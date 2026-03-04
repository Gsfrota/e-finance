
import React, { useEffect, useState } from 'react';
import { getSupabase } from '../services/supabase';
import { Profile, Investment, LoanInstallment, InvestorBalanceView, Tenant } from '../types';
import InstallmentRowActions from './InstallmentRowActions';
import { PaymentModal, RefinanceModal, EditModal } from './InstallmentModals';
import { 
  ArrowLeft, 
  User, 
  Wallet, 
  ChevronDown, 
  CheckCircle2, 
  Clock, 
  AlertTriangle,
  TrendingUp,
  Briefcase
} from 'lucide-react';

interface AdminUserDetailsProps {
  userId: string;
  onBack: () => void;
}

// Deduplicate Logic (Copied for isolation)
const deduplicateInstallments = (list: any[]) => {
  const map = new Map<string, any>();
  list.forEach(inst => {
    const key = `${inst.investment_id}-${inst.number}`;
    if (map.has(key)) {
      const existing = map.get(key);
      if (existing.status !== 'paid' && inst.status === 'paid') {
        map.set(key, inst);
      } 
      else if (existing.status !== 'paid' && existing.status !== 'partial' && inst.status === 'partial') {
        map.set(key, inst);
      }
      else if (existing.status === inst.status) {
        if (inst.created_at && existing.created_at) {
            if (new Date(inst.created_at).getTime() > new Date(existing.created_at).getTime()) {
                map.set(key, inst);
            }
        }
      }
    } else {
      map.set(key, inst);
    }
  });
  return Array.from(map.values());
};

const AdminUserDetails: React.FC<AdminUserDetailsProps> = ({ userId, onBack }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null); // Store tenant for receipts
  const [balanceView, setBalanceView] = useState<InvestorBalanceView | null>(null);
  const [contracts, setContracts] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedContractId, setExpandedContractId] = useState<number | null>(null);

  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isRefinanceModalOpen, setIsRefinanceModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const [stats, setStats] = useState({
    totalLoaned: 0,
    totalPaid: 0,
    balance: 0,
    defaultRate: 0,
    trustScore: 'B'
  });

  const fetchData = async () => {
    setLoading(true);
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      // 1. Fetch Profile and Related Tenant
      const { data: prof } = await supabase
        .from('profiles')
        .select(`
            *,
            tenants!profiles_tenant_id_fkey(*)
        `)
        .eq('id', userId)
        .single();
      
      setProfile(prof);
      setTenant(prof.tenants as any);

      // Fetch Wealth View (Only if Investor/Admin)
      if (prof.role === 'investor' || prof.role === 'admin') {
          const { data: wealthData } = await supabase
              .from('view_investor_balances')
              .select('*')
              .eq('profile_id', userId)
              .maybeSingle();
          if (wealthData) setBalanceView(wealthData);
      }

      const { data: invs, error } = await supabase
        .from('investments')
        .select(`
            *,
            loan_installments (
                *
            )
        `)
        .eq('payer_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      let tLoaned = 0;
      let tPaid = 0;
      let totalInst = 0;
      let lateInst = 0;

      const processedContracts = (invs || []).map((inv: any) => {
          tLoaned += Number(inv.current_value || 0);
          
          // Deduplicate first
          const uniqueInstallments = deduplicateInstallments(inv.loan_installments || []);

          const sortedInstallments = uniqueInstallments.sort((a: any, b: any) => 
            new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
          );

          sortedInstallments.forEach((inst: LoanInstallment) => {
              tPaid += Number(inst.amount_paid || 0);
              totalInst++;
              if (inst.status !== 'paid' && new Date(inst.due_date + 'T12:00:00') < new Date()) lateInst++;
          });

          return { ...inv, loan_installments: sortedInstallments };
      });

      setContracts(processedContracts);
      
      const balance = Math.max(0, tLoaned - tPaid);
      const rate = totalInst > 0 ? (lateInst / totalInst) * 100 : 0;
      
      let score = 'S';
      if (rate > 50) score = 'D';
      else if (rate > 20) score = 'C';
      else if (rate > 5) score = 'B';
      else if (rate > 0) score = 'A';

      setStats({
          totalLoaned: tLoaned,
          totalPaid: tPaid,
          balance,
          defaultRate: rate,
          trustScore: score
      });

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [userId]);

  const toggleContract = (id: number) => {
      setExpandedContractId(prev => prev === id ? null : id);
  };

  const handleOpenPay = (inst: LoanInstallment) => {
    setSelectedInstallment(inst);
    setIsPayModalOpen(true);
  };

  const handleOpenRefinance = (inst: LoanInstallment) => {
    setSelectedInstallment(inst);
    setIsRefinanceModalOpen(true);
  };

  const handleOpenEdit = (inst: LoanInstallment) => {
    setSelectedInstallment(inst);
    setIsEditModalOpen(true);
  };

  const handleActionSuccess = () => {
    fetchData(); 
  };

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const formatDate = (dateStr: string) => {
      if (!dateStr) return '--';
      if (dateStr.includes('T') || dateStr.includes(':')) {
          return new Date(dateStr).toLocaleDateString('pt-BR');
      }
      return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR');
  };

  if (loading) return (
      <div className="flex justify-center items-center h-full text-teal-500 animate-pulse">
          <Clock size={32}/> <span className="ml-3 font-bold uppercase tracking-widest">Carregando Auditoria...</span>
      </div>
  );

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-4 group">
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform"/> Voltar para Usuários
      </button>

      {/* 1. HERO PROFILE */}
      <div className="bg-slate-800 rounded-[2.5rem] border border-slate-700 p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/5 rounded-full blur-3xl -mr-12 -mt-12 pointer-events-none"></div>
          
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 relative z-10">
              <div className="flex items-center gap-6">
                  <div className="w-20 h-20 bg-slate-700 rounded-3xl flex items-center justify-center border-2 border-slate-600 shadow-lg">
                      <User size={32} className="text-slate-300"/>
                  </div>
                  <div>
                      <h1 className="text-2xl font-black text-white">{profile?.full_name}</h1>
                      <div className="flex items-center gap-4 mt-2 text-sm">
                          <span className="text-slate-400 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-700">CPF: {profile?.cpf || '---'}</span>
                          <span className="text-slate-500">{profile?.email}</span>
                      </div>
                      <div className="mt-3 inline-flex items-center gap-2 bg-slate-900/50 border border-slate-700 px-3 py-1 rounded-full">
                          <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Trust Score</span>
                          <span className={`text-xs font-black px-1.5 py-0.5 rounded ${
                              stats.trustScore === 'S' || stats.trustScore === 'A' ? 'bg-teal-500 text-white' :
                              stats.trustScore === 'B' ? 'bg-blue-500 text-white' :
                              'bg-red-500 text-white'
                          }`}>{stats.trustScore}</span>
                      </div>
                  </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full lg:w-auto">
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Total Tomado</p>
                      <p className="text-white font-black text-lg">{formatCurrency(stats.totalLoaned)}</p>
                  </div>
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Pago</p>
                      <p className="text-teal-400 font-black text-lg">{formatCurrency(stats.totalPaid)}</p>
                  </div>
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Em Aberto</p>
                      <p className="text-white font-black text-lg">{formatCurrency(stats.balance)}</p>
                  </div>
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Inadimplência</p>
                      <p className={`${stats.defaultRate > 0 ? 'text-red-400' : 'text-green-400'} font-black text-lg`}>{stats.defaultRate.toFixed(1)}%</p>
                  </div>
              </div>
          </div>
      </div>

      {/* 2. WEALTH SUMMARY (INVESTOR ONLY) */}
      {balanceView && (
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-[2.5rem] border border-slate-700 shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-emerald-900/30 rounded-xl text-emerald-400">
                      <TrendingUp size={20}/>
                  </div>
                  <div>
                      <h3 className="text-sm font-black text-white uppercase tracking-widest">Resumo de Riqueza</h3>
                      <p className="text-[10px] text-slate-500 font-bold">Origem e Destino do Capital</p>
                  </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Capital Próprio */}
                  <div className="bg-slate-950/50 rounded-2xl p-5 border border-slate-800 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                          <Briefcase size={40} className="text-slate-400"/>
                      </div>
                      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-2">Total Aportado (Bolso)</p>
                      <p className="text-2xl font-black text-white">{formatCurrency(balanceView.total_own_capital)}</p>
                  </div>

                  {/* Lucro Reinvestido */}
                  <div className="bg-slate-950/50 rounded-2xl p-5 border border-slate-800 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                          <TrendingUp size={40} className="text-emerald-400"/>
                      </div>
                      <p className="text-[10px] text-emerald-400/80 font-black uppercase tracking-widest mb-2">Lucro Reinvestido</p>
                      <p className="text-2xl font-black text-emerald-400">{formatCurrency(balanceView.total_profit_reinvested)}</p>
                      <p className="text-[9px] text-slate-500 mt-1">Dinheiro gerado que voltou para a rua</p>
                  </div>

                  {/* Saldo Líquido */}
                  <div className="bg-emerald-900/10 rounded-2xl p-5 border border-emerald-900/30 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                          <Wallet size={40} className="text-emerald-300"/>
                      </div>
                      <p className="text-[10px] text-emerald-300 font-black uppercase tracking-widest mb-2">Disponível em Caixa</p>
                      <p className="text-2xl font-black text-white">{formatCurrency(balanceView.available_profit_balance)}</p>
                      <p className="text-[9px] text-emerald-500/70 mt-1 font-bold">Pode ser usado para novos contratos</p>
                  </div>
              </div>
          </div>
      )}

      {/* 3. CONTRACTS LIST */}
      <div className="space-y-4">
          <h2 className="text-xl font-black text-white uppercase tracking-tighter pl-2 flex items-center gap-2">
              <Wallet className="text-teal-500" size={24}/> Contratos Ativos
          </h2>

          {contracts.length === 0 ? (
              <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 text-center text-slate-500 font-bold">
                  Nenhum contrato encontrado para este usuário.
              </div>
          ) : (
              contracts.map(contract => (
                  <div key={contract.id} className="bg-slate-800 border border-slate-700 rounded-3xl overflow-hidden shadow-lg">
                      {/* Accordion Header */}
                      <div 
                        onClick={() => toggleContract(contract.id)}
                        className="p-6 cursor-pointer hover:bg-slate-700/30 transition-colors flex justify-between items-center"
                      >
                          <div>
                              <div className="flex items-center gap-3">
                                  <h3 className="text-lg font-black text-white">{contract.asset_name}</h3>
                                  <span className="text-[10px] bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-700 font-black uppercase">{contract.type}</span>
                              </div>
                              <p className="text-xs text-slate-500 font-medium mt-1">
                                  Contrato #{contract.id} • Criado em {formatDate(contract.created_at)}
                              </p>
                          </div>
                          <div className="flex items-center gap-6">
                              <div className="text-right hidden sm:block">
                                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Valor do Contrato</p>
                                  <p className="text-white font-black">{formatCurrency(Number(contract.current_value))}</p>
                              </div>
                              <div className={`p-2 rounded-full bg-slate-900 text-slate-400 transition-transform ${expandedContractId === contract.id ? 'rotate-180' : ''}`}>
                                  <ChevronDown size={20}/>
                              </div>
                          </div>
                      </div>

                      {expandedContractId === contract.id && (
                          <div className="border-t border-slate-700/50 bg-slate-900/30 p-4">
                              <div className="overflow-x-auto rounded-2xl border border-slate-700/50">
                                  <table className="w-full text-left text-sm whitespace-nowrap bg-slate-800/50">
                                      <thead>
                                          <tr className="bg-slate-900 text-slate-500 text-[10px] font-black uppercase tracking-[0.2em]">
                                              <th className="px-6 py-4">#</th>
                                              <th className="px-6 py-4">Vencimento</th>
                                              <th className="px-6 py-4 text-right">Valor Original</th>
                                              <th className="px-6 py-4 text-right">Multa / Juros</th>
                                              <th className="px-6 py-4 text-right">Total</th>
                                              <th className="px-6 py-4 text-center">Status</th>
                                              <th className="px-6 py-4 text-right">Ações</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-700/30">
                                          {contract.loan_installments?.map(inst => {
                                              const isLate = inst.status !== 'paid' && new Date(inst.due_date + 'T12:00:00') < new Date();
                                              const hasFine = (Number(inst.fine_amount) + Number(inst.interest_delay_amount)) > 0;

                                              return (
                                                  <tr key={inst.id} className="hover:bg-slate-700/20 transition-colors relative">
                                                      <td className="px-6 py-4 text-slate-400 font-mono text-xs">{inst.number}</td>
                                                      <td className={`px-6 py-4 font-bold text-xs ${isLate ? 'text-red-400' : 'text-slate-300'}`}>
                                                          {formatDate(inst.due_date)}
                                                      </td>
                                                      <td className="px-6 py-4 text-right text-slate-400 font-mono text-xs">
                                                          {formatCurrency(Number(inst.amount_principal) + Number(inst.amount_interest))}
                                                      </td>
                                                      <td className="px-6 py-4 text-right">
                                                          {hasFine ? (
                                                              <span className="text-red-400 font-bold text-xs">
                                                                  +{formatCurrency(Number(inst.fine_amount) + Number(inst.interest_delay_amount))}
                                                              </span>
                                                          ) : (
                                                              <span className="text-slate-600 text-[10px]">-</span>
                                                          )}
                                                      </td>
                                                      <td className="px-6 py-4 text-right font-black text-white">
                                                          {formatCurrency(Number(inst.amount_total))}
                                                      </td>
                                                      <td className="px-6 py-4 text-center">
                                                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                                                              inst.status === 'paid' ? 'bg-green-900/20 border-green-900/50 text-green-400' :
                                                              isLate ? 'bg-red-900/20 border-red-900/50 text-red-400' :
                                                              'bg-slate-700/50 border-slate-600 text-slate-300'
                                                          }`}>
                                                              {inst.status === 'paid' ? <CheckCircle2 size={12}/> : isLate ? <AlertTriangle size={12}/> : <Clock size={12}/>}
                                                              {inst.status === 'paid' ? 'Pago' : isLate ? 'Atrasado' : 'A Vencer'}
                                                          </span>
                                                      </td>
                                                      <td className="px-6 py-4 text-right">
                                                          <InstallmentRowActions 
                                                              installment={inst}
                                                              onPay={handleOpenPay}
                                                              onRefinance={handleOpenRefinance}
                                                              onEdit={handleOpenEdit}
                                                          />
                                                      </td>
                                                  </tr>
                                              );
                                          })}
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      )}
                  </div>
              ))
          )}
      </div>

      <PaymentModal 
        isOpen={isPayModalOpen} 
        onClose={() => setIsPayModalOpen(false)} 
        onSuccess={handleActionSuccess} 
        installment={selectedInstallment}
        tenant={tenant}
        payerName={profile?.full_name}
      />

      <RefinanceModal 
        isOpen={isRefinanceModalOpen} 
        onClose={() => setIsRefinanceModalOpen(false)} 
        onSuccess={handleActionSuccess} 
        installment={selectedInstallment} 
      />

      <EditModal 
        isOpen={isEditModalOpen} 
        onClose={() => setIsEditModalOpen(false)} 
        onSuccess={handleActionSuccess} 
        installment={selectedInstallment} 
      />

    </div>
  );
};

export default AdminUserDetails;
