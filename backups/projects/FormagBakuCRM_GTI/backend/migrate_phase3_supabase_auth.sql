-- ============================================================
-- MIGRATION SCRIPT: FormagBaku CRM — Phase 3 Supabase Auth
-- Run this in Supabase SQL Editor after creating auth users
-- ============================================================

-- 1. Link staff records directly to Supabase Auth users
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;

CREATE INDEX IF NOT EXISTS staff_auth_user_id_idx
  ON public.staff(auth_user_id);

-- 2. Backfill links by matching email addresses
-- This is safe to run multiple times.
UPDATE public.staff AS staff_member
SET auth_user_id = auth_user.id
FROM auth.users AS auth_user
WHERE lower(staff_member.email) = lower(auth_user.email)
  AND staff_member.auth_user_id IS NULL;

-- 3. Verification
SELECT
  full_name,
  email,
  role,
  auth_user_id
FROM public.staff
ORDER BY full_name;
