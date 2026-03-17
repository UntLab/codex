import logging
import json
import os
from pathlib import Path
from typing import Dict, Tuple

import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_project_env() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_project_env()

N8N_WEBHOOK_URL_BASE = os.getenv("N8N_WEBHOOK_URL_BASE", "").strip()
N8N_MOVEMENT_ENDPOINT = os.getenv("N8N_MOVEMENT_ENDPOINT", "terminal-movement")
N8N_WEBHOOK_SECRET = os.getenv("N8N_WEBHOOK_SECRET", "").strip()


def json_default(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def send_to_n8n(endpoint: str, payload: Dict) -> Tuple[bool, str, int]:
    if not N8N_WEBHOOK_URL_BASE:
        logger.info("n8n webhook is not configured. Skipping delivery.")
        return False, "n8n webhook disabled", 0
    url = f"{N8N_WEBHOOK_URL_BASE.rstrip('/')}/{endpoint.lstrip('/')}"
    logger.info(f"Sending data to n8n webhook: {url}")
    headers = {}
    if N8N_WEBHOOK_SECRET:
        headers["X-BitVantage-Secret"] = N8N_WEBHOOK_SECRET
    if payload.get("event_type"):
        headers["X-BitVantage-Event-Type"] = str(payload["event_type"])
    headers["Content-Type"] = "application/json"
    try:
        response = requests.post(url, data=json.dumps(payload, default=json_default), headers=headers or None, timeout=2)
        response.raise_for_status()
        return True, response.text or "Success", response.status_code
    except requests.exceptions.RequestException as exc:
        logger.error(f"Failed to communicate with n8n: {exc}")
        status_code = getattr(exc.response, "status_code", 0) if getattr(exc, "response", None) else 0
        return False, f"n8n communication error: {str(exc)}", status_code


def send_movement_event(payload: Dict) -> Tuple[bool, str, int]:
    return send_to_n8n(N8N_MOVEMENT_ENDPOINT, payload)
