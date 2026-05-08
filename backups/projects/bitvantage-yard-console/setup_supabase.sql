CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    telegram_chat_id VARCHAR(100),
    notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    telegram_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    receive_all_movement_alerts BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(50)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(50);

CREATE TABLE IF NOT EXISTS terminal_blocks (
    block VARCHAR(10) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    bay_count INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    tier_count INTEGER NOT NULL,
    equipment VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS slot_overrides (
    slot_code VARCHAR(30) PRIMARY KEY,
    block VARCHAR(10) NOT NULL,
    bay VARCHAR(10) NOT NULL,
    row_num INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_tiers INTEGER NOT NULL,
    allowed_container_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
    container_id VARCHAR(30) PRIMARY KEY,
    container_type VARCHAR(10) NOT NULL,
    block VARCHAR(10) NOT NULL,
    bay VARCHAR(10) NOT NULL,
    row_num INTEGER NOT NULL,
    tier_num INTEGER NOT NULL,
    position_code VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL,
    direction VARCHAR(20) NOT NULL,
    bonded BOOLEAN NOT NULL DEFAULT FALSE,
    stack_out_date DATE,
    weight DOUBLE PRECISION,
    commodity TEXT,
    line VARCHAR(100),
    expeditor VARCHAR(100),
    damages TEXT,
    seals VARCHAR(100),
    arrived_at TIMESTAMPTZ NOT NULL,
    positioned_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS bonded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS stack_out_date DATE;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS weight DOUBLE PRECISION;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS commodity TEXT;

CREATE TABLE IF NOT EXISTS operations_log (
    id BIGSERIAL PRIMARY KEY,
    container_id VARCHAR(30) NOT NULL,
    operation_type VARCHAR(20) NOT NULL,
    old_position_code VARCHAR(30),
    new_position_code VARCHAR(30),
    performed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    operator_username VARCHAR(50),
    operator_full_name VARCHAR(100),
    operator_role VARCHAR(20),
    container_snapshot JSONB,
    emergency_override BOOLEAN NOT NULL DEFAULT FALSE,
    override_reason TEXT
);

ALTER TABLE operations_log ADD COLUMN IF NOT EXISTS emergency_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE operations_log ADD COLUMN IF NOT EXISTS override_reason TEXT;

CREATE TABLE IF NOT EXISTS notification_logs (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(255),
    operation_type VARCHAR(20),
    container_id VARCHAR(30),
    targets JSONB NOT NULL DEFAULT '[]'::jsonb,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    response_text TEXT,
    status_code INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_inventory_position_code ON inventory(position_code);
CREATE INDEX IF NOT EXISTS idx_inventory_block_row_tier ON inventory(block, row_num, tier_num);
CREATE INDEX IF NOT EXISTS idx_operations_log_container_id ON operations_log(container_id);
CREATE INDEX IF NOT EXISTS idx_operations_log_performed_at ON operations_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
