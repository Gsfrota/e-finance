
import React, { useEffect, useState, useMemo } from 'react';
import { getSupabase, parseSupabaseError } from '../services/supabase';
import { Investment, Tenant, Profile } from '../types';
import QuickContractInput from './QuickContractInput';
import {
    Search, PlusCircle, CheckCircle2, X, RefreshCw,
    ArrowRight, Calendar, Zap, Wallet, ChevronRight,
    Minus, Plus, Banknote, Percent, CalendarDays,
    CalendarClock, UserPlus, Loader2, UserCog, ShieldCheck, Eye, ChevronDown, Coins, TrendingUp, Sparkles,
    Trash2, Pencil
} from 'lucide-react';

// --- PURE BUSINESS LOGIC (No React Dependencies) ---

const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const calculateInstallmentDates = (
    frequency: string, 
    dueDay: number, 
    weekday: number, 
    startDateStr: string, 
    count: number
): Date[] => {
    const dates: Date[] = [];
    const now = new Date();
    let cursorDate = new Date();

    if (frequency === 'monthly') {
        cursorDate.setDate(dueDay);
        if (now.getDate() >= dueDay) {
            cursorDate.setMonth(cursorDate.getMonth() + 1);
        }
    } else if (frequency === 'weekly') {
        const currentDay = now.getDay(); 
        let diff = weekday - currentDay;
        if (diff <= 0) diff += 7; 
        cursorDate.setDate(now.getDate() + diff);
    } else if (startDateStr) {
        const [y, m, d] = startDateStr.split('-').map(Number);
        cursorDate = new Date(y, m - 1, d);
    }

    for (let i = 0; i < count; i++) {
        const d = new Date(cursorDate);
        if (frequency === 'monthly') {
            d.setMonth(d.getMonth() + i);
            if (d.getDate() !== dueDay) d.setDate(0); 
        } else if (frequency === 'weekly') {
            d.setDate(d.getDate() + (i * 7));
        } else if (frequency === 'daily') {
            d.setDate(d.getDate() + i);
        }
        dates.push(d);
    }
    return dates;
};

const calculateFinancials = (
    amount: number, 
    installments: number, 
    rate: number, 
    mode: 'auto' | 'manual', 
    manualInstallmentValue: number
) => {
    const principal = Number(amount) || 0;
    const count = Math.max(1, Number(installments));

    if (principal <= 0) return { installmentValue: 0, totalValue: 0, interestRate: 0 };

    if (mode === 'auto') {
        const r = Number(rate) || 0;
        const total = principal * (1 + (r / 100));
        return {
            installmentValue: total / count,
            totalValue: total,
            interestRate: r
        };
    } else {
        const instVal = Number(manualInstallmentValue) || 0;
        const total = instVal * count;
        const impliedRate = ((total - principal) / principal) * 100;
        return {
            installmentValue: instVal,
            totalValue: total,
            interestRate: impliedRate
        };
    }
};

// --- SUB-COMPONENTS ---

const UserSelectionCard: React.FC<{
    label: string;
    role: 'investor' | 'payer';
    selectedProfile: Profile | null;
    profiles: Profile[];
    onSelect: (p: Profile) => void;
    onClear: () => void;
    onCreateNew?: () => void; 
    isDefault?: boolean;
}> = ({ label, role, selectedProfile, profiles, onSelect, onClear, onCreateNew, isDefault }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);

    const filtered = useMemo(() => {
        if (!searchTerm) return profiles;
        const lower = searchTerm.toLowerCase();
        return profiles.filter(p => 
            p.full_name.toLowerCase().includes(lower) || 
            p.email.toLowerCase().includes(lower)
        );
    }, [searchTerm, profiles]);

    if (selectedProfile) {
        return (
            <div className={`p-5 rounded-3xl border flex items-center justify-between animate-fade-in transition-all relative overflow-hidden group ${
                role === 'investor' 
                    ? 'bg-teal-950/30 border-teal-500/30 shadow-lg shadow-teal-900/10' 
                    : 'bg-indigo-950/30 border-indigo-500/30 shadow-lg shadow-indigo-900/10'
            }`}>
                {isDefault && (
                    <div className="absolute top-0 right-0 bg-teal-600 text-[9px] font-black uppercase px-3 py-1 rounded-bl-xl text-white shadow-md z-20">
                        Padrão
                    </div>
                )}
                <div className="flex items-center gap-4 relative z-10">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl border shadow-inner ${
                        role === 'investor' ? 'bg-teal-900/50 text-teal-400 border-teal-500/20' : 'bg-indigo-900/50 text-indigo-400 border-indigo-500/20'
                    }`}>
                        {selectedProfile.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${role === 'investor' ? 'text-teal-400' : 'text-indigo-400'}`}>
                            {label}
                        </p>
                        <div className="flex items-center gap-2">
                            <p className="text-white font-bold text-lg leading-none">{selectedProfile.full_name}</p>
                            {selectedProfile.role === 'admin' && (
                                <div className="bg-slate-800 p-1 rounded-md border border-slate-600" title="Administrador">
                                    <ShieldCheck size={12} className="text-teal-400"/>
                                </div>
                            )}
                        </div>
                        <p className="text-slate-500 text-xs mt-0.5 font-medium">{selectedProfile.email}</p>
                    </div>
                </div>
                <button onClick={onClear} className="p-3 bg-slate-900 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-all border border-slate-800 hover:border-slate-600 shadow-xl" title="Alterar">
                    {role === 'investor' ? <UserCog size={20}/> : <X size={20} />}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-between items-end px-1">
                <label className={`text-[10px] font-black uppercase tracking-widest ${role === 'investor' ? 'text-teal-500' : 'text-indigo-500'}`}>{label}</label>
                {onCreateNew && (
                    <button onClick={onCreateNew} className="text-[10px] font-bold text-teal-400 hover:text-teal-300 flex items-center gap-1.5 transition-colors bg-teal-950/50 px-3 py-1.5 rounded-lg border border-teal-900/50 hover:border-teal-500/50">
                        <PlusCircle size={12}/> Novo Cadastro
                    </button>
                )}
            </div>
            <div className="relative group">
                <Search className="absolute left-4 top-4 text-slate-500 group-focus-within:text-teal-500 transition-colors" size={20} />
                <input 
                    type="text" 
                    placeholder={role === 'investor' ? "Selecione o credor..." : "Busque ou selecione o cliente..."}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl pl-12 pr-10 p-4 text-sm text-white focus:border-slate-500 outline-none transition-all shadow-inner focus:ring-1 focus:ring-slate-700 cursor-pointer"
                    value={searchTerm}
                    onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 200)} 
                />
                <ChevronDown size={20} className={`absolute right-4 top-4 text-slate-500 transition-transform duration-300 pointer-events-none ${showDropdown ? 'rotate-180 text-teal-500' : ''}`} />
                {showDropdown && filtered.length > 0 && (
                    <div className="absolute top-full left-0 w-full mt-2 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fade-in-down max-h-60 overflow-y-auto custom-scrollbar">
                        {filtered.map(p => (
                            <button 
                                key={p.id} 
                                onClick={() => { onSelect(p); setSearchTerm(''); }}
                                className="w-full text-left p-4 hover:bg-slate-700/50 border-b border-slate-700/50 last:border-0 transition-colors flex items-center justify-between group/item"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-xs font-bold text-slate-400 border border-slate-700">
                                        {p.full_name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="text-white font-bold text-sm group-hover/item:text-teal-400 transition-colors">{p.full_name}</p>
                                        <p className="text-slate-500 text-[10px]">{p.email}</p>
                                    </div>
                                </div>
                                {p.role === 'admin' && <span className="text-[9px] bg-teal-950 text-teal-400 px-2 py-1 rounded font-black uppercase border border-teal-900">Admin</span>}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// --- MAIN COMPONENT ---

const AdminContracts: React.FC = () => {
  const [contracts, setContracts] = useState<Investment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isNLContractOpen, setIsNLContractOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [availableProfit, setAvailableProfit] = useState(0);

  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [newDebtorData, setNewDebtorData] = useState({ full_name: '', email: '' });
  const [quickCreateLoading, setQuickCreateLoading] = useState(false);

  const [formData, setFormData] = useState({
      asset_name: '',
      amount_invested: 0,
      total_installments: 12,
      frequency: 'monthly' as 'monthly' | 'weekly' | 'daily' | 'freelancer',
      due_day: 10,
      weekday: 1,
      start_date: new Date().toISOString().split('T')[0],
      interest_rate: 10,
      installment_value: 0, 
      current_value: 0,
      calculation_mode: 'auto' as 'auto' | 'manual',
      source_profit_amount: 0 
  });

  const [selectedInvestor, setSelectedInvestor] = useState<Profile | null>(null);
  const [selectedPayer, setSelectedPayer] = useState<Profile | null>(null);
  const [previewDateStrings, setPreviewDateStrings] = useState<string[]>([]);
  const [viewingContract, setViewingContract] = useState<Investment | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [contractToDelete, setContractToDelete] = useState<Investment | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [isEditContractOpen, setIsEditContractOpen] = useState(false);
  const [contractToEdit, setContractToEdit] = useState<Investment | null>(null);
  const [editContractName, setEditContractName] = useState('');
  const [editContractLoading, setEditContractLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        setCurrentUserId(user.id);
        
        const { data: profile } = await supabase
            .from('profiles')
            .select('*, tenants!profiles_tenant_id_fkey(*)')
            .eq('id', user.id)
            .single();
            
        if (!profile?.tenant_id) return;
        
        setCurrentTenant(profile.tenants as any);

        const { data: profData } = await supabase.from('profiles').select('*').eq('tenant_id', profile.tenant_id).order('full_name');
        
        let allProfiles = profData || [];
        if (profile && !allProfiles.find(p => p.id === profile.id)) {
            allProfiles = [profile, ...allProfiles];
        }
        setProfiles(allProfiles);

        const { data: invData } = await supabase.from('investments')
            .select(`*, investor:profiles!investments_user_id_fkey(full_name, email), payer:profiles!investments_payer_id_fkey(full_name, email)`)
            .eq('tenant_id', profile.tenant_id)
            .order('created_at', { ascending: false });

        setContracts((invData || []).map(i => ({
            ...i,
            investor_name: i.investor?.full_name || 'N/A',
            payer_name: i.payer?.full_name || 'N/A'
        })));

    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  // Effect: Fetch Profit Balance when Investor changes
  useEffect(() => {
    const fetchBalance = async () => {
        if (!selectedInvestor || !currentTenant) {
            setAvailableProfit(0);
            return;
        }
        const supabase = getSupabase();
        if (!supabase) return;

        // Use the VIEW for per-user balance precision
        const { data, error } = await supabase
            .from('view_investor_balances')
            .select('available_profit_balance')
            .eq('profile_id', selectedInvestor.id)
            .single();

        if (!error && data) {
            setAvailableProfit(Number(data.available_profit_balance) || 0);
        } else {
            // Fallback to 0 if no history
            setAvailableProfit(0);
        }
    };
    fetchBalance();
  }, [selectedInvestor, currentTenant]);

  const handleOpenWizard = async () => {
      const today = new Date();
      const nextMonth = new Date(today);
      nextMonth.setDate(today.getDate() + 1);

      setFormData({
          asset_name: '', 
          amount_invested: 0, 
          total_installments: 12, 
          frequency: 'monthly',
          due_day: 10, 
          weekday: 1, 
          start_date: nextMonth.toISOString().split('T')[0], 
          interest_rate: 10, 
          installment_value: 0, 
          current_value: 0, 
          calculation_mode: 'auto',
          source_profit_amount: 0
      });
      
      let defaultInvestor = null;
      if (currentUserId && profiles.length > 0) {
          defaultInvestor = profiles.find(p => p.id === currentUserId) || null;
      }
      if (!defaultInvestor && profiles.length > 0) {
          defaultInvestor = profiles.find(p => p.role === 'admin') || null;
      }
      
      setSelectedInvestor(defaultInvestor);
      setSelectedPayer(null);
      setPreviewDateStrings([]);
      setStep(1);
      setIsWizardOpen(true);
  };

  const updateFormState = (partial: Partial<typeof formData>) => {
      const merged = { ...formData, ...partial };
      const financial = calculateFinancials(
          merged.amount_invested,
          merged.total_installments,
          merged.interest_rate,
          merged.calculation_mode,
          merged.installment_value
      );

      // Validate Profit Amount against Balance and new Invested Amount
      let newProfitAmount = merged.source_profit_amount;
      
      // 1. Cannot exceed investment amount
      if (newProfitAmount > merged.amount_invested) {
          newProfitAmount = merged.amount_invested;
      }
      // 2. Cannot exceed available balance (Safety check in UI)
      if (newProfitAmount > availableProfit) {
          newProfitAmount = availableProfit;
      }

      setFormData(prev => ({
          ...prev,
          ...partial,
          source_profit_amount: newProfitAmount,
          installment_value: financial.installmentValue,
          current_value: financial.totalValue,
          interest_rate: financial.interestRate
      }));

      const dateObjects = calculateInstallmentDates(
          merged.frequency, 
          merged.due_day, 
          merged.weekday, 
          merged.start_date, 
          3 
      );
      setPreviewDateStrings(dateObjects.map(d => d.toLocaleDateString('pt-BR')));
  };

  const handleCreateContract = async () => {
      if (!selectedInvestor || !selectedPayer || !currentTenant) return;
      setWizardLoading(true);
      const supabase = getSupabase();
      if (!supabase) return;

      try {
          const { data: rpcData, error: rpcError } = await supabase.rpc('create_investment_validated', {
              p_tenant_id: currentTenant.id,
              p_user_id: selectedInvestor.id,
              p_payer_id: selectedPayer.id,
              p_asset_name: formData.asset_name || `Contrato ${selectedPayer.full_name.split(' ')[0]}`,
              p_amount_invested: formData.amount_invested,
              p_source_profit: formData.source_profit_amount, 
              p_current_value: formData.current_value,
              p_interest_rate: formData.interest_rate,
              p_installment_value: formData.installment_value,
              p_total_installments: formData.total_installments,
              p_frequency: formData.frequency,
              p_due_day: formData.frequency === 'monthly' ? formData.due_day : null,
              p_weekday: formData.frequency === 'weekly' ? formData.weekday : null,
              p_start_date: ['daily', 'freelancer'].includes(formData.frequency) ? formData.start_date : null,
              p_calculation_mode: formData.calculation_mode
          });

          if (rpcError) throw rpcError;
          
          // NOTE: Instalação automática via gatilho de banco de dados 'on_investment_created_generate_installments'
          // A criação manual de parcelas no frontend foi REMOVIDA para evitar duplicidade.

          setIsWizardOpen(false);
          fetchData(); 

      } catch (err: any) {
          alert(`Falha na criação: ${err.message}`);
      } finally {
          setWizardLoading(false);
      }
  };

  const handleQuickCreateDebtor = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newDebtorData.full_name || !newDebtorData.email || !currentTenant) return;
      
      setQuickCreateLoading(true);
      const supabase = getSupabase();
      if (!supabase) return;

      try {
          const newUserId = crypto.randomUUID();
          const now = new Date().toISOString();

          const { data, error } = await supabase.from('profiles').insert({
              id: newUserId,
              email: newDebtorData.email,
              full_name: newDebtorData.full_name,
              role: 'debtor',
              tenant_id: currentTenant.id,
              created_at: now,
              updated_at: now
          }).select().single();

          if (error) throw error;
          
          if (data) {
              setProfiles(prev => [...prev, data as Profile]);
              setSelectedPayer(data as Profile);
          }
          setIsQuickCreateOpen(false);
          setNewDebtorData({ full_name: '', email: '' });
      } catch (err: any) {
          alert(`Erro: ${parseSupabaseError(err)}`);
      } finally {
          setQuickCreateLoading(false);
      }
  };

  const handleDeleteContract = async () => {
      if (!contractToDelete) return;
      setDeleteLoading(true);
      const supabase = getSupabase();
      if (!supabase) return;
      try {
          const { error } = await supabase.from('investments').delete().eq('id', contractToDelete.id);
          if (error) throw error;
          setIsDeleteConfirmOpen(false);
          setContractToDelete(null);
          fetchData();
      } catch (err: any) {
          alert(`Erro ao excluir: ${parseSupabaseError(err)}`);
      } finally {
          setDeleteLoading(false);
      }
  };

  const handleEditContractSave = async () => {
      if (!contractToEdit || !editContractName.trim()) return;
      setEditContractLoading(true);
      const supabase = getSupabase();
      if (!supabase) return;
      try {
          const { error } = await supabase.from('investments')
              .update({ asset_name: editContractName.trim() })
              .eq('id', contractToEdit.id);
          if (error) throw error;
          setIsEditContractOpen(false);
          setContractToEdit(null);
          fetchData();
      } catch (err: any) {
          alert(`Erro ao salvar: ${parseSupabaseError(err)}`);
      } finally {
          setEditContractLoading(false);
      }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-12 w-full max-w-[100vw]">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-1">
        <div>
            <h2 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tighter">Contratos</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Gestão de Carteira</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
            <button onClick={() => setIsNLContractOpen(true)} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm tracking-wide shadow-lg transition-all hover:scale-105 active:scale-95 border border-slate-600">
                <Zap size={18} className="text-teal-400"/> Cadastro Rápido
            </button>
            <button onClick={handleOpenWizard} className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-3 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm tracking-wide shadow-lg hover:shadow-teal-500/20 transition-all hover:scale-105 active:scale-95">
                <PlusCircle size={18} /> Novo Contrato
            </button>
        </div>
      </div>
      
      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-teal-500 w-12" /></div>
      ) : contracts.length === 0 ? (
        <div className="text-center py-24 bg-slate-800 rounded-[2.5rem] border border-slate-700 border-dashed">
            <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center mx-auto mb-6">
                <Wallet size={32} className="text-slate-600"/>
            </div>
            <h3 className="text-white font-bold text-lg">Carteira Vazia</h3>
            <p className="text-slate-500 text-sm mt-2 max-w-xs mx-auto">Nenhum contrato ativo no momento. Inicie um novo empréstimo para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {contracts.map(contract => (
                <div key={contract.id} className="bg-slate-800 border border-slate-700 rounded-[2.5rem] p-8 shadow-lg hover:border-teal-500/30 transition-all relative group flex flex-col justify-between h-full">
                    <div>
                        <div className="flex justify-between items-start mb-6">
                            <div className="p-3 bg-slate-900 rounded-2xl text-teal-500 shadow-inner border border-slate-800"><Wallet size={24}/></div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => { setViewingContract(contract); setIsDetailsModalOpen(true); }} className="p-2 text-slate-500 hover:text-white bg-slate-900 hover:bg-slate-700 rounded-xl transition-all" title="Ver detalhes"><Eye size={18}/></button>
                                <button onClick={() => { setContractToEdit(contract); setEditContractName(contract.asset_name); setIsEditContractOpen(true); }} className="p-2 text-slate-500 hover:text-sky-400 bg-slate-900 hover:bg-sky-900/20 rounded-xl transition-all" title="Editar contrato"><Pencil size={18}/></button>
                                <button onClick={() => { setContractToDelete(contract); setIsDeleteConfirmOpen(true); }} className="p-2 text-slate-500 hover:text-red-400 bg-slate-900 hover:bg-red-900/20 rounded-xl transition-all" title="Excluir contrato"><Trash2 size={18}/></button>
                            </div>
                        </div>
                        <h3 className="text-white font-black text-xl truncate mb-1">{contract.asset_name}</h3>
                        <div className="flex items-center gap-2 mb-6">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            <p className="text-slate-400 text-xs font-bold uppercase tracking-wide">{contract.payer_name}</p>
                        </div>
                    </div>
                    
                    {/* Badge de Origem do Recurso */}
                    {(contract.source_profit || 0) > 0 && (
                        <div className="mb-4 bg-emerald-900/10 border border-emerald-900/30 p-2 rounded-xl flex items-center gap-2">
                            <div className="bg-emerald-900/30 p-1.5 rounded-lg text-emerald-400"><TrendingUp size={12}/></div>
                            <div className="flex flex-col">
                                <span className="text-[9px] font-black text-emerald-400 uppercase">
                                    {((contract.source_profit! / contract.amount_invested) * 100).toFixed(0)}% Reinvestido
                                </span>
                                {contract.source_capital! > 0 && (
                                    <span className="text-[8px] font-bold text-slate-500 uppercase">
                                        + {((contract.source_capital! / contract.amount_invested) * 100).toFixed(0)}% Aporte
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="pt-6 border-t border-slate-700/50">
                        <div className="flex justify-between items-end">
                            <div>
                                <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">Valor Total</p>
                                <p className="text-2xl font-black text-white">{formatCurrency(Number(contract.current_value))}</p>
                            </div>
                            <div className="text-right">
                                <span className="bg-slate-900 text-white px-3 py-1 rounded-lg text-xs font-bold border border-slate-700">
                                    {contract.total_installments}x
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      )}

      {/* --- WIZARD MODAL --- */}
      {isWizardOpen && (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/90 backdrop-blur-sm sm:p-4">
             <div className="bg-slate-800 border-t md:border border-slate-700 rounded-t-[3rem] md:rounded-[3rem] w-full max-w-lg shadow-2xl flex flex-col h-[95vh] md:h-auto md:max-h-[90vh] overflow-hidden animate-fade-in-up">
                
                <div className="px-8 py-6 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
                    <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                            Novo Contrato
                        </h3>
                        <div className="flex gap-1.5 mt-2">
                            {[1, 2, 3].map(i => (
                                <div key={i} className={`h-1.5 w-8 rounded-full transition-all duration-300 ${step >= i ? 'bg-teal-500' : 'bg-slate-700'}`}></div>
                            ))}
                        </div>
                    </div>
                    <button onClick={() => setIsWizardOpen(false)} className="p-3 hover:bg-slate-700 rounded-full transition-colors group">
                        <X className="text-slate-500 group-hover:text-white" size={24}/>
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar bg-slate-800">
                    
                    {step === 1 && (
                        <div className="space-y-8 animate-fade-in-right">
                            <div className="text-center mb-2">
                                <h3 className="text-2xl font-black text-white uppercase tracking-tight">Partes Envolvidas</h3>
                                <p className="text-slate-400 text-xs font-medium">Defina quem está emprestando e quem irá pagar.</p>
                            </div>
                            <UserSelectionCard 
                                label="Quem Empresta (Credor)"
                                role="investor" 
                                selectedProfile={selectedInvestor} 
                                profiles={profiles.filter(p => p.role === 'investor' || p.role === 'admin' || p.id === currentUserId)}
                                onSelect={setSelectedInvestor}
                                onClear={() => setSelectedInvestor(null)}
                                isDefault={selectedInvestor?.id === currentUserId}
                            />
                            <div className="flex justify-center -my-2 relative z-10">
                                <div className="bg-slate-800 p-2 rounded-full border border-slate-700 shadow-xl">
                                    <ArrowRight className="text-slate-500 rotate-90 md:rotate-0" size={24}/>
                                </div>
                            </div>
                            <UserSelectionCard 
                                label="Quem Paga (Tomador)" 
                                role="payer" 
                                selectedProfile={selectedPayer} 
                                profiles={profiles} 
                                onSelect={setSelectedPayer}
                                onClear={() => setSelectedPayer(null)}
                                onCreateNew={() => setIsQuickCreateOpen(true)}
                            />
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6 animate-fade-in-right pb-20">
                            <div className="text-center mb-4">
                                <h3 className="text-2xl font-black text-white uppercase tracking-tight">Termos Financeiros</h3>
                                <p className="text-slate-400 text-xs mt-1">Detalhes do fluxo de caixa e prazos.</p>
                            </div>

                            <div className="grid grid-cols-1 gap-6">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-500 ml-1 mb-1 block">Nome do Ativo</label>
                                    <input 
                                        type="text" 
                                        className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl p-4 text-white font-bold focus:border-teal-500 outline-none transition-all"
                                        placeholder={`Ex: Empréstimo ${selectedPayer?.full_name.split(' ')[0]}`}
                                        value={formData.asset_name}
                                        onChange={e => setFormData({...formData, asset_name: e.target.value})}
                                    />
                                </div>
                                
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-black uppercase text-slate-500 ml-1 mb-1 block">Valor Principal (Aporte)</label>
                                        <div className="relative group">
                                            <span className="absolute left-4 top-4 text-teal-500 font-bold group-focus-within:text-teal-400 transition-colors">R$</span>
                                            <input 
                                                type="number" inputMode="decimal" step="0.01"
                                                className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl pl-12 pr-4 py-4 text-2xl font-black text-white outline-none focus:border-teal-500 transition-all"
                                                value={formData.amount_invested || ''}
                                                onChange={e => updateFormState({ amount_invested: parseFloat(e.target.value) })}
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>

                                    {/* SLIDER DE FONTE DE RECURSOS */}
                                    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 relative overflow-hidden">
                                        {/* Background Decor */}
                                        <div className="absolute -right-4 -top-4 bg-emerald-500/10 w-24 h-24 rounded-full blur-2xl pointer-events-none"></div>

                                        <div className="flex justify-between items-center mb-4 relative z-10">
                                            <h4 className="text-[10px] font-black uppercase text-emerald-400 flex items-center gap-1.5">
                                                <Coins size={12}/> Fonte de Recursos
                                            </h4>
                                            <div className="text-[9px] text-slate-500 font-bold bg-slate-950 px-2 py-1 rounded border border-slate-800">
                                                Caixa Livre: <span className="text-emerald-400">{formatCurrency(availableProfit)}</span>
                                            </div>
                                        </div>

                                        <div className="space-y-4 relative z-10">
                                            <div>
                                                <div className="flex justify-between items-center text-xs mb-2">
                                                    <span className="text-emerald-400 font-bold">Usar Lucro Acumulado</span>
                                                    <span className="text-white font-black bg-emerald-900/30 px-2 py-0.5 rounded text-[10px]">{formatCurrency(formData.source_profit_amount)}</span>
                                                </div>
                                                <input 
                                                    type="range" 
                                                    min={0} 
                                                    max={Math.min(availableProfit, formData.amount_invested)} 
                                                    step={0.01}
                                                    value={formData.source_profit_amount}
                                                    onChange={(e) => updateFormState({ source_profit_amount: Number(e.target.value) })}
                                                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 transition-all"
                                                    disabled={availableProfit <= 0 || formData.amount_invested <= 0}
                                                />
                                            </div>

                                            <div className="flex justify-between items-center pt-3 border-t border-slate-800/80">
                                                <div className="text-[10px] font-bold uppercase text-slate-500">
                                                    Dinheiro Novo (Aporte)
                                                </div>
                                                <div className="text-sm font-black text-white">
                                                    {formatCurrency(formData.amount_invested - formData.source_profit_amount)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-800/50">
                                <label className="text-[10px] font-black uppercase text-slate-400 mb-3 block text-center">Duração do Contrato</label>
                                <div className="flex items-center justify-between bg-slate-950 rounded-2xl p-1 border border-slate-800">
                                    <button onClick={() => updateFormState({ total_installments: Math.max(1, formData.total_installments - 1) })} className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"><Minus size={20}/></button>
                                    <div className="text-center">
                                        <span className="block font-black text-white text-2xl">{formData.total_installments}</span>
                                        <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">Parcelas</span>
                                    </div>
                                    <button onClick={() => updateFormState({ total_installments: Math.min(120, formData.total_installments + 1) })} className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"><Plus size={20}/></button>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    {[
                                        { id: 'monthly', label: 'Mensal', icon: Calendar },
                                        { id: 'weekly', label: 'Semanal', icon: CalendarDays },
                                        { id: 'daily', label: 'Diário', icon: CalendarClock },
                                        { id: 'freelancer', label: 'Livre', icon: Zap },
                                    ].map(opt => (
                                        <button 
                                            key={opt.id}
                                            onClick={() => updateFormState({ frequency: opt.id as any })}
                                            className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all gap-1.5 ${
                                                formData.frequency === opt.id 
                                                ? 'bg-teal-600 border-teal-500 text-white shadow-lg' 
                                                : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-800'
                                            }`}
                                        >
                                            <opt.icon size={18} />
                                            <span className="text-[9px] font-black uppercase tracking-wide">{opt.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {formData.frequency === 'monthly' && (
                                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-2 flex items-center animate-fade-in">
                                        <div className="px-4 text-[10px] font-black text-slate-500 uppercase">Todo dia</div>
                                        <select
                                                value={formData.due_day}
                                                onChange={e => updateFormState({ due_day: parseInt(e.target.value) })}
                                                className="flex-1 bg-transparent text-white font-bold text-center outline-none cursor-pointer text-lg"
                                            >
                                                {Array.from({length: 31}, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                                            </select>
                                            <div className="px-4 text-slate-500"><ChevronRight size={16}/></div>
                                    </div>
                                )}

                                {formData.frequency === 'weekly' && (
                                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-2 flex items-center animate-fade-in">
                                        <div className="px-4 text-[10px] font-black text-slate-500 uppercase">Toda</div>
                                        <select
                                            value={formData.weekday}
                                            onChange={e => updateFormState({ weekday: parseInt(e.target.value) })}
                                            className="flex-1 bg-transparent text-white font-bold text-center outline-none cursor-pointer text-lg"
                                        >
                                            {['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((day, idx) => (
                                                <option key={idx} value={idx}>{day}</option>
                                            ))}
                                        </select>
                                        <div className="px-4 text-slate-500"><ChevronRight size={16}/></div>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                {previewDateStrings.map((dateStr, idx) => (
                                    <div key={idx} className="flex-none bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-center min-w-[80px]">
                                        <p className="text-[9px] text-slate-500 font-bold uppercase">{idx + 1}ª Parc</p>
                                        <p className="text-xs font-bold text-white font-mono">{dateStr.slice(0, 5)}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="bg-slate-950 p-1.5 rounded-2xl border border-slate-800 flex relative">
                                <div className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-slate-800 rounded-xl transition-all duration-300 shadow-md ${formData.calculation_mode === 'manual' ? 'translate-x-full left-1.5' : 'left-1.5'}`}></div>
                                <button onClick={() => updateFormState({ calculation_mode: 'auto' })} className={`flex-1 py-3 relative z-10 text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-colors ${formData.calculation_mode === 'auto' ? 'text-white' : 'text-slate-500'}`}>
                                    <Percent size={14}/> Taxa (%)
                                </button>
                                <button onClick={() => updateFormState({ calculation_mode: 'manual' })} className={`flex-1 py-3 relative z-10 text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-colors ${formData.calculation_mode === 'manual' ? 'text-white' : 'text-slate-500'}`}>
                                    <Banknote size={14}/> Valor Fixo
                                </button>
                            </div>

                            {formData.calculation_mode === 'auto' ? (
                                <div className="space-y-2">
                                    <div className="relative">
                                        <input 
                                            type="number" inputMode="decimal" step="0.1"
                                            className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-white font-bold text-lg outline-none focus:border-teal-500 transition-all text-center"
                                            value={formData.interest_rate}
                                            onChange={e => updateFormState({ interest_rate: parseFloat(e.target.value) })}
                                        />
                                        <span className="absolute right-6 top-5 text-slate-500 font-bold">%</span>
                                    </div>
                                    <div className="text-center text-xs text-slate-400">
                                        Parcela Estimada: <strong className="text-white">{formatCurrency(formData.installment_value)}</strong>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="relative">
                                        <input 
                                            type="number" inputMode="decimal" step="0.01"
                                            className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-white font-bold text-lg outline-none focus:border-indigo-500 transition-all text-center"
                                            value={formData.installment_value}
                                            onChange={e => updateFormState({ installment_value: parseFloat(e.target.value) })}
                                        />
                                        <span className="absolute left-6 top-5 text-slate-500 font-bold">R$</span>
                                    </div>
                                    <div className="text-center text-xs text-slate-400">
                                        Taxa Implícita: <strong className="text-white">{formData.interest_rate.toFixed(2)}%</strong>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-8 animate-fade-in-right">
                            <div className="text-center">
                                <h3 className="text-2xl font-black text-white uppercase tracking-tight">Revisão Final</h3>
                                <p className="text-slate-400 text-xs mt-1">Confirme os dados para gerar o contrato.</p>
                            </div>

                            <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700 rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

                                <div className="flex justify-between items-end border-b border-slate-700/50 pb-6 mb-6">
                                    <div>
                                        <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Total a Receber</p>
                                        <p className="text-4xl font-black text-white tracking-tight">{formatCurrency(formData.current_value)}</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="bg-teal-900/30 border border-teal-500/20 text-teal-400 px-3 py-1 rounded-lg text-xs font-bold inline-block mb-1">
                                            +{formatCurrency(formData.current_value - formData.amount_invested)} Lucro
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-y-6 gap-x-4 text-sm mb-4">
                                    <div>
                                        <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Investimento Total</p>
                                        <p className="text-white font-bold">{formatCurrency(formData.amount_invested)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Fluxo</p>
                                        <p className="text-white font-bold">{formData.total_installments}x de {formatCurrency(formData.installment_value)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Investidor</p>
                                        <p className="text-white font-bold truncate">{selectedInvestor?.full_name}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Cliente</p>
                                        <p className="text-white font-bold truncate">{selectedPayer?.full_name}</p>
                                    </div>
                                </div>
                                
                                {/* Funding Breakdown for Review */}
                                <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800 mt-4">
                                    <div className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                                        <Sparkles size={10} className="text-teal-500"/> Composição do Aporte
                                    </div>
                                    <div className="flex gap-4">
                                        <div className="flex-1 bg-slate-900 border border-slate-700 p-3 rounded-xl text-center">
                                            <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Novo</p>
                                            <p className="text-sm font-black text-white">{formatCurrency(formData.amount_invested - formData.source_profit_amount)}</p>
                                        </div>
                                        <div className="flex-1 bg-emerald-900/20 border border-emerald-900/40 p-3 rounded-xl text-center">
                                            <p className="text-[9px] text-emerald-500 font-bold uppercase mb-1">Reinvestido</p>
                                            <p className="text-sm font-black text-emerald-400">{formatCurrency(formData.source_profit_amount)}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-center gap-2 text-xs text-slate-500 font-medium">
                                <ShieldCheck size={14} className="text-teal-500"/> Contrato Validado pelo Banco
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-slate-700 bg-slate-900/90 backdrop-blur flex gap-4">
                    {step > 1 && (
                        <button onClick={() => setStep(s => s - 1)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all border border-slate-700">
                            Voltar
                        </button>
                    )}
                    
                    {step < 3 ? (
                        <button onClick={() => setStep(s => s + 1)} disabled={(step === 1 && (!selectedInvestor || !selectedPayer)) || (step === 2 && formData.amount_invested <= 0)} className="flex-[2] bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-teal-900/30">
                            Próximo <ChevronRight size={16}/>
                        </button>
                    ) : (
                        <button onClick={handleCreateContract} disabled={wizardLoading} className="flex-[2] bg-green-600 hover:bg-green-500 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-green-900/30">
                            {wizardLoading ? <RefreshCw className="animate-spin" size={18}/> : <CheckCircle2 size={18}/>} Criar Contrato
                        </button>
                    )}
                </div>
             </div>
          </div>
      )}

      {isQuickCreateOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] w-full max-w-sm shadow-2xl p-8 animate-fade-in-up">
                  <div className="flex justify-between items-center mb-8">
                      <h3 className="text-xl font-black text-white uppercase tracking-tighter">Novo Cliente</h3>
                      <button onClick={() => setIsQuickCreateOpen(false)}><X className="text-slate-500 hover:text-white" size={24}/></button>
                  </div>
                  <div className="mb-6 p-4 bg-blue-900/10 border border-blue-900/30 rounded-2xl text-blue-300 text-xs font-medium text-center leading-relaxed">
                    Cadastro simplificado para emissão imediata.
                  </div>
                  <form onSubmit={handleQuickCreateDebtor} className="space-y-5">
                      <input required type="text" className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white focus:border-teal-500 outline-none transition-all placeholder:text-slate-600" value={newDebtorData.full_name} onChange={e => setNewDebtorData({...newDebtorData, full_name: e.target.value})} placeholder="Nome Completo" />
                      <input required type="email" className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white focus:border-teal-500 outline-none transition-all placeholder:text-slate-600" value={newDebtorData.email} onChange={e => setNewDebtorData({...newDebtorData, email: e.target.value})} placeholder="E-mail do Cliente" />
                      <div className="pt-2">
                        <button type="submit" disabled={quickCreateLoading} className="w-full bg-teal-600 hover:bg-teal-500 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg">
                            {quickCreateLoading ? <Loader2 className="animate-spin" size={18}/> : <UserPlus size={18}/>} Cadastrar Rápido
                        </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {/* --- MODAL: CONFIRMAÇÃO DE EXCLUSÃO --- */}
      {isDeleteConfirmOpen && contractToDelete && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
              <div className="bg-slate-800 border border-red-900/50 rounded-[2.5rem] w-full max-w-sm shadow-2xl p-8 animate-fade-in-up">
                  <div className="text-center mb-6">
                      <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Trash2 size={28} className="text-red-400"/>
                      </div>
                      <h3 className="text-xl font-black text-white uppercase tracking-tight">Excluir Contrato</h3>
                      <p className="text-slate-400 text-sm mt-2">Esta ação é <strong className="text-red-400">irreversível</strong>. Todas as parcelas do contrato serão apagadas.</p>
                      <p className="text-white font-bold mt-3 bg-slate-900 px-4 py-2 rounded-xl border border-slate-700 truncate">"{contractToDelete.asset_name}"</p>
                  </div>
                  <div className="flex gap-3">
                      <button onClick={() => { setIsDeleteConfirmOpen(false); setContractToDelete(null); }} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all">
                          Cancelar
                      </button>
                      <button onClick={handleDeleteContract} disabled={deleteLoading} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                          {deleteLoading ? <Loader2 className="animate-spin" size={16}/> : <Trash2 size={16}/>}
                          {deleteLoading ? 'Excluindo...' : 'Confirmar'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL: EDITAR CONTRATO --- */}
      {isEditContractOpen && contractToEdit && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
              <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] w-full max-w-sm shadow-2xl p-8 animate-fade-in-up">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-black text-white uppercase tracking-tight">Editar Contrato</h3>
                      <button onClick={() => setIsEditContractOpen(false)} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
                          <X className="text-slate-400" size={20}/>
                      </button>
                  </div>
                  <div className="space-y-4">
                      <div>
                          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Nome do Contrato</label>
                          <input
                              type="text"
                              value={editContractName}
                              onChange={e => setEditContractName(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-white font-bold outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                              placeholder="Ex: Empréstimo João"
                          />
                      </div>
                  </div>
                  <div className="flex gap-3 mt-6">
                      <button onClick={() => setIsEditContractOpen(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all">
                          Cancelar
                      </button>
                      <button onClick={handleEditContractSave} disabled={editContractLoading || !editContractName.trim()} className="flex-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                          {editContractLoading ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>}
                          {editContractLoading ? 'Salvando...' : 'Salvar'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {isDetailsModalOpen && viewingContract && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
             <div className="bg-slate-800 border border-slate-700 rounded-[3rem] w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] animate-fade-in-up">
                <div className="p-8 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
                    <div>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Detalhes do Contrato</h3>
                        <p className="text-xs text-slate-500 font-bold mt-1">ID #{viewingContract.id} • {viewingContract.asset_name}</p>
                    </div>
                    <button onClick={() => setIsDetailsModalOpen(false)} className="p-3 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white"><X size={24}/></button>
                </div>
                <div className="p-10 text-center">
                     <div className="bg-gradient-to-b from-slate-900 to-slate-800 p-8 rounded-[2.5rem] border border-slate-700 inline-block w-full max-w-sm shadow-xl">
                         <p className="text-slate-500 text-xs font-black uppercase tracking-widest mb-2">Resumo Financeiro</p>
                         <p className="text-5xl font-black text-white mb-4 tracking-tight">{formatCurrency(viewingContract.current_value)}</p>
                         <div className="inline-flex items-center gap-2 bg-teal-900/30 border border-teal-500/20 px-4 py-2 rounded-xl">
                            <p className="text-sm text-teal-400 font-bold uppercase">{viewingContract.total_installments}x de {formatCurrency(viewingContract.installment_value)}</p>
                         </div>
                     </div>
                </div>
             </div>
          </div>
      )}

      <QuickContractInput
        isOpen={isNLContractOpen}
        onClose={() => setIsNLContractOpen(false)}
        onSuccess={() => { setIsNLContractOpen(false); fetchData(); }}
        profiles={profiles}
        currentTenant={currentTenant}
        currentUserId={currentUserId}
      />
    </div>
  );
};

export default AdminContracts;
