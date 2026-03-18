
import React, { useState, useEffect, useMemo } from 'react';
import { AppView, Tenant, Profile } from '../types';
import { useDashboardData } from '../hooks/useDashboardData';
import { getSupabase } from '../services/supabase';
import { InstallmentsTable } from './dashboard/DashboardWidgets';
import { CollectionDashboard } from './dashboard/CollectionDashboard';
import {
  Zap,
  UserPlus,
  UserCog,
  Phone,
  X,
  ChevronRight,
  FileText,
  Users,
  LayoutDashboard,
  ArrowLeft,
  TrendingUp,
  Wallet,
  BarChart3,
  AlertTriangle,
  Calendar,
} from 'lucide-react';

interface AdminHomeProps {
  tenant: Tenant | null;
  profile: Profile | null;
  onNavigate: (view: AppView) => void;
  onNewContract: () => void;
}

const useHomeData = (tenantId?: string) => {
  const { investments, installments, loading, refetch } = useDashboardData(tenantId);
  const [clientCount, setClientCount] = useState(0);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    const sb = getSupabase();
    if (!sb) return;

    sb.from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'debtor')
      .then(({ count }) => setClientCount(count ?? 0));

    sb.from('profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('full_name')
      .then(({ data }) => setProfiles((data as Profile[]) ?? []));
  }, [tenantId]);

  const today = new Date().toISOString().split('T')[0];

  const contratosHoje = useMemo(
    () => investments.filter(inv => inv.created_at?.startsWith(today)),
    [investments, today]
  );

  const parcelasPagasHoje = useMemo(
    () => installments.filter(i => i.status === 'paid' && i.paid_at?.startsWith(today)),
    [installments, today]
  );

  const clientesQuePageramCount = useMemo(
    () =>
      new Set(
        parcelasPagasHoje
          .map(i => (i as any).investment?.payer?.id)
          .filter(Boolean)
      ).size,
    [parcelasPagasHoje]
  );

  return {
    investments,
    installments,
    loading,
    refetch,
    profiles,
    clientCount,
    contratosHoje,
    parcelasPagasHoje,
    clientesQuePageramCount,
  };
};

// ─── Sub-página Pagamentos de Hoje ───────────────────────────────────────────
interface PagaramHojePageProps {
  clientesPageramHoje: Array<{ name: string; parcelas: any[] }>;
  onBack: () => void;
}

const PagaramHojePage: React.FC<PagaramHojePageProps> = ({ clientesPageramHoje, onBack }) => (
  <div className="space-y-6 pb-12 animate-fade-in">
    <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
      <button
        onClick={onBack}
        className="mb-5 flex items-center gap-2 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors cursor-pointer"
      >
        <ArrowLeft size={16} />
        Voltar
      </button>
      <p className="section-kicker mb-2">Pagamentos do dia</p>
      <h2 className="font-display text-3xl leading-none text-[color:var(--text-primary)] md:text-5xl">
        Quem pagou hoje
      </h2>
    </div>

    {clientesPageramHoje.length === 0 ? (
      <div className="panel-card rounded-[2rem] px-6 py-10 text-center border border-white/[0.06]">
        <p className="text-sm text-[color:var(--text-secondary)]">Nenhum pagamento registrado hoje.</p>
      </div>
    ) : (
      <div className="space-y-3">
        {clientesPageramHoje.map(cliente => (
          <div
            key={cliente.name}
            className="panel-card rounded-[1.6rem] px-5 py-4 border border-white/[0.06]"
          >
            <div className="text-sm font-bold text-[color:var(--text-primary)] mb-2">
              {cliente.name}
            </div>
            {cliente.parcelas.map((p: any) => (
              <div
                key={p.id}
                className="flex items-center justify-between py-2 border-t border-white/[0.05]"
              >
                <div className="text-[0.72rem] text-[color:var(--text-secondary)]">
                  Parcela {p.number} — {p.investment?.asset_name || 'Contrato'}
                </div>
                <div className="text-[0.72rem] font-semibold text-teal-400">
                  {formatCurrency(p.amount_paid ?? p.amount ?? 0)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    )}
  </div>
);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
};

const todayLabel = () =>
  new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

// ─── Modal genérico ───────────────────────────────────────────────────────────
const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => (
  <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    />
    <div className="relative z-10 w-full max-w-lg panel-card rounded-[2rem] p-6 max-h-[80vh] flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-display text-2xl text-[color:var(--text-primary)]">{title}</h3>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-[color:var(--text-muted)] hover:bg-white/[0.1] hover:text-[color:var(--text-primary)] transition-colors cursor-pointer"
          aria-label="Fechar"
        >
          <X size={16} />
        </button>
      </div>
      <div className="overflow-y-auto custom-scrollbar flex-1">{children}</div>
    </div>
  </div>
);

const AdminHome: React.FC<AdminHomeProps> = ({ tenant, profile, onNavigate, onNewContract }) => {
  const {
    investments,
    installments,
    loading,
    refetch,
    profiles,
    clientCount,
    contratosHoje,
    parcelasPagasHoje,
    clientesQuePageramCount,
  } = useHomeData(tenant?.id);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [showContratosHojeModal, setShowContratosHojeModal] = useState(false);
  const [subView, setSubView] = useState<'home' | 'pagaram-hoje'>('home');
  const [activeTab, setActiveTab] = useState<'home' | 'receivables' | 'collection'>('home');

  const firstName = profile?.full_name?.split(' ')[0] || 'Administrador';

  // ─── Agrupar parcelas pagas por cliente ───────────────────────────────────
  const clientesPageramHoje = useMemo(() => {
    const map = new Map<string, { name: string; parcelas: typeof parcelasPagasHoje }>();
    parcelasPagasHoje.forEach(p => {
      const payer = (p as any).investment?.payer;
      if (!payer?.id) return;
      if (!map.has(payer.id)) {
        map.set(payer.id, { name: payer.full_name || 'Cliente', parcelas: [] });
      }
      map.get(payer.id)!.parcelas.push(p);
    });
    return Array.from(map.values());
  }, [parcelasPagasHoje]);

  // ─── Sub-página ────────────────────────────────────────────────────────────
  if (subView === 'pagaram-hoje') {
    return (
      <PagaramHojePage
        clientesPageramHoje={clientesPageramHoje}
        onBack={() => setSubView('home')}
      />
    );
  }

  // ─── Menu grid items (BossCash style) ──────────────────────────────────────
  const menuItems = [
    { icon: Users,         label: 'Clientes',           onClick: () => onNavigate(AppView.USERS),       highlight: false },
    { icon: Zap,           label: 'Novo Emprestimo',    onClick: () => onNewContract(),                  highlight: false },
    { icon: TrendingUp,    label: 'Desempenho',         onClick: () => setActiveTab('receivables'),      highlight: false },
    { icon: Wallet,        label: 'Meus Recebimentos',  onClick: () => setActiveTab('collection'),       highlight: false },
    { icon: BarChart3,     label: 'Meus Relatorios',    onClick: () => setActiveTab('receivables'),      highlight: false },
    { icon: UserCog,       label: 'Usuarios',           onClick: () => onNavigate(AppView.USERS),       highlight: false },
    { icon: AlertTriangle, label: 'Inadimplentes',      onClick: () => onNavigate(AppView.COLLECTION),  highlight: true  },
  ];

  // ─── KPI data for avisos ──────────────────────────────────────────────────
  const parcelasVencendo = useMemo(
    () => installments.filter(i => i.due_date === today && i.status !== 'paid').length,
    [installments, today],
  );
  const parcelasAtrasadas = useMemo(
    () => installments.filter(i => i.due_date < today && i.status !== 'paid').length,
    [installments, today],
  );

  const totalRecebidoHoje = useMemo(
    () => parcelasPagasHoje.reduce((s, i) => s + (Number(i.amount_paid) || 0), 0),
    [parcelasPagasHoje],
  );

  const tabs = [
    { id: 'home' as const, icon: LayoutDashboard, label: 'Inicio' },
    { id: 'receivables' as const, icon: FileText, label: 'Parcelas' },
    { id: 'collection' as const, icon: Phone, label: 'Cobrancas' },
  ];

  return (
    <div className="animate-fade-in pb-12">

      {/* ── Aba: Parcelas ─────────────────────────────────────────────────── */}
      {activeTab === 'receivables' && (
        <div className="space-y-4">
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-2 text-sm font-semibold px-1 py-2 transition-colors" style={{ color: 'var(--text-muted)' }}>
            <ArrowLeft size={16} /> Voltar
          </button>
          <InstallmentsTable data={installments} onUpdate={refetch} tenant={tenant} />
        </div>
      )}

      {/* ── Aba: Cobranças ────────────────────────────────────────────────── */}
      {activeTab === 'collection' && (
        <div className="space-y-4">
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-2 text-sm font-semibold px-1 py-2 transition-colors" style={{ color: 'var(--text-muted)' }}>
            <ArrowLeft size={16} /> Voltar
          </button>
          <CollectionDashboard installments={installments} onUpdate={refetch} tenant={tenant} />
        </div>
      )}

      {/* ── Aba: Início (BossCash Grid) ──────────────────────────────────── */}
      {activeTab === 'home' && (
        <div className="space-y-6">

          {/* ── Grid Menu 3x3 ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            {menuItems.map(item => (
              <button
                key={item.label}
                onClick={item.onClick}
                className={`flex flex-col items-center justify-center gap-2 rounded-2xl p-4 min-h-[100px] transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer ${
                  item.highlight
                    ? 'text-white shadow-md'
                    : 'shadow-sm hover:shadow-md'
                }`}
                style={item.highlight
                  ? { background: 'var(--header-blue)', color: 'white' }
                  : { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }
                }
              >
                <item.icon size={28} style={item.highlight ? { color: 'white' } : { color: 'var(--text-primary)' }} />
                <span className={`text-xs font-semibold text-center leading-tight ${item.highlight ? 'text-white' : ''}`}
                  style={item.highlight ? {} : { color: 'var(--text-primary)' }}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>

          {/* ── Avisos do dia! ────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Avisos do dia!</h3>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {new Date().toLocaleDateString('pt-BR')}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Contratos Renovados', value: contratosHoje.length, color: '#0D47A1' },
                { label: 'Contratos Vigentes', value: investments.length, color: '#2196F3' },
                { label: 'Parcelas Vencendo', value: parcelasVencendo, color: '#FF9800' },
                { label: 'Parcelas Atrasados', value: parcelasAtrasadas, color: '#F44336' },
              ].map(stat => (
                <div key={stat.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <p className="text-[10px] font-medium leading-tight mb-1" style={{ color: 'var(--text-muted)' }}>
                    {stat.label}
                  </p>
                  {loading ? (
                    <div className="skeleton h-7 w-8 rounded mx-auto" />
                  ) : (
                    <p className="text-xl font-black tabular-nums" style={{ color: stat.color }}>
                      {stat.value}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Meus Relatórios ──────────────────────────────────────────── */}
          <div>
            <h3 className="text-lg font-bold mb-3 px-1" style={{ color: 'var(--text-primary)' }}>Meus Relatorios</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setActiveTab('receivables')}
                className="rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <BarChart3 size={24} style={{ color: 'var(--header-blue)' }} className="mb-2" />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Fluxo de Caixa</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Faturamento total e fluxo por periodo</p>
                <ChevronRight size={16} style={{ color: 'var(--text-faint)' }} className="mt-2" />
              </button>
              <button
                onClick={() => clientesQuePageramCount > 0 ? setSubView('pagaram-hoje') : undefined}
                className="rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <Calendar size={24} style={{ color: 'var(--header-blue)' }} className="mb-2" />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Hoje</p>
                <p className="text-lg font-black tabular-nums" style={{ color: 'var(--header-blue)' }}>{formatCurrency(totalRecebidoHoje)}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Recebimentos Hoje</p>
                <ChevronRight size={16} style={{ color: 'var(--text-faint)' }} className="mt-1" />
              </button>
              <button
                onClick={() => setActiveTab('receivables')}
                className="rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <TrendingUp size={24} style={{ color: 'var(--header-blue)' }} className="mb-2" />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Resultados</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Seus Resultados</p>
                <ChevronRight size={16} style={{ color: 'var(--text-faint)' }} className="mt-2" />
              </button>
              <button
                onClick={() => onNavigate(AppView.USERS)}
                className="rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <Users size={24} style={{ color: 'var(--header-blue)' }} className="mb-2" />
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Top Clientes</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Veja aqui quais sao os clientes que pagam em dia</p>
                <ChevronRight size={16} style={{ color: 'var(--text-faint)' }} className="mt-1" />
              </button>
            </div>
          </div>

          {/* ── Modal: Contratos Criados Hoje ─────────────────────────────── */}
          {showContratosHojeModal && (
            <Modal
              title="Contratos criados hoje"
              onClose={() => setShowContratosHojeModal(false)}
            >
              {contratosHoje.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Nenhum contrato criado hoje.</p>
              ) : (
                <div className="space-y-2">
                  {contratosHoje.map(inv => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between rounded-2xl px-4 py-3"
                      style={{ background: 'var(--bg-soft)' }}
                    >
                      <div>
                        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {inv.asset_name || 'Contrato'}
                        </div>
                        <div className="text-[0.7rem]" style={{ color: 'var(--text-faint)' }}>
                          {(inv as any).payer?.full_name || '—'}
                        </div>
                      </div>
                      <div className="text-sm font-bold" style={{ color: 'var(--accent-brass)' }}>
                        {formatCurrency(inv.amount_invested ?? 0)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Modal>
          )}
        </div>
      )}

    </div>
  );
};

export default AdminHome;
