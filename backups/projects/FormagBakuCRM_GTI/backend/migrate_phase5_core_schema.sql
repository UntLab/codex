-- ============================================================
-- MIGRATION SCRIPT: FormagBaku CRM - Phase 5 Core Business Schema
-- Sync the live Supabase schema with the current backend business flow.
-- Safe to run multiple times.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- 1. Staff / agents / clients parity
-- ------------------------------------------------------------

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS firebase_uid TEXT;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS main_email TEXT,
  ADD COLUMN IF NOT EXISTS cc_emails TEXT,
  ADD COLUMN IF NOT EXISTS transportation_type TEXT[],
  ADD COLUMN IF NOT EXISTS portal_access_token TEXT;

ALTER TABLE public.agents
  ALTER COLUMN portal_access_token SET DEFAULT encode(gen_random_bytes(16), 'hex');

UPDATE public.agents
SET portal_access_token = encode(gen_random_bytes(16), 'hex')
WHERE portal_access_token IS NULL;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS additional_emails TEXT,
  ADD COLUMN IF NOT EXISTS telephone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS is_new_client BOOLEAN DEFAULT FALSE;

-- ------------------------------------------------------------
-- 2. Offers parity and request numbering
-- ------------------------------------------------------------

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS req_number TEXT,
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sales_manager_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMP WITH TIME ZONE;

UPDATE public.offers
SET req_number = 'REQ-' || to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || upper(substr(replace(id::text, '-', ''), 1, 6))
WHERE req_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS offers_req_number_unique_idx
  ON public.offers(req_number);

CREATE INDEX IF NOT EXISTS offers_sales_manager_idx
  ON public.offers(sales_manager_id);

-- ------------------------------------------------------------
-- 3. Quotations parity and booking metadata
-- ------------------------------------------------------------

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS req_number TEXT,
  ADD COLUMN IF NOT EXISTS booked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS booked_by_staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMP WITH TIME ZONE;

UPDATE public.quotations AS quotation
SET req_number = offer.req_number
FROM public.offers AS offer
WHERE quotation.offer_id = offer.id
  AND quotation.req_number IS NULL;

UPDATE public.quotations
SET status = CASE
  WHEN status = 'Accepted' THEN 'Booked'
  WHEN status = 'Rejected' THEN 'Canceled'
  ELSE 'Pending'
END
WHERE status IS DISTINCT FROM CASE
  WHEN status = 'Accepted' THEN 'Booked'
  WHEN status = 'Rejected' THEN 'Canceled'
  ELSE 'Pending'
END;

ALTER TABLE public.quotations
  ALTER COLUMN status SET DEFAULT 'Pending';

CREATE INDEX IF NOT EXISTS quotations_sales_manager_status_idx
  ON public.quotations(sales_manager_id, status);

CREATE INDEX IF NOT EXISTS quotations_offer_id_idx
  ON public.quotations(offer_id);

-- ------------------------------------------------------------
-- 4. Shipments parity for operations handoff
-- ------------------------------------------------------------

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS bk_number TEXT,
  ADD COLUMN IF NOT EXISTS so_number TEXT,
  ADD COLUMN IF NOT EXISTS req_number TEXT,
  ADD COLUMN IF NOT EXISTS shipper TEXT,
  ADD COLUMN IF NOT EXISTS incoterms TEXT,
  ADD COLUMN IF NOT EXISTS pol TEXT,
  ADD COLUMN IF NOT EXISTS pod TEXT,
  ADD COLUMN IF NOT EXISTS pol_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pod_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS eta_transshipment_port DATE,
  ADD COLUMN IF NOT EXISTS etd_transshipment_port DATE,
  ADD COLUMN IF NOT EXISTS stuffing_date DATE,
  ADD COLUMN IF NOT EXISTS loading_date_from_pod DATE,
  ADD COLUMN IF NOT EXISTS border_arrival_date DATE,
  ADD COLUMN IF NOT EXISTS time_of_arrival_at_delivery_point TEXT,
  ADD COLUMN IF NOT EXISTS container_quantity INT,
  ADD COLUMN IF NOT EXISTS container_type TEXT,
  ADD COLUMN IF NOT EXISTS container_number TEXT,
  ADD COLUMN IF NOT EXISTS empty_container_return_date_at_pod DATE,
  ADD COLUMN IF NOT EXISTS mbl_number TEXT,
  ADD COLUMN IF NOT EXISTS shipping_line TEXT,
  ADD COLUMN IF NOT EXISTS feeder_vessel_name TEXT,
  ADD COLUMN IF NOT EXISTS eta_vessel_at_pod DATE,
  ADD COLUMN IF NOT EXISTS vessel_unloading_date DATE,
  ADD COLUMN IF NOT EXISTS hbl_release_date DATE,
  ADD COLUMN IF NOT EXISTS mbl_release_date DATE,
  ADD COLUMN IF NOT EXISTS date_of_receipt_of_documents DATE,
  ADD COLUMN IF NOT EXISTS doc_sent_to_agent_date DATE,
  ADD COLUMN IF NOT EXISTS short_declaration TEXT,
  ADD COLUMN IF NOT EXISTS terminal_name TEXT,
  ADD COLUMN IF NOT EXISTS d_o_date DATE,
  ADD COLUMN IF NOT EXISTS cargo_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS driver_information TEXT,
  ADD COLUMN IF NOT EXISTS sales_manager_notes TEXT,
  ADD COLUMN IF NOT EXISTS operation_notes TEXT,
  ADD COLUMN IF NOT EXISTS rate_pol_agent_service_quality INT,
  ADD COLUMN IF NOT EXISTS rate_pod_agent_service_quality INT,
  ADD COLUMN IF NOT EXISTS sales_manager_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operation_manager_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shipments_quotation_id_unique_idx
  ON public.shipments(quotation_id)
  WHERE quotation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS shipments_sales_manager_idx
  ON public.shipments(sales_manager_id);

CREATE INDEX IF NOT EXISTS shipments_operation_manager_idx
  ON public.shipments(operation_manager_id);

CREATE INDEX IF NOT EXISTS shipments_req_number_idx
  ON public.shipments(req_number);

UPDATE public.shipments AS shipment
SET
  sales_manager_id = COALESCE(shipment.sales_manager_id, quotation.sales_manager_id),
  req_number = COALESCE(shipment.req_number, quotation.req_number),
  quotation_id = COALESCE(shipment.quotation_id, quotation.id)
FROM public.quotations AS quotation
WHERE shipment.quotation_id IS NULL
  AND shipment.req_number IS NOT NULL
  AND quotation.req_number = shipment.req_number;

-- ------------------------------------------------------------
-- 5. Finance tables
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID REFERENCES public.shipments(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  issue_date DATE,
  due_date DATE,
  invoice_type TEXT CHECK (invoice_type IN ('Receivable', 'Payable')) NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  amount_net NUMERIC(12, 2) NOT NULL,
  vat_18 NUMERIC(12, 2) DEFAULT 0,
  amount_total NUMERIC(12, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Paid', 'Pending', 'Overdue')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
  amount_paid NUMERIC(12, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  payment_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoices_shipment_id_idx
  ON public.invoices(shipment_id);

CREATE INDEX IF NOT EXISTS payments_invoice_id_idx
  ON public.payments(invoice_id);

-- ------------------------------------------------------------
-- 6. Verification
-- ------------------------------------------------------------

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'staff',
    'agents',
    'clients',
    'offers',
    'quotations',
    'shipments',
    'attendance',
    'tank_storage',
    'invoices',
    'payments'
  )
ORDER BY table_name;
