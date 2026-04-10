-- ============================================================
-- MIGRATION SCRIPT: FormagBaku CRM - Phase 6 Staff Settings
-- Staff directory controls + per-manager outbound email profiles
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS signature_html TEXT;

WITH ordered_staff AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY full_name) * 10 AS display_order_seed
  FROM public.staff
)
UPDATE public.staff AS s
SET display_order = ordered_staff.display_order_seed
FROM ordered_staff
WHERE s.id = ordered_staff.id
  AND (s.display_order IS NULL OR s.display_order = 100);

CREATE TABLE IF NOT EXISTS public.staff_email_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID UNIQUE NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  provider TEXT NOT NULL DEFAULT 'smtp' CHECK (provider IN ('smtp', 'gmail_oauth', 'n8n_proxy')),
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  reply_to_email TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_username TEXT,
  smtp_password TEXT,
  smtp_use_ssl BOOLEAN NOT NULL DEFAULT TRUE,
  email_signature_html TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.staff_email_profiles (
  staff_id,
  is_active,
  provider,
  sender_email,
  sender_name,
  reply_to_email,
  smtp_host,
  smtp_port,
  smtp_username,
  smtp_use_ssl,
  email_signature_html
)
SELECT
  s.id,
  FALSE,
  'smtp',
  s.email,
  s.full_name,
  s.email,
  'smtp.gmail.com',
  465,
  s.email,
  TRUE,
  COALESCE(s.signature_html, '')
FROM public.staff AS s
WHERE s.role = 'Sales'
ON CONFLICT (staff_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
