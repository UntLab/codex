-- ============================================================
-- MIGRATION SCRIPT: FormagBaku CRM - Phase 4 RLS Policies
-- Safe for partial schemas in Supabase.
--
-- Apply only after:
--   1. Supabase Auth users are created
--   2. migrate_phase3_supabase_auth.sql has been executed
--   3. staff.auth_user_id is backfilled
--   4. Backend uses SUPABASE_SERVICE_ROLE_KEY in production
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper functions for role-aware RLS
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.staff
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.staff
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_staff_role(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff
    WHERE auth_user_id = auth.uid()
      AND role = ANY (roles)
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_staff_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_staff_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_staff_role(TEXT[]) TO authenticated;

-- ------------------------------------------------------------
-- 2. Staff
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.staff') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS staff_select_directory ON public.staff';
    EXECUTE 'DROP POLICY IF EXISTS staff_admin_manage ON public.staff';

    EXECUTE $sql$
      CREATE POLICY staff_select_directory
      ON public.staff
      FOR SELECT
      TO authenticated
      USING (public.current_staff_id() IS NOT NULL)
    $sql$;

    EXECUTE $sql$
      CREATE POLICY staff_admin_manage
      ON public.staff
      FOR ALL
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin']))
      WITH CHECK (public.has_staff_role(ARRAY['Admin']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Agents
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.agents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS agents_select_authenticated ON public.agents';
    EXECUTE 'DROP POLICY IF EXISTS agents_manage_admin_hr ON public.agents';

    EXECUTE $sql$
      CREATE POLICY agents_select_authenticated
      ON public.agents
      FOR SELECT
      TO authenticated
      USING (public.current_staff_id() IS NOT NULL)
    $sql$;

    EXECUTE $sql$
      CREATE POLICY agents_manage_admin_hr
      ON public.agents
      FOR ALL
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin', 'HR']))
      WITH CHECK (public.has_staff_role(ARRAY['Admin', 'HR']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. Clients
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS clients_select_by_role ON public.clients';
    EXECUTE 'DROP POLICY IF EXISTS clients_insert_by_role ON public.clients';
    EXECUTE 'DROP POLICY IF EXISTS clients_update_by_role ON public.clients';
    EXECUTE 'DROP POLICY IF EXISTS clients_delete_admin ON public.clients';

    EXECUTE $sql$
      CREATE POLICY clients_select_by_role
      ON public.clients
      FOR SELECT
      TO authenticated
      USING (
        public.has_staff_role(ARRAY['Admin', 'HR', 'Operations'])
        OR sales_manager_id = public.current_staff_id()
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY clients_insert_by_role
      ON public.clients
      FOR INSERT
      TO authenticated
      WITH CHECK (
        public.has_staff_role(ARRAY['Admin', 'HR', 'Operations'])
        OR sales_manager_id = public.current_staff_id()
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY clients_update_by_role
      ON public.clients
      FOR UPDATE
      TO authenticated
      USING (
        public.has_staff_role(ARRAY['Admin', 'HR', 'Operations'])
        OR sales_manager_id = public.current_staff_id()
      )
      WITH CHECK (
        public.has_staff_role(ARRAY['Admin', 'HR', 'Operations'])
        OR sales_manager_id = public.current_staff_id()
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY clients_delete_admin
      ON public.clients
      FOR DELETE
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. Offers
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.offers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS offers_select_authenticated ON public.offers';
    EXECUTE 'DROP POLICY IF EXISTS offers_insert_authenticated ON public.offers';
    EXECUTE 'DROP POLICY IF EXISTS offers_update_admin_hr ON public.offers';
    EXECUTE 'DROP POLICY IF EXISTS offers_delete_admin ON public.offers';

    EXECUTE $sql$
      CREATE POLICY offers_select_authenticated
      ON public.offers
      FOR SELECT
      TO authenticated
      USING (public.current_staff_id() IS NOT NULL)
    $sql$;

    EXECUTE $sql$
      CREATE POLICY offers_insert_authenticated
      ON public.offers
      FOR INSERT
      TO authenticated
      WITH CHECK (public.current_staff_id() IS NOT NULL)
    $sql$;

    EXECUTE $sql$
      CREATE POLICY offers_update_admin_hr
      ON public.offers
      FOR UPDATE
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin', 'HR']))
      WITH CHECK (public.has_staff_role(ARRAY['Admin', 'HR']))
    $sql$;

    EXECUTE $sql$
      CREATE POLICY offers_delete_admin
      ON public.offers
      FOR DELETE
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. Quotations
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.quotations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS quotations_select_by_role ON public.quotations';
    EXECUTE 'DROP POLICY IF EXISTS quotations_insert_by_role ON public.quotations';
    EXECUTE 'DROP POLICY IF EXISTS quotations_update_by_role ON public.quotations';
    EXECUTE 'DROP POLICY IF EXISTS quotations_delete_admin ON public.quotations';

    EXECUTE $sql$
      CREATE POLICY quotations_select_by_role
      ON public.quotations
      FOR SELECT
      TO authenticated
      USING (
        public.has_staff_role(ARRAY['Admin', 'HR'])
        OR sales_manager_id = public.current_staff_id()
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY quotations_insert_by_role
      ON public.quotations
      FOR INSERT
      TO authenticated
      WITH CHECK (
        public.has_staff_role(ARRAY['Admin', 'HR'])
        OR sales_manager_id = public.current_staff_id()
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY quotations_update_by_role
      ON public.quotations
      FOR UPDATE
      TO authenticated
      USING (
        public.has_staff_role(ARRAY['Admin', 'HR'])
        OR sales_manager_id = public.current_staff_id()
      )
      WITH CHECK (
        public.has_staff_role(ARRAY['Admin', 'HR'])
        OR sales_manager_id = public.current_staff_id()
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY quotations_delete_admin
      ON public.quotations
      FOR DELETE
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 7. Shipments
-- If ownership columns are not deployed yet, fall back to a
-- shared authenticated workspace until the schema catches up.
-- ------------------------------------------------------------

DO $$
DECLARE
  has_sales_manager BOOLEAN;
  has_operation_manager BOOLEAN;
BEGIN
  IF to_regclass('public.shipments') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shipments'
        AND column_name = 'sales_manager_id'
    ) INTO has_sales_manager;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shipments'
        AND column_name = 'operation_manager_id'
    ) INTO has_operation_manager;

    EXECUTE 'ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS shipments_select_by_role ON public.shipments';
    EXECUTE 'DROP POLICY IF EXISTS shipments_insert_by_role ON public.shipments';
    EXECUTE 'DROP POLICY IF EXISTS shipments_update_by_role ON public.shipments';
    EXECUTE 'DROP POLICY IF EXISTS shipments_select_authenticated ON public.shipments';
    EXECUTE 'DROP POLICY IF EXISTS shipments_insert_authenticated ON public.shipments';
    EXECUTE 'DROP POLICY IF EXISTS shipments_update_authenticated ON public.shipments';
    EXECUTE 'DROP POLICY IF EXISTS shipments_delete_admin ON public.shipments';

    IF has_sales_manager AND has_operation_manager THEN
      EXECUTE $sql$
        CREATE POLICY shipments_select_by_role
        ON public.shipments
        FOR SELECT
        TO authenticated
        USING (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR sales_manager_id = public.current_staff_id()
          OR operation_manager_id = public.current_staff_id()
        )
      $sql$;

      EXECUTE $sql$
        CREATE POLICY shipments_insert_by_role
        ON public.shipments
        FOR INSERT
        TO authenticated
        WITH CHECK (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR sales_manager_id = public.current_staff_id()
          OR operation_manager_id = public.current_staff_id()
        )
      $sql$;

      EXECUTE $sql$
        CREATE POLICY shipments_update_by_role
        ON public.shipments
        FOR UPDATE
        TO authenticated
        USING (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR sales_manager_id = public.current_staff_id()
          OR operation_manager_id = public.current_staff_id()
        )
        WITH CHECK (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR sales_manager_id = public.current_staff_id()
          OR operation_manager_id = public.current_staff_id()
        )
      $sql$;
    ELSE
      EXECUTE $sql$
        CREATE POLICY shipments_select_authenticated
        ON public.shipments
        FOR SELECT
        TO authenticated
        USING (public.current_staff_id() IS NOT NULL)
      $sql$;

      EXECUTE $sql$
        CREATE POLICY shipments_insert_authenticated
        ON public.shipments
        FOR INSERT
        TO authenticated
        WITH CHECK (public.current_staff_id() IS NOT NULL)
      $sql$;

      EXECUTE $sql$
        CREATE POLICY shipments_update_authenticated
        ON public.shipments
        FOR UPDATE
        TO authenticated
        USING (public.current_staff_id() IS NOT NULL)
        WITH CHECK (public.current_staff_id() IS NOT NULL)
      $sql$;
    END IF;

    EXECUTE $sql$
      CREATE POLICY shipments_delete_admin
      ON public.shipments
      FOR DELETE
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 8. Invoices
-- ------------------------------------------------------------

DO $$
DECLARE
  has_shipments_sales_manager BOOLEAN;
  has_shipments_operation_manager BOOLEAN;
BEGIN
  IF to_regclass('public.invoices') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shipments'
        AND column_name = 'sales_manager_id'
    ) INTO has_shipments_sales_manager;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shipments'
        AND column_name = 'operation_manager_id'
    ) INTO has_shipments_operation_manager;

    EXECUTE 'ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS invoices_select_by_role ON public.invoices';
    EXECUTE 'DROP POLICY IF EXISTS invoices_insert_by_role ON public.invoices';
    EXECUTE 'DROP POLICY IF EXISTS invoices_update_by_role ON public.invoices';
    EXECUTE 'DROP POLICY IF EXISTS invoices_admin_hr_only ON public.invoices';
    EXECUTE 'DROP POLICY IF EXISTS invoices_delete_admin ON public.invoices';

    IF has_shipments_sales_manager AND has_shipments_operation_manager THEN
      EXECUTE $sql$
        CREATE POLICY invoices_select_by_role
        ON public.invoices
        FOR SELECT
        TO authenticated
        USING (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR EXISTS (
            SELECT 1
            FROM public.shipments AS shipment
            WHERE shipment.id = invoices.shipment_id
              AND (
                shipment.sales_manager_id = public.current_staff_id()
                OR shipment.operation_manager_id = public.current_staff_id()
              )
          )
        )
      $sql$;

      EXECUTE $sql$
        CREATE POLICY invoices_insert_by_role
        ON public.invoices
        FOR INSERT
        TO authenticated
        WITH CHECK (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR EXISTS (
            SELECT 1
            FROM public.shipments AS shipment
            WHERE shipment.id = invoices.shipment_id
              AND (
                shipment.sales_manager_id = public.current_staff_id()
                OR shipment.operation_manager_id = public.current_staff_id()
              )
          )
        )
      $sql$;

      EXECUTE $sql$
        CREATE POLICY invoices_update_by_role
        ON public.invoices
        FOR UPDATE
        TO authenticated
        USING (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR EXISTS (
            SELECT 1
            FROM public.shipments AS shipment
            WHERE shipment.id = invoices.shipment_id
              AND (
                shipment.sales_manager_id = public.current_staff_id()
                OR shipment.operation_manager_id = public.current_staff_id()
              )
          )
        )
        WITH CHECK (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR EXISTS (
            SELECT 1
            FROM public.shipments AS shipment
            WHERE shipment.id = invoices.shipment_id
              AND (
                shipment.sales_manager_id = public.current_staff_id()
                OR shipment.operation_manager_id = public.current_staff_id()
              )
          )
        )
      $sql$;
    ELSE
      EXECUTE $sql$
        CREATE POLICY invoices_admin_hr_only
        ON public.invoices
        FOR ALL
        TO authenticated
        USING (public.has_staff_role(ARRAY['Admin', 'HR']))
        WITH CHECK (public.has_staff_role(ARRAY['Admin', 'HR']))
      $sql$;
    END IF;

    EXECUTE $sql$
      CREATE POLICY invoices_delete_admin
      ON public.invoices
      FOR DELETE
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 10. Staff Email Profiles
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.staff_email_profiles') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.staff_email_profiles ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS staff_email_profiles_select_self_or_admin ON public.staff_email_profiles';
    EXECUTE 'DROP POLICY IF EXISTS staff_email_profiles_manage_admin_hr ON public.staff_email_profiles';

    EXECUTE $sql$
      CREATE POLICY staff_email_profiles_select_self_or_admin
      ON public.staff_email_profiles
      FOR SELECT
      TO authenticated
      USING (
        public.has_staff_role(ARRAY['Admin', 'HR'])
        OR staff_id = public.current_staff_id()
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY staff_email_profiles_manage_admin_hr
      ON public.staff_email_profiles
      FOR ALL
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin', 'HR']))
      WITH CHECK (public.has_staff_role(ARRAY['Admin', 'HR']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 9. Payments
-- ------------------------------------------------------------

DO $$
DECLARE
  has_shipments_sales_manager BOOLEAN;
  has_shipments_operation_manager BOOLEAN;
BEGIN
  IF to_regclass('public.payments') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shipments'
        AND column_name = 'sales_manager_id'
    ) INTO has_shipments_sales_manager;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shipments'
        AND column_name = 'operation_manager_id'
    ) INTO has_shipments_operation_manager;

    EXECUTE 'ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS payments_select_by_role ON public.payments';
    EXECUTE 'DROP POLICY IF EXISTS payments_insert_by_role ON public.payments';
    EXECUTE 'DROP POLICY IF EXISTS payments_update_by_role ON public.payments';
    EXECUTE 'DROP POLICY IF EXISTS payments_admin_hr_only ON public.payments';
    EXECUTE 'DROP POLICY IF EXISTS payments_delete_admin ON public.payments';

    IF has_shipments_sales_manager AND has_shipments_operation_manager THEN
      EXECUTE $sql$
        CREATE POLICY payments_select_by_role
        ON public.payments
        FOR SELECT
        TO authenticated
        USING (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR EXISTS (
            SELECT 1
            FROM public.invoices AS invoice
            JOIN public.shipments AS shipment ON shipment.id = invoice.shipment_id
            WHERE invoice.id = payments.invoice_id
              AND (
                shipment.sales_manager_id = public.current_staff_id()
                OR shipment.operation_manager_id = public.current_staff_id()
              )
          )
        )
      $sql$;

      EXECUTE $sql$
        CREATE POLICY payments_insert_by_role
        ON public.payments
        FOR INSERT
        TO authenticated
        WITH CHECK (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR EXISTS (
            SELECT 1
            FROM public.invoices AS invoice
            JOIN public.shipments AS shipment ON shipment.id = invoice.shipment_id
            WHERE invoice.id = payments.invoice_id
              AND (
                shipment.sales_manager_id = public.current_staff_id()
                OR shipment.operation_manager_id = public.current_staff_id()
              )
          )
        )
      $sql$;

      EXECUTE $sql$
        CREATE POLICY payments_update_by_role
        ON public.payments
        FOR UPDATE
        TO authenticated
        USING (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR EXISTS (
            SELECT 1
            FROM public.invoices AS invoice
            JOIN public.shipments AS shipment ON shipment.id = invoice.shipment_id
            WHERE invoice.id = payments.invoice_id
              AND (
                shipment.sales_manager_id = public.current_staff_id()
                OR shipment.operation_manager_id = public.current_staff_id()
              )
          )
        )
        WITH CHECK (
          public.has_staff_role(ARRAY['Admin', 'HR'])
          OR EXISTS (
            SELECT 1
            FROM public.invoices AS invoice
            JOIN public.shipments AS shipment ON shipment.id = invoice.shipment_id
            WHERE invoice.id = payments.invoice_id
              AND (
                shipment.sales_manager_id = public.current_staff_id()
                OR shipment.operation_manager_id = public.current_staff_id()
              )
          )
        )
      $sql$;
    ELSE
      EXECUTE $sql$
        CREATE POLICY payments_admin_hr_only
        ON public.payments
        FOR ALL
        TO authenticated
        USING (public.has_staff_role(ARRAY['Admin', 'HR']))
        WITH CHECK (public.has_staff_role(ARRAY['Admin', 'HR']))
      $sql$;
    END IF;

    EXECUTE $sql$
      CREATE POLICY payments_delete_admin
      ON public.payments
      FOR DELETE
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 10. Attendance
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.attendance') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS attendance_select_by_role ON public.attendance';
    EXECUTE 'DROP POLICY IF EXISTS attendance_insert_by_role ON public.attendance';
    EXECUTE 'DROP POLICY IF EXISTS attendance_update_by_role ON public.attendance';
    EXECUTE 'DROP POLICY IF EXISTS attendance_delete_admin ON public.attendance';

    EXECUTE $sql$
      CREATE POLICY attendance_select_by_role
      ON public.attendance
      FOR SELECT
      TO authenticated
      USING (
        public.has_staff_role(ARRAY['Admin', 'HR'])
        OR staff_id = public.current_staff_id()
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY attendance_insert_by_role
      ON public.attendance
      FOR INSERT
      TO authenticated
      WITH CHECK (
        public.has_staff_role(ARRAY['Admin', 'HR'])
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY attendance_update_by_role
      ON public.attendance
      FOR UPDATE
      TO authenticated
      USING (
        public.has_staff_role(ARRAY['Admin', 'HR'])
      )
      WITH CHECK (
        public.has_staff_role(ARRAY['Admin', 'HR'])
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY attendance_delete_admin
      ON public.attendance
      FOR DELETE
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 11. Tank storage
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.tank_storage') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.tank_storage ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tank_storage_select_by_role ON public.tank_storage';
    EXECUTE 'DROP POLICY IF EXISTS tank_storage_insert_by_role ON public.tank_storage';
    EXECUTE 'DROP POLICY IF EXISTS tank_storage_update_by_role ON public.tank_storage';
    EXECUTE 'DROP POLICY IF EXISTS tank_storage_delete_admin ON public.tank_storage';

    EXECUTE $sql$
      CREATE POLICY tank_storage_select_by_role
      ON public.tank_storage
      FOR SELECT
      TO authenticated
      USING (
        public.has_staff_role(ARRAY['Admin', 'HR', 'Operations'])
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY tank_storage_insert_by_role
      ON public.tank_storage
      FOR INSERT
      TO authenticated
      WITH CHECK (
        public.has_staff_role(ARRAY['Admin', 'HR', 'Operations'])
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY tank_storage_update_by_role
      ON public.tank_storage
      FOR UPDATE
      TO authenticated
      USING (
        public.has_staff_role(ARRAY['Admin', 'HR', 'Operations'])
      )
      WITH CHECK (
        public.has_staff_role(ARRAY['Admin', 'HR', 'Operations'])
      )
    $sql$;

    EXECUTE $sql$
      CREATE POLICY tank_storage_delete_admin
      ON public.tank_storage
      FOR DELETE
      TO authenticated
      USING (public.has_staff_role(ARRAY['Admin']))
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 12. Verification
-- ------------------------------------------------------------

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'staff',
    'agents',
    'clients',
    'offers',
    'quotations',
    'shipments',
    'invoices',
    'payments',
    'attendance',
    'tank_storage'
  )
ORDER BY tablename;
