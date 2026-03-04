import React from 'react';
import { useInvestorMetrics } from '../hooks/useInvestorMetrics';
import { 
  Wallet, 
  TrendingUp, 
  Calendar, 
  MessageCircle, 
  PieChart, 
  ShieldCheck,
  Download,
  Activity,
  Info
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid
} from 'recharts';

const InvestorDashboard: React.FC = () => {
  const { metrics, investments, loading } = useInvestorMetrics();

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const getWhatsappLink = () => {
     return `https://wa.link/22e0gd`;
  };

  if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 animate-pulse">
            <Activity className="text-teal-500 w-12 h-12" />
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Carregando sua carteira...</p>
        </div>
      );
  }

  // EMPTY STATE
  if (investments.length === 0) {
      return (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 animate-fade-in">
              <div className="bg-slate-800 p-8 rounded-full mb-6 border border-slate-700 shadow-2xl">
                  <Wallet size={48} className="text-teal-500" />
              </div>
              <h1 className="text-3xl font-black text-white mb-2">Olá, {metrics.userName}!</h1>
              <p className="text-slate-400 max-w-md mb-8 leading-relaxed">
                  Sua conta foi criada com sucesso, mas você ainda não possui investimentos ativos. 
                  Fale com nosso time para realizar seu primeiro aporte.
              </p>
              <a 
                href={getWhatsappLink()} 
                target="_blank" 
                rel="noopener noreferrer"
                className="bg-teal-600 hover:bg-teal-500 text-white px-8 py-4 rounded-xl font-black uppercase tracking-widest flex items-center gap-3 transition-all shadow-lg hover:shadow-teal-900/40 hover:-translate-y-1"
              >
                  <MessageCircle size={20} /> Falar com Consultor
              </a>
          </div>
      );
  }

  return (
    <div className="space-y-6 md:space-y-8 animate-fade-in pb-12 max-w-7xl mx-auto">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-800">
          <div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Visão do Investidor</p>
              <h1 className="text-3xl font-black text-white">Olá, {metrics.userName} 👋</h1>
          </div>
          <a 
            href={getWhatsappLink()} 
            target="_blank" 
            rel="noopener noreferrer"
            className="bg-green-600 hover:bg-green-500 text-white px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-green-900/20"
          >
              <MessageCircle size={16} /> Falar com Consultor
          </a>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* PATRIMÔNIO */}
          <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 shadow-xl relative overflow-hidden">
              <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-teal-900/20 rounded-2xl text-teal-400">
                      <Wallet size={24} />
                  </div>
                  <span className="text-[10px] bg-slate-900 text-slate-500 px-2 py-1 rounded font-black uppercase">Principal</span>
              </div>
              <h3 className="text-2xl font-black text-white">{formatCurrency(metrics.totalAllocated)}</h3>
              <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Capital Alocado</p>
          </div>

          {/* RETORNO */}
          <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 shadow-xl relative overflow-hidden group">
              <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-emerald-900/20 rounded-2xl text-emerald-400">
                      <TrendingUp size={24} />
                  </div>
                  <div className="relative group/info">
                      <Info size={16} className="text-slate-600 cursor-help hover:text-slate-400 transition-colors" />
                      <div className="absolute right-0 top-6 w-48 bg-slate-950 border border-slate-700 p-3 rounded-xl text-[10px] text-slate-300 shadow-xl opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none z-10">
                          O lucro é contabilizado assim que as parcelas de juros são pagas pelo devedor (Regime de Caixa).
                      </div>
                  </div>
              </div>
              <h3 className="text-2xl font-black text-emerald-400">+{formatCurrency(metrics.totalProfit)}</h3>
              <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Lucro Realizado</p>
          </div>

          {/* PRÓXIMO PAGAMENTO */}
          <div data-testid="next-payment-card" className="bg-slate-800 p-6 rounded-3xl border border-slate-700 shadow-xl relative overflow-hidden">
              <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-blue-900/20 rounded-2xl text-blue-400">
                      <Calendar size={24} />
                  </div>
                  <span className="text-[10px] bg-slate-900 text-slate-500 px-2 py-1 rounded font-black uppercase">Previsão</span>
              </div>
              {metrics.nextPaymentDate ? (
                  <>
                    <h3 data-testid="next-payment-value" className="text-2xl font-black text-white">{formatCurrency(metrics.nextPaymentValue)}</h3>
                    <p data-testid="next-payment-date" className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
                        Receber em {metrics.nextPaymentDate}
                    </p>
                  </>
              ) : (
                  <>
                    <h3 className="text-xl font-black text-slate-500">---</h3>
                    <p className="text-slate-600 text-[10px] font-black uppercase tracking-widest mt-1">Sem pagamentos futuros</p>
                  </>
              )}
          </div>
      </div>

      {/* CHART & LIST */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* CHART */}
          <div className="lg:col-span-2 bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-700 shadow-xl flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                  <PieChart size={20} className="text-teal-400"/>
                  <h4 className="text-sm font-black text-white uppercase tracking-widest">Fluxo de Recebimentos</h4>
              </div>
              <div className="flex-1 min-h-[300px] w-full">
                  <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={metrics.chartData} barSize={32}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                          <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: '#64748b', fontSize: 11, fontWeight: 'bold'}} 
                          />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{fill: '#64748b', fontSize: 11}} 
                            tickFormatter={(val) => `R$${val >= 1000 ? (val/1000).toFixed(0) + 'k' : val}`}
                            domain={[0, 'auto']} 
                          />
                          <Tooltip 
                            cursor={{fill: '#1e293b'}}
                            contentStyle={{backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px'}} 
                            itemStyle={{fontSize: '12px', fontWeight: 'bold'}}
                            formatter={(value: number, name: string) => [formatCurrency(value), name === 'projected' ? 'Projetado' : 'Recebido']}
                            labelStyle={{color: '#94a3b8', marginBottom: '4px', fontWeight: 'bold'}}
                          />
                          <Bar dataKey="projected" name="Projetado" fill="#334155" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="received" name="Recebido" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                  </ResponsiveContainer>
              </div>
          </div>

          {/* ASSET LIST (Mini Table) */}
          <div className="bg-slate-800 rounded-3xl border border-slate-700 shadow-xl overflow-hidden flex flex-col">
               <div className="p-6 border-b border-slate-700 bg-slate-800/50">
                    <h4 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                        <ShieldCheck size={18} className="text-teal-400" /> Meus Ativos
                    </h4>
               </div>
               <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                   {investments.map(inv => (
                       <div data-testid="investment-item" key={inv.id} className="p-4 hover:bg-slate-700/30 rounded-2xl transition-colors mb-2 last:mb-0 border border-transparent hover:border-slate-700">
                           <div className="flex justify-between items-center mb-3">
                               <div className="flex items-center gap-2">
                                   {/* Status Indicator */}
                                   <div data-testid="health-badge" className={`w-2 h-2 rounded-full ${
                                       inv.healthStatus === 'ok' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
                                       inv.healthStatus === 'late' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-pulse' :
                                       inv.healthStatus === 'waiting' ? 'bg-amber-500' :
                                       'bg-slate-500'
                                   }`} title={inv.healthStatus === 'ok' ? 'Em dia' : inv.healthStatus === 'late' ? 'Atenção' : 'Finalizado'}></div>
                                   
                                   <div>
                                       <div className="font-bold text-white text-sm leading-tight">{inv.asset_name}</div>
                                       <div className="text-[10px] text-slate-500 font-mono uppercase mt-0.5">{inv.type}</div>
                                   </div>
                               </div>
                               <div className="bg-slate-900 text-teal-400 text-[10px] font-black px-2 py-1 rounded uppercase border border-slate-700">
                                   {inv.interest_rate}% a.m.
                               </div>
                           </div>
                           
                           <div className="flex justify-between items-end border-t border-slate-700/50 pt-3">
                               <div>
                                   <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wide mb-0.5">Valor Investido</div>
                                   <div className="flex items-center gap-2">
                                       <span className="text-slate-300 font-mono font-bold text-xs">{formatCurrency(Number(inv.amount_invested))}</span>
                                       {inv.roi > 0 && (
                                            <span className="text-[9px] bg-emerald-900/30 text-emerald-400 px-1.5 py-0.5 rounded font-black">
                                                +{inv.roi.toFixed(0)}% ROI
                                            </span>
                                       )}
                                   </div>
                               </div>
                               <div className="text-right">
                                   <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wide mb-0.5">Total a Receber</div>
                                   <div className="text-white font-black text-sm">{formatCurrency(Number(inv.current_value))}</div>
                               </div>
                           </div>
                       </div>
                   ))}
               </div>
               <div className="p-4 border-t border-slate-700 bg-slate-900/30 text-center">
                   <button className="text-slate-500 hover:text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-colors">
                       <Download size={14}/> Baixar Extrato Consolidado
                   </button>
               </div>
          </div>
      </div>
    </div>
  );
};

export default InvestorDashboard;