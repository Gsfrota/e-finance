
import React, { useState, useEffect, useMemo } from 'react';
import { useDashboardData } from '../hooks/useDashboardData';
import {
  KPICards, OverviewCharts, ResumoGeral,
  InvestmentsTable, InstallmentsTable,
} from './dashboard/DashboardWidgets';
import {
  LayoutDashboard,
  FileText,
  Phone,
  CalendarRange,
  AlertCircle,
  WalletCards,
  Clock,
  WifiOff,
} from 'lucide-react';
import { AppView, UserRole, Tenant, MonthlyViewData, LoanInstallment } from '../types';
import { useCompanyContext } from '../services/companyScope';
import InvestorDashboard from './InvestorDashboard';
import DebtorDashboard from './DebtorDashboard';
import { CollectionDashboard } from './dashboard/CollectionDashboard';
import MonthlyInvestorView from './investor/MonthlyInvestorView';
import { computeMonthlyView, monthKeyToDate, dateToMonthKey } from '../hooks/useInvestorMetrics';
import { InstallmentDetailScreen, type InstallmentAction } from './InstallmentDetailFlow';
import { getSupabase } from '../services/supabase';

interface DashboardProps {
    targetUserId?: string;
    onBack?: () => void;
    onNavigate?: (view: AppView) => void;
    userRole?: UserRole;
    tenant?: Tenant | null;
    defaultTab?: 'overview' | 'receivables' | 'collection' | 'monthly';
    investorDefaultTab?: 'portfolio' | 'monthly';
}

// Skeleton de loading premium
const DashboardSkeleton: React.FC = () => (
  <div className="space-y-6 pb-12">
    {/* Header skeleton */}
    <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
      <div className="skeleton h-3 w-36 mb-4 rounded-full" />
      <div className="skeleton h-10 w-72 mb-3" />
      <div className="skeleton h-3 w-full max-w-lg mb-2" />
      <div className="skeleton h-3 w-3/4 max-w-md" />
      <div className="mt-6 skeleton h-11 w-full rounded-full" />
    </div>
    {/* KPI grid skeleton */}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="panel-card rounded-[1.8rem] p-5">
          <div className="skeleton h-3 w-20 mb-4" />
          <div className="skeleton h-8 w-28 mb-3" />
          <div className="skeleton h-2 w-16" />
        </div>
      ))}
    </div>
    {/* Chart skeleton */}
    <div className="panel-card rounded-[1.8rem] p-6">
      <div className="skeleton h-3 w-28 mb-3" />
      <div className="skeleton h-6 w-48 mb-6" />
      <div className="skeleton h-40 w-full" />
    </div>
  </div>
);

// Sub-component for Admin View
const AdminDashboardView: React.FC<{ tenant: Tenant | null | undefined; defaultTab?: 'overview' | 'receivables' | 'collection' | 'monthly'; onNavigate?: (view: AppView) => void }> = ({ tenant, defaultTab = 'overview', onNavigate }) => {
  const { activeCompanyId } = useCompanyContext();
  const { stats, detailedKPIs, investments, installments, allPaidInstallments, loading, isStale, error, refetch } = useDashboardData(tenant?.id, activeCompanyId);
  const [activeTab, setActiveTab] = useState<'overview' | 'receivables' | 'collection' | 'monthly'>(defaultTab);

  // Visão Mensal — mês selecionado
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(() => dateToMonthKey(new Date()));

  // Detalhe de parcela da visão mensal
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);

  // Reconstrói RawInvestment[] combinando todas as parcelas (pagas históricas + pendentes/atrasadas)
  // para que a visão mensal funcione em qualquer mês navegado
  const rawInvestmentsForMonthly = useMemo(() => {
    const map = new Map<number, any>();
    // Índice rápido de investment por id
    const invIndex = new Map<number, any>();
    investments.forEach((inv: any) => invIndex.set(inv.id, inv));

    const processInst = (inst: any) => {
      const inv = inst.investment ?? invIndex.get(inst.investment_id);
      if (!inv) return;
      const id = inst.investment_id;
      if (!map.has(id)) {
        map.set(id, {
          id,
          asset_name: inv.asset_name,
          amount_invested: inv.amount_invested ?? 0,
          payer: inv.payer ?? null,
          loan_installments: [],
        });
      }
      map.get(id).loan_installments.push(inst);
    };

    // Todas as parcelas pagas (histórico completo)
    allPaidInstallments.forEach(processInst);
    // Parcelas pendentes/atrasadas (que não estão em allPaidInstallments)
    installments.forEach((inst: any) => {
      if (inst.status !== 'paid' && inst.status !== 'partial') processInst(inst);
    });

    // Garante que contratos sem parcelas apareçam no capital alocado
    investments.forEach((inv: any) => {
      if (!map.has(inv.id)) {
        map.set(inv.id, {
          id: inv.id,
          asset_name: inv.asset_name,
          amount_invested: inv.amount_invested ?? 0,
          payer: inv.payer ?? null,
          loan_installments: [],
        });
      }
    });
    return Array.from(map.values());
  }, [allPaidInstallments, installments, investments]);

  const monthlyView: MonthlyViewData | null = useMemo(() => {
    if (rawInvestmentsForMonthly.length === 0) return null;
    return computeMonthlyView(rawInvestmentsForMonthly, monthKeyToDate(selectedMonthKey));
  }, [rawInvestmentsForMonthly, selectedMonthKey]);

  const handlePrevMonth = () => {
    const d = monthKeyToDate(selectedMonthKey);
    d.setMonth(d.getMonth() - 1);
    setSelectedMonthKey(dateToMonthKey(d));
  };
  const handleNextMonth = () => {
    const d = monthKeyToDate(selectedMonthKey);
    d.setMonth(d.getMonth() + 1);
    setSelectedMonthKey(dateToMonthKey(d));
  };

  const handleInstallmentClick = async (installmentId: string, investmentId: number) => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data } = await supabase
      .from('loan_installments')
      .select('*, investment:investments(*, payer:profiles!investments_payer_id_fkey(id, full_name), loan_installments(*))')
      .eq('id', installmentId)
      .single();
    if (data) setSelectedInstallment(data as unknown as LoanInstallment);
  };

  // Relógio em tempo real
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
  useEffect(() => {
    const id = setInterval(() =>
      setTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })),
      30_000
    );
    return () => clearInterval(id);
  }, []);

  // Pass all installments to the table so the internal filters (All/Paid/Pending) work correctly
  const filteredInstallments = installments;

  if (selectedInstallment && !installmentAction) {
    return (
      <InstallmentDetailScreen
        installment={selectedInstallment}
        onBack={() => setSelectedInstallment(null)}
        onAction={(action) => setInstallmentAction(action)}
      />
    );
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="panel-card flex max-w-md flex-col items-center gap-4 rounded-[2rem] p-8 text-center">
          <AlertCircle size={32} className="text-[color:var(--accent-danger)]" />
          <h3 className="type-title text-[color:var(--text-primary)]">Erro ao carregar dados</h3>
          <p className="type-body text-[color:var(--text-secondary)]">{error}</p>
        </div>
      </div>
    );
  }

  const tabClass = (tab: typeof activeTab) =>
    `w-full justify-center rounded-full px-4 py-2.5 type-label transition-all flex items-center gap-2 cursor-pointer ${
      activeTab === tab
        ? 'bg-[color:var(--accent-brass)] text-[color:var(--text-on-accent)] shadow-[0_2px_14px_rgba(240,180,41,0.28)]'
        : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
    }`;

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {isStale && (
        <div className="flex items-center gap-1.5 px-4 py-1 text-xs text-amber-400">
          <WifiOff size={12} /> Exibindo dados da última sessão
        </div>
      )}
      <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="section-kicker mb-2">Dashboard executivo</p>
            <h2 className="type-display gradient-underline text-[color:var(--text-primary)]">
              Leitura da carteira
            </h2>
            <p className="mt-5 max-w-2xl type-body text-[color:var(--text-secondary)]">
              Acompanhe capital ativo, performance do mês, agenda de cobrança e o comportamento das parcelas com a mesma base financeira usada nas consultas operacionais.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 shrink-0">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(240,180,41,0.16)]">
              <WalletCards size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-[color:var(--text-primary)]">{tenant?.name || 'Operação'}</div>
              <div className="flex items-center gap-1.5 type-caption text-[color:var(--text-faint)]">
                <Clock size={10} />
                <span>{time}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-4 gap-1.5 rounded-full border border-white/10 bg-black/10 p-1.5">
          <button onClick={() => setActiveTab('overview')} className={tabClass('overview')}>
            <LayoutDashboard size={14} />
            <span className="hidden sm:inline">Visão Geral</span>
            <span className="sm:hidden">Visão</span>
          </button>
          <button onClick={() => setActiveTab('receivables')} className={tabClass('receivables')}>
            <FileText size={14} /> Parcelas
          </button>
          <button onClick={() => setActiveTab('collection')} className={tabClass('collection')}>
            <Phone size={14} /> Cobranças
          </button>
          <button onClick={() => setActiveTab('monthly')} className={tabClass('monthly')}>
            <CalendarRange size={14} /> Mensal
          </button>
        </div>
      </div>

      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
            <ResumoGeral kpis={detailedKPIs} />
            <KPICards stats={stats} kpis={detailedKPIs} installments={installments} onGoToCollection={() => setActiveTab('collection')} />

            <OverviewCharts kpis={detailedKPIs} installments={installments} />

            <div>
              <div className="mb-4 pl-1">
                <p className="section-kicker mb-1">Carteira</p>
                <h3 className="type-title text-[color:var(--text-primary)]">Contratos recentes</h3>
              </div>
              <InvestmentsTable data={investments.slice(0, 5)} />
            </div>
          </div>
        )}

        {activeTab === 'receivables' && (
          <div className="space-y-6 animate-fade-in">
            <InstallmentsTable data={filteredInstallments} onUpdate={refetch} tenant={tenant} />
          </div>
        )}

        {activeTab === 'collection' && (
          <div className="animate-fade-in">
            <CollectionDashboard installments={installments} onUpdate={refetch} tenant={tenant} />
          </div>
        )}

        {activeTab === 'monthly' && monthlyView && (
          <div className="animate-fade-in">
            <MonthlyInvestorView
              monthlyView={monthlyView}
              selectedMonthKey={selectedMonthKey}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              onInstallmentClick={handleInstallmentClick}
            />
          </div>
        )}

      </div>
    </div>
  );
};

// Main Component acting as Router/Controller based on Role
const Dashboard: React.FC<DashboardProps> = ({ targetUserId, userRole, tenant, onBack, defaultTab, onNavigate, investorDefaultTab }) => {
  // If explicitly targeting a user (e.g. Admin viewing specific investor), or if role is Investor/Debtor
  if (userRole === 'investor' && !targetUserId) return <InvestorDashboard defaultTab={investorDefaultTab} />;
  if (userRole === 'debtor' && !targetUserId) return <DebtorDashboard />;

  // Default to Admin Dashboard
  return <AdminDashboardView tenant={tenant} defaultTab={defaultTab} onNavigate={onNavigate} />;
};

export default Dashboard;
