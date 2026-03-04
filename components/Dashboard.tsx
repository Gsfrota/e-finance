
import React, { useState } from 'react';
import { useDashboardData } from '../hooks/useDashboardData';
import { 
  KPICards, FiltersBar, OverviewCharts,
  InvestmentsTable, InstallmentsTable 
} from './dashboard/DashboardWidgets';
import { 
  LayoutDashboard, FileText, Users, PieChart, 
  Loader2, AlertCircle 
} from 'lucide-react';
import { UserRole, Tenant } from '../types';
import InvestorDashboard from './InvestorDashboard';
import DebtorDashboard from './DebtorDashboard';

interface DashboardProps {
    targetUserId?: string; 
    onBack?: () => void;   
    userRole?: UserRole;
    tenant?: Tenant | null;
}

// Sub-component for Admin View
const AdminDashboardView: React.FC<{ tenant: Tenant | null | undefined }> = ({ tenant }) => {
  const { stats, detailedKPIs, investments, installments, loading, error, refetch } = useDashboardData(tenant?.id);
  const [activeTab, setActiveTab] = useState<'overview' | 'receivables' | 'investors' | 'reports'>('overview');
  const [filterTerm, setFilterTerm] = useState('');

  // Local filtering logic (Frontend side for responsiveness on small datasets)
  const filteredInvestments = investments.filter(inv => 
    inv.asset_name.toLowerCase().includes(filterTerm.toLowerCase()) ||
    inv.investor_name?.toLowerCase().includes(filterTerm.toLowerCase()) ||
    inv.payer_name?.toLowerCase().includes(filterTerm.toLowerCase())
  );

  // Pass all installments to the table so the internal filters (All/Paid/Pending) work correctly
  const filteredInstallments = installments;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-teal-500 animate-pulse">
        <Loader2 size={40} className="animate-spin mb-4" />
        <p className="text-xs font-black uppercase tracking-widest">Carregando Indicadores...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="bg-red-900/20 border border-red-900/50 p-6 rounded-3xl flex flex-col items-center gap-4 text-center max-w-md">
          <AlertCircle size={32} className="text-red-500" />
          <h3 className="text-white font-bold">Erro ao carregar dados</h3>
          <p className="text-slate-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* TABS HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-slate-700 pb-1">
        <div className="flex gap-1 bg-slate-800/50 p-1 rounded-xl">
          <button 
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'overview' ? 'bg-teal-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
          >
            <LayoutDashboard size={14} /> Visão Geral
          </button>
          <button 
            onClick={() => setActiveTab('receivables')}
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'receivables' ? 'bg-teal-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
          >
            <FileText size={14} /> Recebíveis
          </button>
          <button 
            onClick={() => setActiveTab('investors')}
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'investors' ? 'bg-teal-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
          >
            <Users size={14} /> Carteira
          </button>
          <button 
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'reports' ? 'bg-teal-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
          >
            <PieChart size={14} /> Relatórios
          </button>
        </div>
      </div>

      {/* CONTENT AREA */}
      <div className="min-h-[500px]">
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
            <KPICards stats={stats} kpis={detailedKPIs} />
            
            {/* Gráficos de Visão Geral */}
            <OverviewCharts kpis={detailedKPIs} installments={installments} />
            
            <div>
              <h3 className="text-white font-bold mb-4 uppercase text-sm tracking-wider pl-2">Últimos Investimentos</h3>
              <InvestmentsTable data={filteredInvestments.slice(0, 5)} />
            </div>
          </div>
        )}

        {activeTab === 'receivables' && (
          <div className="space-y-6 animate-fade-in">
            <h3 className="text-white font-bold mb-2 uppercase text-sm tracking-wider pl-2">Gestão de Títulos</h3>
            <InstallmentsTable data={filteredInstallments} onUpdate={refetch} tenant={tenant} />
          </div>
        )}

        {activeTab === 'investors' && (
          <div className="space-y-6 animate-fade-in">
             <FiltersBar 
                onSearch={setFilterTerm} 
             />
             <InvestmentsTable data={filteredInvestments} />
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="flex flex-col items-center justify-center h-80 bg-slate-800 rounded-3xl border border-slate-700 animate-fade-in">
            <PieChart size={64} className="text-slate-600 mb-4" />
            <h3 className="text-white font-bold text-lg">Central de Relatórios</h3>
            <p className="text-slate-500 text-sm mb-6">Exporte dados consolidados em CSV ou PDF.</p>
            <button className="bg-teal-600 hover:bg-teal-500 text-white px-8 py-3 rounded-xl font-black uppercase text-xs tracking-widest transition-colors">
              Gerar Relatório Mensal
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Main Component acting as Router/Controller based on Role
const Dashboard: React.FC<DashboardProps> = ({ targetUserId, userRole, tenant, onBack }) => {
  // If explicitly targeting a user (e.g. Admin viewing specific investor), or if role is Investor/Debtor
  if (userRole === 'investor' && !targetUserId) return <InvestorDashboard />;
  if (userRole === 'debtor' && !targetUserId) return <DebtorDashboard />;
  
  // Default to Admin Dashboard
  return <AdminDashboardView tenant={tenant} />;
};

export default Dashboard;
