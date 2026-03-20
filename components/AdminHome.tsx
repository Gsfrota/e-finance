
import React, { useState, useEffect, useMemo } from 'react';
import { AppView, Tenant, Profile, LoanInstallment } from '../types';
import { useDashboardData } from '../hooks/useDashboardData';
import { getSupabase } from '../services/supabase';
import { InstallmentsTable } from './dashboard/DashboardWidgets';
import { CollectionDashboard } from './dashboard/CollectionDashboard';
import { SalaryDashboard } from './dashboard/SalaryDashboard';
import {
  InstallmentDetailScreen,
  InstallmentFormScreen,
  type InstallmentAction,
} from './InstallmentDetailFlow';
import ContractDetail from './ContractDetail';
import {
  Zap,
  Bot,
  Phone,
  ChevronRight,
  ChevronDown,
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

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

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
      <h2 className="type-title text-[color:var(--text-primary)] md:text-5xl">
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

  const today = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }, []);
  const [subView, setSubView] = useState<
    'home' | 'pagaram-hoje' | 'contratos-hoje' |
    'contratos-vigentes' | 'parcelas-vencendo' | 'parcelas-atrasadas'
  >('home');
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'receivables' | 'collection' | 'inadimplentes' | 'salary'>('home');
  const [collectionKey, setCollectionKey] = useState(0);
  const [collectionBucket, setCollectionBucket] = useState<'today' | 'overdue'>('today');

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

  // ─── KPI data para avisos (declarado antes dos early returns) ───────────────
  const in3Days = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  }, []);
  const parcelasVencendo = useMemo(
    () => installments.filter(i => i.due_date >= today && i.due_date <= in3Days && i.status !== 'paid').length,
    [installments, today, in3Days],
  );
  const parcelasAtrasadas = useMemo(
    () => installments.filter(i => i.due_date < today && i.status !== 'paid').length,
    [installments, today],
  );
  const overdueInstallments = useMemo(
    () => installments.filter(i => i.due_date < today && i.status !== 'paid'),
    [installments, today],
  );
  const parcelasVencendoList = useMemo(
    () => installments.filter(i => i.due_date >= today && i.due_date <= in3Days && i.status !== 'paid'),
    [installments, today, in3Days],
  );

  const activeInvestments = useMemo(
    () => investments.filter(inv =>
      installments.filter(i => i.investment_id === inv.id).some(i => i.status !== 'paid')
    ),
    [investments, installments],
  );

  const totalRecebidoHoje = useMemo(
    () => parcelasPagasHoje.reduce((s, i) => s + (Number(i.amount_paid) || 0), 0),
    [parcelasPagasHoje],
  );

  // ─── Sub-página: Pagaram hoje ───────────────────────────────────────────────
  if (subView === 'pagaram-hoje') {
    return (
      <PagaramHojePage
        clientesPageramHoje={clientesPageramHoje}
        onBack={() => setSubView('home')}
      />
    );
  }

  // ─── Sub-página: Contratos Renovados ────────────────────────────────────────
  if (subView === 'contratos-hoje') {
    // Parcelas do contrato selecionado
    const contratoInstallments = selectedContractId
      ? installments.filter(i => i.investment_id === selectedContractId)
      : [];

    // Tela de detalhe/ação de parcela
    if (selectedInstallment && !installmentAction) {
      return (
        <InstallmentDetailScreen
          installment={selectedInstallment}
          onBack={() => setSelectedInstallment(null)}
          onAction={action => setInstallmentAction(action)}
        />
      );
    }

    if (installmentAction) {
      return (
        <InstallmentFormScreen
          action={installmentAction}
          onBack={() => setInstallmentAction(null)}
          onDone={() => { setInstallmentAction(null); setSelectedInstallment(null); refetch(); }}
          tenant={tenant}
        />
      );
    }

    return (
      <div className="space-y-6 pb-12 animate-fade-in">
        <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
          <button
            onClick={() => { setSubView('home'); setSelectedContractId(null); }}
            className="mb-5 flex items-center gap-2 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors cursor-pointer"
          >
            <ArrowLeft size={16} />
            Voltar
          </button>
          <p className="section-kicker mb-2">Hoje</p>
          <h2 className="type-title text-[color:var(--text-primary)] md:text-5xl">
            Contratos Renovados
          </h2>
        </div>

        {contratosHoje.length === 0 ? (
          <div className="panel-card rounded-[2rem] px-6 py-10 text-center border border-white/[0.06]">
            <p className="text-sm text-[color:var(--text-secondary)]">Nenhum contrato criado hoje.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {contratosHoje.map(inv => {
              const isExpanded = selectedContractId === inv.id;
              return (
                <div key={inv.id} className="panel-card rounded-[1.6rem] border border-white/[0.06] overflow-hidden">
                  <button
                    onClick={() => setSelectedContractId(isExpanded ? null : inv.id)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer"
                  >
                    <div className="text-left">
                      <div className="text-sm font-bold text-[color:var(--text-primary)]">
                        {inv.asset_name || 'Contrato'}
                      </div>
                      <div className="text-[0.7rem] text-[color:var(--text-faint)] mt-0.5">
                        {(inv as any).payer?.full_name || '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold" style={{ color: 'var(--accent-brass)' }}>
                        {formatCurrency(inv.amount_invested ?? 0)}
                      </span>
                      <ChevronDown
                        size={16}
                        className={`transition-transform text-[color:var(--text-faint)] ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-white/[0.06] px-4 pb-3">
                      {contratoInstallments.length === 0 ? (
                        <p className="text-xs text-[color:var(--text-faint)] py-3 text-center">Nenhuma parcela encontrada.</p>
                      ) : (
                        contratoInstallments.map(inst => (
                          <button
                            key={inst.id}
                            onClick={() => setSelectedInstallment(inst)}
                            className="w-full flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] rounded-lg px-2 transition-colors cursor-pointer"
                          >
                            <div className="text-left">
                              <div className="text-xs font-semibold text-[color:var(--text-primary)]">
                                Parcela {inst.number}
                              </div>
                              <div className="text-[0.65rem] text-[color:var(--text-faint)]">
                                Vence {inst.due_date ? inst.due_date.split('-').reverse().join('/') : '—'}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-[color:var(--text-primary)]">
                                {formatCurrency(Number(inst.amount_total) || 0)}
                              </span>
                              <span className={`chip text-[0.6rem] ${inst.status === 'paid' ? 'chip-paid' : inst.status === 'late' ? 'chip-late' : inst.status === 'partial' ? 'chip-partial' : 'chip-pending'}`}>
                                {inst.status === 'paid' ? 'Pago' : inst.status === 'late' ? 'Atrasado' : inst.status === 'partial' ? 'Parcial' : 'Pendente'}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── Sub-página: Contratos Vigentes ─────────────────────────────────────────
  if (subView === 'contratos-vigentes') {
    if (selectedContractId !== null) {
      return (
        <ContractDetail
          investmentId={selectedContractId}
          onBack={() => setSelectedContractId(null)}
          tenant={tenant}
        />
      );
    }

    return (
      <div className="space-y-6 pb-12 animate-fade-in">
        <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
          <button
            onClick={() => setSubView('home')}
            className="mb-5 flex items-center gap-2 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors cursor-pointer"
          >
            <ArrowLeft size={16} />
            Voltar
          </button>
          <p className="section-kicker mb-2">Carteira ativa</p>
          <h2 className="type-title text-[color:var(--text-primary)] md:text-5xl">
            Contratos Vigentes
          </h2>
        </div>

        {activeInvestments.length === 0 ? (
          <div className="panel-card rounded-[2rem] px-6 py-10 text-center border border-white/[0.06]">
            <p className="text-sm text-[color:var(--text-secondary)]">Nenhum contrato vigente encontrado.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeInvestments.map(inv => {
              const payer = (inv as any).payer;
              const invInstallments = installments.filter(i => i.investment_id === inv.id);
              return (
                <button
                  key={inv.id}
                  onClick={() => setSelectedContractId(inv.id)}
                  className="w-full panel-card rounded-[1.6rem] border border-white/[0.06] flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer text-left"
                >
                  <div>
                    <div className="text-sm font-bold text-[color:var(--text-primary)]">
                      {payer?.full_name || '—'}
                    </div>
                    <div className="text-[0.7rem] text-[color:var(--text-faint)] mt-0.5">
                      {inv.asset_name || 'Contrato'} · {invInstallments.filter(i => i.status !== 'paid').length}/{invInstallments.length} sem pagamento
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-bold" style={{ color: 'var(--accent-brass)' }}>
                        {formatCurrency(Number(inv.amount_invested) || 0)}
                      </div>
                      <div className="text-[0.65rem] text-[color:var(--text-faint)]">
                        Total: {formatCurrency(Number((inv as any).current_value) || 0)}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-[color:var(--text-faint)]" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── Sub-página: Parcelas Vencendo Hoje ──────────────────────────────────────
  if (subView === 'parcelas-vencendo') {
    if (selectedInstallment && !installmentAction) {
      return (
        <InstallmentDetailScreen
          installment={selectedInstallment}
          onBack={() => setSelectedInstallment(null)}
          onAction={action => setInstallmentAction(action)}
        />
      );
    }
    if (installmentAction) {
      return (
        <InstallmentFormScreen
          action={installmentAction}
          onBack={() => setInstallmentAction(null)}
          onDone={() => { setInstallmentAction(null); setSelectedInstallment(null); refetch(); }}
          tenant={tenant}
        />
      );
    }

    return (
      <div className="space-y-6 pb-12 animate-fade-in">
        <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
          <button
            onClick={() => setSubView('home')}
            className="mb-5 flex items-center gap-2 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors cursor-pointer"
          >
            <ArrowLeft size={16} />
            Voltar
          </button>
          <p className="section-kicker mb-2">Vencem em até 3 dias</p>
          <h2 className="type-title text-[color:var(--text-primary)] md:text-5xl">
            Parcelas Vencendo
          </h2>
        </div>

        {parcelasVencendoList.length === 0 ? (
          <div className="panel-card rounded-[2rem] px-6 py-10 text-center border border-white/[0.06]">
            <p className="text-sm text-[color:var(--text-secondary)]">Nenhuma parcela vencendo nos próximos 3 dias.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {parcelasVencendoList.map(inst => {
              const payer = (inst as any).investment?.payer;
              const assetName = (inst as any).investment?.asset_name || 'Contrato';
              return (
                <button
                  key={inst.id}
                  onClick={() => setSelectedInstallment(inst)}
                  className="w-full panel-card rounded-[1.6rem] border border-white/[0.06] flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer text-left"
                >
                  <div>
                    <div className="text-sm font-bold text-[color:var(--text-primary)]">
                      {payer?.full_name || '—'}
                    </div>
                    <div className="text-[0.7rem] text-[color:var(--text-faint)] mt-0.5">
                      {assetName} · Parcela {inst.number}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-bold" style={{ color: 'var(--accent-brass)' }}>
                        {formatCurrency(Number(inst.amount_total) || 0)}
                      </div>
                      <span className={`chip text-[0.6rem] ${inst.status === 'partial' ? 'chip-partial' : 'chip-pending'}`}>
                        {inst.status === 'partial' ? 'Parcial' : 'Pendente'}
                      </span>
                    </div>
                    <ChevronRight size={16} className="text-[color:var(--text-faint)]" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── Sub-página: Parcelas Atrasadas ──────────────────────────────────────────
  if (subView === 'parcelas-atrasadas') {
    if (selectedInstallment && !installmentAction) {
      return (
        <InstallmentDetailScreen
          installment={selectedInstallment}
          onBack={() => setSelectedInstallment(null)}
          onAction={action => setInstallmentAction(action)}
        />
      );
    }
    if (installmentAction) {
      return (
        <InstallmentFormScreen
          action={installmentAction}
          onBack={() => setInstallmentAction(null)}
          onDone={() => { setInstallmentAction(null); setSelectedInstallment(null); refetch(); }}
          tenant={tenant}
        />
      );
    }

    const nowMs = new Date().getTime();

    return (
      <div className="space-y-6 pb-12 animate-fade-in">
        <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
          <button
            onClick={() => setSubView('home')}
            className="mb-5 flex items-center gap-2 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors cursor-pointer"
          >
            <ArrowLeft size={16} />
            Voltar
          </button>
          <p className="section-kicker mb-2">Em atraso</p>
          <h2 className="type-title text-[color:var(--text-primary)] md:text-5xl">
            Parcelas Atrasadas
          </h2>
        </div>

        <div className="panel-card rounded-[2rem] px-6 py-5 flex items-center gap-3" style={{ background: 'rgba(198,126,105,0.08)', border: '1px solid rgba(198,126,105,0.20)' }}>
          <AlertTriangle size={20} style={{ color: 'var(--accent-danger)' }} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent-danger)' }}>Inadimplentes</p>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {overdueInstallments.length} parcela{overdueInstallments.length !== 1 ? 's' : ''} em atraso
            </p>
          </div>
        </div>

        {overdueInstallments.length === 0 ? (
          <div className="panel-card rounded-[2rem] px-6 py-10 text-center border border-white/[0.06]">
            <p className="text-sm text-[color:var(--text-secondary)]">Nenhuma parcela em atraso.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {overdueInstallments.map(inst => {
              const payer = (inst as any).investment?.payer;
              const assetName = (inst as any).investment?.asset_name || 'Contrato';
              const dueMs = new Date(inst.due_date).getTime();
              const diasAtraso = Math.floor((nowMs - dueMs) / (1000 * 60 * 60 * 24));
              const outstanding =
                (Number(inst.amount_total) || 0) +
                (Number(inst.fine_amount) || 0) +
                (Number(inst.interest_delay_amount) || 0) -
                (Number(inst.amount_paid) || 0);
              return (
                <button
                  key={inst.id}
                  onClick={() => setSelectedInstallment(inst)}
                  className="w-full panel-card rounded-[1.6rem] border border-white/[0.06] flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer text-left"
                  style={{ borderColor: 'rgba(198,126,105,0.15)' }}
                >
                  <div>
                    <div className="text-sm font-bold text-[color:var(--text-primary)]">
                      {payer?.full_name || '—'}
                    </div>
                    <div className="text-[0.7rem] text-[color:var(--text-faint)] mt-0.5">
                      {assetName} · Parcela {inst.number} · {diasAtraso}d atraso
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-bold" style={{ color: 'var(--accent-danger)' }}>
                        {formatCurrency(outstanding)}
                      </div>
                      <span className="chip chip-late text-[0.6rem]">Atrasado</span>
                    </div>
                    <ChevronRight size={16} className="text-[color:var(--text-faint)]" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── Menu grid items (BossCash style) ──────────────────────────────────────
  const menuItems = [
    { icon: Users,         label: 'Clientes',             onClick: () => onNavigate(AppView.USERS),                                                                         variant: 'default' as const },
    { icon: Zap,           label: 'Empréstimo',           onClick: () => onNewContract(),                                                                                    variant: 'default' as const },
    { icon: TrendingUp,    label: 'Salário',              onClick: () => setActiveTab('salary'),                                                                             variant: 'default' as const },
    { icon: Wallet,        label: 'Recebimentos',         onClick: () => { setCollectionBucket('today'); setCollectionKey(k => k + 1); setActiveTab('collection'); },         variant: 'default' as const },
    { icon: BarChart3,     label: 'Relatórios',           onClick: () => onNavigate(AppView.DASHBOARD),                                                                      variant: 'default' as const },
    { icon: Bot,           label: 'Assistente',           onClick: () => onNavigate(AppView.ASSISTANT),                                                                      variant: 'default' as const },
    { icon: Calendar,      label: 'Cobranças',            onClick: () => onNavigate(AppView.COLLECTION),                                                                       variant: 'default' as const },
    { icon: AlertTriangle, label: 'Inadimplentes',        onClick: () => { setCollectionBucket('overdue'); setCollectionKey(k => k + 1); setActiveTab('inadimplentes'); },   variant: 'danger'  as const },
  ];

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
          <CollectionDashboard key={collectionKey} initialBucket={collectionBucket} installments={installments} onUpdate={refetch} tenant={tenant} />
        </div>
      )}

      {/* ── Aba: Salário ──────────────────────────────────────────────────── */}
      {activeTab === 'salary' && (
        <div className="space-y-4">
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-2 text-sm font-semibold px-1 py-2 transition-colors" style={{ color: 'var(--text-muted)' }}>
            <ArrowLeft size={16} /> Voltar
          </button>
          <SalaryDashboard installments={installments} tenant={tenant} onUpdate={refetch} />
        </div>
      )}

      {/* ── Aba: Inadimplentes ────────────────────────────────────────────── */}
      {activeTab === 'inadimplentes' && (
        <div className="space-y-4">
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-2 text-sm font-semibold px-1 py-2 transition-colors" style={{ color: 'var(--text-muted)' }}>
            <ArrowLeft size={16} /> Voltar
          </button>
          <div className="panel-card rounded-[2rem] px-6 py-5 flex items-center gap-3" style={{ background: 'rgba(198,126,105,0.08)', border: '1px solid rgba(198,126,105,0.20)' }}>
            <AlertTriangle size={20} style={{ color: 'var(--accent-danger)' }} />
            <div>
              <p className="type-label" style={{ color: 'var(--accent-danger)' }}>Inadimplentes</p>
              <p className="type-body font-bold" style={{ color: 'var(--text-primary)' }}>
                {parcelasAtrasadas} parcela{parcelasAtrasadas !== 1 ? 's' : ''} em atraso
              </p>
            </div>
          </div>
          <CollectionDashboard key={collectionKey} initialBucket="overdue" installments={overdueInstallments} onUpdate={refetch} tenant={tenant} />
        </div>
      )}

      {/* ── Aba: Início (BossCash Grid) ──────────────────────────────────── */}
      {activeTab === 'home' && (
        <div className="space-y-6">

          {/* ── Grid Menu 4x2 ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-3">
            {menuItems.map(item => (
              <button
                key={item.label}
                onClick={item.onClick}
                className="flex flex-col items-center justify-start gap-2 rounded-2xl px-2 pt-5 pb-3 min-h-[88px] transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer shadow-sm hover:shadow-md"
                style={item.variant === 'danger'
                  ? { background: 'rgba(198,126,105,0.12)', border: '1px solid rgba(198,126,105,0.28)', color: 'var(--accent-danger)' }
                  : { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }
                }
              >
                <item.icon size={24} style={item.variant === 'danger' ? { color: 'var(--accent-danger)' } : { color: 'var(--text-primary)' }} />
                <span className="type-label text-center w-full leading-tight"
                  style={{ color: item.variant === 'danger' ? 'var(--accent-danger)' : 'var(--text-primary)', letterSpacing: 0, fontSize: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>

          {/* ── Avisos do dia! ────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="type-subheading" style={{ color: 'var(--text-primary)' }}>Avisos do dia!</h3>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {new Date().toLocaleDateString('pt-BR')}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                {
                  label: 'Renovados',
                  value: contratosHoje.length,
                  color: '#0D47A1',
                  onClick: () => setSubView('contratos-hoje'),
                },
                {
                  label: 'Vigentes',
                  value: activeInvestments.length,
                  color: '#2196F3',
                  onClick: () => setSubView('contratos-vigentes'),
                },
                {
                  label: 'Vencendo (3d)',
                  value: parcelasVencendo,
                  color: '#FF9800',
                  onClick: () => setSubView('parcelas-vencendo'),
                },
                {
                  label: 'Atrasados',
                  value: parcelasAtrasadas,
                  color: '#F44336',
                  onClick: () => setSubView('parcelas-atrasadas'),
                },
              ].map(stat => (
                <button
                  key={stat.label}
                  onClick={stat.onClick}
                  className="rounded-xl p-3 text-center transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                >
                  <p className="type-label w-full leading-tight mb-1" style={{ color: 'var(--text-muted)', letterSpacing: 0, fontSize: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {stat.label}
                  </p>
                  {loading ? (
                    <div className="skeleton h-7 w-8 rounded mx-auto" />
                  ) : (
                    <p className="type-metric-lg" style={{ color: stat.color }}>
                      {stat.value}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── Meus Relatórios ──────────────────────────────────────────── */}
          <div>
            <h3 className="type-subheading mb-3 px-1" style={{ color: 'var(--text-primary)' }}>Meus Relatorios</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setActiveTab('receivables')}
                className="rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <BarChart3 size={24} style={{ color: 'var(--header-blue)' }} className="mb-2" />
                <p className="type-body font-bold" style={{ color: 'var(--text-primary)' }}>Fluxo de Caixa</p>
                <p className="type-caption mt-0.5" style={{ color: 'var(--text-muted)' }}>Faturamento total e fluxo por periodo</p>
                <ChevronRight size={16} style={{ color: 'var(--text-faint)' }} className="mt-2" />
              </button>
              <button
                onClick={() => clientesQuePageramCount > 0 ? setSubView('pagaram-hoje') : undefined}
                className="rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <Calendar size={24} style={{ color: 'var(--header-blue)' }} className="mb-2" />
                <p className="type-body font-bold" style={{ color: 'var(--text-primary)' }}>Hoje</p>
                <p className="type-metric-lg" style={{ color: 'var(--header-blue)' }}>{formatCurrency(totalRecebidoHoje)}</p>
                <p className="type-caption" style={{ color: 'var(--text-muted)' }}>Recebimentos Hoje</p>
                <ChevronRight size={16} style={{ color: 'var(--text-faint)' }} className="mt-1" />
              </button>
              <button
                onClick={() => setActiveTab('receivables')}
                className="rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <TrendingUp size={24} style={{ color: 'var(--header-blue)' }} className="mb-2" />
                <p className="type-body font-bold" style={{ color: 'var(--text-primary)' }}>Resultados</p>
                <p className="type-caption mt-0.5" style={{ color: 'var(--text-muted)' }}>Seus Resultados</p>
                <ChevronRight size={16} style={{ color: 'var(--text-faint)' }} className="mt-2" />
              </button>
              <button
                onClick={() => onNavigate(AppView.USERS)}
                className="rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <Users size={24} style={{ color: 'var(--header-blue)' }} className="mb-2" />
                <p className="type-body font-bold" style={{ color: 'var(--text-primary)' }}>Top Clientes</p>
                <p className="type-caption mt-0.5" style={{ color: 'var(--text-muted)' }}>Veja aqui quais sao os clientes que pagam em dia</p>
                <ChevronRight size={16} style={{ color: 'var(--text-faint)' }} className="mt-1" />
              </button>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};

export default AdminHome;
