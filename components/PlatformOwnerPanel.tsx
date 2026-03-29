import React, { useState, useEffect, useMemo } from 'react';
import { PlatformTenantRow, PlatformStats } from '../types';
import { getSupabase } from '../services/supabase';
import {
  Crown,
  Users,
  Building2,
  TrendingUp,
  DollarSign,
  Search,
  ChevronDown,
  X,
  Eye,
  AlertCircle,
  CheckCircle2,
  Clock,
  Ban,
  RefreshCw,
  CreditCard,
  Activity,
} from 'lucide-react';
import { useAdminMetrics } from '../hooks/useAdminMetrics';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const PLAN_LABELS: Record<string, string> = {
  free: 'Gratuito',
  caderneta: 'Caderneta',
  empresarial: 'Empresarial',
};

const PLAN_PRICES: Record<string, number> = {
  free: 0,
  caderneta: 150,
  empresarial: 275,
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  past_due: 'Em atraso',
  canceled: 'Cancelado',
};

// ─── Badge components ─────────────────────────────────────────────────────────

const PlanBadge: React.FC<{ plan: string | null }> = ({ plan }) => {
  const colors: Record<string, string> = {
    free: 'bg-slate-700/60 text-slate-300',
    caderneta: 'bg-teal-900/60 text-teal-300',
    empresarial: 'bg-violet-900/60 text-violet-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.68rem] font-semibold ${colors[plan ?? 'free'] ?? colors.free}`}>
      {PLAN_LABELS[plan ?? 'free'] ?? plan ?? 'Gratuito'}
    </span>
  );
};

const StatusBadge: React.FC<{ status: string | null }> = ({ status }) => {
  const configs: Record<string, { cls: string; icon: React.ReactNode }> = {
    active: { cls: 'bg-emerald-900/60 text-emerald-300', icon: <CheckCircle2 size={10} /> },
    inactive: { cls: 'bg-slate-700/60 text-slate-400', icon: <Clock size={10} /> },
    past_due: { cls: 'bg-amber-900/60 text-amber-300', icon: <AlertCircle size={10} /> },
    canceled: { cls: 'bg-red-900/60 text-red-400', icon: <Ban size={10} /> },
  };
  const cfg = configs[status ?? 'inactive'] ?? configs.inactive;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-semibold ${cfg.cls}`}>
      {cfg.icon}
      {STATUS_LABELS[status ?? 'inactive'] ?? status ?? 'Inativo'}
    </span>
  );
};

// ─── Tenant Detail Overlay ────────────────────────────────────────────────────

interface TenantProfile {
  profile_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  company_id: string | null;
  cpf: string | null;
  phone_number: string | null;
  created_at: string;
}

interface TenantDetailOverlayProps {
  tenant: PlatformTenantRow;
  onClose: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  investor: 'Investidor',
  debtor: 'Devedor',
};

const TenantDetailOverlay: React.FC<TenantDetailOverlayProps> = ({ tenant, onClose }) => {
  const [profiles, setProfiles] = useState<TenantProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.rpc('platform_view_tenant_data', { p_tenant_id: tenant.id })
      .then(({ data }) => {
        setProfiles((data as TenantProfile[]) ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tenant.id]);

  const { metricsMap } = useAdminMetrics(tenant.id, null);

  const fmtCurrency = (v: number) => {
    if (v >= 1_000_000) return `R$${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
    if (v >= 1_000) return `R$${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`;
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });
  };

  const fmtDate = (d: string | null) => {
    if (!d) return 'Nunca';
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Ontem';
    if (diff < 30) return `${diff}d atrás`;
    if (diff < 365) return `${Math.floor(diff / 30)}m atrás`;
    return `${Math.floor(diff / 365)}a atrás`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="panel-card rounded-[2rem] w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/[0.06] flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="section-kicker">Visualizando tenant</p>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-semibold bg-amber-900/60 text-amber-300">
                <Eye size={9} /> Somente leitura
              </span>
            </div>
            <h2 className="text-xl font-bold text-[color:var(--text-primary)]">{tenant.name}</h2>
            <p className="text-xs text-[color:var(--text-secondary)] mt-0.5">{tenant.owner_email}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-xl hover:bg-white/[0.06] transition-colors text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tenant meta */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center gap-4 flex-wrap">
          <PlanBadge plan={tenant.plan} />
          <StatusBadge status={tenant.plan_status} />
          <span className="text-[0.72rem] text-[color:var(--text-secondary)]">
            {tenant.total_users} usuário{tenant.total_users !== 1 ? 's' : ''}
          </span>
          <span className="text-[0.72rem] text-[color:var(--text-secondary)]">
            Criado em {formatDate(tenant.created_at)}
          </span>
        </div>

        {/* Profiles list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <RefreshCw size={20} className="animate-spin text-[color:var(--text-faint)]" />
            </div>
          ) : profiles.length === 0 ? (
            <p className="text-sm text-[color:var(--text-secondary)] text-center py-8">Nenhum usuário encontrado.</p>
          ) : (
            <div className="space-y-2">
              {profiles.map(p => {
                const isAdmin = p.role === 'admin';
                const m = isAdmin ? metricsMap.get(p.profile_id) : null;
                return (
                  <div key={p.profile_id} className={`rounded-xl border border-white/[0.04] ${isAdmin ? 'p-3' : 'flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03]'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-700/60 flex items-center justify-center shrink-0">
                        <span className="text-[0.68rem] font-bold text-[color:var(--text-secondary)]">
                          {(p.full_name ?? p.email ?? '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[color:var(--text-primary)] truncate">
                          {p.full_name ?? '—'}
                        </div>
                        <div className="text-[0.7rem] text-[color:var(--text-secondary)] truncate">{p.email}</div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {p.cpf && (
                          <span className="text-[0.65rem] text-[color:var(--text-faint)] font-mono">{p.cpf}</span>
                        )}
                        <span className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded-full ${
                          p.role === 'admin' ? 'bg-violet-900/60 text-violet-300' :
                          p.role === 'investor' ? 'bg-teal-900/60 text-teal-300' :
                          'bg-slate-700/60 text-slate-300'
                        }`}>
                          {ROLE_LABELS[p.role] ?? p.role}
                        </span>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                        <div className="bg-[color:var(--bg-base)] rounded-xl p-2 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1 text-[color:var(--text-muted)]"><CreditCard size={10}/><span className="text-[0.6rem]">Contratos</span></div>
                          <span className="text-xs font-bold text-[color:var(--text-primary)]">{m ? m.contracts_created : '—'}</span>
                        </div>
                        <div className="bg-[color:var(--bg-base)] rounded-xl p-2 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1 text-[color:var(--text-muted)]"><DollarSign size={10}/><span className="text-[0.6rem]">Volume</span></div>
                          <span className="text-xs font-bold text-[color:var(--text-primary)] truncate">{m ? fmtCurrency(m.financial_volume) : '—'}</span>
                        </div>
                        <div className="bg-[color:var(--bg-base)] rounded-xl p-2 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1 text-[color:var(--text-muted)]"><Users size={10}/><span className="text-[0.6rem]">Usuários</span></div>
                          <span className="text-xs font-bold text-[color:var(--text-primary)]">{m ? m.users_onboarded : '—'}</span>
                        </div>
                        <div className="bg-[color:var(--bg-base)] rounded-xl p-2 flex flex-col gap-0.5">
                          <div className="flex items-center gap-1 text-[color:var(--text-muted)]"><Activity size={10}/><span className="text-[0.6rem]">Último acesso</span></div>
                          <span className="text-xs font-bold text-[color:var(--text-primary)]">{m ? fmtDate(m.last_sign_in_at) : '—'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Plan/Status Dropdowns ────────────────────────────────────────────────────

interface PlanDropdownProps {
  tenantId: string;
  current: string | null;
  onUpdated: (tenantId: string, plan: string) => void;
}

const PlanDropdown: React.FC<PlanDropdownProps> = ({ tenantId, current, onUpdated }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const plans = ['free', 'caderneta', 'empresarial'];

  const select = async (plan: string) => {
    if (plan === current) { setOpen(false); return; }
    setSaving(true);
    setSaveError(false);
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.rpc('platform_update_tenant_plan', { p_tenant_id: tenantId, p_plan: plan });
      if (error) {
        setSaveError(true);
        setSaving(false);
        setOpen(false);
        return;
      }
    }
    setSaving(false);
    setOpen(false);
    onUpdated(tenantId, plan);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        className="flex items-center gap-1.5 cursor-pointer"
      >
        <PlanBadge plan={current} />
        {saving ? <RefreshCw size={10} className="animate-spin text-[color:var(--text-faint)]" /> : saveError ? <AlertCircle size={10} className="text-red-400" /> : <ChevronDown size={10} className="text-[color:var(--text-faint)]" />}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 panel-card rounded-xl py-1 min-w-[130px] shadow-xl border border-white/[0.08]">
          {plans.map(p => (
            <button
              key={p}
              onClick={() => select(p)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-white/[0.06] flex items-center justify-between cursor-pointer ${p === current ? 'text-[color:var(--text-primary)] font-semibold' : 'text-[color:var(--text-secondary)]'}`}
            >
              {PLAN_LABELS[p]}
              {p === current && <CheckCircle2 size={10} className="text-teal-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface StatusDropdownProps {
  tenantId: string;
  current: string | null;
  onUpdated: (tenantId: string, status: string) => void;
}

const StatusDropdown: React.FC<StatusDropdownProps> = ({ tenantId, current, onUpdated }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const statuses = ['active', 'inactive', 'past_due', 'canceled'];

  const select = async (status: string) => {
    if (status === current) { setOpen(false); return; }
    setSaving(true);
    setSaveError(false);
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.rpc('platform_update_tenant_plan', { p_tenant_id: tenantId, p_plan_status: status });
      if (error) {
        setSaveError(true);
        setSaving(false);
        setOpen(false);
        return;
      }
    }
    setSaving(false);
    setOpen(false);
    onUpdated(tenantId, status);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        className="flex items-center gap-1.5 cursor-pointer"
      >
        <StatusBadge status={current} />
        {saving ? <RefreshCw size={10} className="animate-spin text-[color:var(--text-faint)]" /> : saveError ? <AlertCircle size={10} className="text-red-400" /> : <ChevronDown size={10} className="text-[color:var(--text-faint)]" />}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 panel-card rounded-xl py-1 min-w-[140px] shadow-xl border border-white/[0.08]">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => select(s)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-white/[0.06] flex items-center justify-between cursor-pointer ${s === current ? 'text-[color:var(--text-primary)] font-semibold' : 'text-[color:var(--text-secondary)]'}`}
            >
              {STATUS_LABELS[s]}
              {s === current && <CheckCircle2 size={10} className="text-teal-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const PlatformOwnerPanel: React.FC = () => {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [tenants, setTenants] = useState<PlatformTenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<PlatformTenantRow | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const sb = getSupabase();
    if (!sb) { setError('Supabase não disponível.'); setLoading(false); return; }

    const [statsRes, tenantsRes] = await Promise.all([
      sb.rpc('platform_get_stats'),
      sb.rpc('platform_list_tenants'),
    ]);

    if (statsRes.error) { setError(statsRes.error.message); setLoading(false); return; }
    if (tenantsRes.error) { setError(tenantsRes.error.message); setLoading(false); return; }

    setStats((statsRes.data as any)?.[0] ?? statsRes.data);
    setTenants((tenantsRes.data as PlatformTenantRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handlePlanUpdate = (tenantId: string, plan: string) => {
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, plan } : t));
  };

  const handleStatusUpdate = (tenantId: string, status: string) => {
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, plan_status: status } : t));
  };

  const filteredTenants = useMemo(() => {
    if (!search.trim()) return tenants;
    const q = search.toLowerCase();
    return tenants.filter(t =>
      (t.name ?? '').toLowerCase().includes(q) ||
      (t.owner_email ?? '').toLowerCase().includes(q) ||
      (t.owner_name ?? '').toLowerCase().includes(q)
    );
  }, [tenants, search]);

  const estimatedRevenue = useMemo(() => {
    if (!stats) return 0;
    return (stats.caderneta_count * PLAN_PRICES.caderneta) + (stats.empresarial_count * PLAN_PRICES.empresarial);
  }, [stats]);

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Header */}
      <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
        <div className="flex items-center gap-3 mb-1">
          <Crown size={20} className="text-amber-400" />
          <p className="section-kicker">Acesso exclusivo</p>
        </div>
        <h1 className="type-title text-[color:var(--text-primary)] md:text-5xl">Painel da Plataforma</h1>
        <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
          Visão completa de todos os clientes e assinaturas do sistema.
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="panel-card rounded-[2rem] px-6 py-5 border border-red-500/20 bg-red-950/20">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle size={16} />
            <span className="text-sm font-medium">{error}</span>
          </div>
          <button onClick={load} className="mt-3 text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] flex items-center gap-1 cursor-pointer">
            <RefreshCw size={12} /> Tentar novamente
          </button>
        </div>
      )}

      {/* Stats Cards */}
      {!loading && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="panel-card rounded-[1.8rem] px-5 py-5">
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={16} className="text-[color:var(--text-faint)]" />
              <p className="section-kicker text-[0.6rem]">Clientes</p>
            </div>
            <p className="text-3xl font-black text-[color:var(--text-primary)]">{stats.total_tenants}</p>
            <p className="text-[0.72rem] text-[color:var(--text-secondary)] mt-1">tenants cadastrados</p>
          </div>

          <div className="panel-card rounded-[1.8rem] px-5 py-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <p className="section-kicker text-[0.6rem]">Assinaturas</p>
            </div>
            <p className="text-3xl font-black text-[color:var(--text-primary)]">{stats.active_subscriptions}</p>
            <p className="text-[0.72rem] text-[color:var(--text-secondary)] mt-1">
              {stats.caderneta_count} caderneta · {stats.empresarial_count} empresarial
            </p>
          </div>

          <div className="panel-card rounded-[1.8rem] px-5 py-5">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={16} className="text-teal-400" />
              <p className="section-kicker text-[0.6rem]">Receita Est.</p>
            </div>
            <p className="text-3xl font-black text-[color:var(--text-primary)]">{formatCurrency(estimatedRevenue)}</p>
            <p className="text-[0.72rem] text-[color:var(--text-secondary)] mt-1">estimativa mensal</p>
          </div>

          <div className="panel-card rounded-[1.8rem] px-5 py-5">
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-[color:var(--text-faint)]" />
              <p className="section-kicker text-[0.6rem]">Usuários</p>
            </div>
            <p className="text-3xl font-black text-[color:var(--text-primary)]">{stats.total_users}</p>
            <p className="text-[0.72rem] text-[color:var(--text-secondary)] mt-1">{stats.total_admins} admins</p>
          </div>
        </div>
      )}

      {/* Loading skeleton para stats */}
      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="panel-card rounded-[1.8rem] px-5 py-5 animate-pulse">
              <div className="h-3 w-16 bg-white/[0.06] rounded mb-4" />
              <div className="h-8 w-12 bg-white/[0.06] rounded mb-2" />
              <div className="h-2 w-20 bg-white/[0.04] rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Tenant Table */}
      <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8">
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          <div>
            <p className="section-kicker mb-1">Todos os clientes</p>
            <h2 className="text-lg font-bold text-[color:var(--text-primary)]">
              {filteredTenants.length} tenant{filteredTenants.length !== 1 ? 's' : ''}
              {search && ` encontrado${filteredTenants.length !== 1 ? 's' : ''}`}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 rounded-xl hover:bg-white/[0.06] transition-colors text-[color:var(--text-muted)] cursor-pointer" title="Recarregar">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome ou email..."
                className="pl-8 pr-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-xl text-[color:var(--text-primary)] placeholder-[color:var(--text-faint)] focus:outline-none focus:border-teal-500/50 w-56"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-14 rounded-xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : filteredTenants.length === 0 ? (
          <p className="text-sm text-[color:var(--text-secondary)] text-center py-10">Nenhum tenant encontrado.</p>
        ) : (
          <div className="space-y-2">
            {filteredTenants.map(tenant => (
              <div
                key={tenant.id}
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-white/[0.03] border border-white/[0.04] transition-colors"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-slate-700/60 flex items-center justify-center shrink-0">
                  <Building2 size={14} className="text-[color:var(--text-secondary)]" />
                </div>

                {/* Name + owner */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[color:var(--text-primary)] truncate">{tenant.name}</div>
                  <div className="text-[0.7rem] text-[color:var(--text-secondary)] truncate">{tenant.owner_email}</div>
                </div>

                {/* Plan dropdown */}
                <div className="hidden sm:block">
                  <PlanDropdown tenantId={tenant.id} current={tenant.plan} onUpdated={handlePlanUpdate} />
                </div>

                {/* Status dropdown */}
                <div className="hidden sm:block">
                  <StatusDropdown tenantId={tenant.id} current={tenant.plan_status} onUpdated={handleStatusUpdate} />
                </div>

                {/* User count */}
                <div className="hidden md:flex items-center gap-1 text-[0.7rem] text-[color:var(--text-secondary)] shrink-0">
                  <Users size={11} />
                  {tenant.total_users}
                </div>

                {/* Created at */}
                <div className="hidden lg:block text-[0.68rem] text-[color:var(--text-faint)] shrink-0 w-20 text-right">
                  {formatDate(tenant.created_at)}
                </div>

                {/* Visualizar button */}
                <button
                  onClick={() => setSelectedTenant(tenant)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[0.72rem] font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <Eye size={13} />
                  <span className="hidden sm:inline">Ver</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Plan legend */}
        {!loading && stats && (
          <div className="mt-5 pt-4 border-t border-white/[0.05] flex items-center gap-4 flex-wrap">
            <span className="text-[0.68rem] text-[color:var(--text-faint)] font-medium uppercase tracking-wider">Resumo:</span>
            <span className="text-[0.72rem] text-slate-400">{stats.free_count} gratuito</span>
            <span className="text-[0.72rem] text-teal-400">{stats.caderneta_count} caderneta</span>
            <span className="text-[0.72rem] text-violet-400">{stats.empresarial_count} empresarial</span>
          </div>
        )}
      </div>

      {/* Tenant Detail Overlay */}
      {selectedTenant && (
        <TenantDetailOverlay
          tenant={selectedTenant}
          onClose={() => setSelectedTenant(null)}
        />
      )}
    </div>
  );
};

export default PlatformOwnerPanel;
