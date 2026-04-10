import os
import json
import base64
import time
from uuid import uuid4
from html import escape
import requests
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from supabase import create_client, Client
from fastapi import UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import io
from datetime import datetime, timedelta, timezone

load_dotenv()

# Инициализация Supabase
def _decode_jwt_payload(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return {}
        payload = parts[1]
        padding = "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload + padding)
        return json.loads(decoded.decode("utf-8"))
    except Exception:
        return {}


def _is_safe_public_supabase_key(value: Optional[str]) -> bool:
    if not value:
        return False
    if value.startswith("sb_publishable_"):
        return True
    payload = _decode_jwt_payload(value)
    return payload.get("role") == "anon"


SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
SUPABASE_PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
ALLOW_DEV_AUTH_BYPASS = os.environ.get("ALLOW_DEV_AUTH_BYPASS", "false").lower() == "true"

if not SUPABASE_PUBLISHABLE_KEY and _is_safe_public_supabase_key(os.environ.get("SUPABASE_KEY")):
    SUPABASE_PUBLISHABLE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Отсутствуют переменные окружения SUPABASE_URL и SUPABASE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

QUOTATION_STATUS_ALIASES = {
    "Draft": "Pending",
    "Sent": "Pending",
    "Accepted": "Booked",
    "Rejected": "Canceled",
}
VALID_QUOTATION_STATUSES = {"Pending", "Booked", "Canceled"}
REST_SCHEMA_CACHE_TTL_SECONDS = 30
REST_SCHEMA: dict[str, set[str]] = {}
REST_SCHEMA_FETCHED_AT = 0.0
STAFF_CAPABILITIES_FILE = os.path.join(os.path.dirname(__file__), "staff_capabilities.json")
VALID_STAFF_CAPABILITIES = {"Admin", "HR", "Sales", "Operations"}
STAFF_CAPABILITY_CACHE_TTL_SECONDS = 30
STAFF_CAPABILITY_OVERRIDES_CACHE: dict[str, set[str]] = {}
STAFF_CAPABILITY_OVERRIDES_FETCHED_AT = 0.0


def _fetch_rest_schema() -> dict[str, set[str]]:
    try:
        response = requests.get(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Accept": "application/openapi+json",
            },
            timeout=10,
        )
        response.raise_for_status()
        spec = response.json()
        definitions = spec.get("definitions", {})
        return {
            table_name: set(definition.get("properties", {}).keys())
            for table_name, definition in definitions.items()
        }
    except Exception:
        return {}


def _refresh_rest_schema(force: bool = False) -> dict[str, set[str]]:
    global REST_SCHEMA
    global REST_SCHEMA_FETCHED_AT

    now = time.monotonic()
    if not force and REST_SCHEMA and (now - REST_SCHEMA_FETCHED_AT) < REST_SCHEMA_CACHE_TTL_SECONDS:
        return REST_SCHEMA

    schema = _fetch_rest_schema()
    if schema:
        REST_SCHEMA = schema
        REST_SCHEMA_FETCHED_AT = now
    return REST_SCHEMA


def _normalize_staff_capability(value: Optional[str]) -> Optional[str]:
    mapping = {
        "admin": "Admin",
        "hr": "HR",
        "sales": "Sales",
        "operations": "Operations",
    }
    if not value:
        return None
    return mapping.get(str(value).strip().lower())


def _merge_staff_capability_override_maps(*maps: dict[str, set[str]]) -> dict[str, set[str]]:
    merged: dict[str, set[str]] = {}
    for mapping in maps:
        for email, capabilities in mapping.items():
            merged.setdefault(email, set()).update(capabilities)
    return merged


def _load_staff_capability_file_overrides() -> dict[str, set[str]]:
    try:
        with open(STAFF_CAPABILITIES_FILE, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except FileNotFoundError:
        return {}
    except Exception:
        return {}

    overrides = {}
    if not isinstance(payload, dict):
        return overrides

    for email, raw_capabilities in payload.items():
        if not isinstance(email, str):
            continue
        normalized_email = email.strip().lower()
        if not normalized_email:
            continue
        if isinstance(raw_capabilities, str):
            raw_capabilities = [raw_capabilities]
        if not isinstance(raw_capabilities, list):
            continue
        capabilities = {
            normalized
            for item in raw_capabilities
            if (normalized := _normalize_staff_capability(item)) in VALID_STAFF_CAPABILITIES
        }
        if capabilities:
            overrides[normalized_email] = capabilities
    return overrides


def _fetch_staff_capability_overrides_from_db() -> dict[str, set[str]]:
    if not _table_exists("staff_capability_overrides"):
        return {}

    try:
        response = (
            supabase.table("staff_capability_overrides")
            .select("capability, staff:staff(email)")
            .execute()
        )
    except Exception:
        return {}

    overrides: dict[str, set[str]] = {}
    for row in response.data or []:
        normalized = _normalize_staff_capability(row.get("capability"))
        email = ((row.get("staff") or {}).get("email") or "").strip().lower()
        if normalized in VALID_STAFF_CAPABILITIES and email:
            overrides.setdefault(email, set()).add(normalized)
    return overrides


def _load_staff_capability_overrides(force: bool = False) -> dict[str, set[str]]:
    global STAFF_CAPABILITY_OVERRIDES_CACHE
    global STAFF_CAPABILITY_OVERRIDES_FETCHED_AT

    now = time.monotonic()
    if not force and STAFF_CAPABILITY_OVERRIDES_CACHE and (now - STAFF_CAPABILITY_OVERRIDES_FETCHED_AT) < STAFF_CAPABILITY_CACHE_TTL_SECONDS:
        return STAFF_CAPABILITY_OVERRIDES_CACHE

    overrides = _merge_staff_capability_override_maps(
        _load_staff_capability_file_overrides(),
        _fetch_staff_capability_overrides_from_db(),
    )
    STAFF_CAPABILITY_OVERRIDES_CACHE = overrides
    STAFF_CAPABILITY_OVERRIDES_FETCHED_AT = now
    return overrides


def _get_staff_capabilities(staff_member: dict) -> list[str]:
    capabilities = set()
    primary_role = _normalize_staff_capability(staff_member.get("role"))
    if primary_role:
        capabilities.add(primary_role)

    email = (staff_member.get("email") or "").strip().lower()
    overrides = _load_staff_capability_overrides()
    capabilities.update(overrides.get(email, set()))
    return sorted(capabilities)


def _has_capability(current_user: Optional[dict], capability: str) -> bool:
    if not current_user:
        return False
    normalized = _normalize_staff_capability(capability)
    if not normalized:
        return False
    capabilities = current_user.get("capabilities") or [current_user.get("role")]
    return normalized in capabilities


def _has_any_capability(current_user: Optional[dict], capabilities: set[str]) -> bool:
    return any(_has_capability(current_user, capability) for capability in capabilities)


def _is_admin_like(current_user: Optional[dict]) -> bool:
    return _has_any_capability(current_user, {"Admin", "HR"})


def _is_self_or_admin(current_user: dict, staff_id: str) -> bool:
    return _is_admin_like(current_user) or current_user.get("staff_id") == staff_id


def _normalize_capability_list(values: Optional[list[str]]) -> list[str]:
    normalized_values = []
    seen = set()
    for value in values or []:
        normalized = _normalize_staff_capability(value)
        if normalized in VALID_STAFF_CAPABILITIES and normalized not in seen:
            normalized_values.append(normalized)
            seen.add(normalized)
    return normalized_values


def _sync_staff_capability_overrides(staff_id: str, primary_role: Optional[str], requested_capabilities: list[str]):
    if not _table_exists("staff_capability_overrides"):
        return

    primary = _normalize_staff_capability(primary_role)
    effective_capabilities = set(_normalize_capability_list(requested_capabilities))
    if primary:
        effective_capabilities.add(primary)
    extra_capabilities = sorted(capability for capability in effective_capabilities if capability != primary)

    existing_rows = (
        supabase.table("staff_capability_overrides")
        .select("id, capability")
        .eq("staff_id", staff_id)
        .execute()
        .data
    )
    existing_map = {
        _normalize_staff_capability(row.get("capability")): row
        for row in existing_rows or []
        if _normalize_staff_capability(row.get("capability")) in VALID_STAFF_CAPABILITIES
    }

    for capability in extra_capabilities:
        if capability not in existing_map:
            supabase.table("staff_capability_overrides").insert({
                "staff_id": staff_id,
                "capability": capability,
            }).execute()

    removable_ids = [
        row["id"]
        for capability, row in existing_map.items()
        if capability not in extra_capabilities
    ]
    if removable_ids:
        supabase.table("staff_capability_overrides").delete().in_("id", removable_ids).execute()

    _load_staff_capability_overrides(force=True)


_refresh_rest_schema(force=True)


def _table_exists(table_name: str) -> bool:
    return table_name in _refresh_rest_schema()


def _has_columns(table_name: str, *column_names: str) -> bool:
    columns = _refresh_rest_schema().get(table_name, set())
    return all(column_name in columns for column_name in column_names)


def _filter_known_columns(table_name: str, payload: dict) -> dict:
    columns = _refresh_rest_schema().get(table_name)
    if not columns:
        return payload
    return {key: value for key, value in payload.items() if key in columns}


def _require_table(table_name: str):
    if not _table_exists(table_name):
        raise HTTPException(
            status_code=503,
            detail=f"Supabase table '{table_name}' is not deployed yet.",
        )


def _normalize_quotation_status(status: Optional[str]) -> str:
    normalized = QUOTATION_STATUS_ALIASES.get(status or "", status or "Pending")
    if normalized not in VALID_QUOTATION_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid quotation status. Allowed values: {', '.join(sorted(VALID_QUOTATION_STATUSES))}.",
        )
    return normalized


def _normalize_quotation_rows(rows: list[dict]) -> list[dict]:
    for row in rows:
        row["status"] = QUOTATION_STATUS_ALIASES.get(row.get("status"), row.get("status") or "Pending")
    return rows


def _generate_req_number() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    suffix = uuid4().hex[:4].upper()
    return f"REQ-{stamp}-{suffix}"


def _map_quote_to_shipment_type(transportation_type: Optional[str], trade_direction: Optional[str]) -> str:
    transport = (transportation_type or "").strip()
    direction = (trade_direction or "").strip().lower()

    if transport == "FCL":
        if direction == "export":
            return "ExportFCL"
        if direction == "transit":
            return "TransitFCL"
        return "ImportFCL"

    direct_map = {
        "AIR": "AIR",
        "LCL": "LCL",
        "FTL": "FTL",
        "LTL": "LTL",
        "RailWay": "RailWay",
    }
    if transport in direct_map:
        return direct_map[transport]

    raise HTTPException(
        status_code=422,
        detail=f"Transportation type '{transportation_type}' is not mapped to operations yet.",
    )


def _load_offer_context(offer_id: Optional[str]) -> Optional[dict]:
    if not offer_id or not _table_exists("offers"):
        return None

    select_columns = ["id", "status"]
    for column_name in ["req_number", "sales_manager_id", "client_id", "full_name", "company", "email"]:
        if _has_columns("offers", column_name):
            select_columns.append(column_name)

    response = (
        supabase.table("offers")
        .select(", ".join(select_columns))
        .eq("id", offer_id)
        .single()
        .execute()
    )
    return response.data


def _ensure_offer_assignment_access(offer: Optional[dict], current_user: dict):
    if not offer:
        return

    assigned_manager_id = offer.get("sales_manager_id")

    if _is_admin_like(current_user):
        return

    if not _has_capability(current_user, "Sales"):
        raise HTTPException(status_code=403, detail="Only Sales, HR, or Admin can work with offer requests.")

    if assigned_manager_id and assigned_manager_id != current_user["staff_id"]:
        raise HTTPException(status_code=403, detail="This request is assigned to another sales manager.")


def _ensure_sales_manager_exists(staff_id: Optional[str]) -> Optional[str]:
    if not staff_id:
        return None

    try:
        response = (
            supabase.table("staff")
            .select("id, role")
            .eq("id", staff_id)
            .single()
            .execute()
        )
        staff_member = response.data
    except Exception:
        staff_member = None

    if not staff_member or "Sales" not in _get_staff_capabilities(staff_member):
        raise HTTPException(status_code=422, detail="Assigned manager must be an existing Sales staff member.")
    return staff_id


def _ensure_operations_manager_exists(staff_id: Optional[str]) -> Optional[str]:
    if not staff_id:
        return None

    try:
        response = (
            supabase.table("staff")
            .select("id, role")
            .eq("id", staff_id)
            .single()
            .execute()
        )
        staff_member = response.data
    except Exception:
        staff_member = None

    if not staff_member or "Operations" not in _get_staff_capabilities(staff_member):
        raise HTTPException(status_code=422, detail="Assigned operation manager must be an existing Operations staff member.")
    return staff_id


def _ensure_client_exists(client_id: Optional[str]) -> Optional[str]:
    if not client_id:
        return None

    try:
        response = (
            supabase.table("clients")
            .select("id")
            .eq("id", client_id)
            .single()
            .execute()
        )
        client = response.data
    except Exception:
        client = None

    if not client:
        raise HTTPException(status_code=422, detail="Selected client was not found in the database.")
    return client_id


def _sync_offer_update_to_pending_quotations(offer_id: str, offer_update: dict) -> int:
    if not _table_exists("quotations"):
        return 0

    field_map = {
        "full_name": "contact_name",
        "company": "contact_company",
        "email": "contact_email",
        "origin": "origin",
        "destination": "destination",
        "commodity": "commodity",
        "departure_date": "departure_date",
        "client_id": "client_id",
        "sales_manager_id": "sales_manager_id",
    }
    quotation_update = {
        quotation_field: offer_update[offer_field]
        for offer_field, quotation_field in field_map.items()
        if offer_field in offer_update
    }
    quotation_update = _filter_known_columns("quotations", quotation_update)
    if not quotation_update:
        return 0

    response = (
        supabase.table("quotations")
        .update(quotation_update)
        .eq("offer_id", offer_id)
        .eq("status", "Pending")
        .execute()
    )
    return len(response.data or [])


def _validate_quotation_can_book(quotation: dict):
    _require_table("shipments")

    if not quotation.get("client_id"):
        raise HTTPException(
            status_code=422,
            detail="Link the quotation to a client before marking it as Booked.",
        )

    _map_quote_to_shipment_type(
        quotation.get("transportation_type"),
        quotation.get("trade_direction"),
    )


def _create_shipment_from_quotation(quotation: dict) -> Optional[dict]:
    _validate_quotation_can_book(quotation)

    shipment_type = _map_quote_to_shipment_type(
        quotation.get("transportation_type"),
        quotation.get("trade_direction"),
    )

    if _has_columns("shipments", "quotation_id"):
        existing = (
            supabase.table("shipments")
            .select("*")
            .eq("quotation_id", quotation["id"])
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]

    offer_context = _load_offer_context(quotation.get("offer_id"))
    payload = {
        "quotation_id": quotation["id"],
        "client_id": quotation["client_id"],
        "shipment_type": shipment_type,
        "status": "Pending",
        "departure_date": quotation.get("departure_date"),
        "req_number": quotation.get("req_number") or (offer_context or {}).get("req_number"),
        "incoterms": quotation.get("incoterms"),
        "pol": quotation.get("origin"),
        "pod": quotation.get("destination"),
        "shipper": quotation.get("contact_company") or quotation.get("contact_name"),
        "sales_manager_id": quotation.get("sales_manager_id"),
        "sales_manager_notes": quotation.get("notes"),
    }
    payload = {key: value for key, value in payload.items() if value not in (None, "")}
    payload = _filter_known_columns("shipments", payload)

    response = supabase.table("shipments").insert(payload).execute()
    return response.data[0] if response.data else None


def _build_quotation_email_subject(quotation: dict) -> str:
    req_number = quotation.get("req_number") or "Formag Quote"
    route = " -> ".join([part for part in [quotation.get("origin"), quotation.get("destination")] if part])
    transport = quotation.get("transportation_type") or "Freight"
    subject_parts = [req_number, transport]
    if route:
        subject_parts.append(route)
    return " | ".join(subject_parts)


def _plain_text_to_email_html(message: Optional[str]) -> Optional[str]:
    if not message or not message.strip():
        return None

    normalized = message.replace("\r\n", "\n").strip()
    paragraphs = []
    for chunk in normalized.split("\n\n"):
        lines = [escape(line.strip()) for line in chunk.split("\n") if line.strip()]
        if lines:
            paragraphs.append(f"<p>{'<br>'.join(lines)}</p>")
    return "".join(paragraphs) if paragraphs else None


def _format_offer_transportation_types(offer: dict) -> str:
    raw_types = offer.get("transportation_type")
    if isinstance(raw_types, list):
        normalized = [str(item).strip() for item in raw_types if str(item).strip()]
        return ", ".join(normalized) if normalized else "Freight"
    if isinstance(raw_types, str) and raw_types.strip():
        return raw_types.strip()
    return "Freight"


def _load_staff_sender_defaults(staff_id: Optional[str]) -> dict:
    defaults = {
        "sender_name": "",
        "sender_email": "",
        "signature_html": "",
    }
    if not staff_id or not _table_exists("staff"):
        return defaults

    select_columns = ["full_name", "email"]
    if _has_columns("staff", "signature_html"):
        select_columns.append("signature_html")

    response = (
        supabase.table("staff")
        .select(", ".join(select_columns))
        .eq("id", staff_id)
        .limit(1)
        .execute()
    )
    row = response.data[0] if response.data else None
    if not row:
        return defaults

    return {
        "sender_name": row.get("full_name") or "",
        "sender_email": row.get("email") or "",
        "signature_html": row.get("signature_html") or "",
    }


def _resolve_sales_sender_context(sender_staff_id: Optional[str]) -> dict:
    sender_staff_id = _ensure_sales_manager_exists(sender_staff_id)
    if not sender_staff_id:
        raise HTTPException(status_code=422, detail="Assign a sales manager before sending emails.")

    sender_profile = _load_sender_profile(sender_staff_id)
    sender_defaults = _load_staff_sender_defaults(sender_staff_id)
    effective_sender = dict(sender_profile or {})
    if sender_defaults.get("sender_name") and not effective_sender.get("sender_name"):
        effective_sender["sender_name"] = sender_defaults["sender_name"]
    if sender_defaults.get("signature_html") and not effective_sender.get("email_signature_html"):
        effective_sender["email_signature_html"] = sender_defaults["signature_html"]

    using_personal_profile = bool(sender_profile)
    if using_personal_profile:
        missing_fields = []
        for field_name in ["sender_email", "smtp_host", "smtp_username", "smtp_password"]:
            if not sender_profile.get(field_name):
                missing_fields.append(field_name)
        if missing_fields:
            raise HTTPException(
                status_code=503,
                detail=f"Assigned sales manager sender profile is incomplete: {', '.join(missing_fields)}.",
            )
        sender_email = sender_profile.get("sender_email") or sender_defaults.get("sender_email")
    else:
        sender_email = os.environ.get("SMTP_USER", "")
        if not sender_email or not os.environ.get("SMTP_PASSWORD"):
            raise HTTPException(
                status_code=503,
                detail="No active manager sender profile and no global SMTP fallback configured on the server.",
            )

    return {
        "sender_staff_id": sender_staff_id,
        "sender_profile": sender_profile,
        "sender_defaults": sender_defaults,
        "effective_sender": effective_sender,
        "sender_email": sender_email,
        "using_personal_profile": using_personal_profile,
    }


def _build_offer_request_email_subject(offer: dict) -> str:
    req_number = offer.get("req_number") or "Formag Request"
    route = " -> ".join([part for part in [offer.get("origin"), offer.get("destination")] if part])
    transport = _format_offer_transportation_types(offer)
    subject_parts = [req_number, "Rate Request", transport]
    if route:
        subject_parts.append(route)
    return " | ".join(subject_parts)


def _build_offer_request_email_html(
    offer: dict,
    custom_message: Optional[str],
    sender_profile: Optional[dict],
    agent: Optional[dict] = None,
) -> str:
    agent_name = escape((agent or {}).get("company_name") or "Partner")
    contact_name = escape(offer.get("full_name") or "Customer")
    company = escape(offer.get("company") or "—")
    client_email = escape(offer.get("email") or "—")
    client_phone = escape(offer.get("phone") or "—")
    route = " -> ".join([part for part in [offer.get("origin"), offer.get("destination")] if part]) or "Route on request"
    route = escape(route)
    transport = escape(_format_offer_transportation_types(offer))
    commodity = escape(offer.get("commodity") or "—")
    departure = escape(offer.get("departure_date") or "Open")
    notes = escape(offer.get("notes") or "—")
    reference = escape(str(offer.get("req_number") or offer.get("id")))
    intro = _plain_text_to_email_html(custom_message) or (
        f"<p>Hello {agent_name} Team,</p>"
        "<p>Please share your best rate and transit details for the shipment request below.</p>"
    )
    signature = (sender_profile or {}).get("email_signature_html") or ""
    if not signature and sender_profile and sender_profile.get("sender_name"):
        signature = f"<p>Best regards,<br>{escape(sender_profile['sender_name'])}</p>"

    return f"""
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6;">
      {intro}
      <table style="border-collapse:collapse;width:100%;max-width:700px;margin:18px 0;background:#f8fafc;border:1px solid #e2e8f0;">
        <tr><td style="padding:12px 14px;font-weight:bold;width:190px;">Reference</td><td style="padding:12px 14px;">{reference}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Transportation</td><td style="padding:12px 14px;">{transport}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Route</td><td style="padding:12px 14px;">{route}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Commodity</td><td style="padding:12px 14px;">{commodity}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Requested Departure</td><td style="padding:12px 14px;">{departure}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Client Contact</td><td style="padding:12px 14px;">{contact_name}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Client Company</td><td style="padding:12px 14px;">{company}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Client Email</td><td style="padding:12px 14px;">{client_email}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Client Phone</td><td style="padding:12px 14px;">{client_phone}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Request Notes</td><td style="padding:12px 14px;">{notes}</td></tr>
      </table>
      <p>Please reply with your best rate, validity, transit time, and any important remarks.</p>
      {signature}
    </div>
    """


def _build_quotation_email_html(quotation: dict, custom_message: Optional[str], sender_profile: Optional[dict]) -> str:
    contact_name = escape(quotation.get("contact_name") or "Valued Customer")
    route = " -> ".join([part for part in [quotation.get("origin"), quotation.get("destination")] if part]) or "Route on request"
    route = escape(route)
    transport = escape(quotation.get("transportation_type") or "—")
    commodity = escape(quotation.get("commodity") or "—")
    reference = escape(str(quotation.get("req_number") or quotation.get("id")))
    incoterms = escape(quotation.get("incoterms") or "—")
    trade_direction = escape(quotation.get("trade_direction") or "—")
    rate_value = quotation.get("sell_rate") if quotation.get("sell_rate") is not None else quotation.get("rate")
    currency = escape(quotation.get("currency") or "USD")
    if rate_value is not None:
        try:
            rate_line = f"{float(rate_value):,.2f} {currency}"
        except (TypeError, ValueError):
            rate_line = f"{escape(str(rate_value))} {currency}".strip()
    else:
        rate_line = "To be confirmed"
    validity = escape(quotation.get("validity_date") or "Open")
    intro = _plain_text_to_email_html(custom_message) or (
        f"<p>Hello {contact_name},</p>"
        "<p>Please find our freight quotation details below.</p>"
    )
    signature = (sender_profile or {}).get("email_signature_html") or ""
    if not signature and sender_profile and sender_profile.get("sender_name"):
        signature = f"<p>Best regards,<br>{escape(sender_profile['sender_name'])}</p>"

    return f"""
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6;">
      {intro}
      <table style="border-collapse:collapse;width:100%;max-width:680px;margin:18px 0;background:#f8fafc;border:1px solid #e2e8f0;">
        <tr><td style="padding:12px 14px;font-weight:bold;width:180px;">Reference</td><td style="padding:12px 14px;">{reference}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Route</td><td style="padding:12px 14px;">{route}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Transportation</td><td style="padding:12px 14px;">{transport}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Commodity</td><td style="padding:12px 14px;">{commodity}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Price</td><td style="padding:12px 14px;">{rate_line}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Validity</td><td style="padding:12px 14px;">{validity}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Incoterms</td><td style="padding:12px 14px;">{incoterms}</td></tr>
        <tr><td style="padding:12px 14px;font-weight:bold;">Trade Direction</td><td style="padding:12px 14px;">{trade_direction}</td></tr>
      </table>
      <p>If you would like to proceed, please reply to this email and we will move to booking.</p>
      {signature}
    </div>
    """


# Инициализация приложения
app = FastAPI(title="FormagBaku CRM API")

# Настройки CORS для запросов с фронтенда
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- АПИ ЕНДПОИНТЫ (Бэкенд-логика) ---

@app.get("/api/status")
def get_system_status():
    """Тестовый эндпоинт для проверки здоровья сервера и соединения с БД"""
    try:
        res = supabase.table("clients").select("id").limit(1).execute()
        db_status = "Connected to Supabase PostgreSQL"
    except Exception as e:
        db_status = f"Connection Failed: {str(e)}"
        
    return {
        "server": "online",
        "database": db_status,
        "auth": "Supabase Auth",
        "dev_auth_bypass": ALLOW_DEV_AUTH_BYPASS,
        "rest_schema_tables": sorted(_refresh_rest_schema().keys()),
    }

@app.get("/api/public/config")
def get_public_config():
    if not SUPABASE_PUBLISHABLE_KEY:
        raise HTTPException(
            status_code=503,
            detail="SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) is required for browser authentication."
        )
    return {
        "supabaseUrl": SUPABASE_URL,
        "supabasePublishableKey": SUPABASE_PUBLISHABLE_KEY
    }


def _get_dev_user():
    try:
        res = supabase.table("staff").select("id, full_name, role, email").limit(1).execute()
        if res.data:
            staff_member = res.data[0]
            return {
                "staff_id": staff_member["id"],
                "full_name": staff_member["full_name"],
                "role": "Admin",
                "capabilities": ["Admin"],
                "email": staff_member["email"],
                "auth_user_id": None,
                "dev_mode": True
            }
    except Exception:
        pass

    return {
        "staff_id": None,
        "full_name": "Dev Admin",
        "role": "Admin",
        "capabilities": ["Admin"],
        "email": None,
        "auth_user_id": None,
        "dev_mode": True
    }


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization.split(" ", 1)[1].strip()


def _fetch_supabase_auth_user(access_token: str) -> dict:
    api_key = SUPABASE_PUBLISHABLE_KEY or SUPABASE_KEY
    auth_url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/user"
    response = requests.get(
        auth_url,
        headers={
            "apikey": api_key,
            "Authorization": f"Bearer {access_token}"
        },
        timeout=10
    )

    if response.status_code != 200:
        detail = "Invalid or expired Supabase access token"
        try:
            payload = response.json()
            if isinstance(payload, dict) and payload.get("msg"):
                detail = payload["msg"]
        except Exception:
            pass
        raise HTTPException(status_code=401, detail=detail)

    return response.json()


def _get_staff_by_email(email: str, auth_user_id: Optional[str], dev_mode: bool) -> dict:
    try:
        select_columns = ["id", "full_name", "role", "email"]
        if _has_columns("staff", "is_active"):
            select_columns.append("is_active")
        res = supabase.table("staff").select(", ".join(select_columns)).eq("email", email).single().execute()
        staff_member = res.data
        if staff_member.get("is_active") is False:
            raise HTTPException(status_code=403, detail="Your account is disabled. Contact the administrator.")
        capabilities = _get_staff_capabilities(staff_member)
        return {
            "staff_id": staff_member["id"],
            "full_name": staff_member["full_name"],
            "role": staff_member["role"],
            "capabilities": capabilities,
            "email": staff_member["email"],
            "auth_user_id": auth_user_id,
            "dev_mode": dev_mode
        }
    except Exception:
        raise HTTPException(status_code=403, detail=f"Email {email} not found in staff table")


def _require_current_user(authorization: Optional[str]) -> dict:
    token = _extract_bearer_token(authorization)
    if not token:
        if ALLOW_DEV_AUTH_BYPASS:
            return _get_dev_user()
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    auth_user = _fetch_supabase_auth_user(token)
    email = auth_user.get("email")
    if not email:
        raise HTTPException(status_code=403, detail="Authenticated user does not have an email address")

    return _get_staff_by_email(email, auth_user.get("id"), False)


def _get_optional_current_user(authorization: Optional[str]) -> Optional[dict]:
    token = _extract_bearer_token(authorization)
    if not token:
        return None
    auth_user = _fetch_supabase_auth_user(token)
    email = auth_user.get("email")
    if not email:
        raise HTTPException(status_code=403, detail="Authenticated user does not have an email address")
    return _get_staff_by_email(email, auth_user.get("id"), False)


def _require_staff_roles(current_user: dict, allowed_roles: set[str]):
    normalized_allowed = {
        normalized
        for role in allowed_roles
        if (normalized := _normalize_staff_capability(role)) in VALID_STAFF_CAPABILITIES
    }
    if not _has_any_capability(current_user, normalized_allowed):
        raise HTTPException(
            status_code=403,
            detail=f"Access denied. Allowed roles: {', '.join(sorted(allowed_roles))}.",
        )


def _get_staff_select_columns() -> list[str]:
    columns = ["id", "full_name", "email", "role", "auth_user_id"]
    for optional_column in ["is_active", "display_order", "signature_html"]:
        if _has_columns("staff", optional_column):
            columns.append(optional_column)
    return columns


def _serialize_staff_row(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "full_name": row.get("full_name"),
        "email": row.get("email"),
        "role": row.get("role"),
        "capabilities": _get_staff_capabilities(row),
        "capability_override_ready": _table_exists("staff_capability_overrides"),
        "auth_user_id": row.get("auth_user_id"),
        "is_active": row.get("is_active", True),
        "display_order": row.get("display_order", 100),
        "signature_html": row.get("signature_html") or "",
    }


def _get_email_profile_summary(staff_id: str) -> Optional[dict]:
    if not _table_exists("staff_email_profiles"):
        return None

    select_columns = [
        column
        for column in [
            "id",
            "staff_id",
            "is_active",
            "provider",
            "sender_email",
            "sender_name",
            "reply_to_email",
            "smtp_host",
            "smtp_port",
            "smtp_username",
            "smtp_use_ssl",
            "email_signature_html",
        ]
        if _has_columns("staff_email_profiles", column)
    ]
    response = (
        supabase.table("staff_email_profiles")
        .select(", ".join(select_columns))
        .eq("staff_id", staff_id)
        .limit(1)
        .execute()
    )
    row = response.data[0] if response.data else None
    if not row:
        return None
    row["has_smtp_password"] = False
    if _has_columns("staff_email_profiles", "smtp_password"):
        row["has_smtp_password"] = bool(
            (
                supabase.table("staff_email_profiles")
                .select("smtp_password")
                .eq("staff_id", staff_id)
                .limit(1)
                .execute()
                .data[0]
                .get("smtp_password")
            )
        )
    return row


def _load_sender_profile(staff_id: Optional[str]) -> Optional[dict]:
    if not staff_id or not _table_exists("staff_email_profiles"):
        return None

    select_columns = [
        column
        for column in [
            "staff_id",
            "is_active",
            "provider",
            "sender_email",
            "sender_name",
            "reply_to_email",
            "smtp_host",
            "smtp_port",
            "smtp_username",
            "smtp_password",
            "smtp_use_ssl",
            "email_signature_html",
        ]
        if _has_columns("staff_email_profiles", column)
    ]
    response = (
        supabase.table("staff_email_profiles")
        .select(", ".join(select_columns))
        .eq("staff_id", staff_id)
        .limit(1)
        .execute()
    )
    profile = response.data[0] if response.data else None
    if not profile or not profile.get("is_active"):
        return None
    return profile


# --- AUTH: Получение роли текущего пользователя ---
@app.get("/api/auth/me")
def get_current_user(authorization: Optional[str] = Header(None)):
    """
    Принимает Supabase access token из заголовка Authorization: Bearer <token>
    Проверяет токен через Supabase Auth и ищет email в таблице staff.
    """
    return _require_current_user(authorization)

# --- МОДУЛЬ КЛИЕНТОВ ---
class ClientCreate(BaseModel):
    full_name: str
    contact_email: str
    additional_emails: Optional[str] = None
    contact_mobile: str
    telephone: Optional[str] = None
    tax_id: str
    address: str
    website: Optional[str] = None
    is_new_client: bool = False
    sales_manager_id: str

@app.post("/api/clients/register")
def register_client(client: ClientCreate, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR"})
        sales_manager_id = client.sales_manager_id
        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user):
            sales_manager_id = current_user["staff_id"]

        res = supabase.table("clients").insert({
            "full_name": client.full_name,
            "contact_email": client.contact_email,
            "additional_emails": client.additional_emails,
            "contact_mobile": client.contact_mobile,
            "telephone": client.telephone,
            "tax_id": client.tax_id,
            "address": client.address,
            "website": client.website,
            "is_new_client": client.is_new_client,
            "sales_manager_id": sales_manager_id,
            "status": "Active"
        }).execute()
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/clients/import")
async def import_clients(file: UploadFile = File(...)):
    if not file.filename.endswith((".csv", ".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only CSV and Excel files are allowed.")
    
    try:
        content = await file.read()
        if file.filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
            
        columns_lower = [str(c).lower().strip() for c in df.columns]
        
        # Поиск колонки с именем
        name_col_idx = next((i for i, c in enumerate(columns_lower) if "name" in c or "имя" in c or "компани" in c or "клиент" in c), None)
        if name_col_idx is None:
            name_col = df.columns[0]
        else:
            name_col = df.columns[name_col_idx]
        
        email_col = next((df.columns[i] for i, c in enumerate(columns_lower) if "email" in c or "почта" in c), None)
        phone_col = next((df.columns[i] for i, c in enumerate(columns_lower) if "phone" in c or "телефон" in c or "mobile" in c), None)

        records = []
        for index, row in df.iterrows():
            name_val = str(row[name_col]).strip()
            if name_val == "" or name_val.lower() == "nan":
                continue
                
            record = {
                "full_name": name_val,
                "status": "Active"
            }
            if email_col and pd.notna(row[email_col]):
                record["contact_email"] = str(row[email_col]).strip()
            if phone_col and pd.notna(row[phone_col]):
                record["contact_mobile"] = str(row[phone_col]).strip()
                
            records.append(record)
            
        if not records:
            raise HTTPException(status_code=400, detail="No readable records found in file")
            
        res = supabase.table("clients").insert(records).execute()
        return {"status": "success", "inserted": len(res.data)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/clients/dropdown")
def get_clients_dropdown(authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR", "Operations"})
        query = supabase.table("clients").select("id, full_name, sales_manager_id").eq("status", "Active").order("full_name")
        if _has_capability(current_user, "Sales") and not _has_any_capability(current_user, {"Admin", "HR"}):
            query = query.eq("sales_manager_id", current_user["staff_id"])
        res = query.execute()
        return [{"id": row["id"], "full_name": row["full_name"]} for row in res.data]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/clients")
def get_clients(authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR"})
        # Lazy status update: Check for clients inactive for >= 90 days and mark them as 'Lost'
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        try:
            # We use an update query on clients where last_activity_date < cutoff_date and status != 'Lost'
            supabase.table("clients").update({"status": "Lost"}).lt("last_activity_date", cutoff_date).neq("status", "Lost").execute()
        except:
            # If for some reason the quick update fails (e.g. no inactive clients matched, though Postgrest handles this)
            pass

        res = supabase.table("clients").select("*, staff(full_name)").order("id", desc=True).limit(100).execute()
        data = res.data
        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user):
            data = [row for row in data if row.get("sales_manager_id") == current_user["staff_id"]]
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

def _get_staff_members_by_role(role: str):
    try:
        query = supabase.table("staff").select("id, full_name, email, role")
        if _has_columns("staff", "is_active"):
            query = query.eq("is_active", True)
        if _has_columns("staff", "display_order"):
            query = query.order("display_order")
        res = query.order("full_name").execute()
        return [
            {"id": row["id"], "full_name": row["full_name"]}
            for row in res.data
            if role in _get_staff_capabilities(row)
        ]
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/staff/sales_managers")
def get_sales_managers():
    return _get_staff_members_by_role("Sales")


@app.get("/api/staff/operations_managers")
def get_operations_managers():
    return _get_staff_members_by_role("Operations")


class StaffUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    capabilities: Optional[list[str]] = None
    is_active: Optional[bool] = None
    display_order: Optional[int] = None
    signature_html: Optional[str] = None


class StaffEmailProfileUpsert(BaseModel):
    is_active: bool = False
    provider: str = "smtp"
    sender_email: str
    sender_name: Optional[str] = None
    reply_to_email: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_use_ssl: bool = True
    email_signature_html: Optional[str] = None


@app.get("/api/staff")
def get_staff_directory(authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Admin", "HR"})
        query = supabase.table("staff").select(", ".join(_get_staff_select_columns()))
        if _has_columns("staff", "display_order"):
            query = query.order("display_order")
        res = query.order("full_name").execute()
        data = []
        for row in res.data:
            item = _serialize_staff_row(row)
            item["email_profile"] = _get_email_profile_summary(row["id"])
            data.append(item)
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/staff/{staff_id}")
def get_staff_member(staff_id: str, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        if not _is_self_or_admin(current_user, staff_id):
            raise HTTPException(status_code=403, detail="You can only view your own staff profile.")

        row = (
            supabase.table("staff")
            .select(", ".join(_get_staff_select_columns()))
            .eq("id", staff_id)
            .single()
            .execute()
            .data
        )
        if not row:
            raise HTTPException(status_code=404, detail="Staff member not found")
        item = _serialize_staff_row(row)
        item["email_profile"] = _get_email_profile_summary(staff_id)
        return item
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/staff/{staff_id}")
def update_staff_member(
    staff_id: str,
    body: StaffUpdate,
    authorization: Optional[str] = Header(None),
):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Admin", "HR"})
        payload = body.dict(exclude_unset=True)
        requested_capabilities = payload.pop("capabilities", None)
        if not payload:
            row = supabase.table("staff").select(", ".join(_get_staff_select_columns())).eq("id", staff_id).single().execute().data
            if requested_capabilities is not None:
                _sync_staff_capability_overrides(staff_id, row.get("role"), requested_capabilities)
                row = supabase.table("staff").select(", ".join(_get_staff_select_columns())).eq("id", staff_id).single().execute().data
            item = _serialize_staff_row(row)
            item["email_profile"] = _get_email_profile_summary(staff_id)
            return {"status": "success", "data": item}

        if payload.get("role") and payload["role"] not in {"Admin", "HR", "Sales", "Operations"}:
            raise HTTPException(status_code=422, detail="Unsupported staff role.")

        payload = _filter_known_columns("staff", payload)
        response = supabase.table("staff").update(payload).eq("id", staff_id).execute()
        row = response.data[0] if response.data else None
        if not row:
            raise HTTPException(status_code=404, detail="Staff member not found")
        if requested_capabilities is not None:
            _sync_staff_capability_overrides(staff_id, row.get("role"), requested_capabilities)
        fresh_row = supabase.table("staff").select(", ".join(_get_staff_select_columns())).eq("id", staff_id).single().execute().data
        item = _serialize_staff_row(fresh_row or row)
        item["email_profile"] = _get_email_profile_summary(staff_id)
        return {"status": "success", "data": item}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/staff/{staff_id}/email_profile")
def get_staff_email_profile(staff_id: str, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        if not _is_self_or_admin(current_user, staff_id):
            raise HTTPException(status_code=403, detail="You can only view your own sender profile.")

        if not _table_exists("staff_email_profiles"):
            raise HTTPException(status_code=503, detail="Run the Phase 6 settings migration first.")

        summary = _get_email_profile_summary(staff_id)
        return summary or {
            "staff_id": staff_id,
            "is_active": False,
            "provider": "smtp",
            "sender_email": "",
            "sender_name": "",
            "reply_to_email": "",
            "smtp_host": "",
            "smtp_port": 465,
            "smtp_username": "",
            "smtp_use_ssl": True,
            "email_signature_html": "",
            "has_smtp_password": False,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/staff/{staff_id}/email_profile")
def upsert_staff_email_profile(
    staff_id: str,
    body: StaffEmailProfileUpsert,
    authorization: Optional[str] = Header(None),
):
    try:
        current_user = _require_current_user(authorization)
        if not _is_self_or_admin(current_user, staff_id):
            raise HTTPException(status_code=403, detail="You can only update your own sender profile.")
        if not _table_exists("staff_email_profiles"):
            raise HTTPException(status_code=503, detail="Run the Phase 6 settings migration first.")

        payload = body.dict()
        payload["staff_id"] = staff_id
        if payload["provider"] not in {"smtp", "gmail_oauth", "n8n_proxy"}:
            raise HTTPException(status_code=422, detail="Unsupported sender provider.")
        if not payload.get("sender_email"):
            raise HTTPException(status_code=422, detail="Sender email is required.")

        existing_summary = _get_email_profile_summary(staff_id)
        if existing_summary:
            if not payload.get("smtp_password") and _has_columns("staff_email_profiles", "smtp_password"):
                payload.pop("smtp_password", None)
            payload = _filter_known_columns("staff_email_profiles", payload)
            response = supabase.table("staff_email_profiles").update(payload).eq("staff_id", staff_id).execute()
        else:
            payload = _filter_known_columns("staff_email_profiles", payload)
            response = supabase.table("staff_email_profiles").insert(payload).execute()

        row = response.data[0] if response.data else None
        if not row:
            raise HTTPException(status_code=400, detail="Failed to save email profile.")
        return {"status": "success", "data": _get_email_profile_summary(staff_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- МОДУЛЬ АГЕНТОВ ---
class AgentCreate(BaseModel):
    company_name: str
    country: str
    main_email: str
    cc_emails: Optional[str] = None
    transportation_type: list[str]

@app.post("/api/agents/register")
def register_agent(agent: AgentCreate):
    try:
        res = supabase.table("agents").insert({
            "company_name": agent.company_name,
            "country": agent.country,
            "main_email": agent.main_email,
            "cc_emails": agent.cc_emails,
            "transportation_type": agent.transportation_type
        }).execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/agents/import")
async def import_agents(file: UploadFile = File(...), authorization: Optional[str] = Header(None)):
    if not file.filename.endswith((".csv", ".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only CSV and Excel files are allowed.")
    
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Admin", "HR"})
        content = await file.read()
        if file.filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
            
        columns_lower = [str(c).lower().strip() for c in df.columns]
        
        name_col_idx = next((i for i, c in enumerate(columns_lower) if "name" in c or "имя" in c or "компани" in c or "агент" in c), None)
        if name_col_idx is None:
            name_col = df.columns[0]
        else:
            name_col = df.columns[name_col_idx]
            
        contact_col_idx = next((i for i, c in enumerate(columns_lower) if "contact" in c or "контакт" in c or "телефон" in c or "инфо" in c), None)
        
        records = []
        for index, row in df.iterrows():
            name_val = str(row[name_col]).strip()
            if name_val == "" or name_val.lower() == "nan":
                continue
                
            record = {"company_name": name_val}
            if contact_col_idx is not None and pd.notna(row[df.columns[contact_col_idx]]):
                record["contact_info"] = str(row[df.columns[contact_col_idx]]).strip()
                
            records.append(record)
            
        if not records:
            raise HTTPException(status_code=400, detail="No readable records found in file")
            
        res = supabase.table("agents").insert(records).execute()
        return {"status": "success", "inserted": len(res.data)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agents/dropdown")
def get_agents_dropdown(authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR", "Operations"})
        res = supabase.table("agents").select("id, company_name").order("company_name").execute()
        return res.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/agents")
def get_agents(authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR", "Operations"})
        res = supabase.table("agents").select("*").order("company_name").limit(200).execute()
        return res.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- МОДУЛЬ ЗАЯВОК (OFFERS) ---
class OfferRequest(BaseModel):
    full_name: str
    company: Optional[str] = None
    email: str
    phone: Optional[str] = None
    transportation_type: list[str]
    origin: Optional[str] = None
    destination: Optional[str] = None
    departure_date: Optional[str] = None
    commodity: Optional[str] = None
    notes: Optional[str] = None


class OfferRequestUpdate(BaseModel):
    full_name: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    transportation_type: Optional[list[str]] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    departure_date: Optional[str] = None
    commodity: Optional[str] = None
    notes: Optional[str] = None
    client_id: Optional[str] = None
    sales_manager_id: Optional[str] = None


class OfferAgentsEmailSend(BaseModel):
    agent_ids: list[str]
    subject: Optional[str] = None
    message: Optional[str] = None
    cc_emails: Optional[str] = None

@app.post("/api/offers/submit")
def submit_offer(offer: OfferRequest):
    try:
        payload = {
            "full_name": offer.full_name,
            "company": offer.company,
            "email": offer.email,
            "phone": offer.phone,
            "transportation_type": offer.transportation_type,
            "origin": offer.origin,
            "destination": offer.destination,
            "departure_date": offer.departure_date if offer.departure_date else None,
            "commodity": offer.commodity,
            "notes": offer.notes,
            "status": "New"
        }
        if _has_columns("offers", "req_number"):
            payload["req_number"] = _generate_req_number()
        payload = _filter_known_columns("offers", payload)
        res = supabase.table("offers").insert(payload).execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/offers/{offer_id}")
def update_offer_request(
    offer_id: str,
    body: OfferRequestUpdate,
    authorization: Optional[str] = Header(None),
):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR"})

        offer_response = supabase.table("offers").select("*").eq("id", offer_id).single().execute()
        offer = offer_response.data
        if not offer:
            raise HTTPException(status_code=404, detail="Offer request not found")

        _ensure_offer_assignment_access(offer, current_user)

        if offer.get("status") in {"Booked", "Canceled"}:
            raise HTTPException(status_code=422, detail="Finalized requests can no longer be edited.")

        update_payload = body.dict(exclude_unset=True)
        if not update_payload:
            return {"status": "success", "data": [offer], "synced_quotations": 0}

        if "transportation_type" in update_payload:
            transport_types = update_payload.get("transportation_type") or []
            if not isinstance(transport_types, list) or not transport_types:
                raise HTTPException(status_code=422, detail="Select at least one transportation type.")
            update_payload["transportation_type"] = transport_types

        if "departure_date" in update_payload and not update_payload.get("departure_date"):
            update_payload["departure_date"] = None

        if "client_id" in update_payload:
            client_id = update_payload.get("client_id") or None
            update_payload["client_id"] = _ensure_client_exists(client_id)

        if "sales_manager_id" in update_payload:
            requested_manager_id = update_payload.get("sales_manager_id") or None
            if _has_capability(current_user, "Sales") and not _is_admin_like(current_user):
                if requested_manager_id and requested_manager_id != current_user["staff_id"]:
                    raise HTTPException(status_code=403, detail="Sales managers can only keep requests assigned to themselves.")
                update_payload["sales_manager_id"] = current_user["staff_id"]
            else:
                if requested_manager_id is None:
                    if offer.get("status") != "New":
                        raise HTTPException(status_code=422, detail="Only new requests can be returned to the shared queue.")
                    update_payload["sales_manager_id"] = None
                else:
                    update_payload["sales_manager_id"] = _ensure_sales_manager_exists(requested_manager_id)
        elif _has_capability(current_user, "Sales") and not _is_admin_like(current_user) and _has_columns("offers", "sales_manager_id") and not offer.get("sales_manager_id"):
            # Editing an unassigned request effectively means the sales manager takes ownership.
            update_payload["sales_manager_id"] = current_user["staff_id"]

        update_payload = _filter_known_columns("offers", update_payload)
        response = supabase.table("offers").update(update_payload).eq("id", offer_id).execute()
        synced_quotations = _sync_offer_update_to_pending_quotations(offer_id, update_payload)
        return {"status": "success", "data": response.data, "synced_quotations": synced_quotations}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/offers/{offer_id}/send-agents")
def send_offer_to_agents(
    offer_id: str,
    body: OfferAgentsEmailSend,
    authorization: Optional[str] = Header(None),
):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR"})

        offer = (
            supabase.table("offers")
            .select("*, staff(full_name), clients(full_name)")
            .eq("id", offer_id)
            .single()
            .execute()
            .data
        )
        if not offer:
            raise HTTPException(status_code=404, detail="Offer request not found")

        _ensure_offer_assignment_access(offer, current_user)
        if offer.get("status") in {"Booked", "Canceled"}:
            raise HTTPException(status_code=422, detail="Finalized requests cannot be sent to agents.")

        agent_ids = [str(agent_id).strip() for agent_id in (body.agent_ids or []) if str(agent_id).strip()]
        if not agent_ids:
            raise HTTPException(status_code=422, detail="Select at least one agent.")

        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user):
            sender_staff_id = offer.get("sales_manager_id") or current_user["staff_id"]
            if not offer.get("sales_manager_id") and _has_columns("offers", "sales_manager_id"):
                supabase.table("offers").update({"sales_manager_id": current_user["staff_id"]}).eq("id", offer_id).execute()
                offer["sales_manager_id"] = current_user["staff_id"]
        else:
            sender_staff_id = offer.get("sales_manager_id")

        sender_context = _resolve_sales_sender_context(sender_staff_id)
        subject = (body.subject or "").strip() or _build_offer_request_email_subject(offer)

        agents = (
            supabase.table("agents")
            .select("id, company_name, main_email, cc_emails, country, transportation_type")
            .in_("id", agent_ids)
            .execute()
            .data
        )
        agent_map = {agent["id"]: agent for agent in agents}

        sent_agents = []
        failed_agents = []
        for agent_id in agent_ids:
            agent = agent_map.get(agent_id)
            if not agent:
                failed_agents.append({"agent_id": agent_id, "reason": "Agent not found"})
                continue

            recipient_email = (agent.get("main_email") or "").strip()
            if not recipient_email:
                failed_agents.append({"agent_id": agent_id, "company_name": agent.get("company_name"), "reason": "Agent main email is missing"})
                continue

            merged_cc = ", ".join(
                _normalize_email_list(
                    ",".join(
                        part for part in [agent.get("cc_emails") or "", body.cc_emails or ""] if part
                    )
                )
            )
            html_content = _build_offer_request_email_html(
                offer,
                body.message,
                sender_context["effective_sender"] or None,
                agent=agent,
            )
            sent = send_sales_manager_email(
                to_email=recipient_email,
                subject=subject,
                html_content=html_content,
                sales_manager_id=sender_context["sender_staff_id"],
                cc_emails=merged_cc,
            )
            if sent:
                sent_agents.append(
                    {
                        "agent_id": agent["id"],
                        "company_name": agent.get("company_name"),
                        "to_email": recipient_email,
                        "cc_emails": _normalize_email_list(merged_cc),
                    }
                )
            else:
                failed_agents.append(
                    {
                        "agent_id": agent["id"],
                        "company_name": agent.get("company_name"),
                        "reason": "SMTP delivery failed",
                    }
                )

        if not sent_agents:
            raise HTTPException(
                status_code=502,
                detail=failed_agents[0]["reason"] if failed_agents else "No agent emails were delivered.",
            )

        return {
            "status": "success" if not failed_agents else "partial",
            "data": {
                "offer_id": offer_id,
                "subject": subject,
                "sender_staff_id": sender_context["sender_staff_id"],
                "sender_email": sender_context["sender_email"],
                "sender_name": sender_context["effective_sender"].get("sender_name")
                or sender_context["sender_defaults"].get("sender_name")
                or "",
                "used_personal_profile": sender_context["using_personal_profile"],
                "sent_agents": sent_agents,
                "failed_agents": failed_agents,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- МОДУЛЬ ГРУЗОВ (SHIPMENTS) ---
class ShipmentCreate(BaseModel):
    client_id: str
    agent_id: Optional[str] = None
    shipment_type: str
    status: str
    departure_date: Optional[str] = None
    delivery_date: Optional[str] = None
    
    # Phase 2.1 Extended Fields
    bk_number: Optional[str] = None
    so_number: Optional[str] = None
    req_number: Optional[str] = None
    shipper: Optional[str] = None
    incoterms: Optional[str] = None
    pol: Optional[str] = None
    pod: Optional[str] = None
    pol_agent_id: Optional[str] = None
    pod_agent_id: Optional[str] = None
    
    eta_transshipment_port: Optional[str] = None
    etd_transshipment_port: Optional[str] = None
    stuffing_date: Optional[str] = None
    loading_date_from_pod: Optional[str] = None
    border_arrival_date: Optional[str] = None
    time_of_arrival_at_delivery_point: Optional[str] = None
    
    container_quantity: Optional[int] = None
    container_type: Optional[str] = None
    container_number: Optional[str] = None
    empty_container_return_date_at_pod: Optional[str] = None
    
    mbl_number: Optional[str] = None
    shipping_line: Optional[str] = None
    feeder_vessel_name: Optional[str] = None
    eta_vessel_at_pod: Optional[str] = None
    vessel_unloading_date: Optional[str] = None
    hbl_release_date: Optional[str] = None
    mbl_release_date: Optional[str] = None
    
    date_of_receipt_of_documents: Optional[str] = None
    doc_sent_to_agent_date: Optional[str] = None
    short_declaration: Optional[str] = None
    terminal_name: Optional[str] = None
    d_o_date: Optional[str] = None
    cargo_delivery_date: Optional[str] = None
    
    driver_information: Optional[str] = None
    sales_manager_notes: Optional[str] = None
    operation_notes: Optional[str] = None
    rate_pol_agent_service_quality: Optional[int] = None
    rate_pod_agent_service_quality: Optional[int] = None
    
    sales_manager_id: Optional[str] = None
    operation_manager_id: Optional[str] = None


class ShipmentUpdate(BaseModel):
    client_id: Optional[str] = None
    agent_id: Optional[str] = None
    shipment_type: Optional[str] = None
    status: Optional[str] = None
    departure_date: Optional[str] = None
    delivery_date: Optional[str] = None
    bk_number: Optional[str] = None
    so_number: Optional[str] = None
    req_number: Optional[str] = None
    shipper: Optional[str] = None
    incoterms: Optional[str] = None
    pol: Optional[str] = None
    pod: Optional[str] = None
    pol_agent_id: Optional[str] = None
    pod_agent_id: Optional[str] = None
    eta_transshipment_port: Optional[str] = None
    etd_transshipment_port: Optional[str] = None
    stuffing_date: Optional[str] = None
    loading_date_from_pod: Optional[str] = None
    border_arrival_date: Optional[str] = None
    time_of_arrival_at_delivery_point: Optional[str] = None
    container_quantity: Optional[int] = None
    container_type: Optional[str] = None
    container_number: Optional[str] = None
    empty_container_return_date_at_pod: Optional[str] = None
    mbl_number: Optional[str] = None
    shipping_line: Optional[str] = None
    feeder_vessel_name: Optional[str] = None
    eta_vessel_at_pod: Optional[str] = None
    vessel_unloading_date: Optional[str] = None
    hbl_release_date: Optional[str] = None
    mbl_release_date: Optional[str] = None
    date_of_receipt_of_documents: Optional[str] = None
    doc_sent_to_agent_date: Optional[str] = None
    short_declaration: Optional[str] = None
    terminal_name: Optional[str] = None
    d_o_date: Optional[str] = None
    cargo_delivery_date: Optional[str] = None
    driver_information: Optional[str] = None
    sales_manager_notes: Optional[str] = None
    operation_notes: Optional[str] = None
    rate_pol_agent_service_quality: Optional[int] = None
    rate_pod_agent_service_quality: Optional[int] = None
    sales_manager_id: Optional[str] = None
    operation_manager_id: Optional[str] = None


def _prepare_shipment_payload(data: dict, current_user: Optional[dict], existing_shipment: Optional[dict] = None) -> dict:
    if "client_id" in data:
        data["client_id"] = _ensure_client_exists(data.get("client_id") or None)

    if "sales_manager_id" in data:
        requested_sales_manager_id = data.get("sales_manager_id") or None
        if current_user and _has_capability(current_user, "Sales") and not _has_any_capability(current_user, {"Admin", "HR"}):
            if requested_sales_manager_id and requested_sales_manager_id != current_user["staff_id"]:
                raise HTTPException(status_code=403, detail="Sales managers can only keep shipments assigned to themselves.")
            data["sales_manager_id"] = current_user["staff_id"]
        else:
            data["sales_manager_id"] = _ensure_sales_manager_exists(requested_sales_manager_id)
    elif current_user and _has_capability(current_user, "Sales") and not _has_any_capability(current_user, {"Admin", "HR"}):
        data["sales_manager_id"] = current_user["staff_id"]

    if "operation_manager_id" in data:
        requested_operation_manager_id = data.get("operation_manager_id") or None
        if current_user and _has_capability(current_user, "Operations") and not _has_any_capability(current_user, {"Admin", "HR"}):
            if requested_operation_manager_id and requested_operation_manager_id != current_user["staff_id"]:
                raise HTTPException(status_code=403, detail="Operations users can only keep shipments assigned to themselves.")
            data["operation_manager_id"] = current_user["staff_id"]
        else:
            data["operation_manager_id"] = _ensure_operations_manager_exists(requested_operation_manager_id)
    elif current_user and _has_capability(current_user, "Operations") and not _has_any_capability(current_user, {"Admin", "HR"}):
        if not existing_shipment or not existing_shipment.get("operation_manager_id"):
            data["operation_manager_id"] = current_user["staff_id"]

    uuid_fields = ["agent_id", "pol_agent_id", "pod_agent_id", "sales_manager_id", "operation_manager_id"]
    for key in uuid_fields:
        if data.get(key) == "":
            data[key] = None

    date_fields = [
        "departure_date", "delivery_date", "eta_transshipment_port", "etd_transshipment_port",
        "stuffing_date", "loading_date_from_pod", "border_arrival_date",
        "empty_container_return_date_at_pod", "eta_vessel_at_pod", "vessel_unloading_date",
        "hbl_release_date", "mbl_release_date", "date_of_receipt_of_documents",
        "doc_sent_to_agent_date", "d_o_date", "cargo_delivery_date", "time_of_arrival_at_delivery_point",
    ]
    for key in date_fields:
        if key in data and not data.get(key):
            data[key] = None

    return _filter_known_columns("shipments", data)


def _hydrate_shipments(rows: list[dict]) -> list[dict]:
    if not rows:
        return rows

    staff_ids = {
        staff_id
        for row in rows
        for staff_id in [row.get("sales_manager_id"), row.get("operation_manager_id")]
        if staff_id
    }
    staff_map = {}
    if staff_ids and _table_exists("staff"):
        staff_rows = (
            supabase.table("staff")
            .select("id, full_name")
            .in_("id", list(staff_ids))
            .execute()
            .data
        )
        staff_map = {row["id"]: row.get("full_name") for row in staff_rows}

    agent_ids = {
        agent_id
        for row in rows
        for agent_id in [row.get("agent_id"), row.get("pol_agent_id"), row.get("pod_agent_id")]
        if agent_id
    }
    agent_map = {}
    if agent_ids and _table_exists("agents"):
        agent_rows = (
            supabase.table("agents")
            .select("id, company_name")
            .in_("id", list(agent_ids))
            .execute()
            .data
        )
        agent_map = {row["id"]: row.get("company_name") for row in agent_rows}

    for row in rows:
        row["sales_manager_name"] = staff_map.get(row.get("sales_manager_id")) or ""
        row["operation_manager_name"] = staff_map.get(row.get("operation_manager_id")) or ""
        row["agent_name"] = agent_map.get(row.get("agent_id")) or ""
        row["pol_agent_name"] = agent_map.get(row.get("pol_agent_id")) or ""
        row["pod_agent_name"] = agent_map.get(row.get("pod_agent_id")) or ""
    return rows


@app.post("/api/shipments/register")
def register_shipment(ship: ShipmentCreate, authorization: Optional[str] = Header(None)):
    try:
        _require_table("shipments")
        current_user = _get_optional_current_user(authorization)
        data = ship.dict(exclude_none=True)
        data = _prepare_shipment_payload(data, current_user)
        res = supabase.table("shipments").insert(data).execute()
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/shipments/{shipment_id}")
def update_shipment(
    shipment_id: str,
    body: ShipmentUpdate,
    authorization: Optional[str] = Header(None),
):
    try:
        _require_table("shipments")
        current_user = _require_current_user(authorization)
        if not _has_any_capability(current_user, {"Admin", "HR", "Sales", "Operations"}):
            raise HTTPException(status_code=403, detail="You do not have access to update shipment files.")

        shipment = supabase.table("shipments").select("*").eq("id", shipment_id).single().execute().data
        if not shipment:
            raise HTTPException(status_code=404, detail="Shipment not found")

        if not _has_any_capability(current_user, {"Admin", "HR"}):
            sales_allowed = _has_capability(current_user, "Sales") and shipment.get("sales_manager_id") == current_user["staff_id"]
            assigned_operation_manager = shipment.get("operation_manager_id")
            operations_allowed = _has_capability(current_user, "Operations") and assigned_operation_manager in (None, current_user["staff_id"])
            if not sales_allowed and not operations_allowed:
                raise HTTPException(status_code=403, detail="You can only update shipments assigned to your sales or operations queue.")

        update_payload = body.dict(exclude_unset=True)
        if not update_payload:
            return {"status": "success", "data": [shipment]}

        update_payload = _prepare_shipment_payload(update_payload, current_user, existing_shipment=shipment)
        res = supabase.table("shipments").update(update_payload).eq("id", shipment_id).execute()
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/shipments/{shipment_id}/claim")
def claim_shipment(shipment_id: str, authorization: Optional[str] = Header(None)):
    try:
        _require_table("shipments")
        current_user = _require_current_user(authorization)
        if not _has_capability(current_user, "Operations"):
            raise HTTPException(status_code=403, detail="Only Operations users can claim shipment files.")

        shipment = supabase.table("shipments").select("*").eq("id", shipment_id).single().execute().data
        if not shipment:
            raise HTTPException(status_code=404, detail="Shipment not found")

        assigned_operation_manager = shipment.get("operation_manager_id")
        if assigned_operation_manager and assigned_operation_manager != current_user["staff_id"]:
            raise HTTPException(status_code=403, detail="This shipment is already assigned to another operation manager.")

        res = (
            supabase.table("shipments")
            .update(_filter_known_columns("shipments", {"operation_manager_id": current_user["staff_id"]}))
            .eq("id", shipment_id)
            .execute()
        )
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/shipments/{shipment_id}/release")
def release_shipment(shipment_id: str, authorization: Optional[str] = Header(None)):
    try:
        _require_table("shipments")
        current_user = _require_current_user(authorization)
        if not _has_any_capability(current_user, {"Operations", "Admin", "HR"}):
            raise HTTPException(status_code=403, detail="Only Operations, HR, or Admin can release shipment files.")

        shipment = supabase.table("shipments").select("*").eq("id", shipment_id).single().execute().data
        if not shipment:
            raise HTTPException(status_code=404, detail="Shipment not found")

        if _has_capability(current_user, "Operations") and not _has_any_capability(current_user, {"Admin", "HR"}) and shipment.get("operation_manager_id") != current_user["staff_id"]:
            raise HTTPException(status_code=403, detail="You can only release shipments assigned to you.")

        res = (
            supabase.table("shipments")
            .update(_filter_known_columns("shipments", {"operation_manager_id": None}))
            .eq("id", shipment_id)
            .execute()
        )
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/shipments")
def get_shipments(scope: Optional[str] = None, authorization: Optional[str] = Header(None)):
    try:
        if not _table_exists("shipments"):
            return []
        # Keep the shipments query unambiguous after adding multiple agent FKs.
        res = supabase.table("shipments").select(
            "*, clients(full_name)"
        ).order("created_at", desc=True).limit(200).execute()
        current_user = _get_optional_current_user(authorization)
        data = res.data
        if current_user and not _has_any_capability(current_user, {"Admin", "HR"}):
            effective_scope = (scope or "").strip().lower()
            if effective_scope == "operations" and _has_capability(current_user, "Operations") and _has_columns("shipments", "operation_manager_id"):
                data = [
                    row for row in data
                    if row.get("operation_manager_id") in (None, current_user["staff_id"])
                ]
            elif effective_scope == "sales" and _has_capability(current_user, "Sales") and _has_columns("shipments", "sales_manager_id"):
                data = [row for row in data if row.get("sales_manager_id") == current_user["staff_id"]]
            elif _has_capability(current_user, "Operations") and _has_columns("shipments", "operation_manager_id"):
                data = [
                    row for row in data
                    if row.get("operation_manager_id") in (None, current_user["staff_id"])
                ]
            elif _has_capability(current_user, "Sales") and _has_columns("shipments", "sales_manager_id"):
                data = [row for row in data if row.get("sales_manager_id") == current_user["staff_id"]]
        return _hydrate_shipments(data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- МОДУЛЬ КОТИРОВОК (QUOTATIONS) ---
class QuotationCreate(BaseModel):
    offer_id: Optional[str] = None
    client_id: Optional[str] = None
    contact_name: str
    contact_email: Optional[str] = None
    contact_company: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    transportation_type: Optional[str] = None
    commodity: Optional[str] = None
    departure_date: Optional[str] = None
    buy_rate: Optional[float] = None
    sell_rate: Optional[float] = None
    currency: str = "USD"
    validity_date: Optional[str] = None
    incoterms: Optional[str] = None
    trade_direction: Optional[str] = None
    sales_manager_id: Optional[str] = None
    notes: Optional[str] = None
    status: str = "Pending"


class QuotationUpdate(BaseModel):
    client_id: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_company: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    transportation_type: Optional[str] = None
    commodity: Optional[str] = None
    departure_date: Optional[str] = None
    buy_rate: Optional[float] = None
    sell_rate: Optional[float] = None
    currency: Optional[str] = None
    validity_date: Optional[str] = None
    incoterms: Optional[str] = None
    trade_direction: Optional[str] = None
    sales_manager_id: Optional[str] = None
    notes: Optional[str] = None


class QuotationEmailSend(BaseModel):
    to_email: Optional[str] = None
    cc_emails: Optional[str] = None
    subject: Optional[str] = None
    message: Optional[str] = None

@app.post("/api/quotations/create")
def create_quotation(q: QuotationCreate, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR"})
        margin = None
        if q.sell_rate is not None and q.buy_rate is not None:
            margin = round(q.sell_rate - q.buy_rate, 2)
        sales_manager_id = q.sales_manager_id if q.sales_manager_id else None
        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user):
            sales_manager_id = current_user["staff_id"]
        normalized_status = _normalize_quotation_status(q.status)
        offer_context = _load_offer_context(q.offer_id)
        _ensure_offer_assignment_access(offer_context, current_user)
        payload = {
            "offer_id": q.offer_id if q.offer_id else None,
            "client_id": q.client_id if q.client_id else None,
            "contact_name": q.contact_name,
            "contact_email": q.contact_email,
            "contact_company": q.contact_company,
            "origin": q.origin,
            "destination": q.destination,
            "transportation_type": q.transportation_type,
            "commodity": q.commodity,
            "departure_date": q.departure_date if q.departure_date else None,
            "buy_rate": q.buy_rate,
            "sell_rate": q.sell_rate,
            "rate": q.sell_rate,  # backward compat
            "currency": q.currency,
            "validity_date": q.validity_date if q.validity_date else None,
            "incoterms": q.incoterms,
            "trade_direction": q.trade_direction,
            "req_number": (offer_context or {}).get("req_number"),
            "sales_manager_id": sales_manager_id,
            "notes": q.notes,
            "status": normalized_status
        }
        if normalized_status == "Booked":
            _validate_quotation_can_book(payload)
        if normalized_status == "Booked":
            payload["booked_at"] = datetime.now(timezone.utc).isoformat()
            if current_user:
                payload["booked_by_staff_id"] = current_user["staff_id"]
        payload = _filter_known_columns("quotations", payload)
        res = supabase.table("quotations").insert(payload).execute()
        quotation_row = res.data[0] if res.data else None
        # Mark the offer as processed if linked
        if q.offer_id:
            offer_update = {"status": "Quoted"}
            if _has_columns("offers", "sales_manager_id"):
                offer_update["sales_manager_id"] = sales_manager_id
            if q.client_id and _has_columns("offers", "client_id"):
                offer_update["client_id"] = q.client_id
            if _has_columns("offers", "quoted_at"):
                offer_update["quoted_at"] = datetime.now(timezone.utc).isoformat()
            offer_update = _filter_known_columns("offers", offer_update)
            supabase.table("offers").update(offer_update).eq("id", q.offer_id).execute()
        created_shipment = None
        if quotation_row and normalized_status == "Booked":
            created_shipment = _create_shipment_from_quotation(quotation_row)
            if q.offer_id:
                offer_update = {"status": "Booked"}
                if _has_columns("offers", "sales_manager_id"):
                    offer_update["sales_manager_id"] = sales_manager_id
                if q.client_id and _has_columns("offers", "client_id"):
                    offer_update["client_id"] = q.client_id
                offer_update = _filter_known_columns("offers", offer_update)
                supabase.table("offers").update(offer_update).eq("id", q.offer_id).execute()
        return {"status": "success", "data": res.data, "shipment": created_shipment}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/quotations/{quotation_id}")
def update_quotation(
    quotation_id: str,
    body: QuotationUpdate,
    authorization: Optional[str] = Header(None),
):
    try:
        current_user = _require_current_user(authorization)
        quotation_response = supabase.table("quotations").select("*").eq("id", quotation_id).single().execute()
        quotation = quotation_response.data
        if not quotation:
            raise HTTPException(status_code=404, detail="Quotation not found")

        _require_staff_roles(current_user, {"Sales", "Admin", "HR"})

        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user) and quotation.get("sales_manager_id") != current_user["staff_id"]:
            raise HTTPException(status_code=403, detail="You can only update quotations assigned to you.")

        if quotation.get("status") in {"Booked", "Canceled"}:
            raise HTTPException(status_code=422, detail="Finalized quotations can no longer be edited.")

        update_payload = body.dict(exclude_unset=True)
        if not update_payload:
            return {"status": "success", "data": [quotation]}

        if "client_id" in update_payload:
            update_payload["client_id"] = _ensure_client_exists(update_payload.get("client_id") or None)

        if "sales_manager_id" in update_payload:
            requested_manager_id = update_payload.get("sales_manager_id") or None
            if _has_capability(current_user, "Sales") and not _is_admin_like(current_user):
                if requested_manager_id and requested_manager_id != current_user["staff_id"]:
                    raise HTTPException(status_code=403, detail="Sales managers can only keep quotations assigned to themselves.")
                update_payload["sales_manager_id"] = current_user["staff_id"]
            else:
                update_payload["sales_manager_id"] = _ensure_sales_manager_exists(requested_manager_id)

        for date_field in ["departure_date", "validity_date"]:
            if date_field in update_payload and not update_payload.get(date_field):
                update_payload[date_field] = None

        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user) and _has_columns("quotations", "sales_manager_id") and not quotation.get("sales_manager_id"):
            update_payload.setdefault("sales_manager_id", current_user["staff_id"])

        if "sell_rate" in update_payload and _has_columns("quotations", "rate"):
            update_payload["rate"] = update_payload["sell_rate"]

        update_payload = _filter_known_columns("quotations", update_payload)
        response = supabase.table("quotations").update(update_payload).eq("id", quotation_id).execute()

        if quotation.get("offer_id"):
            offer_update = {}
            if "client_id" in update_payload and _has_columns("offers", "client_id"):
                offer_update["client_id"] = update_payload["client_id"]
            if "sales_manager_id" in update_payload and _has_columns("offers", "sales_manager_id"):
                offer_update["sales_manager_id"] = update_payload["sales_manager_id"]
            if offer_update:
                offer_update = _filter_known_columns("offers", offer_update)
                supabase.table("offers").update(offer_update).eq("id", quotation["offer_id"]).execute()

        return {"status": "success", "data": response.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/quotations")
def get_quotations(manager_id: Optional[str] = None, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR"})
        q = supabase.table("quotations").select(
            "*, staff:staff!quotations_sales_manager_id_fkey(full_name), clients(full_name)"
        ).order("created_at", desc=True)
        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user):
            q = q.eq("sales_manager_id", current_user["staff_id"])
        elif manager_id:
            q = q.eq("sales_manager_id", manager_id)
        res = q.limit(200).execute()
        return _normalize_quotation_rows(res.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/quotations/{quotation_id}/send-email")
def send_quotation_email(
    quotation_id: str,
    body: QuotationEmailSend,
    authorization: Optional[str] = Header(None),
):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR"})

        quotation = (
            supabase.table("quotations")
            .select("*")
            .eq("id", quotation_id)
            .single()
            .execute()
            .data
        )
        if not quotation:
            raise HTTPException(status_code=404, detail="Quotation not found")

        quotation_manager_id = quotation.get("sales_manager_id")
        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user) and quotation_manager_id != current_user["staff_id"]:
            raise HTTPException(status_code=403, detail="You can only send emails for quotations assigned to you.")

        sender_staff_id = quotation_manager_id or (current_user["staff_id"] if _has_capability(current_user, "Sales") else None)
        sender_context = _resolve_sales_sender_context(sender_staff_id)

        to_email = (body.to_email or quotation.get("contact_email") or "").strip()
        if not to_email:
            raise HTTPException(status_code=422, detail="Recipient email is required.")
        subject = (body.subject or "").strip() or _build_quotation_email_subject(quotation)
        html_content = _build_quotation_email_html(quotation, body.message, sender_context["effective_sender"] or None)
        sent = send_sales_manager_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            sales_manager_id=sender_context["sender_staff_id"],
            cc_emails=body.cc_emails,
        )
        if not sent:
            raise HTTPException(
                status_code=502,
                detail="SMTP delivery failed. Check the sales manager sender profile or server SMTP fallback.",
            )

        return {
            "status": "success",
            "data": {
                "quotation_id": quotation_id,
                "to_email": to_email,
                "cc_emails": _normalize_email_list(body.cc_emails),
                "subject": subject,
                "sender_staff_id": sender_context["sender_staff_id"],
                "sender_email": sender_context["sender_email"],
                "sender_name": sender_context["effective_sender"].get("sender_name")
                or sender_context["sender_defaults"].get("sender_name")
                or "",
                "used_personal_profile": sender_context["using_personal_profile"],
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/quotations/{quotation_id}/status")
def update_quotation_status(quotation_id: str, body: dict, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        new_status = _normalize_quotation_status(body.get("status"))
        quotation_res = supabase.table("quotations").select("*").eq("id", quotation_id).single().execute()
        quotation = quotation_res.data
        if not quotation:
            raise HTTPException(status_code=404, detail="Quotation not found")

        target_quotation = {**quotation, "status": new_status}
        if new_status == "Booked":
            _validate_quotation_can_book(target_quotation)

        update_payload = {"status": new_status}
        if new_status == "Booked":
            if _has_columns("quotations", "booked_at"):
                update_payload["booked_at"] = datetime.now(timezone.utc).isoformat()
            if current_user and _has_columns("quotations", "booked_by_staff_id"):
                update_payload["booked_by_staff_id"] = current_user["staff_id"]
        if new_status == "Canceled" and _has_columns("quotations", "canceled_at"):
            update_payload["canceled_at"] = datetime.now(timezone.utc).isoformat()

        update_payload = _filter_known_columns("quotations", update_payload)
        res = supabase.table("quotations").update(update_payload).eq("id", quotation_id).execute()

        updated_quotation = {**quotation, **update_payload}
        created_shipment = None
        if new_status == "Booked":
            created_shipment = _create_shipment_from_quotation(updated_quotation)
            if quotation.get("offer_id"):
                offer_update = {"status": "Booked"}
                if _has_columns("offers", "sales_manager_id"):
                    offer_update["sales_manager_id"] = quotation.get("sales_manager_id")
                if quotation.get("client_id") and _has_columns("offers", "client_id"):
                    offer_update["client_id"] = quotation.get("client_id")
                offer_update = _filter_known_columns("offers", offer_update)
                supabase.table("offers").update(offer_update).eq("id", quotation["offer_id"]).execute()
        elif new_status == "Canceled" and quotation.get("offer_id"):
            offer_update = {"status": "Canceled"}
            if _has_columns("offers", "sales_manager_id"):
                offer_update["sales_manager_id"] = quotation.get("sales_manager_id")
            if quotation.get("client_id") and _has_columns("offers", "client_id"):
                offer_update["client_id"] = quotation.get("client_id")
            offer_update = _filter_known_columns("offers", offer_update)
            supabase.table("offers").update(offer_update).eq("id", quotation["offer_id"]).execute()

        return {"status": "success", "data": res.data, "shipment": created_shipment}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/offers")
def get_offers(authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        res = supabase.table("offers").select(
            "*, staff(full_name), clients(full_name)"
        ).order("created_at", desc=True).limit(100).execute()
        data = res.data
        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user):
            data = [
                row for row in data
                if row.get("sales_manager_id") in (None, current_user["staff_id"])
            ]
        elif not _is_admin_like(current_user):
            data = []
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/offers/{offer_id}/claim")
def claim_offer_request(offer_id: str, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        if not _has_capability(current_user, "Sales"):
            raise HTTPException(status_code=403, detail="Only Sales managers can claim requests.")

        offer = _load_offer_context(offer_id)
        if not offer:
            raise HTTPException(status_code=404, detail="Offer request not found")

        _ensure_offer_assignment_access(offer, current_user)

        update_payload = {"sales_manager_id": current_user["staff_id"]}
        update_payload = _filter_known_columns("offers", update_payload)
        res = supabase.table("offers").update(update_payload).eq("id", offer_id).execute()
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/offers/{offer_id}/release")
def release_offer_request(offer_id: str, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_staff_roles(current_user, {"Sales", "Admin", "HR"})

        offer = _load_offer_context(offer_id)
        if not offer:
            raise HTTPException(status_code=404, detail="Offer request not found")

        if offer.get("status") != "New":
            raise HTTPException(status_code=422, detail="Only new requests can be released back to the queue.")

        if _has_capability(current_user, "Sales") and not _is_admin_like(current_user) and offer.get("sales_manager_id") != current_user["staff_id"]:
            raise HTTPException(status_code=403, detail="You can only release requests assigned to you.")

        update_payload = _filter_known_columns("offers", {"sales_manager_id": None})
        res = supabase.table("offers").update(update_payload).eq("id", offer_id).execute()
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- МОДУЛЬ ФИНАНСОВ (FINANCE) ---
class InvoiceCreate(BaseModel):
    shipment_id: str
    invoice_number: str
    issue_date: str
    due_date: str
    invoice_type: str
    client_id: Optional[str] = None
    agent_id: Optional[str] = None
    amount_net: float
    vat_18: float = 0
    amount_total: float
    currency: str = "USD"
    status: str = "Pending"

@app.post("/api/invoices/create")
def create_invoice(inv: InvoiceCreate, authorization: Optional[str] = Header(None)):
    try:
        _require_table("invoices")
        current_user = _require_current_user(authorization)
        _require_finance_write_access(current_user)
        data = inv.dict(exclude_none=True)
        # Convert empty strings to None
        for k in ["client_id", "agent_id"]:
            if data.get(k) == "":
                data.pop(k, None)
        data = _filter_known_columns("invoices", data)
        res = supabase.table("invoices").insert(data).execute()
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/invoices")
def get_invoices(authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_finance_read_access(current_user)
        if not _table_exists("invoices"):
            return []

        select_parts = ["*"]
        if _table_exists("shipments"):
            shipment_columns = [
                column_name
                for column_name in ["bk_number", "sales_manager_id", "operation_manager_id"]
                if _has_columns("shipments", column_name)
            ]
            if shipment_columns:
                select_parts.append(f"shipments({', '.join(shipment_columns)})")
        if _table_exists("clients"):
            select_parts.append("clients(full_name)")
        if _table_exists("agents"):
            select_parts.append("agents(company_name)")
        if _table_exists("payments"):
            select_parts.append("payments(*)")

        res = supabase.table("invoices").select(
            ", ".join(select_parts)
        ).order("created_at", desc=True).limit(200).execute()
        data = res.data
        if current_user and not _is_admin_like(current_user):
            filtered = []
            for row in data:
                shipment = row.get("shipments") or {}
                sales_match = _has_capability(current_user, "Sales") and _has_columns("shipments", "sales_manager_id") and shipment.get("sales_manager_id") == current_user["staff_id"]
                operations_match = _has_capability(current_user, "Operations") and _has_columns("shipments", "operation_manager_id") and shipment.get("operation_manager_id") == current_user["staff_id"]
                if sales_match or operations_match:
                    filtered.append(row)
            data = filtered
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class PaymentCreate(BaseModel):
    invoice_id: str
    amount_paid: float
    currency: str = "USD"
    payment_date: str
    notes: Optional[str] = None


def _require_finance_read_access(current_user: dict):
    _require_staff_roles(current_user, {"Sales", "Operations", "Admin", "HR"})


def _require_finance_write_access(current_user: dict):
    _require_staff_roles(current_user, {"Operations", "Admin", "HR"})


def _require_tank_storage_read_access(current_user: dict):
    _require_staff_roles(current_user, {"Operations", "Admin", "HR"})


def _require_tank_storage_write_access(current_user: dict):
    _require_staff_roles(current_user, {"Operations", "Admin", "HR"})

@app.post("/api/payments/create")
def create_payment(pay: PaymentCreate, authorization: Optional[str] = Header(None)):
    try:
        _require_table("payments")
        current_user = _require_current_user(authorization)
        _require_finance_write_access(current_user)
        res = supabase.table("payments").insert(pay.dict(exclude_none=True)).execute()
        
        # Determine if invoice status should evolve to 'Paid'
        # Since we use Supabase Python Client simply, we return the payment data
        # We can calculate status on frontend or check totals here.
        # Simple implementation for now.
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/invoices/{invoice_id}/status")
def update_invoice_status(invoice_id: str, body: dict, authorization: Optional[str] = Header(None)):
    try:
        _require_table("invoices")
        current_user = _require_current_user(authorization)
        _require_finance_write_access(current_user)
        new_status = body.get("status")
        if new_status not in ["Paid", "Pending", "Overdue"]:
            raise HTTPException(status_code=422, detail="Invalid status")
        res = supabase.table("invoices").update({"status": new_status}).eq("id", invoice_id).execute()
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- MODULE: TANK STORAGE COST & NOTIFICATIONS ---

import smtplib
from email.mime.text import MIMEText
import urllib.request
import json
import logging

class TankStorageCreate(BaseModel):
    container_number: str
    arrival_date: str
    free_days: int = 15
    rate_tier1: float = 2.00
    rate_tier2: float = 2.50
    rate_tier3: float = 4.00
    warning_limit: float = 100.00
    comments: Optional[str] = None

def _normalize_email_list(value: Optional[str]) -> list[str]:
    if not value:
        return []
    normalized = value.replace(";", ",").replace("\n", ",")
    seen = []
    for item in normalized.split(","):
        email = item.strip()
        if email and email not in seen:
            seen.append(email)
    return seen


def send_smtp_email(
    to_email,
    subject,
    html_content,
    sender_staff_id: Optional[str] = None,
    reply_to_email: Optional[str] = None,
    cc_emails: Optional[str] = None,
):
    profile = _load_sender_profile(sender_staff_id)
    if profile:
        sender = profile.get("sender_email") or ""
        password = profile.get("smtp_password") or ""
        smtp_username = profile.get("smtp_username") or sender
        host = profile.get("smtp_host") or ""
        port = int(profile.get("smtp_port") or 465)
        use_ssl = profile.get("smtp_use_ssl")
        if use_ssl is None:
            use_ssl = True
        sender_name = profile.get("sender_name") or ""
        effective_reply_to = reply_to_email or profile.get("reply_to_email") or sender
        if not sender or not password or not host:
            logging.warning(f"Sender profile for {sender_staff_id} is incomplete. Skipping email: {subject}")
            return False
    else:
        sender = os.environ.get("SMTP_USER", "")
        password = os.environ.get("SMTP_PASSWORD", "")
        smtp_username = sender
        host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
        port = int(os.environ.get("SMTP_PORT", "465"))
        use_ssl = os.environ.get("SMTP_USE_SSL", "true").lower() != "false"
        sender_name = ""
        effective_reply_to = reply_to_email or sender
        if not sender or not password:
            logging.warning("SMTP not configured. Skipping email: " + subject)
            return False

    try:
        msg = MIMEText(html_content, 'html')
        msg['Subject'] = subject
        msg['From'] = f"{sender_name} <{sender}>" if sender_name else sender
        msg['To'] = to_email
        cc_list = _normalize_email_list(cc_emails)
        if cc_list:
            msg['Cc'] = ", ".join(cc_list)
        msg['Reply-To'] = effective_reply_to
        if use_ssl:
            server = smtplib.SMTP_SSL(host, port)
        else:
            server = smtplib.SMTP(host, port)
            server.starttls()
        server.login(smtp_username, password)
        recipients = [to_email, *cc_list]
        server.send_message(msg, to_addrs=recipients)
        server.quit()
        return True
    except Exception as e:
        logging.error(f"Email error: {str(e)}")
        return False

def send_n8n_webhook(payload):
    webhook_url = os.environ.get("N8N_WEBHOOK_URL", "")
    if not webhook_url:
        logging.warning("N8N_WEBHOOK_URL not set. Skipping N8N webhook.")
        return False
        
    try:
        req = urllib.request.Request(webhook_url, method="POST")
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(payload).encode('utf-8')
        urllib.request.urlopen(req, data=data, timeout=5)
        return True
    except Exception as e:
        logging.error(f"N8N Webhook error: {str(e)}")
        return False


def send_sales_manager_email(
    to_email,
    subject,
    html_content,
    sales_manager_id: Optional[str],
    cc_emails: Optional[str] = None,
):
    return send_smtp_email(
        to_email=to_email,
        subject=subject,
        html_content=html_content,
        sender_staff_id=sales_manager_id,
        cc_emails=cc_emails,
    )

@app.post("/api/tank_storage/create")
def create_tank_storage(ts: TankStorageCreate, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_tank_storage_write_access(current_user)
        data = ts.dict(exclude_none=True)
        res = supabase.table("tank_storage").insert(data).execute()
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.patch("/api/tank_storage/{ts_id}/stop")
def stop_tank_storage(ts_id: str, body: dict, authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_tank_storage_write_access(current_user)
        stop_date = body.get("stop_date")
        if not stop_date:
            raise HTTPException(status_code=400, detail="stop_date required")
        res = supabase.table("tank_storage").update({"stop_date": stop_date, "status": "Stopped"}).eq("id", ts_id).execute()
        return {"status": "success", "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/tank_storage")
def get_tank_storage(authorization: Optional[str] = Header(None)):
    try:
        current_user = _require_current_user(authorization)
        _require_tank_storage_read_access(current_user)
        res = supabase.table("tank_storage").select("*").order("created_at", desc=True).limit(200).execute()
        
        # Post-Processing: Calculate costs, check limits, trigger notifications
        today = datetime.now(timezone.utc).date()
        processed_data = []
        
        for item in res.data:
            arrival_date = datetime.strptime(item["arrival_date"], "%Y-%m-%d").date()
            stop_date = datetime.strptime(item["stop_date"], "%Y-%m-%d").date() if item.get("stop_date") else today
            
            total_days = (stop_date - arrival_date).days
            if total_days < 0:
                total_days = 0
                
            free_days = item["free_days"]
            billable_days = max(0, total_days - free_days)
            
            amount = 0.0
            if billable_days > 0:
                tier1 = min(15, billable_days) # 16-30 days scale (15 days long)
                tier2 = min(30, max(0, billable_days - 15)) # 31-60 days scale (30 days long)
                tier3 = max(0, billable_days - 45) # Over 60 days
                amount = (tier1 * float(item.get("rate_tier1", 2.0))) + (tier2 * float(item.get("rate_tier2", 2.5))) + (tier3 * float(item.get("rate_tier3", 4.0)))

            item["calculated_total_days"] = total_days
            item["calculated_amount"] = amount
            
            # NOTIFICATION LOGIC (Only if Active)
            if item["status"] == "Active":
                container = item["container_number"]
                
                # Check 1: Free Days Ended
                if total_days > free_days and not item.get("alert_freedays_sent"):
                    msg = f"Free days expired for Container: {container}. Billable days started."
                    send_smtp_email("formagstatus@gmail.com", f"ALERT: Free Days Ended - {container}", msg)
                    send_n8n_webhook({"type": "FREEDAYS_ALERT", "container": container, "message": msg})
                    supabase.table("tank_storage").update({"alert_freedays_sent": True}).eq("id", item["id"]).execute()
                    item["alert_freedays_sent"] = True

                # Check 2: Warning Limit Reached
                if amount >= item["warning_limit"] and not item.get("alert_warning_sent"):
                    msg = f"WARNING! Demurrage limit exceeded for Container: {container}. Current Penalty: ${amount:.2f}."
                    send_smtp_email("formagstatus@gmail.com", f"CRITICAL: Storage Penalty Limit - {container}", msg)
                    send_n8n_webhook({"type": "LIMIT_ALERT", "container": container, "amount": amount, "message": msg})
                    supabase.table("tank_storage").update({"alert_warning_sent": True}).eq("id", item["id"]).execute()
                    item["alert_warning_sent"] = True

            processed_data.append(item)
            
        return processed_data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- РАЗДАЧА ФРОНТЕНДА ---

# Берем корневую папку, где лежат index.html, JS, CSS
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# Монтируем корневую папку с HTML файлами
# Это позволит FastAPI отдавать вашу верстку по умолчанию (браузер откроет index.html)
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
