
import React, { useState } from 'react';
import { useDashboardData } from '../hooks/useDashboardData';
import {
  KPICards, OverviewCharts,
  InvestmentsTable, InstallmentsTable
} from './dashboard/DashboardWidgets';
import {
  LayoutDashboard,
  FileText,
  Phone,
  Loader2,
  AlertCircle,
  WalletCards,
} from 'lucide-react';
import { UserRole, Tenant } from '../types';
import InvestorDashboard from './InvestorDashboard';
import DebtorDashboard from './DebtorDashboard';
import { CollectionDashboard } from './dashboard/CollectionDashboard';

interface DashboardProps {
    targetUserId?: string;
    onBack?: () => void;
    userRole?: UserRole;
    tenant?: Tenant | null;
    defaultTab?: 'overview' | 'receivables' | 'collection';
}

// Sub-component for Admin View
const AdminDashboardView: React.FC<{ tenant: Tenant | null | undefined; defaultTab?: 'overview' | 'receivables' | 'collection' }> = ({ tenant, defaultTab = 'overview' }) => {
  const { stats, detailedKPIs, investments, installments, loading, error, refetch } = useDashboardData(tenant?.id);
  const [activeTab, setActiveTab] = useState<'overview' | 'receivables' | 'collection'>(defaultTab);
  // Pass all installments to the table so the internal filters (All/Paid/Pending) work correctly
  const filteredInstallments = installments;

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center text-[color:var(--accent-brass)] animate-pulse">
        <Loader2 size={40} className="animate-spin mb-4" />
        <p className="section-kicker text-[color:var(--text-secondary)]">Carregando indicadores</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="panel-card flex max-w-md flex-col items-center gap-4 rounded-[2rem] p-8 text-center">
          <AlertCircle size={32} className="text-[color:var(--accent-danger)]" />
          <h3 className="font-display text-3xl text-[color:var(--text-primary)]">Erro ao carregar dados</h3>
          <p className="text-sm leading-7 text-[color:var(--text-secondary)]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="section-kicker mb-2">Dashboard executivo</p>
            <h2 className="font-display text-3xl leading-none text-[color:var(--text-primary)] md:text-5xl">Leitura da carteira</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[color:var(--text-secondary)]">
              Acompanhe capital ativo, performance do mês, agenda de cobrança e o comportamento das parcelas com a mesma base financeira usada nas consultas operacionais.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]">
              <WalletCards size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-[color:var(--text-primary)]">{tenant?.name || 'Operação'}</div>
              <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Base real do tenant</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-1.5 rounded-full border border-white/10 bg-black/10 p-1.5">
          <button
            onClick={() => setActiveTab('overview')}
            className={`w-full justify-center rounded-full px-4 py-2.5 text-xs font-extrabold uppercase tracking-[0.18em] transition-all flex items-center gap-2 ${activeTab === 'overview' ? 'bg-[color:var(--accent-brass)] text-[#17120b]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
          >
            <LayoutDashboard size={14} /> <span className="hidden sm:inline">Visão Geral</span><span className="sm:hidden">Visão</span>
          </button>
          <button
            onClick={() => setActiveTab('receivables')}
            className={`w-full justify-center rounded-full px-4 py-2.5 text-xs font-extrabold uppercase tracking-[0.18em] transition-all flex items-center gap-2 ${activeTab === 'receivables' ? 'bg-[color:var(--accent-brass)] text-[#17120b]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
          >
            <FileText size={14} /> Parcelas
          </button>
          <button
            onClick={() => setActiveTab('collection')}
            className={`w-full justify-center rounded-full px-4 py-2.5 text-xs font-extrabold uppercase tracking-[0.18em] transition-all flex items-center gap-2 ${activeTab === 'collection' ? 'bg-[color:var(--accent-brass)] text-[#17120b]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
          >
            <Phone size={14} /> Cobranças
          </button>
        </div>
      </div>

      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
            <KPICards stats={stats} kpis={detailedKPIs} installments={installments} onGoToCollection={() => setActiveTab('collection')} />
            
            <OverviewCharts kpis={detailedKPIs} installments={installments} />
            
            <div>
              <div className="mb-4 pl-1">
                <p className="section-kicker mb-1">Carteira</p>
                <h3 className="font-display text-2xl leading-none text-[color:var(--text-primary)] md:text-4xl">Contratos recentes</h3>
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

      </div>
    </div>
  );
};

// Main Component acting as Router/Controller based on Role
const Dashboard: React.FC<DashboardProps> = ({ targetUserId, userRole, tenant, onBack, defaultTab }) => {
  // If explicitly targeting a user (e.g. Admin viewing specific investor), or if role is Investor/Debtor
  if (userRole === 'investor' && !targetUserId) return <InvestorDashboard />;
  if (userRole === 'debtor' && !targetUserId) return <DebtorDashboard />;

  // Default to Admin Dashboard
  return <AdminDashboardView tenant={tenant} defaultTab={defaultTab} />;
};

export default Dashboard;
