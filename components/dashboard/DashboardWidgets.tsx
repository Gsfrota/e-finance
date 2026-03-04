
import React, { useState, useMemo } from 'react';
import { AdminDashboardStats, DashboardKPIs, Investment, LoanInstallment, Tenant } from '../../types';
import { 
  Wallet, TrendingUp, AlertTriangle, Search, ArrowDownRight,
  Filter, CheckCircle2, DollarSign, RefreshCw, Pencil, Info, ShieldCheck, Clock, PieChart, Coins, AlertCircle, Briefcase, CalendarCheck, ListFilter, Calendar, ChevronLeft, ChevronRight, XCircle, CalendarDays, Sparkles
} from 'lucide-react';
import { PaymentModal, RefinanceModal, EditModal } from '../InstallmentModals';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell
} from 'recharts';

// --- SHARED HELPERS ---

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const normalizeNumber = (val: any): number => {
    if (val === null || val === undefined) return 0;
    const num = Number(val);
    return isNaN(num) ? 0 : num;
};

const calculateOutstanding = (inst: LoanInstallment): number => {
    const total = normalizeNumber(inst.amount_total);
    const fine = normalizeNumber(inst.fine_amount);
    const interestDelay = normalizeNumber(inst.interest_delay_amount);
    const paid = normalizeNumber(inst.amount_paid);
    return Math.max(0, (total + fine + interestDelay) - paid);
};

const isInstallmentOverdue = (inst: LoanInstallment): boolean => {
    if (inst.status === 'paid') return false;
    const today = new Date().toISOString().split('T')[0];
    const outstanding = calculateOutstanding(inst);
    return inst.due_date < today && outstanding > 0.01;
};

const computeAgingBuckets = (installments: LoanInstallment[]) => {
    const buckets = {
        '1-7 dias': 0,
        '8-15 dias': 0,
        '16-30 dias': 0,
        '31-60 dias': 0,
        '60+ dias': 0
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    installments.forEach(inst => {
        if (isInstallmentOverdue(inst)) {
            const dueDate = new Date(inst.due_date + 'T00:00:00');
            const diffTime = Math.abs(today.getTime() - dueDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            const outstanding = calculateOutstanding(inst);

            if (diffDays <= 7) buckets['1-7 dias'] += outstanding;
            else if (diffDays <= 15) buckets['8-15 dias'] += outstanding;
            else if (diffDays <= 30) buckets['16-30 dias'] += outstanding;
            else if (diffDays <= 60) buckets['31-60 dias'] += outstanding;
            else buckets['60+ dias'] += outstanding;
        }
    });

    return Object.entries(buckets).map(([range, value]) => ({
        name: range,
        value: value
    }));
};

// --- 1. KPI CARDS ---
interface KPICardsProps {
  stats: AdminDashboardStats;
  kpis: DashboardKPIs;
}
export const KPICards: React.FC<KPICardsProps> = ({ kpis }) => {
  const recoveryPercentage = kpis.totalInvestedHistorical > 0 
    ? (kpis.totalPrincipalRepaid / kpis.totalInvestedHistorical) * 100 
    : 0;
  
  // Calculate allocation percentages for visual bar
  const totalActive = kpis.activeStreetMoney || 1;
  const ownPct = (kpis.activeOwnCapital / totalActive) * 100;
  const reinvestPct = (kpis.activeReinvestedCapital / totalActive) * 100;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      
      {/* CARD 1: DINHEIRO NA RUA (Risco Ativo & Composição) */}
      <div className="bg-gradient-to-br from-indigo-900/50 to-slate-900 p-6 rounded-[2rem] border border-indigo-500/30 shadow-lg relative group flex flex-col justify-between">
        <div className="absolute inset-0 overflow-hidden rounded-[2rem] pointer-events-none">
            <div className="absolute right-0 top-0 p-8 opacity-10">
                <Briefcase size={64} className="text-white"/>
            </div>
        </div>
        
        <div>
            <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="p-3 bg-indigo-500/20 rounded-2xl text-indigo-300">
                <Briefcase size={24} />
            </div>
            <span className="text-[10px] uppercase font-black text-indigo-300 bg-indigo-950 px-2 py-1 rounded border border-indigo-500/20">Capital na Rua</span>
            </div>
            <h3 className="text-2xl font-black text-white relative z-10">{formatCurrency(kpis.activeStreetMoney)}</h3>
            <p className="text-[10px] text-slate-400 uppercase font-bold mt-1 relative z-10">Principal Ativo (Risco)</p>
        </div>

        {/* Breakdown Bar (New Feature) */}
        <div className="mt-4 relative z-10">
            <div className="flex justify-between items-end mb-1">
                <span className="text-[8px] font-black uppercase text-indigo-400 flex items-center gap-1"><Wallet size={8}/> Aporte</span>
                <span className="text-[8px] font-black uppercase text-emerald-400 flex items-center gap-1"><Sparkles size={8}/> Reinvestido</span>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden flex">
                <div style={{ width: `${ownPct}%` }} className="h-full bg-indigo-500 hover:bg-indigo-400 transition-colors" title={`Aporte Próprio: ${formatCurrency(kpis.activeOwnCapital)}`}></div>
                <div style={{ width: `${reinvestPct}%` }} className="h-full bg-emerald-500 hover:bg-emerald-400 transition-colors" title={`Lucro Reinvestido: ${formatCurrency(kpis.activeReinvestedCapital)}`}></div>
            </div>
            <div className="flex justify-between mt-1">
                <span className="text-[9px] font-bold text-slate-300">{formatCurrency(kpis.activeOwnCapital)}</span>
                <span className="text-[9px] font-bold text-emerald-400">{formatCurrency(kpis.activeReinvestedCapital)}</span>
            </div>
        </div>
        
        <div className="absolute top-full left-0 w-full mt-2 p-4 bg-slate-900 border border-slate-700 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl pointer-events-none group-hover:pointer-events-auto">
            <div className="text-[9px] text-slate-400 mb-1 font-bold">Resumo do Capital:</div>
            <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">Total Aplicado</span>
                <span className="text-white font-bold">{formatCurrency(kpis.totalInvestedHistorical)}</span>
            </div>
            <div className="flex justify-between text-xs">
                <span className="text-emerald-500">Já Retornou</span>
                <span className="text-emerald-400 font-bold">-{formatCurrency(kpis.totalPrincipalRepaid)}</span>
            </div>
        </div>
      </div>

      {/* CARD 2: LUCRO RECEBIDO (Caixa) */}
      <div className="bg-gradient-to-br from-emerald-900/50 to-slate-900 p-6 rounded-[2rem] border border-emerald-500/30 shadow-lg relative group">
        <div className="absolute inset-0 overflow-hidden rounded-[2rem] pointer-events-none">
            <div className="absolute right-0 top-0 p-8 opacity-10">
                <TrendingUp size={64} className="text-white"/>
            </div>
        </div>
        <div className="flex justify-between items-start mb-4 relative z-10">
          <div className="p-3 bg-emerald-500/20 rounded-2xl text-emerald-400">
            <TrendingUp size={24} />
          </div>
          <div className="relative group/info">
              <span className="text-[10px] uppercase font-black text-emerald-400 bg-emerald-950 px-2 py-1 rounded border border-emerald-500/20 flex items-center gap-1.5 cursor-help">
                  Lucro Recebido <Info size={12}/>
              </span>
              <div className="absolute top-full right-0 w-60 mt-2 p-4 bg-slate-950 border border-slate-700 rounded-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 shadow-2xl pointer-events-none group-hover/info:pointer-events-auto">
                  <p className="text-xs font-bold text-white mb-3">Composição do Lucro:</p>
                  <div className="space-y-2 text-[10px]">
                      <div className="flex justify-between">
                          <span className="text-slate-400">Lucro Potencial Total</span>
                          <span className="text-white font-bold">{formatCurrency(kpis.totalProfitPotential)}</span>
                      </div>
                      <div className="flex justify-between">
                          <span className="text-emerald-400">Já Recebido (Caixa)</span>
                          <span className="text-emerald-300 font-bold">{formatCurrency(kpis.totalProfitReceived)}</span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-slate-700">
                          <span className="text-slate-400">A Receber</span>
                          <span className="text-white font-bold">{formatCurrency(kpis.totalProfitReceivable)}</span>
                      </div>
                  </div>
              </div>
          </div>
        </div>
        <h3 className="text-2xl font-black text-white relative z-10">{formatCurrency(kpis.totalProfitReceived)}</h3>
        <p className="text-[10px] text-emerald-400/80 uppercase font-bold mt-1 relative z-10">Juros e Multas Pagos (Caixa)</p>
      </div>

      {/* CARD 3: PREVISÃO MÊS (Fluxo) */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-[2rem] border border-slate-700 shadow-lg relative group">
        <div className="absolute inset-0 overflow-hidden rounded-[2rem] pointer-events-none">
            <div className="absolute right-0 top-0 p-8 opacity-5">
                <CalendarCheck size={64} className="text-white"/>
            </div>
        </div>
        <div className="flex justify-between items-start mb-4 relative z-10">
          <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-400">
            <CalendarCheck size={24} />
          </div>
          <span className="text-[10px] uppercase font-black text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-700">Fluxo Mês</span>
        </div>
        <h3 className="text-2xl font-black text-white relative z-10">{formatCurrency(kpis.expectedMonth)}</h3>
        <div className="flex items-center gap-2 mt-1 relative z-10">
            <div className="h-1.5 w-16 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 rounded-full transition-all duration-1000" 
                  style={{ width: `${kpis.expectedMonth > 0 ? Math.min(100, (kpis.receivedMonth / kpis.expectedMonth) * 100) : 0}%` }}
                ></div>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase">{kpis.expectedMonth > 0 ? Math.round((kpis.receivedMonth / kpis.expectedMonth) * 100) : 0}% Recebido</p>
        </div>
        
        <div className="absolute top-full left-0 w-full mt-2 p-4 bg-slate-900 border border-slate-700 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl pointer-events-none group-hover:pointer-events-auto">
             <div className="flex justify-between text-xs mb-1">
                 <span className="text-slate-400">Já Entrou</span>
                 <span className="text-emerald-400 font-bold">{formatCurrency(kpis.receivedMonth)}</span>
             </div>
             <div className="flex justify-between text-xs">
                 <span className="text-slate-400">Falta Entrar</span>
                 <span className="text-white font-bold">{formatCurrency(Math.max(0, kpis.expectedMonth - kpis.receivedMonth))}</span>
             </div>
        </div>
      </div>

      {/* CARD 4: RETORNO (CAPITAL RECUPERADO) */}
      <div className="bg-gradient-to-br from-sky-900/50 to-slate-900 p-6 rounded-[2rem] border border-sky-500/30 shadow-lg relative group">
        <div className="absolute inset-0 overflow-hidden rounded-[2rem] pointer-events-none">
            <div className="absolute right-0 top-0 p-8 opacity-10">
                <Coins size={64} className="text-white"/>
            </div>
        </div>
        <div className="flex justify-between items-start mb-4 relative z-10">
          <div className="p-3 bg-sky-500/20 rounded-2xl text-sky-400">
            <Coins size={24} />
          </div>
          <span className="text-[10px] uppercase font-black text-sky-400 bg-sky-950 px-2 py-1 rounded border border-sky-500/20">Retorno</span>
        </div>
        <h3 className="text-2xl font-black text-white relative z-10">{formatCurrency(kpis.totalPrincipalRepaid)}</h3>
        <p className="text-[10px] text-slate-400 uppercase font-bold mt-1 relative z-10">Capital Recuperado</p>
        
        <div className="absolute top-full left-0 w-full mt-2 p-4 bg-slate-900 border border-slate-700 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl pointer-events-none group-hover:pointer-events-auto">
            <div className="flex justify-between items-center mb-2">
              <div className="text-[9px] text-slate-400 font-bold">Progresso de Recuperação:</div>
              <div className="text-xs font-bold text-sky-400">{recoveryPercentage.toFixed(1)}%</div>
            </div>
            <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden mb-2">
                <div 
                  className="h-full bg-sky-500 rounded-full transition-all duration-1000" 
                  style={{ width: `${recoveryPercentage}%` }}
                ></div>
            </div>
            <div className="flex justify-between text-xs">
                <span className="text-slate-500">Total Aportado</span>
                <span className="text-white font-bold">{formatCurrency(kpis.totalInvestedHistorical)}</span>
            </div>
        </div>
      </div>
    </div>
  );
};

// --- 2. FILTERS BAR (Reused for other lists if needed) ---
interface FiltersBarProps {
  onSearch: (term: string) => void;
  activeStatus?: 'all' | 'pending' | 'overdue' | 'paid';
  onStatusChange?: (status: 'all' | 'pending' | 'overdue' | 'paid') => void;
  selectedMonth?: string;
  onMonthChange?: (month: string) => void;
}

export const FiltersBar: React.FC<FiltersBarProps> = ({ 
    onSearch, 
    activeStatus, 
    onStatusChange,
    selectedMonth,
    onMonthChange 
}) => (
  <div className="bg-slate-800 p-4 rounded-[1.5rem] border border-slate-700 mb-6 shadow-xl flex flex-col xl:flex-row gap-4">
    <div className="flex flex-col sm:flex-row gap-3 flex-1">
        <div className="relative flex-1">
            <Search className="absolute left-3 top-3.5 text-slate-500" size={18} />
            <input 
                type="text" 
                placeholder="Buscar..." 
                onChange={(e) => onSearch(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:border-teal-500 outline-none transition-colors"
            />
        </div>
        {selectedMonth !== undefined && onMonthChange && (
            <div className="relative group">
                <Calendar className="absolute left-3 top-3.5 text-slate-500 group-focus-within:text-teal-500" size={18} />
                <input 
                    type="month" 
                    value={selectedMonth}
                    onChange={(e) => onMonthChange(e.target.value)}
                    className="w-full sm:w-auto bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:border-teal-500 outline-none transition-colors"
                />
            </div>
        )}
    </div>
  </div>
);

// --- 3. OVERVIEW CHARTS ---

interface OverviewChartsProps {
    kpis: DashboardKPIs;
    installments: LoanInstallment[];
}

export const OverviewCharts: React.FC<OverviewChartsProps> = ({ kpis, installments }) => {
    const portfolioData = [
        {
            name: 'Capital',
            recuperado: kpis.totalPrincipalRepaid,
            naRua: kpis.activeStreetMoney,
            lucro: kpis.totalProfitReceived
        }
    ];

    const agingData = useMemo(() => computeAgingBuckets(installments), [installments]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="bg-slate-800 p-8 rounded-[2rem] border border-slate-700 shadow-xl flex flex-col">
                <div className="flex items-center gap-3 mb-8">
                    <div className="p-2 bg-indigo-900/30 rounded-xl text-indigo-400">
                        <PieChart size={24}/>
                    </div>
                    <div>
                        <h4 className="text-sm font-black text-white uppercase tracking-widest">Saúde da Carteira</h4>
                        <p className="text-[10px] text-slate-500 font-bold uppercase">Ciclo de Vida do Capital</p>
                    </div>
                </div>
                
                <div className="flex-1 w-full min-h-[300px]">
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={portfolioData} barSize={80} layout="horizontal">
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis dataKey="name" hide />
                            <YAxis 
                                axisLine={false} 
                                tickLine={false} 
                                tick={{fill: '#64748b', fontSize: 11}} 
                                tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`}
                            />
                            <Tooltip 
                                cursor={{fill: '#1e293b'}}
                                contentStyle={{backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'}} 
                                itemStyle={{fontSize: '12px', fontWeight: 'bold'}}
                                formatter={(value: number) => formatCurrency(value)}
                            />
                            <Legend wrapperStyle={{paddingTop: '20px', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase'}}/>
                            <Bar name="Principal Recuperado" dataKey="recuperado" stackId="a" fill="#3b82f6" radius={[0, 0, 4, 4]} />
                            <Bar name="Capital na Rua" dataKey="naRua" stackId="a" fill="#6366f1" />
                            <Bar name="Lucro Recebido" dataKey="lucro" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-slate-800 p-8 rounded-[2rem] border border-slate-700 shadow-xl flex flex-col">
                <div className="flex items-center gap-3 mb-8">
                    <div className="p-2 bg-red-900/30 rounded-xl text-red-400">
                        <AlertCircle size={24}/>
                    </div>
                    <div>
                        <h4 className="text-sm font-black text-white uppercase tracking-widest">Raio-X da Inadimplência</h4>
                        <p className="text-[10px] text-slate-500 font-bold uppercase">Tempo médio de atraso</p>
                    </div>
                </div>

                <div className="flex-1 w-full min-h-[300px]">
                     {agingData.every(d => d.value === 0) ? (
                         <div className="h-full flex flex-col items-center justify-center text-slate-600">
                             <CheckCircle2 size={64} className="mb-4 text-slate-700"/>
                             <p className="text-xs font-black uppercase tracking-widest">Nenhuma pendência crítica</p>
                         </div>
                     ) : (
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={agingData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis 
                                    dataKey="name" 
                                    type="category" 
                                    axisLine={false} 
                                    tickLine={false} 
                                    tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 'bold'}}
                                    width={80}
                                />
                                <Tooltip 
                                    cursor={{fill: '#1e293b'}}
                                    contentStyle={{backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '16px'}} 
                                    itemStyle={{fontSize: '12px', fontWeight: 'bold', color: '#ef4444'}}
                                    formatter={(value: number) => [formatCurrency(value), 'Valor Atrasado']}
                                />
                                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
                                    {agingData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index > 2 ? '#ef4444' : '#f59e0b'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                     )}
                </div>
            </div>

        </div>
    );
};

// --- 4. INVESTMENTS TABLE (Styled) ---
export const InvestmentsTable: React.FC<{ data: Investment[] }> = ({ data }) => (
  <div className="bg-slate-800 rounded-[2rem] border border-slate-700 overflow-hidden shadow-xl">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-slate-900/50 text-slate-400 font-black uppercase text-[10px] tracking-wider">
          <tr>
            <th className="px-6 py-4">Contrato / Ativo</th>
            <th className="px-6 py-4">Investidor</th>
            <th className="px-6 py-4">Tomador</th>
            <th className="px-6 py-4 text-right">Valor Principal</th>
            <th className="px-6 py-4 text-right">Taxa</th>
            <th className="px-6 py-4 text-center">Origem</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/30 text-slate-300">
          {data.map((inv) => (
            <tr key={inv.id} className="hover:bg-slate-700/20 transition-colors">
              <td className="px-6 py-4 font-bold text-white flex items-center gap-2">
                  <div className="p-1.5 bg-slate-700 rounded-lg text-teal-400"><Wallet size={12}/></div>
                  {inv.asset_name}
              </td>
              <td className="px-6 py-4 text-xs font-medium text-indigo-300">{inv.investor_name}</td>
              <td className="px-6 py-4 text-xs font-medium text-slate-400">{inv.payer_name}</td>
              <td className="px-6 py-4 text-right font-mono text-white font-bold">{formatCurrency(Number(inv.amount_invested))}</td>
              <td className="px-6 py-4 text-right text-xs font-mono">{inv.interest_rate}%</td>
              <td className="px-6 py-4 text-center">
                  {(inv.source_profit || 0) > 0 ? (
                      <span className="inline-flex items-center gap-1 bg-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded text-[9px] font-black uppercase border border-emerald-900/50">
                         <Coins size={10}/> {((inv.source_profit! / inv.amount_invested) * 100).toFixed(0)}% Reinv.
                      </span>
                  ) : (
                      <span className="inline-flex items-center gap-1 bg-slate-700 text-slate-300 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                         <Briefcase size={10}/> Aporte
                      </span>
                  )}
              </td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500 text-xs uppercase font-bold">Nenhum investimento encontrado</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

// --- 5. INSTALLMENTS TABLE (ENHANCED WITH PERIOD FILTER) ---
interface InstallmentsTableProps {
  data: LoanInstallment[];
  onUpdate?: () => void;
  tenant?: Tenant | null; // Needed for Receipts
}

export const InstallmentsTable: React.FC<InstallmentsTableProps> = ({ data, onUpdate, tenant }) => {
  // Configs
  const [filterMode, setFilterMode] = useState<'month' | 'range'>('month');
  
  // Date States
  const [currentDate, setCurrentDate] = useState(new Date());
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  // Other States
  const [activeStatus, setActiveStatus] = useState<'all' | 'pending' | 'overdue' | 'paid'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [modalType, setModalType] = useState<'pay' | 'refinance' | 'edit' | null>(null);

  // Navigation Handlers
  const nextMonth = () => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)));
  const prevMonth = () => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)));
  
  const currentMonthLabel = currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const targetMonth = currentDate.getMonth();
  const targetYear = currentDate.getFullYear();

  // MAIN FILTER LOGIC
  const filteredData = useMemo(() => {
      return data.filter(inst => {
        // 1. DATE FILTER (Flexible)
        if (filterMode === 'month') {
            const [y, m] = inst.due_date.split('-').map(Number);
            if (y !== targetYear || m !== (targetMonth + 1)) return false;
        } else {
            // Range Mode
            if (rangeStart && inst.due_date < rangeStart) return false;
            if (rangeEnd && inst.due_date > rangeEnd) return false;
        }

        // 2. STATUS FILTER (Common)
        const isPaid = inst.status === 'paid';
        const isLate = isInstallmentOverdue(inst);

        if (activeStatus === 'pending' && (isPaid || isLate)) return false;
        if (activeStatus === 'overdue' && !isLate) return false;
        if (activeStatus === 'paid' && !isPaid) return false;

        // 3. SEARCH FILTER (Common)
        const term = searchTerm.toLowerCase();
        if (term && !(
            inst.contract_name?.toLowerCase().includes(term) || 
            inst.investment?.payer?.full_name?.toLowerCase().includes(term) ||
            inst.number.toString().includes(term)
        )) return false;

        return true;
      }).sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [data, filterMode, currentDate, rangeStart, rangeEnd, activeStatus, searchTerm]);

  // STATS CALCULATION (Based on current filters)
  const stats = useMemo(() => {
      let total = 0;
      let paid = 0;
      let pending = 0;
      let count = 0;

      filteredData.forEach(inst => {
          total += Number(inst.amount_total);
          count++;
          if (inst.status === 'paid') {
              paid += Number(inst.amount_paid > 0 ? inst.amount_paid : inst.amount_total);
          } else {
              pending += calculateOutstanding(inst);
          }
      });

      return { total, paid, pending, count };
  }, [filteredData]);

  // Counts for Tabs (Contextual)
  const counts = useMemo(() => {
      // We need to filter by DATE ONLY first to get accurate tab counts
      const dateFiltered = data.filter(inst => {
          if (filterMode === 'month') {
              const [y, m] = inst.due_date.split('-').map(Number);
              return y === targetYear && m === (targetMonth + 1);
          } else {
              if (rangeStart && inst.due_date < rangeStart) return false;
              if (rangeEnd && inst.due_date > rangeEnd) return false;
              return true;
          }
      });

      return {
          all: dateFiltered.length,
          pending: dateFiltered.filter(i => i.status !== 'paid' && !isInstallmentOverdue(i)).length,
          overdue: dateFiltered.filter(i => isInstallmentOverdue(i)).length,
          paid: dateFiltered.filter(i => i.status === 'paid').length
      };
  }, [data, filterMode, currentDate, rangeStart, rangeEnd]);

  const handleAction = (type: 'pay' | 'refinance' | 'edit', inst: LoanInstallment) => {
    setSelectedInstallment(inst);
    setModalType(type);
  };

  const handleCloseModal = () => {
    setModalType(null);
    setSelectedInstallment(null);
  };

  const handleSuccess = () => { if (onUpdate) onUpdate(); };

  return (
    <>
      <div className="space-y-6">
        {/* NEW CONTROL PANEL */}
        <div className="bg-slate-800 rounded-[2rem] border border-slate-700 shadow-xl overflow-hidden">
            
            {/* Top Bar: Date Logic & Search */}
            <div className="p-4 md:p-6 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-slate-700/50 bg-slate-900/30">
                
                {/* MODE SWITCHER & NAV */}
                <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
                    <div className="bg-slate-900 p-1 rounded-xl border border-slate-700 flex shrink-0">
                        <button 
                            onClick={() => setFilterMode('month')}
                            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filterMode === 'month' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Mensal
                        </button>
                        <button 
                            onClick={() => setFilterMode('range')}
                            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filterMode === 'range' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Período
                        </button>
                    </div>

                    {filterMode === 'month' ? (
                        <div className="flex items-center gap-4 bg-slate-900 p-1.5 rounded-2xl border border-slate-700 shadow-inner w-full sm:w-auto justify-between sm:justify-start">
                            <button onClick={prevMonth} className="p-2.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all"><ChevronLeft size={20}/></button>
                            <div className="text-center w-32 md:w-40">
                                <span className="block text-[10px] font-black uppercase text-slate-500 tracking-widest mb-0.5">Mês de Ref.</span>
                                <span className="block text-white font-black capitalize text-sm">{currentMonthLabel}</span>
                            </div>
                            <button onClick={nextMonth} className="p-2.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all"><ChevronRight size={20}/></button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-2xl border border-slate-700 w-full sm:w-auto">
                            <input 
                                type="date" 
                                value={rangeStart} 
                                onChange={e => setRangeStart(e.target.value)}
                                className="bg-transparent text-white text-xs font-bold p-2 outline-none w-full sm:w-auto"
                            />
                            <span className="text-slate-500">-</span>
                            <input 
                                type="date" 
                                value={rangeEnd} 
                                onChange={e => setRangeEnd(e.target.value)}
                                className="bg-transparent text-white text-xs font-bold p-2 outline-none w-full sm:w-auto"
                            />
                        </div>
                    )}
                </div>

                {/* Search */}
                <div className="relative w-full md:w-64">
                    <Search className="absolute left-4 top-3.5 text-slate-500" size={18} />
                    <input 
                        type="text" 
                        placeholder="Filtrar por nome..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-2xl pl-12 pr-4 py-3 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-slate-600 font-medium"
                    />
                </div>
            </div>

            {/* DYNAMIC METRICS BAR (Only shows if filter is active or range mode) */}
            <div className="px-6 py-4 bg-slate-900/50 border-b border-slate-700 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                    <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Total no Período</p>
                    <p className="text-white font-black text-lg">{formatCurrency(stats.total)}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-[9px] text-emerald-500 font-black uppercase tracking-widest">Recebido</p>
                    <p className="text-emerald-400 font-black text-lg">{formatCurrency(stats.paid)}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-[9px] text-amber-500 font-black uppercase tracking-widest">Pendente</p>
                    <p className="text-amber-400 font-black text-lg">{formatCurrency(stats.pending)}</p>
                </div>
                <div className="space-y-1 text-right">
                    <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Qtd. Títulos</p>
                    <p className="text-white font-black text-lg">{stats.count}</p>
                </div>
            </div>

            {/* Status Tabs (Big Pills) */}
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                    { id: 'all', label: 'Todos', count: counts.all, color: 'slate', icon: ListFilter },
                    { id: 'pending', label: 'A Vencer', count: counts.pending, color: 'sky', icon: Clock },
                    { id: 'overdue', label: 'Atrasados', count: counts.overdue, color: 'red', icon: AlertTriangle },
                    { id: 'paid', label: 'Pagos', count: counts.paid, color: 'emerald', icon: CheckCircle2 },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveStatus(tab.id as any)}
                        className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all relative overflow-hidden group ${
                            activeStatus === tab.id 
                                ? `bg-${tab.color}-900/30 border-${tab.color}-500/50 text-white shadow-lg` 
                                : 'bg-slate-900/50 border-slate-800 text-slate-500 hover:bg-slate-800'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-1 z-10">
                            <tab.icon size={14} className={activeStatus === tab.id ? `text-${tab.color}-400` : ''} />
                            <span className="text-[10px] font-black uppercase tracking-widest">{tab.label}</span>
                        </div>
                        <span className={`text-xl font-black z-10 ${activeStatus === tab.id ? `text-${tab.color}-400` : 'text-slate-400'}`}>
                            {tab.count}
                        </span>
                        {activeStatus === tab.id && (
                            <div className={`absolute bottom-0 left-0 w-full h-1 bg-${tab.color}-500`}></div>
                        )}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="overflow-x-auto min-h-[300px] border-t border-slate-700/50">
            <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-900/50 text-slate-400 font-black uppercase text-[10px] tracking-wider">
                <tr>
                    <th className="px-6 py-4">Data Venc.</th>
                    <th className="px-6 py-4">Contrato</th>
                    <th className="px-6 py-4">Parcela</th>
                    <th className="px-6 py-4 text-right">Valor</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30 text-slate-300">
                {filteredData.map((inst) => {
                    const isLate = isInstallmentOverdue(inst);
                    const outstanding = calculateOutstanding(inst);
                    const [year, month, day] = inst.due_date.split('-'); // ISO Date

                    return (
                    <tr key={inst.id} className="hover:bg-slate-700/20 transition-colors group">
                        <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center font-bold border ${isLate ? 'bg-red-900/20 border-red-500/30 text-red-400' : 'bg-slate-800 border-slate-700 text-white'}`}>
                                    <span className="text-sm leading-none">{day}</span>
                                </div>
                                <div>
                                    <span className="text-xs font-bold text-slate-300 block">{month}/{year}</span>
                                </div>
                            </div>
                        </td>
                        <td className="px-6 py-4">
                            <div className="text-xs font-bold text-white mb-0.5">{inst.investment?.asset_name || inst.contract_name || '---'}</div>
                            <div className="text-[10px] text-slate-500 uppercase">{inst.investment?.payer?.full_name || 'Cliente'}</div>
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-slate-400">#{inst.number}</td>
                        <td className="px-6 py-4 text-right font-mono font-bold text-slate-200">
                            {formatCurrency(Number(inst.amount_total))}
                            {outstanding > 0 && outstanding < inst.amount_total && (
                                <div className="text-[9px] text-amber-500 font-medium">Restam: {formatCurrency(outstanding)}</div>
                            )}
                        </td>
                        <td className="px-6 py-4 text-center">
                            {isLate ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider bg-red-900/20 text-red-400 border border-red-900/30 animate-pulse">
                                    <AlertTriangle size={10}/> Atrasado
                                </span>
                            ) : inst.status === 'paid' ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider bg-green-900/20 text-green-400">
                                    <CheckCircle2 size={10}/> Pago
                                </span>
                            ) : inst.status === 'partial' ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider bg-amber-900/20 text-amber-400">
                                    <PieChart size={10}/> Parcial
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider bg-slate-700 text-slate-400">
                                    <Clock size={10}/> A Vencer
                                </span>
                            )}
                        </td>
                        <td className="px-6 py-4 text-right">
                           <div className="flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                {inst.status !== 'paid' && (
                                    <>
                                        <button onClick={() => handleAction('pay', inst)} className="p-1.5 bg-emerald-900/30 text-emerald-400 rounded hover:bg-emerald-600 hover:text-white transition-colors" title="Baixar">
                                            <DollarSign size={14} />
                                        </button>
                                        <button onClick={() => handleAction('refinance', inst)} className="p-1.5 bg-purple-900/30 text-purple-400 rounded hover:bg-purple-600 hover:text-white transition-colors" title="Refinanciar">
                                            <RefreshCw size={14} />
                                        </button>
                                    </>
                                )}
                                <button onClick={() => handleAction('edit', inst)} className="p-1.5 bg-sky-900/30 text-sky-400 rounded hover:bg-sky-600 hover:text-white transition-colors" title="Editar">
                                    <Pencil size={14} />
                                </button>
                           </div>
                        </td>
                    </tr>
                    );
                })}
                {filteredData.length === 0 && (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500 text-xs uppercase font-bold">
                        {filterMode === 'range' && (!rangeStart || !rangeEnd) 
                            ? "Selecione as datas de início e fim para visualizar." 
                            : "Nenhum registro encontrado para este filtro."}
                    </td></tr>
                )}
                </tbody>
            </table>
            </div>
            
            {/* Footer Summary */}
            <div className="bg-slate-900/50 border-t border-slate-700 p-4 flex justify-between items-center text-xs">
                <span className="text-slate-500 font-bold uppercase tracking-wide">Total Visível ({filteredData.length})</span>
                <span className="text-white font-black text-sm">{formatCurrency(stats.total)}</span>
            </div>
        </div>
      </div>

      <PaymentModal 
        isOpen={modalType === 'pay'} 
        onClose={handleCloseModal} 
        onSuccess={handleSuccess} 
        installment={selectedInstallment}
        tenant={tenant}
      />
      <RefinanceModal isOpen={modalType === 'refinance'} onClose={handleCloseModal} onSuccess={handleSuccess} installment={selectedInstallment}/>
      <EditModal isOpen={modalType === 'edit'} onClose={handleCloseModal} onSuccess={handleSuccess} installment={selectedInstallment}/>
    </>
  );
};
