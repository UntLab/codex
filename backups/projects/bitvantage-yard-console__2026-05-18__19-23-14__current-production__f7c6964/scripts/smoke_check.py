#!/usr/bin/env python3
import argparse
import sys

import requests


def require_ok(response, label: str) -> None:
    if not response.ok:
        raise RuntimeError(f"{label} failed: {response.status_code} {response.text[:300]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="BitVantage smoke check")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    base = args.base_url.rstrip("/")

    health = requests.get(f"{base}/healthz", timeout=10)
    require_ok(health, "healthz")
    print("healthz OK")

    root = requests.get(f"{base}/", timeout=10)
    require_ok(root, "root")
    print("root OK")

    login = requests.post(
        f"{base}/api/auth/login",
        json={"username": args.username, "password": args.password},
        timeout=15,
    )
    require_ok(login, "login")
    payload = login.json()
    token = payload["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("login OK")

    me = requests.get(f"{base}/api/users/me", headers=headers, timeout=15)
    require_ok(me, "users/me")
    print("users/me OK")

    bootstrap = requests.get(f"{base}/api/bootstrap?logs_limit=20", headers=headers, timeout=20)
    require_ok(bootstrap, "bootstrap")
    print("bootstrap OK")

    logs = requests.get(f"{base}/api/containers/logs?limit=10", headers=headers, timeout=20)
    require_ok(logs, "containers/logs")
    print("containers/logs OK")

    admin_users = requests.get(f"{base}/api/admin/users", headers=headers, timeout=20)
    require_ok(admin_users, "admin/users")
    print("admin/users OK")

    print("SMOKE CHECK PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
