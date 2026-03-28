import { createContext, useContext } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppView } from '../types';
import type { Company, CompanyAccessMode, CompanyScope, Profile, Tenant } from '../types';

const COMPANY_SCOPE_STORAGE_PREFIX = 'EF_ACTIVE_COMPANY_SCOPE_';

export interface CompanyBranding {
  id: string | null;
  name: string;
  logo_url?: string | null;
  pix_key?: string | null;
  pix_key_type?: Company['pix_key_type'];
  pix_name?: string | null;
  pix_city?: string | null;
  support_whatsapp?: string | null;
  timezone?: string | null;
  isFallback?: boolean;
}

export interface CompanyContextValue {
  tenant: Tenant | null;
  profile: Profile | null;
  companies: Company[];
  activeCompanyScope: CompanyScope;
  activeCompanyId: string | null;
  activeCompany: Company | null;
  isEnterpriseTenant: boolean;
  isTrialActive: boolean;
  isFreePlanLocked: boolean;
  companyAccessMode: CompanyAccessMode | null;
  canManageMultipleCompanies: boolean;
  canUseAggregateScope: boolean;
  setActiveCompanyScope: (scope: CompanyScope) => void;
  refreshCompanies: () => Promise<void> | void;
}

const noop = () => {};

const CompanyContext = createContext<CompanyContextValue>({
  tenant: null,
  profile: null,
  companies: [],
  activeCompanyScope: null,
  activeCompanyId: null,
  activeCompany: null,
  isEnterpriseTenant: false,
  isTrialActive: false,
  isFreePlanLocked: false,
  companyAccessMode: null,
  canManageMultipleCompanies: false,
  canUseAggregateScope: false,
  setActiveCompanyScope: noop,
  refreshCompanies: noop,
});

export const getCompanyScopeStorageKey = (tenantId?: string | null) =>
  `${COMPANY_SCOPE_STORAGE_PREFIX}${tenantId ?? 'default'}`;

export const isEnterpriseTenant = (tenant?: Tenant | null) => tenant?.plan === 'empresarial';
export const isTrialActive = (tenant?: Tenant | null) =>
  Boolean(tenant?.trial_ends_at && new Date(tenant.trial_ends_at).getTime() > Date.now());

export const hasActiveEnterprisePlan = (tenant?: Tenant | null) =>
  tenant?.plan === 'empresarial' && tenant?.plan_status === 'active';

export const canAccessMultiCompany = (tenant?: Tenant | null) =>
  hasActiveEnterprisePlan(tenant) || isTrialActive(tenant);

export const getCompanyAccessMode = (
  tenant?: Tenant | null,
  profile?: Profile | null
): CompanyAccessMode | null => {
  if (profile?.role !== 'admin') return null;
  return canAccessMultiCompany(tenant) ? 'enabled' : 'upsell_locked';
};

export const canUseAggregateScope = (tenant?: Tenant | null, profile?: Profile | null) =>
  profile?.role === 'admin' && canAccessMultiCompany(tenant);

export const isFreePlanLocked = (tenant?: Tenant | null): boolean =>
  tenant?.plan === 'free' && !isTrialActive(tenant);

export const FREE_PLAN_BLOCKED_VIEWS: ReadonlySet<AppView> = new Set([
  AppView.HOME,
  AppView.DASHBOARD,
  AppView.USER_DETAILS,
  AppView.COLLECTION,
  AppView.TOP_CLIENTES,
  AppView.ASSISTANT,
]);

export const isAggregateCompanyScope = (scope?: CompanyScope) => scope === 'all';
export const isAllCompaniesScope = isAggregateCompanyScope;

export const getScopedCompanyId = (scope?: CompanyScope) =>
  scope && scope !== 'all' ? scope : null;

export const getPrimaryCompany = (companies: Company[]) =>
  companies.find((company) => company.is_primary) || companies[0] || null;

export const createFallbackCompany = (tenant: Tenant): Company => ({
  id: tenant.id,
  tenant_id: tenant.id,
  name: tenant.name,
  logo_url: tenant.logo_url ?? null,
  pix_key: tenant.pix_key ?? null,
  pix_key_type: tenant.pix_key_type ?? null,
  pix_name: tenant.pix_name ?? null,
  pix_city: tenant.pix_city ?? null,
  support_whatsapp: tenant.support_whatsapp ?? null,
  timezone: tenant.timezone ?? null,
  is_primary: true,
  created_at: tenant.created_at,
  is_fallback: true,
});

export const resolveCompanyBranding = (
  tenant?: Tenant | null,
  company?: Company | null
): CompanyBranding => ({
  id: company?.id ?? tenant?.id ?? null,
  name: company?.name ?? tenant?.name ?? 'Operação',
  logo_url: company?.logo_url ?? tenant?.logo_url ?? null,
  pix_key: company?.pix_key ?? tenant?.pix_key ?? null,
  pix_key_type: company?.pix_key_type ?? tenant?.pix_key_type ?? null,
  pix_name: company?.pix_name ?? tenant?.pix_name ?? null,
  pix_city: company?.pix_city ?? tenant?.pix_city ?? null,
  support_whatsapp: company?.support_whatsapp ?? tenant?.support_whatsapp ?? null,
  timezone: company?.timezone ?? tenant?.timezone ?? null,
  isFallback: Boolean(company?.is_fallback),
});

export const getOperationLabel = (
  tenant?: Tenant | null,
  activeCompany?: Company | null,
  scope?: CompanyScope
) => {
  if (scope === 'all') return 'Todas as empresas';
  return activeCompany?.name ?? tenant?.name ?? 'Operação';
};

export const getScopeSummary = (
  tenant?: Tenant | null,
  activeCompany?: Company | null,
  scope?: CompanyScope
) => {
  if (scope === 'all') {
    return {
      label: 'Visão',
      value: tenant?.name ? `Todas as empresas de ${tenant.name}` : 'Todas as empresas',
    };
  }

  return {
    label: 'Empresa ativa',
    value: activeCompany?.name ?? tenant?.name ?? 'Empresa principal',
  };
};

export const resolveActiveCompany = (
  companies: Company[],
  scope?: CompanyScope
): Company | null => {
  const scopedCompanyId = getScopedCompanyId(scope);
  if (!scopedCompanyId) return null;
  return (
    companies.find((company) => company.id === scopedCompanyId)
    || getPrimaryCompany(companies)
    || companies[0]
    || null
  );
};

export async function listTenantCompanies(
  supabase: SupabaseClient,
  tenant: Tenant
): Promise<Company[]> {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (data && data.length > 0) return data as Company[];
  } catch {
    return [createFallbackCompany(tenant)];
  }

  return [createFallbackCompany(tenant)];
}

export const useCompanyContext = () => useContext(CompanyContext);

export const CompanyContextProvider = CompanyContext.Provider;
