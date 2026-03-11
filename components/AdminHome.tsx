
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

  // ─── Ações rápidas ─────────────────────────────────────────────────────────
  const quickActions = [
    {
      icon: Zap,
      label: 'Criar Contrato',
      sublabel: 'Novo crédito',
      color: 'brass',
      border: 'border-[rgba(202,176,122,0.3)]',
      bg: 'bg-[rgba(202,176,122,0.07)]',
      iconBg: 'bg-[rgba(202,176,122,0.14)]',
      iconColor: 'text-[color:var(--accent-brass)]',
      onClick: () => onNewContract(),
    },
    {
      icon: UserPlus,
      label: 'Cadastrar Cliente',
      sublabel: 'Novo devedor',
      color: 'teal',
      border: 'border-[rgba(45,212,191,0.25)]',
      bg: 'bg-[rgba(45,212,191,0.05)]',
      iconBg: 'bg-[rgba(45,212,191,0.12)]',
      iconColor: 'text-teal-400',
      onClick: () => onNavigate(AppView.USERS),
    },
    {
      icon: Phone,
      label: 'Cobranças de Hoje',
      sublabel: 'Agenda do dia',
      color: 'blue',
      border: 'border-[rgba(96,165,250,0.25)]',
      bg: 'bg-[rgba(96,165,250,0.05)]',
      iconBg: 'bg-[rgba(96,165,250,0.12)]',
      iconColor: 'text-blue-400',
      onClick: () => onNavigate(AppView.COLLECTION),
    },
    {
      icon: UserCog,
      label: 'Editar Cliente',
      sublabel: 'Atualizar dados',
      color: 'steel',
      border: 'border-[rgba(144,160,189,0.25)]',
      bg: 'bg-[rgba(144,160,189,0.05)]',
      iconBg: 'bg-[rgba(144,160,189,0.12)]',
      iconColor: 'text-[color:var(--accent-steel)]',
      onClick: () => onNavigate(AppView.USERS),
    },
  ];

  const tabs = [
    { id: 'home' as const, icon: LayoutDashboard, label: 'Início' },
    { id: 'receivables' as const, icon: FileText, label: 'Parcelas' },
    { id: 'collection' as const, icon: Phone, label: 'Cobranças' },
  ];

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* ── Header de boas-vindas ──────────────────────────────────────────── */}
      <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
        <p className="section-kicker mb-2">Painel de entrada</p>
        <h2 className="font-display gradient-underline text-3xl leading-none text-[color:var(--text-primary)] md:text-5xl">
          {getGreeting()}, {firstName}
        </h2>
        <p className="mt-3 text-sm text-[color:var(--text-faint)] capitalize">{todayLabel()}</p>

        {/* ── Abas de navegação ── */}
        <div className="mt-5 flex gap-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[0.72rem] font-semibold transition-all duration-200 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-[color:var(--accent-brass)] text-[color:var(--text-on-accent)]'
                  : 'bg-white/[0.06] text-[color:var(--text-muted)] hover:bg-white/[0.1] hover:text-[color:var(--text-primary)]'
              }`}
            >
              <tab.icon size={12} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Aba: Parcelas ─────────────────────────────────────────────────── */}
      {activeTab === 'receivables' && (
        <InstallmentsTable data={installments} onUpdate={refetch} tenant={tenant} />
      )}

      {/* ── Aba: Cobranças ────────────────────────────────────────────────── */}
      {activeTab === 'collection' && (
        <CollectionDashboard installments={installments} onUpdate={refetch} tenant={tenant} />
      )}

      {/* ── Aba: Início ───────────────────────────────────────────────────── */}
      {activeTab === 'home' && (
        <>
          {/* Ações Rápidas */}
          <div>
            <div className="mb-4 pl-1">
              <p className="section-kicker mb-1">Acesso rápido</p>
              <h3 className="font-display text-2xl leading-none text-[color:var(--text-primary)] md:text-4xl">
                Ações do dia
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {quickActions.map(action => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className={`panel-card rounded-[1.6rem] p-5 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg border ${action.border} ${action.bg} cursor-pointer`}
                >
                  <div
                    className={`mb-4 flex h-11 w-11 items-center justify-center rounded-full ${action.iconBg}`}
                  >
                    <action.icon size={20} className={action.iconColor} />
                  </div>
                  <div className="text-sm font-bold text-[color:var(--text-primary)]">
                    {action.label}
                  </div>
                  <div className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">
                    {action.sublabel}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Avisos do Dia */}
          <div>
            <div className="mb-4 pl-1">
              <p className="section-kicker mb-1">Resumo operacional</p>
              <h3 className="font-display text-2xl leading-none text-[color:var(--text-primary)] md:text-4xl">
                Avisos do dia
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {/* Contratos criados hoje */}
              <button
                disabled={contratosHoje.length === 0}
                onClick={() => contratosHoje.length > 0 && setShowContratosHojeModal(true)}
                className={`panel-card rounded-[1.6rem] p-5 text-left transition-all duration-200 ${
                  contratosHoje.length > 0
                    ? 'border border-[rgba(202,176,122,0.2)] hover:border-[rgba(202,176,122,0.35)] cursor-pointer hover:scale-[1.01]'
                    : 'border border-white/[0.06] cursor-default'
                }`}
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(202,176,122,0.12)]">
                  <FileText size={16} className="text-[color:var(--accent-brass)]" />
                </div>
                <div className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-faint)] mb-2">
                  Contratos hoje
                </div>
                {loading ? (
                  <div className="skeleton h-8 w-12 rounded-lg" />
                ) : (
                  <div className="font-display text-4xl leading-none text-[color:var(--text-primary)]">
                    {contratosHoje.length}
                  </div>
                )}
                {contratosHoje.length > 0 && (
                  <div className="mt-2 flex items-center gap-1 text-[0.65rem] font-semibold text-[color:var(--accent-brass)]">
                    <span>ver lista</span>
                    <ChevronRight size={11} />
                  </div>
                )}
              </button>

              {/* Total de contratos */}
              <div className="panel-card rounded-[1.6rem] p-5 border border-white/[0.06]">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06]">
                  <FileText size={16} className="text-[color:var(--text-muted)]" />
                </div>
                <div className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-faint)] mb-2">
                  Total contratos
                </div>
                {loading ? (
                  <div className="skeleton h-8 w-12 rounded-lg" />
                ) : (
                  <div className="font-display text-4xl leading-none text-[color:var(--text-primary)]">
                    {investments.length}
                  </div>
                )}
              </div>

              {/* Total de clientes */}
              <div className="panel-card rounded-[1.6rem] p-5 border border-white/[0.06]">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06]">
                  <Users size={16} className="text-[color:var(--text-muted)]" />
                </div>
                <div className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-faint)] mb-2">
                  Total clientes
                </div>
                {loading ? (
                  <div className="skeleton h-8 w-12 rounded-lg" />
                ) : (
                  <div className="font-display text-4xl leading-none text-[color:var(--text-primary)]">
                    {clientCount}
                  </div>
                )}
              </div>

              {/* Pagaram hoje */}
              <button
                disabled={clientesQuePageramCount === 0}
                onClick={() => clientesQuePageramCount > 0 && setSubView('pagaram-hoje')}
                className={`panel-card rounded-[1.6rem] p-5 text-left transition-all duration-200 ${
                  clientesQuePageramCount > 0
                    ? 'border border-[rgba(45,212,191,0.2)] hover:border-[rgba(45,212,191,0.35)] cursor-pointer hover:scale-[1.01]'
                    : 'border border-white/[0.06] cursor-default'
                }`}
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(45,212,191,0.1)]">
                  <Users size={16} className="text-teal-400" />
                </div>
                <div className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-faint)] mb-2">
                  Pagaram hoje
                </div>
                {loading ? (
                  <div className="skeleton h-8 w-12 rounded-lg" />
                ) : (
                  <div className="font-display text-4xl leading-none text-[color:var(--text-primary)]">
                    {clientesQuePageramCount}
                  </div>
                )}
                {clientesQuePageramCount > 0 && (
                  <div className="mt-2 flex items-center gap-1 text-[0.65rem] font-semibold text-teal-400">
                    <span>ver lista</span>
                    <ChevronRight size={11} />
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* ── Modal: Contratos Criados Hoje ─────────────────────────────────── */}
          {showContratosHojeModal && (
            <Modal
              title="Contratos criados hoje"
              onClose={() => setShowContratosHojeModal(false)}
            >
              {contratosHoje.length === 0 ? (
                <p className="text-sm text-[color:var(--text-secondary)]">Nenhum contrato criado hoje.</p>
              ) : (
                <div className="space-y-2">
                  {contratosHoje.map(inv => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between rounded-2xl bg-white/[0.03] px-4 py-3"
                    >
                      <div>
                        <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                          {inv.asset_name || 'Contrato'}
                        </div>
                        <div className="text-[0.7rem] text-[color:var(--text-faint)]">
                          {(inv as any).payer?.full_name || '—'}
                        </div>
                      </div>
                      <div className="text-sm font-bold text-[color:var(--accent-brass)]">
                        {formatCurrency(inv.amount_invested ?? 0)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Modal>
          )}
        </>
      )}

    </div>
  );
};

export default AdminHome;
