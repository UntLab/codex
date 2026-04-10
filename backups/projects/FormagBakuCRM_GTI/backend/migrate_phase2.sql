-- ============================================================
-- MIGRATION SCRIPT: FormagBaku CRM — Phase 2
-- Run this in Supabase SQL Editor (one time only)
-- Legacy note:
--   This file is kept for historical schema changes.
--   Supabase Auth linkage is handled in migrate_phase3_supabase_auth.sql.
-- ============================================================


-- ── 1. STAFF TABLE ──────────────────────────────────────────
-- Supabase Auth linkage moved to migrate_phase3_supabase_auth.sql.
-- No auth-user column is added in this legacy phase file anymore.


-- ── 2. QUOTATIONS TABLE ─────────────────────────────────────
-- Add buy/sell rates, incoterms, trade direction
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS buy_rate       NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS sell_rate      NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS incoterms      TEXT,
  ADD COLUMN IF NOT EXISTS trade_direction TEXT;


-- ── 3. OFFERS TABLE (if not created yet) ───────────────────
CREATE TABLE IF NOT EXISTS public.offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    company TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    transportation_type TEXT[],
    origin TEXT,
    destination TEXT,
    departure_date DATE,
    commodity TEXT,
    notes TEXT,
    status TEXT DEFAULT 'New',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ── 4. QUOTATIONS TABLE (if not created yet) ───────────────
CREATE TABLE IF NOT EXISTS public.quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_id UUID REFERENCES public.offers(id) ON DELETE SET NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    contact_name TEXT,
    contact_email TEXT,
    contact_company TEXT,
    origin TEXT,
    destination TEXT,
    transportation_type TEXT,
    commodity TEXT,
    departure_date DATE,
    buy_rate NUMERIC(12, 2),
    sell_rate NUMERIC(12, 2),
    rate NUMERIC(12, 2),
    currency TEXT DEFAULT 'USD',
    validity_date DATE,
    incoterms TEXT,
    trade_direction TEXT,
    status TEXT DEFAULT 'Draft',
    sales_manager_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ── 5. DISABLE RLS FOR TESTING ──────────────────────────────
-- Remove when Supabase Auth + RLS policies are fully integrated
ALTER TABLE public.clients    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff      DISABLE ROW LEVEL SECURITY;


-- ── 6. HOW TO ADD A NEW SALES MANAGER (LEGACY NOTES) ───────
-- Step 1: Insert into staff (replace values)
-- INSERT INTO public.staff (full_name, role, email)
-- VALUES ('New Manager Name', 'Sales', 'manager@formag.az');
--
-- Step 2: Create the same user in Supabase Auth
--         Then run migrate_phase3_supabase_auth.sql
--
-- Step 3: Verify that staff.auth_user_id has been backfilled
--         by email match.


-- ── 7. VERIFY ───────────────────────────────────────────────
SELECT 'staff'      AS tbl, count(*) FROM public.staff      UNION ALL
SELECT 'clients'    AS tbl, count(*) FROM public.clients    UNION ALL
SELECT 'agents'     AS tbl, count(*) FROM public.agents     UNION ALL
SELECT 'offers'     AS tbl, count(*) FROM public.offers     UNION ALL
SELECT 'quotations' AS tbl, count(*) FROM public.quotations UNION ALL
SELECT 'shipments'  AS tbl, count(*) FROM public.shipments;
