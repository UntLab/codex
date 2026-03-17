import atexit
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - optional until dependencies are installed
    psycopg = None
    dict_row = None

try:
    from psycopg_pool import ConnectionPool
except ImportError:  # pragma: no cover - optional until dependency is installed
    ConnectionPool = None


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


LOCAL_DB_PATH = os.getenv(
    "BITVANTAGE_LOCAL_DB_PATH",
    os.path.join(os.path.dirname(__file__), "bitvantage_local.db"),
)
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USE_POSTGRES = bool(DATABASE_URL)
DEMO_MODE = os.getenv("BITVANTAGE_DEMO_MODE", "false" if USE_POSTGRES else "true").strip().lower() in {"1", "true", "yes", "on"}

PASSWORD_ITERATIONS = 120_000
ROLE_PERMISSIONS = {
    "ADMIN": {
        "view_inventory",
        "view_history",
        "view_audit",
        "view_notifications",
        "stack_in",
        "stack_out",
        "restow",
        "manage_layout",
        "manage_users",
        "receive_all_movement_alerts",
    },
    "MANAGER": {
        "view_inventory",
        "view_history",
        "view_audit",
        "view_notifications",
        "stack_in",
        "stack_out",
        "restow",
        "receive_all_movement_alerts",
    },
    "PLANNER": {
        "view_inventory",
        "view_history",
        "view_audit",
        "view_notifications",
        "stack_in",
        "stack_out",
        "restow",
        "receive_all_movement_alerts",
    },
    "TALLYMAN": {
        "view_inventory",
        "view_history",
        "stack_in",
        "stack_out",
        "restow",
    },
}

DEFAULT_USERS = [
    ("usr-000", "admin", "admin123", "ADMIN", "BitVantage Admin", "@bitvantage_admin", 1, 1, 1, "2026-03-11T06:45:00+00:00"),
    ("usr-001", "manager", "manager123", "MANAGER", "Marina Orlova", "@shift_manager", 1, 1, 1, "2026-03-11T06:45:00+00:00"),
    ("usr-002", "planner", "planner123", "PLANNER", "Daniel Ash", "@yard_planner", 1, 1, 1, "2026-03-11T06:45:00+00:00"),
    ("usr-003", "yard01", "yard123", "TALLYMAN", "Emin Guliyev", "@yard01", 1, 1, 0, "2026-03-11T06:45:00+00:00"),
]

DEFAULT_BLOCKS = [
    ("01", "West Rail Block", 10, 2, 4, "Left of the railway"),
    ("02", "East Rail Block", 14, 3, 4, "Right of the railway"),
]

DEFAULT_INVENTORY = [
    ("CONT001", "40ft", "01", "02", 2, 1, "01-02-2-1", "Loaded", "Import", "Maersk", "John Doe", "None", "OK123", "2026-03-10T08:15:00+00:00", "2026-03-10T08:15:00+00:00", "2026-03-10T08:15:00+00:00"),
    ("CONT002", "20ft", "02", "09", 3, 1, "02-09-3-1", "Empty", "Export", "MSC", "Jane Smith", "None", "SEAL456", "2026-03-11T09:30:00+00:00", "2026-03-11T09:30:00+00:00", "2026-03-11T09:30:00+00:00"),
    ("CONT003", "45ft", "02", "26", 2, 2, "02-26-2-2", "Loaded", "Import", "ZIM", "Alex Rail", "None", "RAIL789", "2026-03-12T07:20:00+00:00", "2026-03-12T07:20:00+00:00", "2026-03-12T07:20:00+00:00"),
]

DEFAULT_LOGS = [
    ("CONT001", "STACK_IN", None, "01-02-2-1", "2026-03-10T08:15:00+00:00", "2026-03-10T08:15:00+00:00", "manager", "Marina Orlova", "MANAGER", json.dumps({"container_id": "CONT001", "container_type": "40ft", "block": "01", "bay": "02", "row_num": 2, "tier_num": 1, "position_code": "01-02-2-1", "status": "Loaded", "direction": "Import", "line": "Maersk", "expeditor": "John Doe", "damages": "None", "seals": "OK123", "arrived_at": "2026-03-10T08:15:00+00:00", "positioned_at": "2026-03-10T08:15:00+00:00", "updated_at": "2026-03-10T08:15:00+00:00"})),
    ("CONT002", "STACK_IN", None, "02-09-3-1", "2026-03-11T09:30:00+00:00", "2026-03-11T09:30:00+00:00", "planner", "Daniel Ash", "PLANNER", json.dumps({"container_id": "CONT002", "container_type": "20ft", "block": "02", "bay": "09", "row_num": 3, "tier_num": 1, "position_code": "02-09-3-1", "status": "Empty", "direction": "Export", "line": "MSC", "expeditor": "Jane Smith", "damages": "None", "seals": "SEAL456", "arrived_at": "2026-03-11T09:30:00+00:00", "positioned_at": "2026-03-11T09:30:00+00:00", "updated_at": "2026-03-11T09:30:00+00:00"})),
    ("CONT003", "STACK_IN", None, "02-26-2-2", "2026-03-12T07:20:00+00:00", "2026-03-12T07:20:00+00:00", "admin", "BitVantage Admin", "ADMIN", json.dumps({"container_id": "CONT003", "container_type": "45ft", "block": "02", "bay": "26", "row_num": 2, "tier_num": 2, "position_code": "02-26-2-2", "status": "Loaded", "direction": "Import", "line": "ZIM", "expeditor": "Alex Rail", "damages": "None", "seals": "RAIL789", "arrived_at": "2026-03-12T07:20:00+00:00", "positioned_at": "2026-03-12T07:20:00+00:00", "updated_at": "2026-03-12T07:20:00+00:00"})),
]

DEFAULT_SLOT_OVERRIDES = []

SCHEMA_REQUIRED_TABLES = [
    "users",
    "terminal_blocks",
    "slot_overrides",
    "inventory",
    "operations_log",
    "notification_logs",
    "sessions",
]

_POSTGRES_POOL: Optional["ConnectionPool"] = None


class DBResult:
    def __init__(self, cursor: Any):
        self._cursor = cursor

    @property
    def rowcount(self) -> int:
        return getattr(self._cursor, "rowcount", -1)

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()


class DBConnection:
    def __init__(self, connection: Any, postgres: bool, pool: Optional[Any] = None):
        self._connection = connection
        self._postgres = postgres
        self._pool = pool

    def _adapt_query(self, query: str) -> str:
        return query.replace("?", "%s") if self._postgres else query

    def execute(self, query: str, params: Optional[Union[tuple, list]] = None) -> DBResult:
        cursor = self._connection.cursor()
        cursor.execute(self._adapt_query(query), params or ())
        return DBResult(cursor)

    def executemany(self, query: str, seq_params: Sequence[Sequence[Any]]) -> DBResult:
        cursor = self._connection.cursor()
        cursor.executemany(self._adapt_query(query), seq_params)
        return DBResult(cursor)

    def executescript(self, script: str) -> None:
        if not self._postgres:
            self._connection.executescript(script)
            return
        statements = [statement.strip() for statement in script.split(";") if statement.strip()]
        cursor = self._connection.cursor()
        for statement in statements:
            cursor.execute(statement)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self._connection.rollback()
        else:
            self._connection.commit()
        if self._pool is not None:
            self._pool.putconn(self._connection)
        else:
            self._connection.close()
        return False


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def hash_password(password: str, salt: Optional[str] = None) -> str:
    raw_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), raw_salt.encode("utf-8"), PASSWORD_ITERATIONS).hex()
    return f"{raw_salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    salt, expected_digest = stored_hash.split("$", 1)
    actual_digest = hash_password(password, salt).split("$", 1)[1]
    return hmac.compare_digest(actual_digest, expected_digest)


def get_permissions_for_role(role: str) -> List[str]:
    return sorted(ROLE_PERMISSIONS.get(role, {"view_inventory"}))


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    created_at = user.get("created_at")
    if hasattr(created_at, "isoformat"):
        created_at = created_at.isoformat()
    return {
        "user_id": str(user["user_id"]),
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "telegram_chat_id": user.get("telegram_chat_id"),
        "notifications_enabled": bool(user.get("notifications_enabled", True)),
        "telegram_notifications_enabled": bool(user.get("telegram_notifications_enabled", True)),
        "receive_all_movement_alerts": bool(user.get("receive_all_movement_alerts", False)),
        "permissions": get_permissions_for_role(user["role"]),
        "created_at": created_at,
    }


def get_postgres_pool() -> Optional["ConnectionPool"]:
    global _POSTGRES_POOL
    if not USE_POSTGRES or ConnectionPool is None:
        return None
    if _POSTGRES_POOL is None:
        _POSTGRES_POOL = ConnectionPool(
            DATABASE_URL,
            min_size=1,
            max_size=6,
            kwargs={"row_factory": dict_row, "autocommit": False},
            timeout=10,
            open=True,
        )
    return _POSTGRES_POOL


def close_postgres_pool() -> None:
    global _POSTGRES_POOL
    if _POSTGRES_POOL is not None:
        _POSTGRES_POOL.close()
        _POSTGRES_POOL = None


atexit.register(close_postgres_pool)


def get_db() -> DBConnection:
    if USE_POSTGRES:
        if psycopg is None:
            raise RuntimeError("psycopg is required when DATABASE_URL is set. Install backend requirements first.")
        pool = get_postgres_pool()
        if pool is not None:
            connection = pool.getconn()
            return DBConnection(connection, postgres=True, pool=pool)
        connection = psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=False)
        return DBConnection(connection, postgres=True)
    connection = sqlite3.connect(LOCAL_DB_PATH)
    connection.row_factory = sqlite3.Row
    return DBConnection(connection, postgres=False)


def bool_int(value: bool) -> int:
    if USE_POSTGRES:
        return bool(value)
    return 1 if value else 0


def is_wide_container(container_type: str) -> bool:
    return str(container_type).strip().lower() in {"40ft", "45ft"}


def format_bay_number(value: int) -> str:
    return str(int(value)).zfill(2)


def get_block_record(block: str, layout: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
    source = layout if layout is not None else get_terminal_layout()
    return next((item for item in source if item["block"] == block), None)


def get_max_surface_bay(block_or_record: Union[str, Dict[str, Any]]) -> int:
    block_record = block_or_record if isinstance(block_or_record, dict) else get_block_record(block_or_record)
    return int(block_record["bay_count"]) * 2 - 1 if block_record else 0


def get_max_wide_bay(block_or_record: Union[str, Dict[str, Any]]) -> int:
    return get_max_surface_bay(block_or_record) - 1


def is_surface_bay(bay: str) -> bool:
    return int(bay) % 2 == 1


def can_start_wide_at_surface_bay(block_or_record: Union[str, Dict[str, Any]], bay: str) -> bool:
    bay_num = int(bay)
    return bay_num % 4 == 1 and bay_num + 2 <= get_max_surface_bay(block_or_record)


def get_wide_anchor_bay_from_surface_bay(bay: str) -> str:
    return format_bay_number(int(bay) + 1)


def get_surface_bays_from_wide_anchor(bay: str) -> List[str]:
    bay_num = int(bay)
    return [format_bay_number(bay_num - 1), format_bay_number(bay_num + 1)]


def get_surface_start_bay_from_wide_anchor(bay: str) -> str:
    return get_surface_bays_from_wide_anchor(bay)[0]


def is_45ft_anchor_allowed(block_or_record: Union[str, Dict[str, Any]], bay: str) -> bool:
    bay_num = int(bay)
    return bay_num == 2 or bay_num == get_max_wide_bay(block_or_record)


def default_allowed_types_for_bay(block_or_record: Union[str, Dict[str, Any]], bay: str) -> List[str]:
    allowed = ["20ft"]
    if can_start_wide_at_surface_bay(block_or_record, bay):
        allowed.append("40ft")
        if is_45ft_anchor_allowed(block_or_record, get_wide_anchor_bay_from_surface_bay(bay)):
            allowed.append("45ft")
    return allowed


def get_surface_position_codes(block: str, bay: str, row_num: int, tier_num: int, container_type: str) -> List[str]:
    normalized_bay = format_bay_number(int(bay))
    if not is_wide_container(container_type):
        return [f"{block}-{normalized_bay}-{row_num}-{tier_num}"]
    return [f"{block}-{surface_bay}-{row_num}-{tier_num}" for surface_bay in get_surface_bays_from_wide_anchor(normalized_bay)]


def container_position_is_valid(container_type: str, block: str, bay: str, row_num: int, tier_num: int) -> bool:
    block_record = next((item for item in DEFAULT_BLOCKS if item[0] == block), None)
    if not block_record:
        return False
    if int(row_num) < 1 or int(row_num) > int(block_record[3]):
        return False
    if int(tier_num) < 1 or int(tier_num) > int(block_record[4]):
        return False
    bay_num = int(bay)
    if not is_wide_container(container_type):
        if bay_num < 1 or bay_num > get_max_surface_bay(block) or bay_num % 2 == 0:
            return False
        return True
    if bay_num < 2 or bay_num > get_max_wide_bay(block) or bay_num % 4 != 2:
        return False
    if str(container_type).strip().lower() == "45ft" and not is_45ft_anchor_allowed(block, format_bay_number(bay_num)):
        return False
    try:
        get_surface_position_codes(block, bay, row_num, tier_num, container_type)
    except ValueError:
        return False
    return True


def sync_terminal_blocks(db: sqlite3.Connection) -> None:
    expected_blocks = {block[0] for block in DEFAULT_BLOCKS}
    db.executemany(
        """
        INSERT INTO terminal_blocks (block, label, bay_count, row_count, tier_count, equipment)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(block) DO UPDATE SET
            label=excluded.label,
            bay_count=excluded.bay_count,
            row_count=excluded.row_count,
            tier_count=excluded.tier_count,
            equipment=excluded.equipment
        """,
        DEFAULT_BLOCKS,
    )
    placeholders = ", ".join("?" for _ in expected_blocks)
    db.execute(f"DELETE FROM terminal_blocks WHERE block NOT IN ({placeholders})", tuple(expected_blocks))


def sync_slot_overrides(db: sqlite3.Connection) -> None:
    layout_by_block = {block: {"bay_count": bay_count, "row_count": row_count, "tier_count": tier_count} for block, _, bay_count, row_count, tier_count, _ in DEFAULT_BLOCKS}
    rows = db.execute("SELECT slot_code, block, bay, row_num, max_tiers FROM slot_overrides").fetchall()
    for row in rows:
        layout = layout_by_block.get(row["block"])
        if not layout:
            db.execute("DELETE FROM slot_overrides WHERE slot_code = ?", (row["slot_code"],))
            continue
        if int(row["bay"]) > (layout["bay_count"] * 2 - 1) or int(row["row_num"]) > layout["row_count"] or int(row["bay"]) % 2 == 0:
            db.execute("DELETE FROM slot_overrides WHERE slot_code = ?", (row["slot_code"],))
            continue
        if int(row["max_tiers"]) > layout["tier_count"]:
            db.execute("UPDATE slot_overrides SET max_tiers = ? WHERE slot_code = ?", (layout["tier_count"], row["slot_code"]))


def should_reset_demo_inventory(db: sqlite3.Connection) -> bool:
    rows = db.execute("SELECT container_id, container_type, block, bay, row_num, tier_num FROM inventory").fetchall()
    if not rows:
        return True
    container_ids = {row["container_id"] for row in rows}
    expected_ids = {entry[0] for entry in DEFAULT_INVENTORY}
    if not container_ids.issubset(expected_ids):
        return False
    if container_ids != expected_ids:
        return True
    return any(
        not container_position_is_valid(row["container_type"], row["block"], row["bay"], row["row_num"], row["tier_num"])
        for row in rows
    )


def reseed_demo_inventory(db: sqlite3.Connection) -> None:
    db.execute("DELETE FROM slot_overrides")
    db.execute("DELETE FROM inventory")
    db.execute("DELETE FROM operations_log")
    db.executemany(
        """
        INSERT INTO inventory (container_id, container_type, block, bay, row_num, tier_num, position_code, status, direction, line, expeditor, damages, seals, arrived_at, positioned_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        DEFAULT_INVENTORY,
    )
    db.executemany(
        """
        INSERT INTO operations_log (container_id, operation_type, old_position_code, new_position_code, performed_at, created_at, operator_username, operator_full_name, operator_role, container_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        DEFAULT_LOGS,
    )


def ensure_postgres_ready(db: DBConnection) -> None:
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    missing = []
    for table_name in SCHEMA_REQUIRED_TABLES:
        row = db.execute("SELECT to_regclass(%s) AS table_name", (table_name,)).fetchone()
        if table_name == "sessions":
            continue
        if not row or not row.get("table_name"):
            missing.append(table_name)
    if missing:
        raise RuntimeError(
            "Supabase schema is incomplete. Run setup_supabase.sql before starting the backend. "
            f"Missing tables: {', '.join(missing)}."
        )


def init_db() -> None:
    if USE_POSTGRES:
        with get_db() as db:
            ensure_postgres_ready(db)
            sync_terminal_blocks(db)
            sync_slot_overrides(db)
        return

    os.makedirs(os.path.dirname(LOCAL_DB_PATH), exist_ok=True)
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                full_name TEXT NOT NULL,
                telegram_chat_id TEXT,
                notifications_enabled INTEGER NOT NULL,
                telegram_notifications_enabled INTEGER NOT NULL,
                receive_all_movement_alerts INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS terminal_blocks (
                block TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                bay_count INTEGER NOT NULL,
                row_count INTEGER NOT NULL,
                tier_count INTEGER NOT NULL,
                equipment TEXT
            );
            CREATE TABLE IF NOT EXISTS slot_overrides (
                slot_code TEXT PRIMARY KEY,
                block TEXT NOT NULL,
                bay TEXT NOT NULL,
                row_num INTEGER NOT NULL,
                enabled INTEGER NOT NULL,
                max_tiers INTEGER NOT NULL,
                allowed_container_types TEXT NOT NULL,
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS inventory (
                container_id TEXT PRIMARY KEY,
                container_type TEXT NOT NULL,
                block TEXT NOT NULL,
                bay TEXT NOT NULL,
                row_num INTEGER NOT NULL,
                tier_num INTEGER NOT NULL,
                position_code TEXT NOT NULL,
                status TEXT NOT NULL,
                direction TEXT NOT NULL,
                line TEXT,
                expeditor TEXT,
                damages TEXT,
                seals TEXT,
                arrived_at TEXT NOT NULL,
                positioned_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS operations_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                container_id TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                old_position_code TEXT,
                new_position_code TEXT,
                performed_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                operator_username TEXT,
                operator_full_name TEXT,
                operator_role TEXT,
                container_snapshot TEXT
            );
            CREATE TABLE IF NOT EXISTS notification_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT,
                operation_type TEXT,
                container_id TEXT,
                targets TEXT,
                success INTEGER NOT NULL,
                response_text TEXT,
                status_code INTEGER,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        count_row = db.execute("SELECT COUNT(*) AS count FROM users").fetchone()
        if count_row["count"] == 0 and DEMO_MODE:
            for user in DEFAULT_USERS:
                db.execute(
                    """
                    INSERT INTO users (user_id, username, password_hash, role, full_name, telegram_chat_id,
                    notifications_enabled, telegram_notifications_enabled, receive_all_movement_alerts, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user[0], user[1], hash_password(user[2]), user[3], user[4], user[5], user[6], user[7], user[8], user[9]),
                )
        sync_terminal_blocks(db)
        sync_slot_overrides(db)
        if DEMO_MODE and should_reset_demo_inventory(db):
            reseed_demo_inventory(db)


def row_dict(row: Any) -> Dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, dict):
        return row
    return dict(row)


def decode_json_field(value: Any, default: Any) -> Any:
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def json_default(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def json_dumps_safe(value: Any) -> str:
    return json.dumps(value, default=json_default)


def normalize_user_row(user: Any) -> Dict[str, Any]:
    item = row_dict(user)
    if not item:
        return {}
    item["notifications_enabled"] = bool(item["notifications_enabled"])
    item["telegram_notifications_enabled"] = bool(item["telegram_notifications_enabled"])
    item["receive_all_movement_alerts"] = bool(item["receive_all_movement_alerts"])
    return item


def parse_position_code(position_code: str) -> Dict[str, Any]:
    try:
        block, bay, row, tier = position_code.split("-")
        return {"block": block, "bay": bay, "row_num": int(row), "tier_num": int(tier)}
    except ValueError:
        return {}


def _local_user_row(username: str, db: Optional[DBConnection] = None) -> Optional[Dict[str, Any]]:
    if db is None:
        with get_db() as db_conn:
            row = db_conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    else:
        row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        return None
    return normalize_user_row(row)


def list_users(db: Optional[DBConnection] = None) -> List[Dict[str, Any]]:
    if db is None:
        with get_db() as db_conn:
            rows = db_conn.execute("SELECT * FROM users ORDER BY username").fetchall()
    else:
        rows = db.execute("SELECT * FROM users ORDER BY username").fetchall()
    return [public_user(normalize_user_row(row)) for row in rows]


def normalize_role(role: str) -> str:
    normalized = role.strip().upper()
    if normalized not in ROLE_PERMISSIONS:
        raise ValueError(f"Unsupported role: {role}")
    return normalized


def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    user = _local_user_row(username)
    if not user or not verify_password(password, user["password_hash"]):
        return None
    return public_user(user)


def create_session(username: str) -> tuple[str, Dict[str, Any]]:
    user = _local_user_row(username)
    if not user:
        raise ValueError("Unknown user")
    token = secrets.token_urlsafe(32)
    with get_db() as db:
        db.execute(
            "INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)",
            (token, username, utc_now_iso()),
        )
    return token, public_user(user)


def delete_session(token: str) -> None:
    with get_db() as db:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))


def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    with get_db() as db:
        session = db.execute("SELECT username FROM sessions WHERE token = ?", (token,)).fetchone()
    if not session:
        return None
    username = session["username"] if isinstance(session, dict) else session["username"]
    user = _local_user_row(username)
    return public_user(user) if user else None


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    user = _local_user_row(username)
    return public_user(user) if user else None


def create_user_record(payload: Dict[str, Any]) -> Dict[str, Any]:
    if _local_user_row(payload["username"].strip()):
        raise ValueError("Username already exists.")
    role = normalize_role(payload["role"])
    with get_db() as db:
        if USE_POSTGRES:
            db.execute(
                """
                INSERT INTO users (user_id, username, password_hash, role, full_name, telegram_chat_id,
                notifications_enabled, telegram_notifications_enabled, receive_all_movement_alerts, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    payload["username"].strip(),
                    hash_password(payload["password"]),
                    role,
                    payload["full_name"].strip(),
                    payload.get("telegram_chat_id"),
                    bool_int(payload.get("notifications_enabled", True)),
                    bool_int(payload.get("telegram_notifications_enabled", True)),
                    bool_int(payload.get("receive_all_movement_alerts", False) if "receive_all_movement_alerts" in get_permissions_for_role(role) else False),
                    utc_now_iso(),
                ),
            )
        else:
            db.execute(
                """
                INSERT INTO users (user_id, username, password_hash, role, full_name, telegram_chat_id,
                notifications_enabled, telegram_notifications_enabled, receive_all_movement_alerts, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"usr-{secrets.token_hex(4)}",
                    payload["username"].strip(),
                    hash_password(payload["password"]),
                    role,
                    payload["full_name"].strip(),
                    payload.get("telegram_chat_id"),
                    bool_int(payload.get("notifications_enabled", True)),
                    bool_int(payload.get("telegram_notifications_enabled", True)),
                    bool_int(payload.get("receive_all_movement_alerts", False) if "receive_all_movement_alerts" in get_permissions_for_role(role) else False),
                    utc_now_iso(),
                ),
            )
    return get_user_by_username(payload["username"].strip())


def update_user_role(username: str, role: str) -> Optional[Dict[str, Any]]:
    normalized = normalize_role(role)
    with get_db() as db:
        cursor = db.execute(
            """
            UPDATE users
            SET role = ?, receive_all_movement_alerts = CASE WHEN ? THEN receive_all_movement_alerts ELSE 0 END
            WHERE username = ?
            """,
            (normalized, int("receive_all_movement_alerts" in get_permissions_for_role(normalized)), username),
        )
    if cursor.rowcount == 0:
        return None
    return get_user_by_username(username)


def admin_set_password(username: str, new_password: str) -> Optional[Dict[str, Any]]:
    with get_db() as db:
        cursor = db.execute("UPDATE users SET password_hash = ? WHERE username = ?", (hash_password(new_password), username))
    if cursor.rowcount == 0:
        return None
    return get_user_by_username(username)


def change_own_password(username: str, current_password: str, new_password: str) -> Optional[Dict[str, Any]]:
    user = _local_user_row(username)
    if not user:
        return None
    if not verify_password(current_password, user["password_hash"]):
        raise ValueError("Current password is incorrect.")
    with get_db() as db:
        db.execute("UPDATE users SET password_hash = ? WHERE username = ?", (hash_password(new_password), username))
    return get_user_by_username(username)


def update_notification_settings(username: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    user = _local_user_row(username)
    if not user:
        return None
    receive_all = bool(updates.get("receive_all_movement_alerts", user["receive_all_movement_alerts"]))
    if "receive_all_movement_alerts" not in get_permissions_for_role(user["role"]):
        receive_all = False
    with get_db() as db:
        db.execute(
            "UPDATE users SET notifications_enabled = ?, telegram_notifications_enabled = ?, receive_all_movement_alerts = ? WHERE username = ?",
            (bool_int(updates["notifications_enabled"]), bool_int(updates["telegram_notifications_enabled"]), bool_int(receive_all), username),
        )
    return get_user_by_username(username)


def get_terminal_layout(db: Optional[DBConnection] = None) -> List[Dict[str, Any]]:
    if db is None:
        with get_db() as db_conn:
            rows = db_conn.execute("SELECT * FROM terminal_blocks ORDER BY block").fetchall()
    else:
        rows = db.execute("SELECT * FROM terminal_blocks ORDER BY block").fetchall()
    return [row_dict(row) for row in rows]


def update_terminal_block(block: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    with get_db() as db:
        cursor = db.execute(
            "UPDATE terminal_blocks SET label=?, bay_count=?, row_count=?, tier_count=?, equipment=? WHERE block=?",
            (updates["label"].strip(), int(updates["bay_count"]), int(updates["row_count"]), int(updates["tier_count"]), updates.get("equipment"), block),
        )
    if cursor.rowcount == 0:
        return None
    return next(item for item in get_terminal_layout() if item["block"] == block)


def build_slot_record(block_record: Dict[str, Any], bay: str, row: int, override: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    slot = {
        "block": block_record["block"],
        "slot_code": f"{block_record['block']}-{bay}-{row}",
        "bay": bay,
        "row_num": row,
        "enabled": True,
        "max_tiers": block_record["tier_count"],
        "allowed_container_types": default_allowed_types_for_bay(block_record, bay),
        "notes": None,
    }
    if override:
        slot.update(override)
    return slot


def load_slot_overrides(
    db: Optional[DBConnection] = None,
    block: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    query = "SELECT * FROM slot_overrides"
    params: List[Any] = []
    if block is not None:
        query += " WHERE block = ?"
        params.append(block)
    if db is None:
        with get_db() as db_conn:
            rows = db_conn.execute(query, params).fetchall()
    else:
        rows = db.execute(query, params).fetchall()
    return {
        row["slot_code"]: {
            **row_dict(row),
            "enabled": bool(row["enabled"]),
            "allowed_container_types": decode_json_field(row["allowed_container_types"], []),
        }
        for row in rows
    }


def get_slots_for_block(
    block: str,
    *,
    layout_records: Optional[List[Dict[str, Any]]] = None,
    overrides_by_slot: Optional[Dict[str, Dict[str, Any]]] = None,
    db: Optional[DBConnection] = None,
) -> List[Dict[str, Any]]:
    layout_source = layout_records if layout_records is not None else get_terminal_layout(db=db)
    block_record = next((item for item in layout_source if item["block"] == block), None)
    if not block_record:
        return []
    overrides = overrides_by_slot if overrides_by_slot is not None else load_slot_overrides(db=db, block=block)
    slots = []
    for bay_index in range(1, block_record["bay_count"] + 1):
        bay = format_bay_number(bay_index * 2 - 1)
        for row in range(1, block_record["row_count"] + 1):
            slot_code = f"{block}-{bay}-{row}"
            slots.append(build_slot_record(block_record, bay, row, overrides.get(slot_code)))
    return slots


def get_all_slots(
    *,
    db: Optional[DBConnection] = None,
    layout_records: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    layout_source = layout_records if layout_records is not None else get_terminal_layout(db=db)
    overrides_by_slot = load_slot_overrides(db=db)
    result: List[Dict[str, Any]] = []
    for block in layout_source:
        result.extend(
            get_slots_for_block(
                block["block"],
                layout_records=layout_source,
                overrides_by_slot=overrides_by_slot,
            )
        )
    return result


def get_slot(
    block: str,
    bay: str,
    row: int,
    *,
    db: Optional[DBConnection] = None,
    layout_records: Optional[List[Dict[str, Any]]] = None,
    overrides_by_slot: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    return next(
        (
            slot
            for slot in get_slots_for_block(
                block,
                db=db,
                layout_records=layout_records,
                overrides_by_slot=overrides_by_slot,
            )
            if slot["bay"] == bay and slot["row_num"] == row
        ),
        None,
    )


def update_slot(block: str, bay: str, row: int, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    slot = get_slot(block, bay, row)
    if not slot:
        return None
    with get_db() as db:
        db.execute(
            """
            INSERT INTO slot_overrides (slot_code, block, bay, row_num, enabled, max_tiers, allowed_container_types, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slot_code) DO UPDATE SET enabled=excluded.enabled, max_tiers=excluded.max_tiers, allowed_container_types=excluded.allowed_container_types, notes=excluded.notes
            """,
            (slot["slot_code"], block, bay, row, bool_int(updates["enabled"]), int(updates["max_tiers"]), json.dumps(list(updates["allowed_container_types"])), updates.get("notes")),
        )
    return get_slot(block, bay, row)


def insert_inventory(container: Dict[str, Any]) -> bool:
    payload = dict(container)
    timestamp = utc_now_iso()
    payload.setdefault("arrived_at", timestamp)
    payload.setdefault("positioned_at", timestamp)
    payload["updated_at"] = timestamp
    with get_db() as db:
        db.execute(
            """
            INSERT INTO inventory (container_id, container_type, block, bay, row_num, tier_num, position_code, status, direction, line, expeditor, damages, seals, arrived_at, positioned_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["container_id"], payload["container_type"], payload["block"], payload["bay"], payload["row_num"], payload["tier_num"],
                payload["position_code"], payload["status"], payload["direction"], payload.get("line"), payload.get("expeditor"),
                payload.get("damages"), payload.get("seals"), payload["arrived_at"], payload["positioned_at"], payload["updated_at"]
            ),
        )
    return True


def check_inventory(container_id: str, db: Optional[DBConnection] = None) -> Optional[Dict[str, Any]]:
    if db is None:
        with get_db() as db_conn:
            row = db_conn.execute("SELECT * FROM inventory WHERE container_id = ?", (container_id,)).fetchone()
    else:
        row = db.execute("SELECT * FROM inventory WHERE container_id = ?", (container_id,)).fetchone()
    return row_dict(row) if row else None


def find_inventory_by_position(position_code: str, exclude_container_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    query = "SELECT * FROM inventory WHERE position_code = ?"
    params: List[Any] = [position_code]
    if exclude_container_id:
        query += " AND container_id != ?"
        params.append(exclude_container_id)
    query += " LIMIT 1"
    with get_db() as db:
        row = db.execute(query, params).fetchone()
    return row_dict(row) if row else None


def find_inventory_by_surface_position(
    block: str,
    bay: str,
    row_num: int,
    tier_num: int,
    container_type: str,
    exclude_container_id: Optional[str] = None,
    *,
    inventory_rows: Optional[List[Dict[str, Any]]] = None,
    db: Optional[DBConnection] = None,
) -> Optional[Dict[str, Any]]:
    target_codes = set(get_surface_position_codes(block, bay, row_num, tier_num, container_type))
    inventory = inventory_rows if inventory_rows is not None else get_all_inventory(db=db)
    for item in inventory:
        if exclude_container_id and item["container_id"] == exclude_container_id:
            continue
        occupied_codes = set(get_surface_position_codes(item["block"], item["bay"], item["row_num"], item["tier_num"], item["container_type"]))
        if target_codes & occupied_codes:
            return item
    return None


def get_slot_lookup_bay(block: str, bay: str, container_type: str) -> str:
    normalized_bay = format_bay_number(int(bay))
    if not is_wide_container(container_type):
        return normalized_bay
    return get_surface_start_bay_from_wide_anchor(normalized_bay)


def has_supporting_base(
    block: str,
    bay: str,
    row_num: int,
    tier_num: int,
    container_type: str,
    *,
    inventory_rows: Optional[List[Dict[str, Any]]] = None,
    db: Optional[DBConnection] = None,
) -> bool:
    if int(tier_num) <= 1:
        return True
    inventory = inventory_rows if inventory_rows is not None else get_all_inventory(db=db)
    support_codes = set(get_surface_position_codes(block, bay, row_num, tier_num - 1, container_type))
    for target_code in support_codes:
        supported = False
        for item in inventory:
            if item["block"] != block or int(item["row_num"]) != int(row_num) or int(item["tier_num"]) != int(tier_num) - 1:
                continue
            occupied_codes = set(get_surface_position_codes(item["block"], item["bay"], item["row_num"], item["tier_num"], item["container_type"]))
            if target_code in occupied_codes:
                supported = True
                break
        if not supported:
            return False
    return True


def get_all_inventory(db: Optional[DBConnection] = None) -> List[Dict[str, Any]]:
    if db is None:
        with get_db() as db_conn:
            rows = db_conn.execute("SELECT * FROM inventory ORDER BY position_code").fetchall()
    else:
        rows = db.execute("SELECT * FROM inventory ORDER BY position_code").fetchall()
    return [row_dict(row) for row in rows]


def delete_inventory(container_id: str) -> bool:
    with get_db() as db:
        db.execute("DELETE FROM inventory WHERE container_id = ?", (container_id,))
    return True


def update_inventory(container_id: str, updates: Dict[str, Any], db: Optional[DBConnection] = None) -> bool:
    payload = dict(updates)
    timestamp = utc_now_iso()
    payload["updated_at"] = timestamp
    if payload.get("position_code") and "positioned_at" not in payload:
        payload["positioned_at"] = timestamp
    assignments = ", ".join(f"{key} = ?" for key in payload.keys())
    params = list(payload.values()) + [container_id]
    if db is None:
        with get_db() as db_conn:
            db_conn.execute(f"UPDATE inventory SET {assignments} WHERE container_id = ?", params)
    else:
        db.execute(f"UPDATE inventory SET {assignments} WHERE container_id = ?", params)
    return True


def insert_log(log_entry: Dict[str, Any], db: Optional[DBConnection] = None) -> bool:
    payload = dict(log_entry)
    performed_at = payload.get("performed_at") or utc_now_iso()
    payload["performed_at"] = performed_at
    payload.setdefault("created_at", performed_at)
    if db is None:
        with get_db() as db_conn:
            db_conn.execute(
                """
                INSERT INTO operations_log (container_id, operation_type, old_position_code, new_position_code, performed_at, created_at, operator_username, operator_full_name, operator_role, container_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["container_id"], payload["operation_type"], payload.get("old_position_code"), payload.get("new_position_code"),
                    payload["performed_at"], payload["created_at"], payload.get("operator_username"), payload.get("operator_full_name"),
                    payload.get("operator_role"), json_dumps_safe(payload.get("container_snapshot", {}))
                ),
            )
    else:
        db.execute(
            """
            INSERT INTO operations_log (container_id, operation_type, old_position_code, new_position_code, performed_at, created_at, operator_username, operator_full_name, operator_role, container_snapshot)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["container_id"], payload["operation_type"], payload.get("old_position_code"), payload.get("new_position_code"),
                payload["performed_at"], payload["created_at"], payload.get("operator_username"), payload.get("operator_full_name"),
                payload.get("operator_role"), json_dumps_safe(payload.get("container_snapshot", {}))
            ),
        )
    return True


def get_operations_log(
    container_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: Optional[int] = None,
    db: Optional[DBConnection] = None,
) -> List[Dict[str, Any]]:
    query = "SELECT * FROM operations_log WHERE 1=1"
    params: List[Any] = []
    if container_id:
        query += " AND container_id = ?"
        params.append(container_id)
    if date_from:
        query += " AND performed_at >= ?"
        params.append(date_from)
    if date_to:
        query += " AND performed_at <= ?"
        params.append(date_to)
    query += " ORDER BY performed_at ASC"
    if limit:
        query += f" LIMIT {int(limit)}"
    if db is None:
        with get_db() as db_conn:
            rows = db_conn.execute(query, params).fetchall()
    else:
        rows = db.execute(query, params).fetchall()
    logs = []
    for row in rows:
        item = row_dict(row)
        item["container_snapshot"] = decode_json_field(item.get("container_snapshot"), {})
        logs.append(item)
    return logs


def get_bootstrap_payload(current_user: Dict[str, Any], logs_limit: int = 50, include_admin_users: bool = False) -> Dict[str, Any]:
    with get_db() as db:
        layout = get_terminal_layout(db=db)
        slots = get_all_slots(db=db, layout_records=layout)
        inventory = get_all_inventory(db=db)
        logs = get_operations_log(limit=logs_limit, db=db)
        payload = {
            "layout": layout,
            "slots": slots,
            "inventory": inventory,
            "logs": logs,
            "fetched_at": utc_now_iso(),
        }
        if include_admin_users and "manage_users" in current_user.get("permissions", []):
            payload["admin_users"] = list_users(db=db)
    return payload


def get_container_history(container_id: str) -> List[Dict[str, Any]]:
    return get_operations_log(container_id=container_id)


def insert_notification_log(entry: Dict[str, Any]) -> bool:
    payload = dict(entry)
    payload.setdefault("created_at", utc_now_iso())
    with get_db() as db:
        db.execute(
            """
            INSERT INTO notification_logs (event_id, operation_type, container_id, targets, success, response_text, status_code, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.get("event_id"), payload.get("operation_type"), payload.get("container_id"),
                json_dumps_safe(payload.get("targets", [])), bool_int(payload.get("success", False)),
                payload.get("response_text"), payload.get("status_code", 0), payload["created_at"]
            ),
        )
    return True


def get_notification_logs(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    query = "SELECT * FROM notification_logs ORDER BY created_at DESC"
    if limit:
        query += f" LIMIT {int(limit)}"
    with get_db() as db:
        rows = db.execute(query).fetchall()
    items = []
    for row in rows:
        item = row_dict(row)
        item["targets"] = decode_json_field(item.get("targets"), [])
        item["success"] = bool(item["success"])
        items.append(item)
    return items


def get_notification_targets(
    operation_type: str,
    acting_user: Dict[str, Any],
    container_snapshot: Dict[str, Any],
    db: Optional[DBConnection] = None,
) -> List[Dict[str, str]]:
    targets: List[Dict[str, str]] = []
    if acting_user.get("notifications_enabled") and acting_user.get("telegram_notifications_enabled"):
        targets.append({"type": "user", "channel": "telegram", "target": acting_user["username"], "label": f"{acting_user['full_name']} (self)"})
    for user in list_users(db=db):
        if user["username"] == acting_user["username"]:
            continue
        if user.get("notifications_enabled") and user.get("telegram_notifications_enabled") and user.get("receive_all_movement_alerts"):
            targets.append({"type": "role", "channel": "telegram", "target": user["username"], "label": f"{user['full_name']} ({user['role']})"})
    expeditor = container_snapshot.get("expeditor")
    if expeditor:
        targets.append({"type": "expeditor", "channel": "telegram", "target": expeditor, "label": f"Assigned expeditor: {expeditor}"})
    if operation_type == "STACK_OUT":
        targets.append({"type": "group", "channel": "telegram", "target": "shift-control-room", "label": "Shift control room"})
    return targets


def get_inventory_snapshot_at(snapshot_at: str) -> List[Dict[str, Any]]:
    logs = get_operations_log(date_to=snapshot_at)
    state: Dict[str, Dict[str, Any]] = {}
    for entry in logs:
        container_id = entry["container_id"]
        if entry["operation_type"] == "STACK_OUT":
            state.pop(container_id, None)
            continue
        snapshot = dict(entry.get("container_snapshot") or state.get(container_id, {}))
        new_position_code = entry.get("new_position_code")
        if new_position_code:
            snapshot["position_code"] = new_position_code
            snapshot.update(parse_position_code(new_position_code))
        snapshot["container_id"] = container_id
        snapshot["last_operation_type"] = entry["operation_type"]
        snapshot["last_operation_at"] = entry.get("performed_at")
        snapshot["last_operator_username"] = entry.get("operator_username")
        snapshot["last_operator_full_name"] = entry.get("operator_full_name")
        state[container_id] = snapshot
    return sorted(state.values(), key=lambda item: item.get("position_code", ""))


init_db()
