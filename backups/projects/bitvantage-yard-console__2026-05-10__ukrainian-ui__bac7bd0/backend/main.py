from pathlib import Path
from datetime import date, datetime, time, timezone
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles

import n8n_client
import report_exports
import supabase_client
from models import (
    AdminSetPasswordRequest,
    AdminUpdateBlockRequest,
    AdminUpdateSlotRequest,
    AdminUpdateUserRoleRequest,
    ChangeOwnPasswordRequest,
    CreateUserRequest,
    LoginRequest,
    NotificationPreviewRequest,
    NotificationSettingsUpdateRequest,
    RestowRequest,
    StackInRequest,
    StackOutRequest,
)
from validators import validate_position

app = FastAPI(title="BitVantage Yard API", version="1.0")
security = HTTPBearer(auto_error=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "https://bitvantage.online",
        "https://www.bitvantage.online",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def model_to_dict(model: Any) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Dict[str, Any]:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    user = supabase_client.get_user_by_token(credentials.credentials)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid token.")
    return user


def require_permission(permission: str):
    def dependency(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if permission not in current_user.get("permissions", []):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Permission '{permission}' is required for this action.")
        return current_user
    return dependency


def parse_snapshot_date(value: Optional[str]) -> str:
    target_date = date.today() if not value else datetime.strptime(value, "%Y-%m-%d").date()
    snapshot_at = datetime.combine(target_date, time.max, tzinfo=timezone.utc).replace(microsecond=0)
    return snapshot_at.isoformat()


def get_slot_or_404(
    block: str,
    bay: str,
    row: int,
    container_type: str,
    *,
    db=None,
    layout_records=None,
    overrides_by_slot=None,
) -> Dict[str, Any]:
    normalized_bay = str(int(bay)).zfill(2)
    lookup_bay = supabase_client.get_slot_lookup_bay(block, normalized_bay, container_type)
    slot = supabase_client.get_slot(
        block,
        lookup_bay,
        row,
        db=db,
        layout_records=layout_records,
        overrides_by_slot=overrides_by_slot,
    )
    if not slot:
        raise HTTPException(status_code=404, detail=f"Slot {block}-{lookup_bay}-{row} not found in slot directory.")
    return slot


def ensure_position_available(position: Dict[str, Any], exclude_container_id: Optional[str] = None, *, db=None, inventory_rows=None) -> None:
    try:
        occupant = supabase_client.find_inventory_by_surface_position(
            position["block"],
            position["bay"],
            position["row"],
            position["tier"],
            position["container_type"],
            exclude_container_id=exclude_container_id,
            db=db,
            inventory_rows=inventory_rows,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if occupant:
        raise HTTPException(status_code=409, detail=f"Position {position['position_code']} is already occupied by container {occupant['container_id']}.")


def ensure_slot_eligible(slot: Dict[str, Any], container_type: str, tier: int) -> None:
    if not slot.get("enabled", True):
        raise HTTPException(status_code=400, detail=f"Slot {slot['slot_code']} is blocked in the slot directory.")
    if container_type not in slot.get("allowed_container_types", []):
        raise HTTPException(status_code=400, detail=f"Slot {slot['slot_code']} does not allow container type {container_type}.")
    if tier > int(slot.get("max_tiers", 4)):
        raise HTTPException(status_code=400, detail=f"Slot {slot['slot_code']} supports tiers only up to {slot['max_tiers']}.")


def ensure_bay_direction_consistent(
    block: str,
    bay: str,
    direction: str,
    container_type: str,
    *,
    exclude_container_id: Optional[str] = None,
    db=None,
    inventory_rows=None,
) -> None:
    conflict = supabase_client.find_direction_conflict_in_bay(
        block,
        bay,
        direction,
        container_type,
        exclude_container_id=exclude_container_id,
        db=db,
        inventory_rows=inventory_rows,
    )
    if not conflict:
        return
    normalized_bay = str(int(bay)).zfill(2)
    raise HTTPException(
        status_code=409,
        detail=(
            f"Cannot mix {direction} with {conflict['direction']} in bay {block}-{normalized_bay}. "
            f"Container {conflict['container_id']} is already assigned there."
        ),
    )


def can_emergency_override_departure_priority(current_user: Dict[str, Any]) -> bool:
    return "emergency_departure_override" in current_user.get("permissions", [])


def build_departure_priority_message(conflict: Dict[str, Any], *, override_allowed: bool) -> str:
    message = (
        f"Cannot place this container above {conflict['container_id']} at {conflict['position_code']} because it leaves earlier "
        f"({conflict['priority_source']} date {conflict['priority_label']}) than this container's "
        f"{conflict['candidate_source']} date {conflict['candidate_label']}."
    )
    if override_allowed:
        message += " Emergency override is available, but a reason is required."
    return message


def ensure_departure_priority_allowed(
    *,
    block: str,
    bay: str,
    row: int,
    tier: int,
    container_type: str,
    stack_out_date: Optional[str],
    arrived_at: Optional[str],
    current_user: Dict[str, Any],
    emergency_override: bool = False,
    override_reason: Optional[str] = None,
    exclude_container_id: Optional[str] = None,
    db=None,
    inventory_rows=None,
) -> Dict[str, Any]:
    conflict = supabase_client.find_departure_priority_conflict(
        block,
        bay,
        row,
        tier,
        container_type,
        stack_out_date,
        arrived_at,
        exclude_container_id=exclude_container_id,
        db=db,
        inventory_rows=inventory_rows,
    )
    if not conflict:
        return {"emergency_override": False, "override_reason": None, "conflict": None}

    override_allowed = can_emergency_override_departure_priority(current_user)
    if not emergency_override:
        raise HTTPException(status_code=409, detail=build_departure_priority_message(conflict, override_allowed=override_allowed))
    if not override_allowed:
        raise HTTPException(status_code=403, detail="Emergency override for departure priority is allowed only for Admin or Manager.")

    cleaned_reason = (override_reason or "").strip()
    if not cleaned_reason:
        raise HTTPException(status_code=400, detail="Emergency override reason is required for this placement.")

    return {"emergency_override": True, "override_reason": cleaned_reason, "conflict": conflict}


def build_log_entry(
    *,
    container_id: str,
    operation_type: str,
    performed_at: str,
    old_position_code: Optional[str],
    new_position_code: Optional[str],
    container_snapshot: Dict[str, Any],
    current_user: Dict[str, Any],
    emergency_override: bool = False,
    override_reason: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "container_id": container_id,
        "operation_type": operation_type,
        "old_position_code": old_position_code,
        "new_position_code": new_position_code,
        "performed_at": performed_at,
        "operator_username": current_user["username"],
        "operator_full_name": current_user["full_name"],
        "operator_role": current_user["role"],
        "container_snapshot": container_snapshot,
        "emergency_override": emergency_override,
        "override_reason": override_reason,
    }


def build_notification_payload(
    *,
    request_data: Dict[str, Any],
    operation_type: str,
    performed_at: str,
    old_position_code: Optional[str],
    new_position_code: Optional[str],
    container_snapshot: Dict[str, Any],
    current_user: Dict[str, Any],
    targets: Optional[list] = None,
) -> Dict[str, Any]:
    targets = targets if targets is not None else supabase_client.get_notification_targets(operation_type, current_user, container_snapshot)
    payload = dict(request_data)
    payload.update(
        {
            "event_id": f"{operation_type.lower()}-{container_snapshot['container_id']}-{performed_at}",
            "event_type": "terminal.container.moved",
            "operation_type": operation_type,
            "performed_at": performed_at,
            "old_position_code": old_position_code,
            "new_position_code": new_position_code,
            "container_snapshot": container_snapshot,
            "operator": {
                "username": current_user["username"],
                "full_name": current_user["full_name"],
                "role": current_user["role"],
            },
            "notification_targets": targets,
        }
    )
    return payload


def dispatch_movement_notification(payload: Dict[str, Any]) -> Dict[str, Any]:
    success, response_text, status_code = n8n_client.send_movement_event(payload)
    result = {
        "event_id": payload["event_id"],
        "operation_type": payload["operation_type"],
        "container_id": payload["container_snapshot"]["container_id"],
        "targets": payload["notification_targets"],
        "success": success,
        "response_text": response_text,
        "status_code": status_code,
        "created_at": supabase_client.utc_now_iso(),
    }
    supabase_client.insert_notification_log(result)
    return result


@app.post("/api/auth/login")
def login(request: LoginRequest):
    user = supabase_client.authenticate_user(request.username.strip(), request.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")
    token, session_user = supabase_client.create_session(request.username.strip())
    return JSONResponse(
        content=jsonable_encoder(
            {"access_token": token, "token_type": "bearer", "user": session_user}
        )
    )


@app.get("/healthz")
def healthz():
    return PlainTextResponse("ok")


@app.get("/health-json")
def health_json():
    return JSONResponse(content={"ok": True})


@app.post("/api/auth/logout")
def logout(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if credentials:
        supabase_client.delete_session(credentials.credentials)
    return {"status": "success"}


@app.get("/api/users/me")
def get_me(current_user: Dict[str, Any] = Depends(get_current_user)):
    return current_user


@app.get("/api/bootstrap")
def get_bootstrap(
    logs_limit: int = Query(default=50, ge=1, le=200),
    include_admin_users: bool = Query(default=False),
    dashboard_date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    utc_offset_minutes: int = Query(default=0, ge=-720, le=840),
    current_user: Dict[str, Any] = Depends(require_permission("view_inventory")),
):
    target_date = datetime.strptime(dashboard_date, "%Y-%m-%d").date() if dashboard_date else None
    return supabase_client.get_bootstrap_payload(
        current_user,
        logs_limit=logs_limit,
        include_admin_users=include_admin_users,
        dashboard_date=target_date,
        utc_offset_minutes=utc_offset_minutes,
    )


@app.patch("/api/users/me/notifications")
def update_my_notifications(request: NotificationSettingsUpdateRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    updated = supabase_client.update_notification_settings(current_user["username"], model_to_dict(request))
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    return updated


@app.patch("/api/users/me/password")
def change_my_password(request: ChangeOwnPasswordRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        updated = supabase_client.change_own_password(current_user["username"], request.current_password, request.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"status": "success"}


@app.get("/api/admin/users")
def admin_list_users(current_user: Dict[str, Any] = Depends(require_permission("manage_users"))):
    return supabase_client.list_users()


@app.post("/api/admin/users")
def admin_create_user(request: CreateUserRequest, current_user: Dict[str, Any] = Depends(require_permission("manage_users"))):
    try:
        return supabase_client.create_user_record(model_to_dict(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.patch("/api/admin/users/{username}/role")
def admin_update_user_role(username: str, request: AdminUpdateUserRoleRequest, current_user: Dict[str, Any] = Depends(require_permission("manage_users"))):
    try:
        updated = supabase_client.update_user_role(username, request.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    return updated


@app.patch("/api/admin/users/{username}/password")
def admin_update_user_password(username: str, request: AdminSetPasswordRequest, current_user: Dict[str, Any] = Depends(require_permission("manage_users"))):
    updated = supabase_client.admin_set_password(username, request.new_password)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"status": "success"}


@app.delete("/api/admin/users/{username}")
def admin_delete_user(username: str, current_user: Dict[str, Any] = Depends(require_permission("manage_users"))):
    try:
        archived = supabase_client.archive_user_record(username, current_user["username"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not archived:
        raise HTTPException(status_code=404, detail="User not found.")
    return archived


@app.get("/api/yard/layout")
def get_yard_layout(current_user: Dict[str, Any] = Depends(require_permission("view_inventory"))):
    return supabase_client.get_terminal_layout()


@app.patch("/api/admin/layout/{block}")
def admin_update_terminal_block(block: str, request: AdminUpdateBlockRequest, current_user: Dict[str, Any] = Depends(require_permission("manage_layout"))):
    if request.bay_count < 1 or request.bay_count > 99:
        raise HTTPException(status_code=400, detail="Bay count must be between 1 and 99.")
    if request.row_count < 1 or request.row_count > 99:
        raise HTTPException(status_code=400, detail="Row count must be between 1 and 99.")
    if request.tier_count < 1 or request.tier_count > 4:
        raise HTTPException(status_code=400, detail="Tier count must be between 1 and 4.")
    updated = supabase_client.update_terminal_block(block, model_to_dict(request))
    if not updated:
        raise HTTPException(status_code=404, detail="Block not found.")
    return updated


@app.get("/api/yard/slots")
def get_yard_slots(block: Optional[str] = Query(default=None), current_user: Dict[str, Any] = Depends(require_permission("view_inventory"))):
    return supabase_client.get_slots_for_block(block) if block else supabase_client.get_all_slots()


@app.patch("/api/admin/slots/{block}/{bay}/{row}")
def admin_update_slot(block: str, bay: str, row: int, request: AdminUpdateSlotRequest, current_user: Dict[str, Any] = Depends(require_permission("manage_layout"))):
    normalized_bay = str(int(bay)).zfill(2)
    if request.max_tiers < 1 or request.max_tiers > 4:
        raise HTTPException(status_code=400, detail="Slot max tiers must be between 1 and 4.")
    allowed = set(request.allowed_container_types)
    supported = {"20ft", "40ft", "45ft"}
    if not allowed or not allowed.issubset(supported):
        raise HTTPException(status_code=400, detail="Allowed slot types must be chosen from 20ft, 40ft, 45ft.")
    updated = supabase_client.update_slot(block, normalized_bay, row, model_to_dict(request))
    if not updated:
        raise HTTPException(status_code=404, detail="Slot not found.")
    return updated


@app.post("/api/containers/stack-in")
def stack_in(request: StackInRequest, current_user: Dict[str, Any] = Depends(require_permission("stack_in"))):
    request_data = model_to_dict(request)
    try:
        normalized = validate_position(request.container_type, request.block, request.bay, request.row, request.tier)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    slot = get_slot_or_404(normalized["block"], normalized["bay"], normalized["row"], normalized["container_type"])
    ensure_slot_eligible(slot, normalized["container_type"], normalized["tier"])
    if not supabase_client.has_supporting_base(normalized["block"], normalized["bay"], normalized["row"], normalized["tier"], normalized["container_type"]):
        raise HTTPException(status_code=400, detail=f"{normalized['container_type']} is not supported by the lower tier at {normalized['position_code']}.")
    existing = supabase_client.check_inventory(request.container_id)
    if existing:
        raise HTTPException(status_code=400, detail="Container ID already exists in inventory. Use Restow to move or Stack Out to remove.")
    ensure_bay_direction_consistent(normalized["block"], normalized["bay"], request.direction, request.container_type)
    performed_at = supabase_client.utc_now_iso()
    override_state = ensure_departure_priority_allowed(
        block=normalized["block"],
        bay=normalized["bay"],
        row=normalized["row"],
        tier=normalized["tier"],
        container_type=normalized["container_type"],
        stack_out_date=request.stack_out_date,
        arrived_at=performed_at,
        current_user=current_user,
        emergency_override=request.emergency_override,
        override_reason=request.override_reason,
    )
    ensure_position_available(normalized)
    inventory_data = {
        "container_id": request.container_id,
        "container_type": normalized["container_type"],
        "block": normalized["block"],
        "bay": normalized["bay"],
        "row_num": normalized["row"],
        "tier_num": normalized["tier"],
        "position_code": normalized["position_code"],
        "status": request.status,
        "direction": request.direction,
        "bonded": request.bonded,
        "stack_out_date": request.stack_out_date,
        "weight": request.weight,
        "commodity": request.commodity,
        "line": request.line,
        "expeditor": request.expeditor,
        "damages": request.damages,
        "seals": request.seals,
        "arrived_at": performed_at,
        "positioned_at": performed_at,
    }
    request_data["emergency_override"] = override_state["emergency_override"]
    request_data["override_reason"] = override_state["override_reason"]
    supabase_client.insert_inventory(inventory_data)
    supabase_client.insert_log(build_log_entry(container_id=request.container_id, operation_type="STACK_IN", performed_at=performed_at, old_position_code=None, new_position_code=normalized["position_code"], container_snapshot=inventory_data, current_user=current_user, emergency_override=override_state["emergency_override"], override_reason=override_state["override_reason"]))
    dispatch_movement_notification(build_notification_payload(request_data=request_data, operation_type="STACK_IN", performed_at=performed_at, old_position_code=None, new_position_code=normalized["position_code"], container_snapshot=inventory_data, current_user=current_user))
    return {"status": "success", "message": f"Container {request.container_id} received and positioned at {normalized['position_code']}."}


@app.post("/api/containers/stack-out")
def stack_out(request: StackOutRequest, current_user: Dict[str, Any] = Depends(require_permission("stack_out"))):
    request_data = model_to_dict(request)
    existing = supabase_client.check_inventory(request.container_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Container ID not found in inventory.")
    old_position = existing.get("position_code")
    performed_at = supabase_client.utc_now_iso()
    supabase_client.delete_inventory(request.container_id)
    supabase_client.insert_log(build_log_entry(container_id=request.container_id, operation_type="STACK_OUT", performed_at=performed_at, old_position_code=old_position, new_position_code=None, container_snapshot=existing, current_user=current_user))
    dispatch_movement_notification(build_notification_payload(request_data=request_data, operation_type="STACK_OUT", performed_at=performed_at, old_position_code=old_position, new_position_code=None, container_snapshot=existing, current_user=current_user))
    return {"status": "success", "message": f"Container {request.container_id} checked out."}


@app.post("/api/containers/restow")
def restow(request: RestowRequest, current_user: Dict[str, Any] = Depends(require_permission("restow"))):
    request_data = model_to_dict(request)
    with supabase_client.get_db() as db:
        layout_records = supabase_client.get_terminal_layout(db=db)
        overrides_by_slot = supabase_client.load_slot_overrides(db=db)
        inventory_rows = supabase_client.get_all_inventory(db=db)
        existing = next((item for item in inventory_rows if item["container_id"] == request.container_id), None)
        if not existing:
            raise HTTPException(status_code=404, detail="Container ID not found in inventory.")
        try:
            normalized = validate_position(existing.get("container_type"), request.new_block, request.new_bay, request.new_row, request.new_tier)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        ensure_bay_direction_consistent(
            normalized["block"],
            normalized["bay"],
            existing["direction"],
            existing["container_type"],
            exclude_container_id=request.container_id,
            db=db,
            inventory_rows=inventory_rows,
        )
        slot = get_slot_or_404(
            normalized["block"],
            normalized["bay"],
            normalized["row"],
            normalized["container_type"],
            db=db,
            layout_records=layout_records,
            overrides_by_slot=overrides_by_slot,
        )
        ensure_slot_eligible(slot, normalized["container_type"], normalized["tier"])
        if not supabase_client.has_supporting_base(
            normalized["block"],
            normalized["bay"],
            normalized["row"],
            normalized["tier"],
            normalized["container_type"],
            inventory_rows=inventory_rows,
        ):
            raise HTTPException(status_code=400, detail=f"{normalized['container_type']} is not supported by the lower tier at {normalized['position_code']}.")
        override_state = ensure_departure_priority_allowed(
            block=normalized["block"],
            bay=normalized["bay"],
            row=normalized["row"],
            tier=normalized["tier"],
            container_type=normalized["container_type"],
            stack_out_date=existing.get("stack_out_date"),
            arrived_at=existing.get("arrived_at"),
            current_user=current_user,
            emergency_override=request.emergency_override,
            override_reason=request.override_reason,
            exclude_container_id=request.container_id,
            db=db,
            inventory_rows=inventory_rows,
        )
        ensure_position_available(
            normalized,
            exclude_container_id=request.container_id,
            inventory_rows=inventory_rows,
        )
        old_position = existing.get("position_code")
        performed_at = supabase_client.utc_now_iso()
        updates = {"block": normalized["block"], "bay": normalized["bay"], "row_num": normalized["row"], "tier_num": normalized["tier"], "position_code": normalized["position_code"], "positioned_at": performed_at}
        supabase_client.update_inventory(request.container_id, updates, db=db)
        updated_container = dict(existing)
        updated_container.update(updates)
        updated_container["updated_at"] = performed_at
        supabase_client.insert_log(
            build_log_entry(
                container_id=request.container_id,
                operation_type="RESTOW",
                performed_at=performed_at,
                old_position_code=old_position,
                new_position_code=normalized["position_code"],
                container_snapshot=updated_container,
                current_user=current_user,
                emergency_override=override_state["emergency_override"],
                override_reason=override_state["override_reason"],
            ),
            db=db,
        )
        targets = supabase_client.get_notification_targets("RESTOW", current_user, updated_container, db=db)
    request_data["emergency_override"] = override_state["emergency_override"]
    request_data["override_reason"] = override_state["override_reason"]
    dispatch_movement_notification(
        build_notification_payload(
            request_data=request_data,
            operation_type="RESTOW",
            performed_at=performed_at,
            old_position_code=old_position,
            new_position_code=normalized["position_code"],
            container_snapshot=updated_container,
            current_user=current_user,
            targets=targets,
        )
    )
    return {"status": "success", "message": f"Container {request.container_id} restowed to {normalized['position_code']}."}


@app.get("/api/containers/inventory")
def get_inventory(current_user: Dict[str, Any] = Depends(require_permission("view_inventory"))):
    return supabase_client.get_all_inventory()


@app.get("/api/containers/logs")
def get_operations_log(container_id: Optional[str] = Query(default=None), date_from: Optional[str] = Query(default=None), date_to: Optional[str] = Query(default=None), limit: Optional[int] = Query(default=None, ge=1, le=1000), current_user: Dict[str, Any] = Depends(require_permission("view_inventory"))):
    return supabase_client.get_operations_log(container_id=container_id, date_from=date_from, date_to=date_to, limit=limit)


@app.get("/api/reports/operations")
def get_operations_report(
    date_from: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    operation_type: Optional[str] = Query(default=None),
    operator_query: Optional[str] = Query(default=None),
    container_query: Optional[str] = Query(default=None),
    utc_offset_minutes: int = Query(default=0, ge=-720, le=840),
    current_user: Dict[str, Any] = Depends(require_permission("view_audit")),
):
    try:
        return supabase_client.get_operations_report(
            date_from_local=date_from,
            date_to_local=date_to,
            utc_offset_minutes=utc_offset_minutes,
            operation_type=operation_type,
            operator_query=operator_query,
            container_query=container_query,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/reports/operations/export")
def export_operations_report(
    format: str = Query(default="csv", pattern=r"^(csv|pdf)$"),
    date_from: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    operation_type: Optional[str] = Query(default=None),
    operator_query: Optional[str] = Query(default=None),
    container_query: Optional[str] = Query(default=None),
    utc_offset_minutes: int = Query(default=0, ge=-720, le=840),
    current_user: Dict[str, Any] = Depends(require_permission("view_audit")),
):
    try:
        report = supabase_client.get_operations_report(
            date_from_local=date_from,
            date_to_local=date_to,
            utc_offset_minutes=utc_offset_minutes,
            operation_type=operation_type,
            operator_query=operator_query,
            container_query=container_query,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    filename = report_exports.build_operations_filename(report, format)
    if format == "pdf":
        try:
            payload = report_exports.export_operations_pdf(report)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        return StreamingResponse(
            iter([payload]),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    payload = report_exports.export_operations_csv(report)
    return StreamingResponse(
        iter([payload]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/containers/history/{container_id}")
def get_container_history(container_id: str, current_user: Dict[str, Any] = Depends(require_permission("view_history"))):
    history = supabase_client.get_container_history(container_id)
    if not history:
        raise HTTPException(status_code=404, detail="No history found for this container.")
    return history


@app.get("/api/yard/snapshot")
def get_yard_snapshot(snapshot_date: Optional[str] = Query(default=None, alias="date"), current_user: Dict[str, Any] = Depends(require_permission("view_inventory"))):
    try:
        snapshot_at = parse_snapshot_date(snapshot_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    containers = supabase_client.get_inventory_snapshot_at(snapshot_at)
    return {"snapshot_date": snapshot_at[:10], "snapshot_at": snapshot_at, "total_containers": len(containers), "containers": containers}


@app.post("/api/notifications/preview")
def preview_notification_routing(request: NotificationPreviewRequest, current_user: Dict[str, Any] = Depends(require_permission("view_inventory"))):
    container = supabase_client.check_inventory(request.container_id)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found.")
    targets = supabase_client.get_notification_targets(request.operation_type, current_user, container)
    return {"operation_type": request.operation_type, "container_id": request.container_id, "targets": targets}


@app.get("/api/notifications/logs")
def get_notification_logs(limit: Optional[int] = Query(default=20, ge=1, le=200), current_user: Dict[str, Any] = Depends(require_permission("view_notifications"))):
    return supabase_client.get_notification_logs(limit=limit)


FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import os
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("BITVANTAGE_HOST", "0.0.0.0"),
        port=int(os.getenv("BITVANTAGE_PORT", "8000")),
        access_log=False,
    )
