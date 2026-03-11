
import React, { useEffect, useState, useMemo } from 'react';
import { getSupabase, parseSupabaseError, isValidCPF } from '../services/supabase';
import { Investment, Tenant, Profile } from '../types';
import QuickContractInput from './QuickContractInput';
import ContractDetail from './ContractDetail';
import ContractRenewalModal from './ContractRenewalModal';
import {
    Search, PlusCircle, CheckCircle2, X, RefreshCw,
    ArrowRight, Calendar, Zap, Wallet, ChevronRight,
    Minus, Plus, Banknote, Percent, CalendarDays,
    CalendarClock, UserPlus, Loader2, UserCog, ShieldCheck, Eye, ChevronDown, Coins, TrendingUp, Sparkles,
    Trash2, Pencil, Mail, Phone, Key, MapPin, Activity
} from 'lucide-react';

// --- PURE BUSINESS LOGIC (No React Dependencies) ---

const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const formatDecimalInput = (val: number) => roundCurrency(Number(val || 0)).toFixed(2);

const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const distributeEvenly = (total: number, count: number): number[] => {
    if (count <= 0) return [];
    const base = roundCurrency(total / count);
    const values = Array.from({ length: count }, () => base);
    const currentTotal = roundCurrency(values.reduce((sum, value) => sum + value, 0));
    values[count - 1] = roundCurrency(values[count - 1] + (total - currentTotal));
    return values;
};

const calculateInstallmentDates = (
    frequency: string,
    dueDay: number,
    weekday: number,
    startDateStr: string,
    count: number,
    skipWeekends: boolean = false
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

    if (frequency === 'daily' && skipWeekends) {
        let start = new Date(cursorDate);
        while (start.getDay() === 0 || start.getDay() === 6) {
            start.setDate(start.getDate() + 1);
        }
        for (let i = 0; i < count; i++) {
            const candidate = new Date(start);
            let bDaysLeft = i;
            while (bDaysLeft > 0) {
                candidate.setDate(candidate.getDate() + 1);
                if (candidate.getDay() !== 0 && candidate.getDay() !== 6) bDaysLeft--;
            }
            dates.push(new Date(candidate));
        }
        return dates;
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
                            <p className="text-[color:var(--text-primary)] font-bold text-lg leading-none">{selectedProfile.full_name}</p>
                            {selectedProfile.role === 'admin' && (
                                <div className="bg-[color:var(--bg-elevated)] p-1 rounded-md border border-[color:var(--border-subtle)]" title="Administrador">
                                    <ShieldCheck size={12} className="text-teal-400"/>
                                </div>
                            )}
                        </div>
                        <p className="text-[color:var(--text-muted)] text-xs mt-0.5 font-medium">{selectedProfile.email}</p>
                    </div>
                </div>
                <button onClick={onClear} className="p-3 bg-[color:var(--bg-base)] hover:bg-[color:var(--bg-elevated)] rounded-xl text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-all border border-[color:var(--border-subtle)] shadow-xl" title="Alterar">
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
                <Search className="absolute left-4 top-4 text-[color:var(--text-muted)] group-focus-within:text-teal-500 transition-colors" size={20} />
                <input
                    type="text"
                    placeholder={role === 'investor' ? "Selecione o credor..." : "Busque ou selecione o cliente..."}
                    className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl pl-12 pr-10 p-4 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--border-subtle)] outline-none transition-all shadow-inner focus:ring-1 focus:ring-[color:var(--border-subtle)] cursor-pointer"
                    value={searchTerm}
                    onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                />
                <ChevronDown size={20} className={`absolute right-4 top-4 text-[color:var(--text-muted)] transition-transform duration-300 pointer-events-none ${showDropdown ? 'rotate-180 text-teal-500' : ''}`} />
            </div>
            {showDropdown && (
                <div className="mt-2 bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden">
                    {filtered.length > 0 ? (
                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                            {filtered.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => { onSelect(p); setSearchTerm(''); }}
                                    className="w-full text-left p-4 hover:bg-[color:var(--bg-soft)] border-b border-[color:var(--border-subtle)] last:border-0 transition-colors flex items-center justify-between group/item"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-[color:var(--bg-base)] flex items-center justify-center text-xs font-bold text-[color:var(--text-secondary)] border border-[color:var(--border-subtle)]">
                                            {p.full_name.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-[color:var(--text-primary)] font-bold text-sm group-hover/item:text-teal-400 transition-colors">{p.full_name}</p>
                                            <p className="text-[color:var(--text-muted)] text-[10px]">{p.email}</p>
                                        </div>
                                    </div>
                                    {p.role === 'admin' && <span className="text-[9px] bg-teal-950 text-teal-400 px-2 py-1 rounded font-black uppercase border border-teal-900">Admin</span>}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="p-4 text-center text-xs text-[color:var(--text-muted)]">
                            Nenhum cliente encontrado
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

type EditableContractInstallment = {
  id: string;
  number: number;
  due_date: string;
  status: 'pending' | 'paid' | 'late' | 'partial';
  amount_total: number;
  amount_paid: number;
  amount_principal: number;
  amount_interest: number;
};

// --- MAIN COMPONENT ---

interface AdminContractsProps { autoOpenCreate?: boolean; }
const AdminContracts: React.FC<AdminContractsProps> = ({ autoOpenCreate = false }) => {
  const [contracts, setContracts] = useState<Investment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [isNLContractOpen, setIsNLContractOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [availableProfit, setAvailableProfit] = useState(0);

  const [newDebtorData, setNewDebtorData] = useState({ full_name: '', email: '', phone_number: '', cpf: '', cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '' });
  const [quickCreateCpfError, setQuickCreateCpfError] = useState('');
  const [quickCreateCepLoading, setQuickCreateCepLoading] = useState(false);
  const [quickCreateCepError, setQuickCreateCepError] = useState('');
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
      source_profit_amount: 0,
      skip_weekends: false
  });

  const [selectedInvestor, setSelectedInvestor] = useState<Profile | null>(null);
  const [selectedPayer, setSelectedPayer] = useState<Profile | null>(null);
  const [previewDateStrings, setPreviewDateStrings] = useState<string[]>([]);
  const [viewingContractId, setViewingContractId] = useState<number | null>(null);
  const [viewingContract, setViewingContract] = useState<Investment | null>(null);
  const [contractsSubView, setContractsSubView] = useState<'list' | 'detail' | 'renewal' | 'create' | 'create-client' | 'edit'>(autoOpenCreate ? 'create' : 'list');
  const [renewalSource, setRenewalSource] = useState<Investment | null>(null);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [contractToDelete, setContractToDelete] = useState<Investment | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [contractToEdit, setContractToEdit] = useState<Investment | null>(null);
  const [editContractName, setEditContractName] = useState('');
  const [editContractPrincipal, setEditContractPrincipal] = useState('');
  const [editContractInstallmentValue, setEditContractInstallmentValue] = useState('');
  const [editInstallments, setEditInstallments] = useState<EditableContractInstallment[]>([]);
  const [editContractError, setEditContractError] = useState<string | null>(null);
  const [editContractLoading, setEditContractLoading] = useState(false);

  const editPaidInstallments = useMemo(
      () => editInstallments.filter((installment) => installment.status === 'paid'),
      [editInstallments]
  );

  const editOpenInstallments = useMemo(
      () => editInstallments.filter((installment) => installment.status !== 'paid'),
      [editInstallments]
  );

  const editPaidPrincipal = useMemo(
      () => roundCurrency(editPaidInstallments.reduce((sum, installment) => sum + Number(installment.amount_principal || 0), 0)),
      [editPaidInstallments]
  );

  const editPaidTotal = useMemo(
      () => roundCurrency(editPaidInstallments.reduce((sum, installment) => sum + Number(installment.amount_total || 0), 0)),
      [editPaidInstallments]
  );

  const editCurrentValuePreview = useMemo(() => {
      const installmentValue = Number(editContractInstallmentValue) || 0;
      return roundCurrency(editPaidTotal + installmentValue * editOpenInstallments.length);
  }, [editContractInstallmentValue, editOpenInstallments.length, editPaidTotal]);

  const editInterestRatePreview = useMemo(() => {
      const principal = Number(editContractPrincipal) || 0;
      if (principal <= 0) return 0;
      return roundCurrency(((editCurrentValuePreview / principal) - 1) * 100);
  }, [editContractPrincipal, editCurrentValuePreview]);

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
          source_profit_amount: 0,
          skip_weekends: false
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
      setContractsSubView('create');
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
          merged.total_installments,
          merged.skip_weekends
      );
      setPreviewDateStrings(dateObjects.map(d =>
          d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
      ));
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
              p_source_capital: formData.amount_invested - formData.source_profit_amount,
              p_source_profit: formData.source_profit_amount,
              p_current_value: formData.current_value,
              p_interest_rate: formData.interest_rate,
              p_installment_value: formData.installment_value,
              p_total_installments: formData.total_installments,
              p_frequency: formData.frequency,
              p_due_day: formData.frequency === 'monthly' ? formData.due_day : null,
              p_weekday: formData.frequency === 'weekly' ? formData.weekday : null,
              p_start_date: ['daily', 'freelancer'].includes(formData.frequency) ? formData.start_date : null,
              p_calculation_mode: formData.calculation_mode,
              p_skip_weekends: formData.frequency === 'daily' ? formData.skip_weekends : false
          });

          if (rpcError) throw rpcError;
          setContractsSubView('list');
          fetchData();

      } catch (err: any) {
          alert(`Falha na criação: ${err.message}`);
      } finally {
          setWizardLoading(false);
      }
  };

  const handleQuickCepLookup = async (digits: string) => {
      if (digits.length !== 8) return;
      setQuickCreateCepLoading(true);
      setQuickCreateCepError('');
      try {
          const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
          const d = await res.json();
          if (d.erro) { setQuickCreateCepError('CEP não encontrado.'); return; }
          setNewDebtorData(p => ({ ...p, logradouro: d.logradouro || '', bairro: d.bairro || '', cidade: d.localidade || '', uf: d.uf || '' }));
      } catch { setQuickCreateCepError('Erro ao buscar CEP.'); }
      finally { setQuickCreateCepLoading(false); }
  };

  const maskCPFAdmin = (v: string) => {
      const d = v.replace(/\D/g, '').slice(0, 11);
      return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
              .replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3')
              .replace(/(\d{3})(\d{0,3})/, '$1.$2');
  };

  const handleQuickCreateDebtor = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newDebtorData.full_name || !currentTenant) return;

      const cpfDigits = newDebtorData.cpf.replace(/\D/g, '');
      if (cpfDigits && !isValidCPF(cpfDigits)) {
          setQuickCreateCpfError('CPF inválido');
          return;
      }

      setQuickCreateLoading(true);
      setQuickCreateCpfError('');
      const supabase = getSupabase();
      if (!supabase) return;

      try {
          const { data, error } = await supabase.rpc('create_client_direct', {
              p_full_name:    newDebtorData.full_name,
              p_email:        newDebtorData.email.trim() || null,
              p_role:         'debtor',
              p_phone_number: newDebtorData.phone_number.trim() || null,
              p_cpf:          cpfDigits || null,
              p_photo_url:    null,
          });

          if (error) throw error;
          const newId = data as string;

          // Salvar endereço separadamente (RPC não suporta esses campos)
          const hasAddress = newDebtorData.cep || newDebtorData.logradouro || newDebtorData.numero || newDebtorData.bairro || newDebtorData.cidade || newDebtorData.uf;
          if (hasAddress) {
              await supabase.from('profiles').update({
                  cep: newDebtorData.cep || null,
                  logradouro: newDebtorData.logradouro || null,
                  numero: newDebtorData.numero || null,
                  bairro: newDebtorData.bairro || null,
                  cidade: newDebtorData.cidade || null,
                  uf: newDebtorData.uf || null,
              }).eq('id', newId);
          }

          const newProfile: Profile = {
              id: newId,
              full_name: newDebtorData.full_name,
              email: newDebtorData.email || '',
              role: 'debtor',
              tenant_id: currentTenant.id,
              phone_number: newDebtorData.phone_number || null,
              cpf: cpfDigits || null,
              cep: newDebtorData.cep || null,
              logradouro: newDebtorData.logradouro || null,
              numero: newDebtorData.numero || null,
              bairro: newDebtorData.bairro || null,
              cidade: newDebtorData.cidade || null,
              uf: newDebtorData.uf || null,
          } as Profile;

          setProfiles(prev => [...prev, newProfile]);
          setSelectedPayer(newProfile);
          setContractsSubView('create');
          setNewDebtorData({ full_name: '', email: '', phone_number: '', cpf: '', cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '' });
          setQuickCreateCepError('');
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

  const handleOpenContractEdit = async (contract: Investment) => {
      setContractToEdit(contract);
      setEditContractName(contract.asset_name);
      setEditContractPrincipal(formatDecimalInput(contract.amount_invested));
      setEditContractInstallmentValue(formatDecimalInput(contract.installment_value));
      setEditContractError(null);
      setContractsSubView('edit');
      setEditContractLoading(true);

      const supabase = getSupabase();
      if (!supabase) {
          setEditContractError('Instância Supabase indisponível.');
          setEditContractLoading(false);
          return;
      }

      try {
          const { data, error } = await supabase
              .from('loan_installments')
              .select('id, number, due_date, status, amount_total, amount_paid, amount_principal, amount_interest')
              .eq('investment_id', contract.id)
              .order('number', { ascending: true });

          if (error) throw error;
          const rawInstallments = (data || []).map((installment) => ({
              ...installment,
              investment_id: contract.id,
              amount_total: Number(installment.amount_total || 0),
              amount_paid: Number(installment.amount_paid || 0),
              amount_principal: Number(installment.amount_principal || 0),
              amount_interest: Number(installment.amount_interest || 0),
          }));

          setEditInstallments(rawInstallments.map(({ investment_id, ...installment }) => installment));
      } catch (err: any) {
          setEditContractError(parseSupabaseError(err));
      } finally {
          setEditContractLoading(false);
      }
  };

  const handleEditInstallmentDateChange = (installmentId: string, dueDate: string) => {
      setEditInstallments((current) =>
          current.map((installment) =>
              installment.id === installmentId ? { ...installment, due_date: dueDate } : installment
          )
      );
  };

  const handleEditContractSave = async () => {
      if (!contractToEdit || !editContractName.trim()) return;
      setEditContractLoading(true);
      setEditContractError(null);
      const supabase = getSupabase();
      if (!supabase) return;
      try {
          const principal = roundCurrency(Number(editContractPrincipal));
          const installmentValue = roundCurrency(Number(editContractInstallmentValue));
          const openCount = editOpenInstallments.length;

          if (!principal || principal <= 0) {
              throw new Error('Informe um valor emprestado válido.');
          }

          if (!installmentValue || installmentValue <= 0) {
              throw new Error('Informe um valor de parcela válido.');
          }

          if (openCount === 0) {
              throw new Error('Este contrato não possui parcelas abertas para redistribuir.');
          }

          if (principal < editPaidPrincipal) {
              throw new Error(`O valor emprestado não pode ser menor que o principal já recuperado (${formatCurrency(editPaidPrincipal)}).`);
          }

          const nextCurrentValue = roundCurrency(editPaidTotal + installmentValue * openCount);
          const remainingPrincipal = roundCurrency(principal - editPaidPrincipal);
          const remainingTotal = roundCurrency(nextCurrentValue - editPaidTotal);

          if (remainingTotal < remainingPrincipal) {
              throw new Error('O valor da parcela gera um total menor do que o principal ainda em aberto.');
          }

          const nextInterestRate = principal > 0
              ? roundCurrency(((nextCurrentValue / principal) - 1) * 100)
              : 0;

          const principalDistribution = distributeEvenly(remainingPrincipal, openCount);
          const totalDistribution = distributeEvenly(remainingTotal, openCount);

          const installmentUpdates = editOpenInstallments.map((installment, index) => {
              const nextAmountPrincipal = principalDistribution[index];
              const nextAmountTotal = totalDistribution[index];
              const nextAmountInterest = roundCurrency(nextAmountTotal - nextAmountPrincipal);
              if (!installment.due_date) {
                  throw new Error(`A parcela ${installment.number} precisa de uma data válida.`);
              }

              return supabase
                  .from('loan_installments')
                  .update({
                      due_date: installment.due_date,
                      amount_total: nextAmountTotal,
                      amount_principal: nextAmountPrincipal,
                      amount_interest: nextAmountInterest,
                  })
                  .eq('id', installment.id);
          });

          const { error: investmentError } = await supabase
              .from('investments')
              .update({
                  asset_name: editContractName.trim(),
                  amount_invested: principal,
                  installment_value: installmentValue,
                  current_value: nextCurrentValue,
                  interest_rate: nextInterestRate,
              })
              .eq('id', contractToEdit.id);

          if (investmentError) throw investmentError;

          const installmentResults = await Promise.all(installmentUpdates);
          const installmentError = installmentResults.find((result) => result.error)?.error;
          if (installmentError) throw installmentError;

          setContractsSubView('list');
          setContractToEdit(null);
          setEditInstallments([]);
          fetchData();
      } catch (err: any) {
          setEditContractError(parseSupabaseError(err));
      } finally {
          setEditContractLoading(false);
      }
  };

  if (contractsSubView === 'detail') {
    return (
      <ContractDetail
        investmentId={viewingContractId}
        onBack={() => { setContractsSubView('list'); setViewingContractId(null); setViewingContract(null); }}
        onRenew={(inv) => { setRenewalSource(inv); setContractsSubView('renewal'); }}
        onRefreshList={fetchData}
        tenant={currentTenant}
      />
    );
  }

  if (contractsSubView === 'renewal') {
    return (
      <ContractRenewalModal
        sourceContract={renewalSource}
        onBack={() => setContractsSubView('detail')}
        onSuccess={() => { fetchData(); setContractsSubView('list'); setViewingContractId(null); setRenewalSource(null); }}
      />
    );
  }

  if (contractsSubView === 'create') {
    return (
      <div className="flex h-full flex-col bg-[color:var(--bg-elevated)] overflow-hidden">
        <div className="px-8 py-6 border-b border-[color:var(--border-subtle)] flex justify-between items-center bg-[color:var(--bg-base)]/50">
            <div>
                <h3 className="text-sm font-black text-[color:var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
                    Novo Contrato
                </h3>
                <div className="flex gap-1.5 mt-2">
                    {[1, 2, 3].map(i => (
                        <div key={i} className={`h-1.5 w-8 rounded-full transition-all duration-300 ${step >= i ? 'bg-teal-500' : 'bg-[color:var(--border-subtle)]'}`}></div>
                    ))}
                </div>
            </div>
            <button onClick={() => setContractsSubView('list')} className="p-3 hover:bg-[color:var(--bg-soft)] rounded-full transition-colors group">
                <X className="text-[color:var(--text-muted)] group-hover:text-[color:var(--text-primary)]" size={24}/>
            </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar bg-[color:var(--bg-elevated)]">

            {step === 1 && (
                <div className="space-y-8 animate-fade-in-right">
                    <div className="text-center mb-2">
                        <h3 className="text-2xl font-black text-[color:var(--text-primary)] uppercase tracking-tight">Partes Envolvidas</h3>
                        <p className="text-[color:var(--text-secondary)] text-xs font-medium">Defina quem está emprestando e quem irá pagar.</p>
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
                        <div className="bg-[color:var(--bg-elevated)] p-2 rounded-full border border-[color:var(--border-subtle)] shadow-xl">
                            <ArrowRight className="text-[color:var(--text-muted)] rotate-90 md:rotate-0" size={24}/>
                        </div>
                    </div>
                    <UserSelectionCard
                        label="Quem Paga (Tomador)"
                        role="payer"
                        selectedProfile={selectedPayer}
                        profiles={profiles}
                        onSelect={setSelectedPayer}
                        onClear={() => setSelectedPayer(null)}
                        onCreateNew={() => setContractsSubView('create-client')}
                    />
                </div>
            )}

            {step === 2 && (
                <div className="space-y-6 animate-fade-in-right pb-20">
                    <div className="text-center mb-4">
                        <h3 className="text-2xl font-black text-[color:var(--text-primary)] uppercase tracking-tight">Termos Financeiros</h3>
                        <p className="text-[color:var(--text-secondary)] text-xs mt-1">Detalhes do fluxo de caixa e prazos.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                        <div>
                            <label className="text-[10px] font-black uppercase text-[color:var(--text-muted)] ml-1 mb-1 block">Nome do Ativo</label>
                            <input
                                type="text"
                                className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)] font-bold focus:border-teal-500 outline-none transition-all"
                                placeholder={`Ex: Empréstimo ${selectedPayer?.full_name.split(' ')[0]}`}
                                value={formData.asset_name}
                                onChange={e => setFormData({...formData, asset_name: e.target.value})}
                            />
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-black uppercase text-[color:var(--text-muted)] ml-1 mb-1 block">Valor Principal (Aporte)</label>
                                <div className="relative group">
                                    <span className="absolute left-4 top-4 text-teal-500 font-bold group-focus-within:text-teal-400 transition-colors">R$</span>
                                    <input
                                        type="number" inputMode="decimal" step="0.01"
                                        className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl pl-12 pr-4 py-4 text-2xl font-black text-[color:var(--text-primary)] outline-none focus:border-teal-500 transition-all"
                                        value={formData.amount_invested || ''}
                                        onChange={e => updateFormState({ amount_invested: parseFloat(e.target.value) })}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>

                            <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 relative overflow-hidden">
                                <div className="absolute -right-4 -top-4 bg-emerald-500/10 w-24 h-24 rounded-full blur-2xl pointer-events-none"></div>

                                <div className="flex justify-between items-center mb-4 relative z-10">
                                    <h4 className="text-[10px] font-black uppercase text-emerald-400 flex items-center gap-1.5">
                                        <Coins size={12}/> Fonte de Recursos
                                    </h4>
                                    <div className="text-[9px] text-[color:var(--text-muted)] font-bold bg-[color:var(--bg-base)] px-2 py-1 rounded border border-[color:var(--border-subtle)]">
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
                                            className="w-full h-2 bg-[color:var(--bg-elevated)] rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 transition-all"
                                            disabled={availableProfit <= 0 || formData.amount_invested <= 0}
                                        />
                                    </div>

                                    <div className="flex justify-between items-center pt-3 border-t border-[color:var(--border-subtle)]">
                                        <div className="text-[10px] font-bold uppercase text-[color:var(--text-muted)]">
                                            Dinheiro Novo (Aporte)
                                        </div>
                                        <div className="text-sm font-black text-[color:var(--text-primary)]">
                                            {formatCurrency(formData.amount_invested - formData.source_profit_amount)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-[color:var(--bg-base)]/50 p-5 rounded-3xl border border-[color:var(--border-subtle)]">
                        <label className="text-[10px] font-black uppercase text-[color:var(--text-secondary)] mb-3 block text-center">Duração do Contrato</label>
                        <div className="flex items-center justify-between bg-[color:var(--bg-base)] rounded-2xl p-1 border border-[color:var(--border-subtle)]">
                            <button onClick={() => updateFormState({ total_installments: Math.max(1, formData.total_installments - 1) })} className="w-12 h-12 flex items-center justify-center text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] rounded-xl transition-all"><Minus size={20}/></button>
                            <div className="text-center">
                                <span className="block font-black text-[color:var(--text-primary)] text-2xl">{formData.total_installments}</span>
                                <span className="text-[9px] text-[color:var(--text-muted)] uppercase font-bold tracking-widest">Parcelas</span>
                            </div>
                            <button onClick={() => updateFormState({ total_installments: Math.min(120, formData.total_installments + 1) })} className="w-12 h-12 flex items-center justify-center text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] rounded-xl transition-all"><Plus size={20}/></button>
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
                                        : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                                    }`}
                                >
                                    <opt.icon size={18} />
                                    <span className="text-[9px] font-black uppercase tracking-wide">{opt.label}</span>
                                </button>
                            ))}
                        </div>

                        {formData.frequency === 'monthly' && (
                            <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-2 flex items-center animate-fade-in">
                                <div className="px-4 text-[10px] font-black text-[color:var(--text-muted)] uppercase">Todo dia</div>
                                <select
                                        value={formData.due_day}
                                        onChange={e => updateFormState({ due_day: parseInt(e.target.value) })}
                                        className="flex-1 bg-transparent text-[color:var(--text-primary)] font-bold text-center outline-none cursor-pointer text-lg"
                                    >
                                        {Array.from({length: 31}, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                    <div className="px-4 text-[color:var(--text-muted)]"><ChevronRight size={16}/></div>
                            </div>
                        )}

                        {formData.frequency === 'weekly' && (
                            <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-2 flex items-center animate-fade-in">
                                <div className="px-4 text-[10px] font-black text-[color:var(--text-muted)] uppercase">Toda</div>
                                <select
                                    value={formData.weekday}
                                    onChange={e => updateFormState({ weekday: parseInt(e.target.value) })}
                                    className="flex-1 bg-transparent text-[color:var(--text-primary)] font-bold text-center outline-none cursor-pointer text-lg"
                                >
                                    {['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((day, idx) => (
                                        <option key={idx} value={idx}>{day}</option>
                                    ))}
                                </select>
                                <div className="px-4 text-[color:var(--text-muted)]"><ChevronRight size={16}/></div>
                            </div>
                        )}
                    </div>

                    {formData.frequency === 'daily' && (
                        <button
                            onClick={() => updateFormState({ skip_weekends: !formData.skip_weekends })}
                            className={`flex items-center gap-3 w-full p-3 rounded-2xl border transition-all animate-fade-in ${
                                formData.skip_weekends
                                    ? 'bg-teal-950/40 border-teal-500/40 text-teal-300'
                                    : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'
                            }`}
                        >
                            <div className={`w-9 h-5 rounded-full relative transition-all flex-shrink-0 ${formData.skip_weekends ? 'bg-teal-600' : 'bg-[color:var(--bg-elevated)]'}`}>
                                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${formData.skip_weekends ? 'left-4' : 'left-0.5'}`} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest">Pular finais de semana</span>
                        </button>
                    )}

                    {previewDateStrings.length > 0 && (
                        <div className="rounded-2xl border border-[color:var(--border-subtle)] overflow-hidden animate-fade-in">
                            <div className="flex items-center justify-between px-4 py-3 bg-[color:var(--bg-base)] border-b border-[color:var(--border-subtle)]">
                                <span className="text-[10px] font-black uppercase text-[color:var(--text-muted)]">
                                    Preview das {previewDateStrings.length} parcelas
                                </span>
                                <span className="text-[10px] font-bold text-[color:var(--accent-brass)]">
                                    {formatCurrency(formData.installment_value)} cada
                                </span>
                            </div>
                            <div className="max-h-48 overflow-y-auto divide-y divide-[color:var(--border-subtle)]">
                                {previewDateStrings.map((dateStr, idx) => (
                                    <div key={idx} className="flex items-center justify-between px-4 py-2.5">
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-black text-[color:var(--text-faint)] w-6 text-right">
                                                {idx + 1}
                                            </span>
                                            <span className="text-xs font-bold text-[color:var(--text-primary)] font-mono">
                                                {dateStr}
                                            </span>
                                        </div>
                                        <span className="text-xs font-bold text-[color:var(--accent-positive)]">
                                            {formatCurrency(formData.installment_value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="bg-[color:var(--bg-base)] p-1.5 rounded-2xl border border-[color:var(--border-subtle)] flex relative">
                        <div className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-[color:var(--bg-elevated)] rounded-xl transition-all duration-300 shadow-md ${formData.calculation_mode === 'manual' ? 'translate-x-full left-1.5' : 'left-1.5'}`}></div>
                        <button onClick={() => updateFormState({ calculation_mode: 'auto' })} className={`flex-1 py-3 relative z-10 text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-colors ${formData.calculation_mode === 'auto' ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)]'}`}>
                            <Percent size={14}/> Taxa (%)
                        </button>
                        <button onClick={() => updateFormState({ calculation_mode: 'manual' })} className={`flex-1 py-3 relative z-10 text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-colors ${formData.calculation_mode === 'manual' ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)]'}`}>
                            <Banknote size={14}/> Valor Fixo
                        </button>
                    </div>

                    {formData.calculation_mode === 'auto' ? (
                        <div className="space-y-2">
                            <div className="relative">
                                <input
                                    type="number" inputMode="decimal" step="0.1"
                                    className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)] font-bold text-lg outline-none focus:border-teal-500 transition-all text-center"
                                    value={formData.interest_rate}
                                    onChange={e => updateFormState({ interest_rate: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                                />
                                <span className="absolute right-6 top-5 text-[color:var(--text-muted)] font-bold">%</span>
                            </div>
                            <div className="text-center text-xs text-[color:var(--text-secondary)]">
                                Parcela Estimada: <strong className="text-[color:var(--text-primary)]">{formatCurrency(formData.installment_value)}</strong>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="relative">
                                <input
                                    type="number" inputMode="decimal" step="0.01"
                                    className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)] font-bold text-lg outline-none focus:border-indigo-500 transition-all text-center"
                                    value={formData.installment_value}
                                    onChange={e => updateFormState({ installment_value: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                                />
                                <span className="absolute left-6 top-5 text-[color:var(--text-muted)] font-bold">R$</span>
                            </div>
                            <div className="text-center text-xs text-[color:var(--text-secondary)]">
                                Taxa Implícita: <strong className="text-[color:var(--text-primary)]">{(Number(formData.interest_rate) || 0).toFixed(2)}%</strong>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {step === 3 && (
                <div className="space-y-8 animate-fade-in-right">
                    <div className="text-center">
                        <h3 className="text-2xl font-black text-[color:var(--text-primary)] uppercase tracking-tight">Revisão Final</h3>
                        <p className="text-[color:var(--text-secondary)] text-xs mt-1">Confirme os dados para gerar o contrato.</p>
                    </div>

                    <div className="bg-gradient-to-b from-[color:var(--bg-elevated)] to-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

                        <div className="flex justify-between items-end border-b border-[color:var(--border-subtle)] pb-6 mb-6">
                            <div>
                                <p className="text-[10px] text-[color:var(--text-muted)] font-black uppercase tracking-widest mb-1">Total a Receber</p>
                                <p className="text-4xl font-black text-[color:var(--text-primary)] tracking-tight">{formatCurrency(formData.current_value)}</p>
                            </div>
                            <div className="text-right">
                                <div className="bg-teal-900/30 border border-teal-500/20 text-teal-400 px-3 py-1 rounded-lg text-xs font-bold inline-block mb-1">
                                    +{formatCurrency(formData.current_value - formData.amount_invested)} Lucro
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-y-6 gap-x-4 text-sm mb-4">
                            <div>
                                <p className="text-[10px] text-[color:var(--text-muted)] font-black uppercase tracking-widest mb-1">Investimento Total</p>
                                <p className="text-[color:var(--text-primary)] font-bold">{formatCurrency(formData.amount_invested)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-[color:var(--text-muted)] font-black uppercase tracking-widest mb-1">Fluxo</p>
                                <p className="text-[color:var(--text-primary)] font-bold">{formData.total_installments}x de {formatCurrency(formData.installment_value)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-[color:var(--text-muted)] font-black uppercase tracking-widest mb-1">Investidor</p>
                                <p className="text-[color:var(--text-primary)] font-bold truncate">{selectedInvestor?.full_name}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-[color:var(--text-muted)] font-black uppercase tracking-widest mb-1">Cliente</p>
                                <p className="text-[color:var(--text-primary)] font-bold truncate">{selectedPayer?.full_name}</p>
                            </div>
                        </div>

                        <div className="bg-[color:var(--bg-base)]/50 p-4 rounded-xl border border-[color:var(--border-subtle)] mt-4">
                            <div className="text-[9px] text-[color:var(--text-muted)] font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Sparkles size={10} className="text-teal-500"/> Composição do Aporte
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] p-3 rounded-xl text-center">
                                    <p className="text-[9px] text-[color:var(--text-secondary)] font-bold uppercase mb-1">Novo</p>
                                    <p className="text-sm font-black text-[color:var(--text-primary)]">{formatCurrency(formData.amount_invested - formData.source_profit_amount)}</p>
                                </div>
                                <div className="flex-1 bg-emerald-900/20 border border-emerald-900/40 p-3 rounded-xl text-center">
                                    <p className="text-[9px] text-emerald-500 font-bold uppercase mb-1">Reinvestido</p>
                                    <p className="text-sm font-black text-emerald-400">{formatCurrency(formData.source_profit_amount)}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-center gap-2 text-xs text-[color:var(--text-muted)] font-medium">
                        <ShieldCheck size={14} className="text-teal-500"/> Contrato Validado pelo Banco
                    </div>
                </div>
            )}
        </div>

        <div className="flex gap-4 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-base)]/90 px-6 pt-6 pb-[max(calc(env(safe-area-inset-bottom,0px)+5.5rem),5.5rem)] md:pb-6 backdrop-blur">
            {step > 1 && (
                <button onClick={() => setStep(s => s - 1)} className="flex-1 bg-[color:var(--bg-elevated)] hover:bg-[color:var(--bg-soft)] text-[color:var(--text-primary)] py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all border border-[color:var(--border-subtle)]">
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
    );
  }

  if (contractsSubView === 'create-client') {
    return (
      <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">
        {/* Header fixo */}
        <div className="shrink-0 flex items-center justify-between px-6 py-5 border-b border-[color:var(--border-subtle)]">
            <div>
                <h3 className="text-lg font-black text-[color:var(--text-primary)] uppercase tracking-tighter">Novo Cliente</h3>
                <p className="text-[10px] text-[color:var(--text-muted)] font-bold uppercase tracking-widest">Cadastro para emissão imediata</p>
            </div>
            <button onClick={() => setContractsSubView('create')}><X className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" size={22}/></button>
        </div>
        {/* Body scrollável */}
        <div className="flex-1 overflow-y-auto p-6 pb-2 custom-scrollbar">
        <form id="quick-create-debtor-form" onSubmit={handleQuickCreateDebtor} className="space-y-4">
            {/* Identificação */}
            <div className="bg-[color:var(--bg-base)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="text-[10px] font-black uppercase text-[color:var(--text-muted)] tracking-widest">Identificação</p>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">Nome Completo *</label>
                    <div className="relative">
                        <UserPlus size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input required type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl pl-9 pr-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.full_name} onChange={e => setNewDebtorData({...newDebtorData, full_name: e.target.value})} placeholder="Nome completo" />
                    </div>
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">E-mail</label>
                    <div className="relative">
                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input type="email" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl pl-9 pr-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.email} onChange={e => setNewDebtorData({...newDebtorData, email: e.target.value})} placeholder="email@exemplo.com (opcional)" />
                    </div>
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">Telefone</label>
                    <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input type="tel" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl pl-9 pr-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.phone_number} onChange={e => setNewDebtorData({...newDebtorData, phone_number: e.target.value})} placeholder="(11) 99999-9999 (opcional)" />
                    </div>
                </div>
            </div>
            {/* Documento */}
            <div className="bg-[color:var(--bg-base)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="text-[10px] font-black uppercase text-[color:var(--text-muted)] tracking-widest">Documento</p>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">CPF</label>
                    <div className="relative">
                        <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input type="text" maxLength={14} className={`w-full bg-[color:var(--bg-elevated)] border rounded-xl pl-9 pr-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)] ${quickCreateCpfError ? 'border-red-500' : 'border-[color:var(--border-subtle)]'}`} value={newDebtorData.cpf} onChange={e => { setQuickCreateCpfError(''); setNewDebtorData({...newDebtorData, cpf: maskCPFAdmin(e.target.value)}); }} placeholder="000.000.000-00 (opcional)" />
                    </div>
                    {quickCreateCpfError && <p className="text-red-400 text-[10px] mt-1 font-bold">{quickCreateCpfError}</p>}
                </div>
            </div>
            {/* Endereço */}
            <div className="bg-[color:var(--bg-base)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="text-[10px] font-black uppercase text-[color:var(--text-muted)] tracking-widest">Endereço</p>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">CEP</label>
                    <div className="relative">
                        <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input type="text" maxLength={9} className={`w-full bg-[color:var(--bg-elevated)] border rounded-xl pl-9 pr-9 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)] ${quickCreateCepError ? 'border-red-500' : 'border-[color:var(--border-subtle)]'}`}
                            value={newDebtorData.cep}
                            onChange={e => {
                                const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                                const formatted = digits.length > 5 ? `${digits.slice(0,5)}-${digits.slice(5)}` : digits;
                                setNewDebtorData(p => ({ ...p, cep: formatted }));
                                setQuickCreateCepError('');
                                if (digits.length === 8) handleQuickCepLookup(digits);
                            }}
                            placeholder="00000-000 (opcional)" />
                        {quickCreateCepLoading && <Activity size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-teal-500 animate-spin" />}
                    </div>
                    {quickCreateCepError && <p className="text-red-400 text-[10px] mt-1 font-bold">{quickCreateCepError}</p>}
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">Logradouro</label>
                    <input type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.logradouro} onChange={e => setNewDebtorData(p => ({ ...p, logradouro: e.target.value }))} placeholder="Rua, Av..." />
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">Número</label>
                        <input type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.numero} onChange={e => setNewDebtorData(p => ({ ...p, numero: e.target.value }))} placeholder="Nº" />
                    </div>
                    <div className="col-span-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">Bairro</label>
                        <input type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.bairro} onChange={e => setNewDebtorData(p => ({ ...p, bairro: e.target.value }))} placeholder="Bairro" />
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">Cidade</label>
                        <input type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.cidade} onChange={e => setNewDebtorData(p => ({ ...p, cidade: e.target.value }))} placeholder="Cidade" />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-[color:var(--text-muted)] block mb-1">UF</label>
                        <input type="text" maxLength={2} className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)] uppercase" value={newDebtorData.uf} onChange={e => setNewDebtorData(p => ({ ...p, uf: e.target.value.toUpperCase() }))} placeholder="SP" />
                    </div>
                </div>
            </div>
        </form>
        </div>
        {/* Footer fixo */}
        <div className="shrink-0 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]/90 px-6 pt-4 pb-[max(calc(env(safe-area-inset-bottom,0px)+5.5rem),5.5rem)] md:pb-5 backdrop-blur">
            <button type="submit" form="quick-create-debtor-form" disabled={quickCreateLoading} className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-teal-900/30">
                {quickCreateLoading ? <Loader2 className="animate-spin" size={18}/> : <UserPlus size={18}/>} Cadastrar Rápido
            </button>
        </div>
      </div>
    );
  }

  if (contractsSubView === 'edit' && contractToEdit) {
    return (
      <div className="flex h-full flex-col overflow-y-auto p-6 md:p-8 bg-[color:var(--bg-elevated)]">
        <div className="panel-card rounded-[2.5rem] p-8 shadow-2xl w-full max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-6">
              <div>
                  <p className="section-kicker mb-2">Ajuste operacional</p>
                  <h3 className="font-display text-4xl leading-none text-[color:var(--text-primary)]">Editar contrato</h3>
              </div>
              <button onClick={() => setContractsSubView('list')} className="p-2 hover:bg-[color:var(--bg-soft)] rounded-full transition-colors">
                  <X className="text-[color:var(--text-secondary)]" size={20}/>
              </button>
          </div>
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-5">
                  <div className="rounded-[1.6rem] border border-white/10 bg-black/10 p-5">
                      <p className="section-kicker mb-4">Parâmetros financeiros</p>
                      <div className="space-y-4">
                          <div>
                              <label className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Nome do contrato</label>
                              <input
                                  type="text"
                                  value={editContractName}
                                  onChange={e => setEditContractName(e.target.value)}
                                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-sm font-semibold text-[color:var(--text-primary)] outline-none transition-all focus:border-[color:var(--accent-brass)]"
                                  placeholder="Ex: Empréstimo João"
                              />
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                  <label className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Valor emprestado</label>
                                  <div className="relative">
                                      <Wallet size={16} className="absolute left-4 top-4 text-[color:var(--text-faint)]" />
                                      <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={editContractPrincipal}
                                          onChange={e => setEditContractPrincipal(e.target.value)}
                                          className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3.5 pl-11 pr-4 text-sm font-semibold text-[color:var(--text-primary)] outline-none transition-all focus:border-[color:var(--accent-brass)]"
                                      />
                                  </div>
                              </div>
                              <div>
                                  <label className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Valor da parcela aberta</label>
                                  <div className="relative">
                                      <Banknote size={16} className="absolute left-4 top-4 text-[color:var(--text-faint)]" />
                                      <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={editContractInstallmentValue}
                                          onChange={e => setEditContractInstallmentValue(e.target.value)}
                                          className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3.5 pl-11 pr-4 text-sm font-semibold text-[color:var(--text-primary)] outline-none transition-all focus:border-[color:var(--accent-brass)]"
                                      />
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>

                  <div className="rounded-[1.6rem] border border-white/10 bg-black/10 p-5">
                      <p className="section-kicker mb-4">Leitura após o ajuste</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-faint)]">Parcelas abertas</p>
                              <p className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{editOpenInstallments.length}</p>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-faint)]">Parcelas pagas</p>
                              <p className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{editPaidInstallments.length}</p>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-faint)]">Valor total recalculado</p>
                              <p className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{formatCurrency(editCurrentValuePreview)}</p>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-faint)]">Taxa implícita</p>
                              <p className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{editInterestRatePreview.toFixed(2)}%</p>
                          </div>
                      </div>
                      <p className="mt-4 text-xs leading-6 text-[color:var(--text-secondary)]">
                          Parcelas já pagas permanecem preservadas. O ajuste redistribui apenas as parcelas em aberto.
                      </p>
                  </div>
              </div>

              <div className="rounded-[1.6rem] border border-white/10 bg-black/10 p-5">
                  <div className="flex items-center justify-between gap-4">
                      <div>
                          <p className="section-kicker mb-2">Cronograma</p>
                          <h4 className="font-display text-3xl leading-none text-[color:var(--text-primary)]">Datas das parcelas</h4>
                      </div>
                      <div className="rounded-2xl bg-[rgba(202,176,122,0.14)] p-3 text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.18)]">
                          <CalendarDays size={18} />
                      </div>
                  </div>

                  <div className="custom-scrollbar mt-5 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                      {editContractLoading ? (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-[color:var(--text-secondary)]">
                              Carregando cronograma do contrato...
                          </div>
                      ) : editInstallments.length === 0 ? (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-[color:var(--text-secondary)]">
                              Nenhuma parcela encontrada para este contrato.
                          </div>
                      ) : (
                          editInstallments.map((installment) => {
                              const locked = installment.status === 'paid';
                              return (
                                  <div key={installment.id} className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                          <div>
                                              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[color:var(--text-faint)]">Parcela {installment.number}</p>
                                              <p className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">
                                                  {locked ? 'Parcela liquidada' : 'Parcela em aberto'}
                                              </p>
                                              <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
                                                  {locked
                                                      ? `Recebido ${formatCurrency(Number(installment.amount_paid || 0))}`
                                                      : `Valor previsto ${formatCurrency(Number(installment.amount_total || 0))}`}
                                              </p>
                                          </div>
                                          <div className="flex items-center gap-3">
                                              <input
                                                  type="date"
                                                  disabled={locked}
                                                  value={installment.due_date}
                                                  onChange={(event) => handleEditInstallmentDateChange(installment.id, event.target.value)}
                                                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-[color:var(--text-primary)] outline-none transition-all focus:border-[color:var(--accent-brass)] disabled:cursor-not-allowed disabled:opacity-45"
                                              />
                                          </div>
                                      </div>
                                  </div>
                              );
                          })
                      )}
                  </div>
              </div>
          </div>

          {editContractError && (
              <div className="mt-6 rounded-2xl border border-[rgba(198,126,105,0.22)] bg-[rgba(198,126,105,0.08)] px-4 py-3 text-sm text-[color:var(--accent-danger)]">
                  {editContractError}
              </div>
          )}

          <div className="flex gap-3 mt-6">
              <button onClick={() => setContractsSubView('list')} className="flex-1 bg-[color:var(--bg-soft)] hover:bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all">
                  Cancelar
              </button>
              <button onClick={handleEditContractSave} disabled={editContractLoading || !editContractName.trim()} className="flex-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                  {editContractLoading ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>}
                  {editContractLoading ? 'Salvando...' : 'Salvar'}
              </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in pb-12 w-full max-w-[100vw]">
      <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-1">
        <div>
            <p className="section-kicker mb-2">Crédito operacional</p>
            <h2 className="font-display text-5xl leading-none text-[color:var(--text-primary)]">Contratos</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[color:var(--text-secondary)]">Crie, acompanhe e revise contratos com leitura clara de principal, prazo e cronograma financeiro.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
            <button onClick={() => setIsNLContractOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-6 py-3 text-sm font-semibold text-[color:var(--text-primary)] transition-all hover:bg-white/[0.08]">
                <Zap size={16} className="text-[color:var(--accent-steel)]"/> Cadastro Rápido
            </button>
            <button onClick={handleOpenWizard} className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent-brass)] px-6 py-3 text-sm font-extrabold text-[color:var(--text-on-accent)] transition-all hover:bg-[color:var(--accent-brass-strong)]">
                <PlusCircle size={16} /> Novo Contrato
            </button>
        </div>
      </div>
      </div>
      
      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-[color:var(--accent-brass)] w-12" /></div>
      ) : contracts.length === 0 ? (
        <div className="panel-card rounded-[2rem] border border-dashed border-white/10 py-24 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]">
                <Wallet size={32}/>
            </div>
            <h3 className="font-display text-4xl leading-none text-[color:var(--text-primary)]">Carteira vazia</h3>
            <p className="mx-auto mt-4 max-w-xs text-sm leading-7 text-[color:var(--text-secondary)]">Nenhum contrato ativo no momento. Inicie um novo empréstimo para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {contracts.map(contract => (
                <div key={contract.id} className="panel-card relative flex h-full flex-col justify-between rounded-[2rem] p-7 transition-all hover:border-white/15">
                    <div>
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.18)]"><Wallet size={20}/></div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => { setViewingContractId(contract.id); setViewingContract(contract); setContractsSubView('detail'); }} className="rounded-full border border-white/10 bg-white/[0.03] p-3 min-h-[44px] min-w-[44px] flex items-center justify-center text-[color:var(--text-muted)] transition-all hover:text-white" title="Ver detalhes"><Eye size={16}/></button>
                                <button onClick={() => handleOpenContractEdit(contract)} className="rounded-full border border-white/10 bg-white/[0.03] p-3 min-h-[44px] min-w-[44px] flex items-center justify-center text-[color:var(--text-muted)] transition-all hover:text-[color:var(--accent-brass)]" title="Editar contrato"><Pencil size={16}/></button>
                                <button onClick={() => { setContractToDelete(contract); setIsDeleteConfirmOpen(true); }} className="rounded-full border border-white/10 bg-white/[0.03] p-3 min-h-[44px] min-w-[44px] flex items-center justify-center text-[color:var(--text-muted)] transition-all hover:text-[color:var(--accent-danger)]" title="Excluir contrato"><Trash2 size={16}/></button>
                            </div>
                        </div>
                        <div className="section-kicker mb-2">Contrato #{contract.id}</div>
                        <h3 className="font-display text-[2rem] leading-tight text-[color:var(--text-primary)] truncate mb-1">{contract.asset_name}</h3>
                        <div className="flex items-center gap-2 mb-6">
                            <span className="h-2 w-2 rounded-full bg-[color:var(--accent-positive)]"></span>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">{contract.payer_name}</p>
                        </div>
                    </div>
                    
                    {(contract.source_profit || 0) > 0 && (
                        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[rgba(143,179,157,0.16)] bg-[rgba(143,179,157,0.08)] p-3">
                            <div className="rounded-xl bg-[rgba(143,179,157,0.12)] p-2 text-[color:var(--accent-positive)]"><TrendingUp size={12}/></div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-[color:var(--accent-positive)] uppercase tracking-[0.16em]">
                                    {((contract.source_profit! / contract.amount_invested) * 100).toFixed(0)}% Reinvestido
                                </span>
                                {contract.source_capital! > 0 && (
                                    <span className="text-[10px] font-semibold text-[color:var(--text-faint)] uppercase tracking-[0.16em]">
                                        + {((contract.source_capital! / contract.amount_invested) * 100).toFixed(0)}% Aporte
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="grid gap-4 border-t border-white/10 pt-5">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="min-w-0">
                                <p className="section-kicker mb-1">Principal</p>
                                <p className="truncate text-lg font-semibold text-[color:var(--text-primary)]">{formatCurrency(Number(contract.amount_invested))}</p>
                            </div>
                            <div className="min-w-0 text-right">
                                <p className="section-kicker mb-1">Valor total</p>
                                <p className="truncate text-lg font-semibold text-[color:var(--text-primary)]">{formatCurrency(Number(contract.current_value))}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="min-w-0">
                                <p className="section-kicker mb-1">Parcela</p>
                                <p className="truncate text-sm font-semibold text-[color:var(--text-secondary)]">{formatCurrency(Number(contract.installment_value || 0))}</p>
                            </div>
                            <div className="min-w-0 text-right">
                                <p className="section-kicker mb-1">Prazo</p>
                                <p className="truncate text-sm font-semibold text-[color:var(--text-secondary)]">{contract.total_installments}x</p>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      )}

      {/* --- MODAL: CONFIRMAÇÃO DE EXCLUSÃO --- */}
      {isDeleteConfirmOpen && contractToDelete && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
              <div className="bg-[color:var(--bg-elevated)] border border-red-900/50 rounded-[2.5rem] w-full max-w-sm shadow-2xl p-8 animate-fade-in-up">
                  <div className="text-center mb-6">
                      <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Trash2 size={28} className="text-red-400"/>
                      </div>
                      <h3 className="text-xl font-black text-[color:var(--text-primary)] uppercase tracking-tight">Excluir Contrato</h3>
                      <p className="text-[color:var(--text-secondary)] text-sm mt-2">Esta ação é <strong className="text-red-400">irreversível</strong>. Todas as parcelas do contrato serão apagadas.</p>
                      <p className="text-[color:var(--text-primary)] font-bold mt-3 bg-[color:var(--bg-base)] px-4 py-2 rounded-xl border border-[color:var(--border-subtle)] truncate">"{contractToDelete.asset_name}"</p>
                  </div>
                  <div className="flex gap-3">
                      <button onClick={() => { setIsDeleteConfirmOpen(false); setContractToDelete(null); }} className="flex-1 bg-[color:var(--bg-soft)] hover:bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all">
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
