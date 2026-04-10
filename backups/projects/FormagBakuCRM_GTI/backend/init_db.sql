-- ==========================================
-- DDL Script: Formag Baku ERP (Supabase)
-- ==========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Table: staff (Sales & Operations Managers)
CREATE TABLE public.staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    role TEXT CHECK (role IN ('Sales', 'Operations', 'HR', 'Admin')) NOT NULL,
    email TEXT UNIQUE NOT NULL,
    firebase_uid TEXT,
    auth_user_id UUID UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 100,
    signature_html TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.staff_email_profiles (
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

-- 2. Table: agents (Agent Database)
CREATE TABLE public.agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name TEXT NOT NULL,
    contact_info TEXT,
    country TEXT,
    main_email TEXT,
    cc_emails TEXT,
    transportation_type TEXT[],
    portal_access_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Table: clients (Client Database & CRM)
CREATE TABLE public.clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    contact_email TEXT,
    additional_emails TEXT,
    contact_mobile TEXT,
    telephone TEXT,
    tax_id TEXT,
    address TEXT,
    website TEXT,
    is_new_client BOOLEAN DEFAULT false,
    sales_manager_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
    status TEXT CHECK (status IN ('Active', 'Lost')) DEFAULT 'Active',
    last_activity_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Table: shipments (Status for Formag Forwarding)
CREATE TABLE public.shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
    shipment_type TEXT CHECK (shipment_type IN ('ImportFCL', 'TransitFCL', 'ExportFCL', 'AIR', 'LCL', 'FTL', 'LTL', 'RailWay')) NOT NULL,
    status TEXT NOT NULL,
    departure_date DATE,
    delivery_date DATE,
    pod_reached BOOLEAN DEFAULT FALSE,
    agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Extended Operations Fields (Phase 2.1)
    bk_number TEXT,
    so_number TEXT,
    req_number TEXT,
    shipper TEXT,
    incoterms TEXT,
    pol TEXT,
    pod TEXT,
    pol_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    pod_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    
    eta_transshipment_port DATE,
    etd_transshipment_port DATE,
    stuffing_date DATE,
    loading_date_from_pod DATE,
    border_arrival_date DATE,
    time_of_arrival_at_delivery_point TEXT,
    
    container_quantity INT,
    container_type TEXT,
    container_number TEXT,
    empty_container_return_date_at_pod DATE,
    
    mbl_number TEXT,
    shipping_line TEXT,
    feeder_vessel_name TEXT,
    eta_vessel_at_pod DATE,
    vessel_unloading_date DATE,
    hbl_release_date DATE,
    mbl_release_date DATE,
    
    date_of_receipt_of_documents DATE,
    doc_sent_to_agent_date DATE,
    short_declaration TEXT,
    terminal_name TEXT,
    d_o_date DATE,
    cargo_delivery_date DATE,
    
    driver_information TEXT,
    sales_manager_notes TEXT,
    operation_notes TEXT,
    rate_pol_agent_service_quality INT,
    rate_pod_agent_service_quality INT,
    
    sales_manager_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
    operation_manager_id UUID REFERENCES public.staff(id) ON DELETE SET NULL
);

-- 5. Table: offers (Incoming Freight Quote Requests)
CREATE TABLE public.offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    req_number TEXT UNIQUE,
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
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    sales_manager_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
    quoted_at TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'New',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Table: quotations (Freight Quotes / Price Offers)
CREATE TABLE public.quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_id UUID REFERENCES public.offers(id) ON DELETE SET NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    req_number TEXT,
    -- Contact info (если клиент не в базе, берём из заявки)
    contact_name TEXT,
    contact_email TEXT,
    contact_company TEXT,
    -- Маршрут и тип
    origin TEXT,
    destination TEXT,
    transportation_type TEXT,
    commodity TEXT,
    departure_date DATE,
    -- Ценообразование
    buy_rate NUMERIC(12, 2),
    sell_rate NUMERIC(12, 2),
    rate NUMERIC(12, 2),
    currency TEXT DEFAULT 'USD',
    validity_date DATE,
    incoterms TEXT,
    trade_direction TEXT,
    -- Управление
    status TEXT DEFAULT 'Pending',
    sales_manager_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
    booked_at TIMESTAMP WITH TIME ZONE,
    booked_by_staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
    canceled_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.shipments
ADD COLUMN quotation_id UUID UNIQUE REFERENCES public.quotations(id) ON DELETE SET NULL;

-- 8. Table: attendance (Monthly reports)
CREATE TABLE public.attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID REFERENCES public.staff(id) ON DELETE CASCADE NOT NULL,
    record_date DATE NOT NULL,
    day_of_week TEXT,
    arrival_time TIME,
    departure_time TIME,
    working_hours NUMERIC,
    delay_minutes INTEGER DEFAULT 0,
    is_absent BOOLEAN DEFAULT FALSE,
    permission_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(staff_id, record_date)
);

-- 9. Table: invoices (Finance tracking for VAT, Margins, Receivables)
CREATE TABLE public.invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID REFERENCES public.shipments(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    issue_date DATE,
    due_date DATE,
    invoice_type TEXT CHECK (invoice_type IN ('Receivable', 'Payable')) NOT NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL, -- If it's a Receivable from Client
    agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL, -- If it's a Payable to Agent
    amount_net NUMERIC(12, 2) NOT NULL,
    vat_18 NUMERIC(12, 2) DEFAULT 0,
    amount_total NUMERIC(12, 2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Paid', 'Pending', 'Overdue')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Table: payments (Reconciliation and cash flow)
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
    amount_paid NUMERIC(12, 2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    payment_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Table: tank_storage (Demurrage and Detention tracking)
CREATE TABLE public.tank_storage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    container_number TEXT NOT NULL,
    arrival_date DATE NOT NULL,
    stop_date DATE,
    free_days INTEGER DEFAULT 15,
    rate_tier1 NUMERIC(12, 2) DEFAULT 2.00, -- 16-30 days
    rate_tier2 NUMERIC(12, 2) DEFAULT 2.50, -- 31-60 days
    rate_tier3 NUMERIC(12, 2) DEFAULT 4.00, -- >60 days
    warning_limit NUMERIC(12, 2) DEFAULT 100.00,
    comments TEXT,
    alert_freedays_sent BOOLEAN DEFAULT FALSE,
    alert_warning_sent BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Stopped')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- Automatic Triggers (Replacing Apps Script)
-- ==========================================

-- Trigger Function: Update client's last activity date and status on shipment creation
CREATE OR REPLACE FUNCTION update_client_last_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.clients
    SET last_activity_date = NOW(),
        status = 'Active' -- If they have a new shipment, they are Active again
    WHERE id = NEW.client_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to shipments table
CREATE TRIGGER shipment_activity_trigger
AFTER INSERT OR UPDATE ON public.shipments
FOR EACH ROW
EXECUTE FUNCTION update_client_last_activity();

-- ==========================================
-- Row Level Security (RLS) - "Личные кабинеты"
-- ==========================================
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

-- Note: Specific RLS policies based on auth.uid() will be added later
-- in migrate_phase4_rls.sql after Supabase Auth linkage is complete.
