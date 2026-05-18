#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import supabase_client


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the initial BitVantage admin user.")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--full-name", required=True)
    parser.add_argument("--telegram-chat-id", default=None)
    args = parser.parse_args()

    try:
        user = supabase_client.create_user_record(
            {
                "username": args.username,
                "password": args.password,
                "full_name": args.full_name,
                "role": "ADMIN",
                "telegram_chat_id": args.telegram_chat_id,
                "notifications_enabled": True,
                "telegram_notifications_enabled": True,
                "receive_all_movement_alerts": True,
            }
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Created admin user @{user['username']} ({user['full_name']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
