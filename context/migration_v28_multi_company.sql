-- =====================================================================
-- V28 — Multiempresa Enterprise no mesmo tenant
-- =====================================================================
-- Objetivo:
-- 1. introduzir public.companies como unidade operacional abaixo de tenants
-- 2. adicionar company_id nas tabelas operacionais
-- 3. fazer backfill seguro a partir de tenants legados
-- 4. atualizar helpers, RLS e RPCs críticas para isolamento por empresa
--
-- Estratégia:
-- - Fase 1: schema aditivo + backfill + dual-read/dual-write
-- - Fase 2: validar dados e endurecer NOT NULL / remover legado
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Tabela companies
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT,
  pix_key TEXT,
  pix_key_type TEXT CHECK (pix_key_type IN ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP')),
  pix_name TEXT,
  pix_city TEXT,
  support_whatsapp TEXT,
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_tenant_id
  ON public.companies (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_primary_per_tenant
  ON public.companies (tenant_id)
  WHERE is_primary = true;

-- ---------------------------------------------------------------------
-- 2. company_id nas tabelas operacionais
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.loan_installments
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.contract_renegotiations
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.avulso_payments
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_company
  ON public.profiles (tenant_id, company_id);

CREATE INDEX IF NOT EXISTS idx_invites_tenant_company
  ON public.invites (tenant_id, company_id);

CREATE INDEX IF NOT EXISTS idx_investments_tenant_company
  ON public.investments (tenant_id, company_id);

CREATE INDEX IF NOT EXISTS idx_loan_installments_tenant_company
  ON public.loan_installments (tenant_id, company_id);

CREATE INDEX IF NOT EXISTS idx_contract_renegotiations_tenant_company
  ON public.contract_renegotiations (tenant_id, company_id);

CREATE INDEX IF NOT EXISTS idx_avulso_payments_tenant_company
  ON public.avulso_payments (tenant_id, company_id);

-- ---------------------------------------------------------------------
-- 3. Helpers de tenant/profile/company
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_primary_company(p_tenant_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_company_id UUID;
  source_tenant public.tenants%ROWTYPE;
BEGIN
  SELECT id
    INTO existing_company_id
  FROM public.companies
  WHERE tenant_id = p_tenant_id
    AND is_primary = true
  LIMIT 1;

  IF existing_company_id IS NOT NULL THEN
    RETURN existing_company_id;
  END IF;

  SELECT *
    INTO source_tenant
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant não encontrado para criar company primária: %', p_tenant_id;
  END IF;

  INSERT INTO public.companies (
    tenant_id,
    name,
    logo_url,
    pix_key,
    pix_key_type,
    pix_name,
    pix_city,
    support_whatsapp,
    timezone,
    is_primary
  )
  VALUES (
    source_tenant.id,
    source_tenant.name,
    source_tenant.logo_url,
    source_tenant.pix_key,
    source_tenant.pix_key_type,
    source_tenant.pix_name,
    source_tenant.pix_city,
    source_tenant.support_whatsapp,
    COALESCE(source_tenant.timezone, 'America/Sao_Paulo'),
    true
  )
  RETURNING id INTO existing_company_id;

  RETURN existing_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profile_id_safe()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_profile_id UUID;
BEGIN
  SELECT id
    INTO v_profile_id
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
     OR id = auth.uid()
  ORDER BY CASE WHEN auth_user_id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;

  RETURN v_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_profile_role_safe()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role
    INTO v_role
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
     OR id = auth.uid()
  ORDER BY CASE WHEN auth_user_id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;

  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_id_safe()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT company_id
    INTO v_company_id
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
     OR id = auth.uid()
  ORDER BY CASE WHEN auth_user_id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;

  RETURN v_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.company_belongs_to_my_tenant(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = p_company_id
      AND c.tenant_id = public.get_tenant_id_safe()
  );
$$;

-- ---------------------------------------------------------------------
-- 4. Backfill seguro
-- ---------------------------------------------------------------------
DO $$
DECLARE
  tenant_record RECORD;
  primary_company_id UUID;
BEGIN
  FOR tenant_record IN
    SELECT id FROM public.tenants
  LOOP
    primary_company_id := public.ensure_primary_company(tenant_record.id);

    UPDATE public.profiles
       SET company_id = primary_company_id
     WHERE tenant_id = tenant_record.id
       AND company_id IS NULL;

    UPDATE public.invites
       SET company_id = primary_company_id
     WHERE tenant_id = tenant_record.id
       AND company_id IS NULL;

    UPDATE public.investments
       SET company_id = primary_company_id
     WHERE tenant_id = tenant_record.id
       AND company_id IS NULL;

    UPDATE public.loan_installments li
       SET company_id = COALESCE(li.company_id, inv.company_id, primary_company_id)
      FROM public.investments inv
     WHERE li.investment_id = inv.id
       AND li.tenant_id = tenant_record.id
       AND li.company_id IS NULL;

    UPDATE public.contract_renegotiations cr
       SET company_id = COALESCE(cr.company_id, inv.company_id, primary_company_id)
      FROM public.investments inv
     WHERE cr.investment_id = inv.id
       AND cr.tenant_id = tenant_record.id
       AND cr.company_id IS NULL;

    UPDATE public.avulso_payments ap
       SET company_id = COALESCE(ap.company_id, inv.company_id, primary_company_id)
      FROM public.investments inv
     WHERE ap.investment_id = inv.id
       AND ap.tenant_id = tenant_record.id
       AND ap.company_id IS NULL;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. RLS multiempresa
-- ---------------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_renegotiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avulso_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_select_same_tenant ON public.companies;
DROP POLICY IF EXISTS companies_manage_same_tenant_admin ON public.companies;
DROP POLICY IF EXISTS profiles_select_multi_company ON public.profiles;
DROP POLICY IF EXISTS profiles_manage_multi_company_admin ON public.profiles;
DROP POLICY IF EXISTS invites_manage_multi_company_admin ON public.invites;
DROP POLICY IF EXISTS investments_select_multi_company ON public.investments;
DROP POLICY IF EXISTS investments_manage_multi_company_admin ON public.investments;
DROP POLICY IF EXISTS installments_select_multi_company ON public.loan_installments;
DROP POLICY IF EXISTS installments_manage_multi_company_admin ON public.loan_installments;
DROP POLICY IF EXISTS renegotiations_select_multi_company ON public.contract_renegotiations;
DROP POLICY IF EXISTS renegotiations_manage_multi_company_admin ON public.contract_renegotiations;
DROP POLICY IF EXISTS avulso_payments_select_multi_company ON public.avulso_payments;
DROP POLICY IF EXISTS avulso_payments_manage_multi_company_admin ON public.avulso_payments;

CREATE POLICY companies_select_same_tenant
  ON public.companies
  FOR SELECT
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND (
      public.get_profile_role_safe() = 'admin'
      OR id = public.get_company_id_safe()
    )
  );

CREATE POLICY companies_manage_same_tenant_admin
  ON public.companies
  FOR ALL
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
  );

CREATE POLICY profiles_select_multi_company
  ON public.profiles
  FOR SELECT
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND (
      public.get_profile_role_safe() = 'admin'
      OR id = public.get_profile_id_safe()
    )
  );

CREATE POLICY profiles_manage_multi_company_admin
  ON public.profiles
  FOR ALL
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
    AND public.company_belongs_to_my_tenant(company_id)
  );

CREATE POLICY invites_manage_multi_company_admin
  ON public.invites
  FOR ALL
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
    AND public.company_belongs_to_my_tenant(company_id)
  );

CREATE POLICY investments_select_multi_company
  ON public.investments
  FOR SELECT
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND (
      public.get_profile_role_safe() = 'admin'
      OR (
        public.get_profile_role_safe() = 'investor'
        AND company_id = public.get_company_id_safe()
        AND user_id = public.get_profile_id_safe()
      )
      OR (
        public.get_profile_role_safe() = 'debtor'
        AND company_id = public.get_company_id_safe()
        AND payer_id = public.get_profile_id_safe()
      )
    )
  );

CREATE POLICY investments_manage_multi_company_admin
  ON public.investments
  FOR ALL
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
    AND public.company_belongs_to_my_tenant(company_id)
  );

CREATE POLICY installments_select_multi_company
  ON public.loan_installments
  FOR SELECT
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND EXISTS (
      SELECT 1
      FROM public.investments inv
      WHERE inv.id = investment_id
        AND inv.tenant_id = public.get_tenant_id_safe()
        AND (
          public.get_profile_role_safe() = 'admin'
          OR (
            public.get_profile_role_safe() = 'investor'
            AND inv.company_id = public.get_company_id_safe()
            AND inv.user_id = public.get_profile_id_safe()
          )
          OR (
            public.get_profile_role_safe() = 'debtor'
            AND inv.company_id = public.get_company_id_safe()
            AND inv.payer_id = public.get_profile_id_safe()
          )
        )
    )
  );

CREATE POLICY installments_manage_multi_company_admin
  ON public.loan_installments
  FOR ALL
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
    AND public.company_belongs_to_my_tenant(company_id)
  );

CREATE POLICY renegotiations_select_multi_company
  ON public.contract_renegotiations
  FOR SELECT
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND EXISTS (
      SELECT 1
      FROM public.investments inv
      WHERE inv.id = investment_id
        AND inv.tenant_id = public.get_tenant_id_safe()
        AND (
          public.get_profile_role_safe() = 'admin'
          OR (
            public.get_profile_role_safe() = 'investor'
            AND inv.company_id = public.get_company_id_safe()
            AND inv.user_id = public.get_profile_id_safe()
          )
          OR (
            public.get_profile_role_safe() = 'debtor'
            AND inv.company_id = public.get_company_id_safe()
            AND inv.payer_id = public.get_profile_id_safe()
          )
        )
    )
  );

CREATE POLICY renegotiations_manage_multi_company_admin
  ON public.contract_renegotiations
  FOR ALL
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
    AND public.company_belongs_to_my_tenant(company_id)
  );

CREATE POLICY avulso_payments_select_multi_company
  ON public.avulso_payments
  FOR SELECT
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND EXISTS (
      SELECT 1
      FROM public.investments inv
      WHERE inv.id = investment_id
        AND inv.tenant_id = public.get_tenant_id_safe()
        AND (
          public.get_profile_role_safe() = 'admin'
          OR (
            public.get_profile_role_safe() = 'investor'
            AND inv.company_id = public.get_company_id_safe()
            AND inv.user_id = public.get_profile_id_safe()
          )
          OR (
            public.get_profile_role_safe() = 'debtor'
            AND inv.company_id = public.get_company_id_safe()
            AND inv.payer_id = public.get_profile_id_safe()
          )
        )
    )
  );

CREATE POLICY avulso_payments_manage_multi_company_admin
  ON public.avulso_payments
  FOR ALL
  USING (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id_safe()
    AND public.get_profile_role_safe() = 'admin'
    AND public.company_belongs_to_my_tenant(company_id)
  );

-- ---------------------------------------------------------------------
-- 6. RPCs críticas com company_id
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_invite_code(
  p_full_name TEXT,
  p_email TEXT,
  p_phone_number TEXT,
  p_role TEXT,
  p_company_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_admin_profile RECORD;
  v_target_company_id UUID;
  v_new_code TEXT;
BEGIN
  SELECT id, tenant_id, role, company_id
    INTO v_admin_profile
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
     OR id = auth.uid()
  ORDER BY CASE WHEN auth_user_id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_admin_profile.tenant_id IS NULL OR v_admin_profile.role <> 'admin' THEN
    RAISE EXCEPTION 'Admin profile not found or tenant not linked.';
  END IF;

  v_target_company_id := COALESCE(
    p_company_id,
    v_admin_profile.company_id,
    public.ensure_primary_company(v_admin_profile.tenant_id)
  );

  IF NOT public.company_belongs_to_my_tenant(v_target_company_id) THEN
    RAISE EXCEPTION 'Empresa inválida para este tenant.';
  END IF;

  LOOP
    v_new_code := upper(substr(md5(random()::text), 0, 9));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.invites WHERE code = v_new_code);
  END LOOP;

  INSERT INTO public.invites (
    tenant_id,
    company_id,
    code,
    role,
    full_name,
    email,
    phone_number,
    created_by
  )
  VALUES (
    v_admin_profile.tenant_id,
    v_target_company_id,
    v_new_code,
    p_role,
    p_full_name,
    p_email,
    p_phone_number,
    v_admin_profile.id
  );

  RETURN v_new_code;
END;
$$;

DROP FUNCTION IF EXISTS public.create_client_direct(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
);

CREATE OR REPLACE FUNCTION public.create_client_direct(
  p_full_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_role TEXT DEFAULT 'debtor',
  p_phone_number TEXT DEFAULT NULL,
  p_cpf TEXT DEFAULT NULL,
  p_photo_url TEXT DEFAULT NULL,
  p_cep TEXT DEFAULT NULL,
  p_logradouro TEXT DEFAULT NULL,
  p_numero TEXT DEFAULT NULL,
  p_bairro TEXT DEFAULT NULL,
  p_cidade TEXT DEFAULT NULL,
  p_uf TEXT DEFAULT NULL,
  p_company_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_new_id UUID := gen_random_uuid();
  v_admin_profile RECORD;
  v_target_company_id UUID;
BEGIN
  SELECT id, tenant_id, role, company_id
    INTO v_admin_profile
  FROM public.profiles
  WHERE auth_user_id = auth.uid()
     OR id = auth.uid()
  ORDER BY CASE WHEN auth_user_id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_admin_profile.tenant_id IS NULL OR v_admin_profile.role <> 'admin' THEN
    RAISE EXCEPTION 'Admin não encontrado.';
  END IF;

  v_target_company_id := COALESCE(
    p_company_id,
    v_admin_profile.company_id,
    public.ensure_primary_company(v_admin_profile.tenant_id)
  );

  IF NOT public.company_belongs_to_my_tenant(v_target_company_id) THEN
    RAISE EXCEPTION 'Empresa inválida para este tenant.';
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    tenant_id,
    company_id,
    phone_number,
    cpf,
    cep,
    logradouro,
    numero,
    bairro,
    cidade,
    uf,
    photo_url,
    updated_at
  )
  VALUES (
    v_new_id,
    p_email,
    p_full_name,
    p_role,
    v_admin_profile.tenant_id,
    v_target_company_id,
    p_phone_number,
    p_cpf,
    p_cep,
    p_logradouro,
    p_numero,
    p_bairro,
    p_cidade,
    p_uf,
    p_photo_url,
    NOW()
  );

  RETURN v_new_id;
END;
$$;

DROP FUNCTION IF EXISTS public.create_investment_validated(
  UUID, UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, NUMERIC, INTEGER, TEXT, INTEGER, INTEGER, DATE, TEXT, BOOLEAN, BOOLEAN, DATE[]
);

CREATE OR REPLACE FUNCTION public.create_investment_validated(
  p_tenant_id UUID,
  p_company_id UUID,
  p_user_id UUID,
  p_payer_id UUID,
  p_asset_name TEXT,
  p_amount_invested NUMERIC,
  p_source_capital NUMERIC DEFAULT 0,
  p_source_profit NUMERIC DEFAULT 0,
  p_current_value NUMERIC DEFAULT 0,
  p_interest_rate NUMERIC DEFAULT 0,
  p_installment_value NUMERIC DEFAULT 0,
  p_total_installments INTEGER DEFAULT 1,
  p_frequency TEXT DEFAULT 'monthly',
  p_due_day INTEGER DEFAULT NULL,
  p_weekday INTEGER DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_calculation_mode TEXT DEFAULT 'manual',
  p_skip_saturday BOOLEAN DEFAULT false,
  p_skip_sunday BOOLEAN DEFAULT false,
  p_custom_dates DATE[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_investment_id BIGINT;
  v_amount_principal NUMERIC;
  v_amount_interest NUMERIC;
  v_due_date DATE;
  v_base_date DATE;
  v_effective_day INTEGER;
  v_bd_count INTEGER;
  v_candidate DATE;
  i INTEGER;
BEGIN
  IF p_tenant_id <> public.get_tenant_id_safe() THEN
    RAISE EXCEPTION 'Tenant inválido para o usuário autenticado.';
  END IF;

  IF NOT public.company_belongs_to_my_tenant(p_company_id) THEN
    RAISE EXCEPTION 'Empresa inválida para este tenant.';
  END IF;

  INSERT INTO public.investments (
    tenant_id,
    company_id,
    user_id,
    payer_id,
    asset_name,
    amount_invested,
    current_value,
    interest_rate,
    installment_value,
    total_installments,
    frequency,
    due_day,
    weekday,
    start_date,
    calculation_mode,
    source_capital,
    source_profit
  )
  VALUES (
    p_tenant_id,
    p_company_id,
    p_user_id,
    p_payer_id,
    p_asset_name,
    p_amount_invested,
    p_current_value,
    p_interest_rate,
    p_installment_value,
    p_total_installments,
    p_frequency,
    p_due_day,
    p_weekday,
    p_start_date,
    p_calculation_mode,
    p_source_capital,
    p_source_profit
  )
  RETURNING id INTO v_investment_id;

  v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
  v_amount_interest := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);

  IF p_frequency = 'monthly' THEN
    v_effective_day := COALESCE(p_due_day, 1);
    IF v_effective_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
      v_base_date := (DATE_TRUNC('month', CURRENT_DATE) + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
    ELSE
      v_base_date := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
    END IF;
  END IF;

  FOR i IN 1..p_total_installments LOOP
    IF p_frequency = 'monthly' THEN
      v_due_date := (
        DATE_TRUNC('month', v_base_date + ((i - 1) || ' months')::INTERVAL)
        + (EXTRACT(DAY FROM v_base_date)::INTEGER - 1) * INTERVAL '1 day'
      )::DATE;
      v_due_date := LEAST(
        v_due_date,
        (DATE_TRUNC('month', v_due_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE
      );
    ELSIF p_frequency = 'weekly' THEN
      v_due_date := (CURRENT_DATE + (i * 7 || ' days')::INTERVAL)::DATE;
    ELSIF p_frequency = 'freelancer' AND p_custom_dates IS NOT NULL AND array_length(p_custom_dates, 1) >= i THEN
      v_due_date := p_custom_dates[i];
    ELSE
      IF p_skip_saturday OR p_skip_sunday THEN
        v_candidate := COALESCE(p_start_date, CURRENT_DATE);
        WHILE (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0)
           OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6) LOOP
          v_candidate := v_candidate + INTERVAL '1 day';
        END LOOP;

        v_bd_count := i - 1;
        WHILE v_bd_count > 0 LOOP
          v_candidate := v_candidate + INTERVAL '1 day';
          IF NOT (
            (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0)
            OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6)
          ) THEN
            v_bd_count := v_bd_count - 1;
          END IF;
        END LOOP;

        v_due_date := v_candidate;
      ELSE
        v_due_date := (COALESCE(p_start_date, CURRENT_DATE) + (i - 1) * INTERVAL '1 day')::DATE;
      END IF;
    END IF;

    INSERT INTO public.loan_installments (
      investment_id,
      tenant_id,
      company_id,
      number,
      due_date,
      amount_principal,
      amount_interest,
      amount_total
    )
    VALUES (
      v_investment_id,
      p_tenant_id,
      p_company_id,
      i,
      v_due_date,
      v_amount_principal,
      v_amount_interest,
      p_installment_value
    );
  END LOOP;

  RETURN v_investment_id;
END;
$$;

DROP FUNCTION IF EXISTS public.create_legacy_investment(
  UUID, UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, NUMERIC, INTEGER, TEXT, DATE, INTEGER, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.create_legacy_investment(
  p_tenant_id UUID,
  p_company_id UUID,
  p_user_id UUID,
  p_payer_id UUID,
  p_asset_name TEXT,
  p_amount_invested NUMERIC,
  p_source_capital NUMERIC DEFAULT 0,
  p_source_profit NUMERIC DEFAULT 0,
  p_current_value NUMERIC DEFAULT 0,
  p_interest_rate NUMERIC DEFAULT 0,
  p_installment_value NUMERIC DEFAULT 0,
  p_total_installments INTEGER DEFAULT 1,
  p_frequency TEXT DEFAULT 'monthly',
  p_first_due_date DATE DEFAULT NULL,
  p_paid_count INTEGER DEFAULT 0,
  p_calculation_mode TEXT DEFAULT 'manual',
  p_original_code TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_investment_id BIGINT;
  v_amount_principal NUMERIC;
  v_amount_interest NUMERIC;
  v_due_date DATE;
  i INTEGER;
BEGIN
  IF p_tenant_id <> public.get_tenant_id_safe() THEN
    RAISE EXCEPTION 'Tenant inválido para o usuário autenticado.';
  END IF;

  IF NOT public.company_belongs_to_my_tenant(p_company_id) THEN
    RAISE EXCEPTION 'Empresa inválida para este tenant.';
  END IF;

  INSERT INTO public.investments (
    tenant_id,
    company_id,
    user_id,
    payer_id,
    asset_name,
    amount_invested,
    current_value,
    interest_rate,
    installment_value,
    total_installments,
    frequency,
    calculation_mode,
    source_capital,
    source_profit,
    original_contract_code
  )
  VALUES (
    p_tenant_id,
    p_company_id,
    p_user_id,
    p_payer_id,
    p_asset_name,
    p_amount_invested,
    p_current_value,
    p_interest_rate,
    p_installment_value,
    p_total_installments,
    p_frequency,
    p_calculation_mode,
    p_source_capital,
    p_source_profit,
    p_original_code
  )
  RETURNING id INTO v_investment_id;

  v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
  v_amount_interest := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);

  FOR i IN 1..p_total_installments LOOP
    IF p_frequency = 'monthly' THEN
      v_due_date := (COALESCE(p_first_due_date, CURRENT_DATE) + ((i - 1) || ' months')::INTERVAL)::DATE;
    ELSIF p_frequency = 'weekly' THEN
      v_due_date := (COALESCE(p_first_due_date, CURRENT_DATE) + ((i - 1) * 7 || ' days')::INTERVAL)::DATE;
    ELSE
      v_due_date := (COALESCE(p_first_due_date, CURRENT_DATE) + ((i - 1) || ' days')::INTERVAL)::DATE;
    END IF;

    INSERT INTO public.loan_installments (
      investment_id,
      tenant_id,
      company_id,
      number,
      due_date,
      amount_principal,
      amount_interest,
      amount_total,
      amount_paid,
      status,
      paid_at
    )
    VALUES (
      v_investment_id,
      p_tenant_id,
      p_company_id,
      i,
      v_due_date,
      v_amount_principal,
      v_amount_interest,
      p_installment_value,
      CASE WHEN i <= COALESCE(p_paid_count, 0) THEN p_installment_value ELSE 0 END,
      CASE WHEN i <= COALESCE(p_paid_count, 0) THEN 'paid' ELSE 'pending' END,
      CASE WHEN i <= COALESCE(p_paid_count, 0) THEN NOW() ELSE NULL END
    );
  END LOOP;

  RETURN v_investment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_invite_code(TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_client_direct(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_investment_validated(
  UUID, UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, NUMERIC, INTEGER, TEXT, INTEGER, INTEGER, DATE, TEXT, BOOLEAN, BOOLEAN, DATE[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_legacy_investment(
  UUID, UUID, UUID, UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  NUMERIC, NUMERIC, INTEGER, TEXT, DATE, INTEGER, TEXT, TEXT
) TO authenticated;

COMMIT;

-- =====================================================================
-- Fase 2 — executar só após validar o app novo
-- ---------------------------------------------------------------------
-- 1. confirmar que nenhum registro operacional ficou com company_id NULL;
-- 2. tornar company_id NOT NULL em profiles, invites, investments,
--    loan_installments, contract_renegotiations e avulso_payments;
-- 3. revisar funções legadas fora do repositório, como complete_oauth_onboarding
--    e handle_new_user, para garantir company_id na criação inicial;
-- 4. remover fallback operacional de branding/Pix/WhatsApp/timezone em tenants.
-- =====================================================================
