import React, { useState } from 'react';
import { useDebtorFinance, DebtorContract } from '../hooks/useDebtorFinance';
import PaymentModal from './PaymentModal';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Calendar, 
  ChevronDown,
  ChevronUp,
  CreditCard,
  MessageCircle,
  QrCode,
  ShieldCheck,
  Package
} from 'lucide-react';

const DebtorDashboard: React.FC = () => {
  const { metrics, loading } = useDebtorFinance();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<any>(null);
  
  // Accordion State: Track which contract ID is expanded
  const [expandedContractId, setExpandedContractId] = useState<number | null>(null);

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const formatDate = (dateStr: string) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

  const fmtWeekday = (dateStr: string) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });

  const handlePay = (installment: any) => {
      setSelectedInstallment(installment);
      setIsModalOpen(true);
  };

  const toggleAccordion = (id: number) => {
      setExpandedContractId(prev => prev === id ? null : id);
  };

  if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 animate-pulse">
            <CreditCard className="text-teal-500 w-12 h-12" />
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Carregando seus contratos...</p>
        </div>
      );
  }

  // EMPTY STATE
  if (metrics.contracts.length === 0) {
      return (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 animate-fade-in">
              <div className="bg-slate-800 p-8 rounded-full mb-6 border border-slate-700 shadow-2xl">
                  <ShieldCheck size={48} className="text-teal-500" />
              </div>
              <h1 className="text-3xl font-black text-white mb-2">Tudo Limpo!</h1>
              <p className="text-slate-400 max-w-md mb-8 leading-relaxed">
                  Você não possui pendências ou contratos ativos no momento.
              </p>
          </div>
      );
  }

  return (
    <div className="space-y-8 animate-fade-in pb-24 md:pb-12 max-w-5xl mx-auto relative">
      
      {/* 1. HERO STATUS SECTION */}
      <div
        data-testid={metrics.hasLatePayment ? 'late-payment-alert' : 'status-hero'}
        className={`p-6 md:p-8 rounded-[2.5rem] border shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden transition-all duration-500 ${
          metrics.hasLatePayment
            ? 'bg-red-900/20 border-red-500/30 shadow-red-900/20'
            : 'bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 shadow-teal-900/10'
      }`}>
          {/* Background Decor */}
          <div className={`absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none -mr-16 -mt-16 ${metrics.hasLatePayment ? 'bg-red-600' : 'bg-teal-600'}`}></div>

          <div className="relative z-10 text-center md:text-left">
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest mb-3 ${
                  metrics.hasLatePayment ? 'bg-red-500 text-white' : 'bg-teal-500 text-white'
              }`}>
                  {metrics.hasLatePayment ? <AlertTriangle size={12}/> : <CheckCircle2 size={12}/>}
                  {metrics.hasLatePayment ? 'Atenção Necessária' : 'Situação Regular'}
              </div>
              <h1 className="text-3xl md:text-4xl font-black text-white mb-2">Olá, {metrics.userName}</h1>
              <p className={`text-sm font-medium max-w-lg ${metrics.hasLatePayment ? 'text-red-200' : 'text-slate-400'}`}>
                  {metrics.hasLatePayment 
                    ? 'Identificamos pagamentos pendentes. Selecione o contrato abaixo para regularizar.' 
                    : 'Seus pagamentos estão em dia. Seu score financeiro está excelente!'}
              </p>
          </div>

          {/* NEXT PAYMENT HIGHLIGHT CARD */}
          {metrics.nextPayment && (
              <div data-testid="next-payment-card" className="relative z-10 bg-slate-950/60 backdrop-blur-md border border-white/10 p-6 rounded-3xl w-full md:w-80 shadow-lg transform hover:scale-[1.02] transition-transform">
                  <div className="flex justify-between items-start mb-4">
                      <div>
                          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">Próximo Vencimento</p>
                          <div className="flex items-center gap-2 text-white font-bold text-sm">
                              <Calendar size={14} className="text-teal-400"/> {formatDate(metrics.nextPayment.due_date)}
                          </div>
                          <div className="text-[10px] text-slate-500 capitalize mt-0.5">
                              {fmtWeekday(metrics.nextPayment.due_date)}
                          </div>
                      </div>
                      {metrics.nextPayment.is_late && (
                          <span className="bg-red-500 text-white text-[9px] font-black px-2 py-1 rounded uppercase animate-pulse">Atrasado</span>
                      )}
                  </div>
                  <div className="mb-6">
                      <span className="text-3xl font-black text-white block">{formatCurrency(metrics.nextPayment.amount_total)}</span>
                      <span className="text-[10px] text-slate-500 font-mono uppercase truncate block">{metrics.nextPayment.contract_name}</span>
                  </div>
                  <button
                    onClick={() => handlePay(metrics.nextPayment)}
                    className={`w-full min-h-[44px] py-3 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 ${
                        metrics.nextPayment.is_late 
                            ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/30' 
                            : 'bg-teal-600 hover:bg-teal-500 text-white shadow-teal-900/30'
                    }`}
                  >
                      <QrCode size={16}/> Pagar Agora
                  </button>
              </div>
          )}
      </div>

      {/* 2. CONTRACTS LIST (Accordion) */}
      <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
              <Package className="text-slate-500" size={20} />
              <h3 className="text-lg font-black text-white uppercase tracking-tighter">Meus Contratos Ativos</h3>
          </div>

          {metrics.contracts.map((contract) => {
              const isOpen = expandedContractId === contract.id;
              
              return (
                  <div data-testid="contract-item" key={contract.id} className={`bg-slate-800 rounded-[2rem] border transition-all duration-300 overflow-hidden ${
                      contract.status === 'late' ? 'border-red-900/50 shadow-red-900/10 hover:border-red-700/60' : 'border-slate-700 shadow-lg hover:border-slate-500'
                  }`}>
                      
                      {/* HEADER (Clickable) */}
                      <div 
                        onClick={() => toggleAccordion(contract.id)}
                        className="p-6 md:p-8 cursor-pointer hover:bg-slate-700/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-6"
                      >
                          <div className="flex items-start gap-4">
                              <div className={`p-3 rounded-2xl ${contract.status === 'late' ? 'bg-red-900/20 text-red-400' : 'bg-teal-900/20 text-teal-400'}`}>
                                  <ShieldCheck size={24} />
                              </div>
                              <div>
                                  <h4 className="text-lg font-black text-white">{contract.asset_name}</h4>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-[10px] px-2 py-0.5 rounded font-black uppercase tracking-widest ${
                                        contract.status === 'late' ? 'bg-red-500/20 text-red-300' : 
                                        contract.status === 'finished' ? 'bg-green-500/20 text-green-300' : 'bg-teal-500/20 text-teal-300'
                                    }`}>
                                        {contract.status === 'late' ? 'Pagamento Pendente' : contract.status === 'finished' ? 'Quitado' : 'Em Dia'}
                                    </span>
                                  </div>
                              </div>
                          </div>

                          <div className="flex items-center gap-6 justify-between md:justify-end w-full md:w-auto">
                              <div className="text-right">
                                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">Saldo Devedor</p>
                                  <p className="text-xl font-black text-white">{formatCurrency(contract.balance)}</p>
                              </div>
                              
                              {/* Desktop Progress Bar */}
                              <div className="hidden md:block w-32">
                                   <div className="flex justify-between text-[9px] text-slate-500 font-bold mb-1 uppercase">
                                       <span>Progresso</span>
                                       <span>{contract.progress.toFixed(0)}%</span>
                                   </div>
                                   <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                                       <div 
                                        className={`h-full rounded-full ${contract.status === 'late' ? 'bg-red-500' : 'bg-teal-500'}`} 
                                        style={{width: `${contract.progress}%`}}
                                       ></div>
                                   </div>
                              </div>

                              <div className={`p-2 rounded-full bg-slate-900 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                                  <ChevronDown size={20} />
                              </div>
                          </div>
                      </div>

                      {/* BODY (Installments List) */}
                      {isOpen && (
                          <div className="max-h-[60vh] overflow-y-auto border-t border-slate-700/50 bg-slate-900/30 p-4 animate-fade-in-down md:p-6">
                              <div className="overflow-x-auto">
                                  <table className="w-full text-left text-sm whitespace-nowrap">
                                      <thead>
                                          <tr className="text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-700/50">
                                              <th className="pb-3 pl-4">Vencimento</th>
                                              <th className="pb-3 text-right">Valor</th>
                                              <th className="pb-3 text-center hidden sm:table-cell">Status</th>
                                              <th className="pb-3 pr-4 text-right">Ação</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-700/30">
                                          {contract.installments.map(inst => (
                                              <tr data-testid="installment-row" key={inst.id} className="hover:bg-slate-800/50 transition-colors">
                                                  <td className="py-4 pl-4">
                                                      <div className="flex flex-col">
                                                          <span className="text-[10px] text-slate-500 capitalize">{fmtWeekday(inst.due_date)}</span>
                                                          <span className={`font-bold font-mono ${inst.is_late ? 'text-red-400' : 'text-slate-300'}`}>
                                                              {formatDate(inst.due_date)}
                                                          </span>
                                                          <span className="text-[10px] text-slate-600 uppercase">Parc. {inst.number}</span>
                                                      </div>
                                                  </td>
                                                  <td className="py-4 text-right">
                                                      <span className="font-black text-white">{formatCurrency(inst.amount_total)}</span>
                                                  </td>
                                                  <td className="py-4 text-center hidden sm:table-cell">
                                                      {inst.status === 'paid' ? (
                                                          <span data-testid="installment-status" className="text-green-400 text-[10px] font-bold uppercase flex items-center justify-center gap-1"><CheckCircle2 size={12}/> Pago</span>
                                                      ) : inst.is_late ? (
                                                          <span data-testid="installment-status" className="text-red-400 text-[10px] font-bold uppercase flex items-center justify-center gap-1"><AlertTriangle size={12}/> Atrasado</span>
                                                      ) : (
                                                          <span data-testid="installment-status" className="text-slate-500 text-[10px] font-bold uppercase">A Vencer</span>
                                                      )}
                                                  </td>
                                                  <td className="py-4 pr-4 text-right">
                                                      {inst.status !== 'paid' && (
                                                          <button
                                                            data-testid="pay-btn"
                                                            onClick={() => handlePay(inst)}
                                                            className={`min-h-[44px] px-4 py-2 rounded-lg text-[10px] font-black uppercase flex items-center gap-2 float-right transition-all ${
                                                                inst.is_late
                                                                    ? 'bg-red-900/20 text-red-300 hover:bg-red-900/40 border border-red-900/50'
                                                                    : 'bg-teal-900/20 text-teal-300 hover:bg-teal-900/40 border border-teal-900/50'
                                                            }`}
                                                          >
                                                              <QrCode size={12}/> Pagar
                                                          </button>
                                                      )}
                                                  </td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      )}
                  </div>
              );
          })}
      </div>

      {/* FLOATING WHATSAPP BUTTON */}
      <a 
         href="https://wa.me/558431914090" 
         target="_blank" 
         rel="noopener noreferrer"
         className="fixed right-6 z-40 flex items-center justify-center rounded-full bg-green-600 p-4 text-white shadow-2xl shadow-green-900/50 transition-all hover:scale-110 hover:bg-green-500 [bottom:calc(1.5rem+env(safe-area-inset-bottom,0px))]"
         title="Falar com Suporte"
      >
          <MessageCircle size={24} />
      </a>

      <PaymentModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        installment={selectedInstallment}
        payerName={metrics.userName}
      />

    </div>
  );
};

export default DebtorDashboard;