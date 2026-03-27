
import React, { useEffect, useState, useMemo } from 'react';
import { fetchProfileByAuthUserId, getSupabase, parseSupabaseError, isValidCPF } from '../services/supabase';
import { Investment, Tenant, Profile, AppView } from '../types';
import { useCompanyContext } from '../services/companyScope';
import QuickContractInput from './QuickContractInput';
import ContractDetail from './ContractDetail';
import ContractRenewalModal from './ContractRenewalModal';
import {
    Search, PlusCircle, CheckCircle2, X, RefreshCw,
    ArrowRight, Calendar, Zap, Wallet, ChevronRight,
    Minus, Plus, Banknote, Percent, CalendarDays,
    CalendarClock, UserPlus, Loader2, UserCog, ShieldCheck, Eye, ChevronDown, Coins, TrendingUp, Sparkles,
    Trash2, Pencil, Mail, Phone, Key, MapPin, Activity, History
} from 'lucide-react';
import {
    formatCurrency, formatDecimalInput, roundCurrency, distributeEvenly,
    calculateInstallmentDates, calculateFinancials, buildFreelancerDates
} from '../utils/financials';

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
            (p.full_name || '').toLowerCase().includes(lower) ||
            (p.email || '').toLowerCase().includes(lower)
        );
    }, [searchTerm, profiles]);

    if (selectedProfile) {
        return (
            <div className={`p-5 rounded-3xl border flex items-center justify-between animate-fade-in transition-all relative overflow-hidden group ${
                role === 'investor'
                    ? 'bg-[color:var(--accent-positive-subtle)] border-[color:var(--accent-positive-border)] shadow-lg'
                    : 'bg-[color:var(--accent-steel-subtle)] border-[color:var(--accent-steel-border)] shadow-lg'
            }`}>
                {isDefault && (
                    <div className="absolute top-0 right-0 bg-[color:var(--accent-positive)] type-micro text-white px-3 py-1 rounded-bl-xl shadow-md z-20">
                        Padrão
                    </div>
                )}
                <div className="flex items-center gap-4 relative z-10">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl border shadow-inner ${
                        role === 'investor' ? 'bg-[color:var(--accent-positive-subtle)] text-[color:var(--accent-positive)] border-[color:var(--accent-positive-border)]' : 'bg-[color:var(--accent-steel-subtle)] text-[color:var(--accent-steel)] border-[color:var(--accent-steel-border)]'
                    }`}>
                        {(selectedProfile.full_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <p className={`type-label mb-1 ${role === 'investor' ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--accent-steel)]'}`}>
                            {label}
                        </p>
                        <div className="flex items-center gap-2">
                            <p className="text-[color:var(--text-primary)] font-bold text-lg leading-none">{selectedProfile.full_name}</p>
                            {selectedProfile.role === 'admin' && (
                                <div className="bg-[color:var(--bg-elevated)] p-1 rounded-md border border-[color:var(--border-subtle)]" title="Administrador">
                                    <ShieldCheck size={12} className="text-[color:var(--accent-positive)]"/>
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
                <label className={`type-label ${role === 'investor' ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--accent-steel)]'}`}>{label}</label>
                {onCreateNew && (
                    <button onClick={onCreateNew} className="text-[10px] font-bold text-[color:var(--accent-positive)] flex items-center gap-1.5 transition-colors bg-[color:var(--accent-positive-subtle)] px-3 py-1.5 rounded-lg border border-[color:var(--accent-positive-border)] hover:opacity-80">
                        <PlusCircle size={12}/> Novo Cadastro
                    </button>
                )}
            </div>
            <div className="relative group">
                <Search className="absolute left-4 top-4 text-[color:var(--text-muted)] group-focus-within:text-[color:var(--accent-positive)] transition-colors" size={20} />
                <input
                    type="text"
                    placeholder={role === 'investor' ? "Selecione o credor..." : "Busque ou selecione o cliente..."}
                    className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl pl-12 pr-10 p-4 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--border-subtle)] outline-none transition-all shadow-inner focus:ring-1 focus:ring-[color:var(--border-subtle)] cursor-pointer"
                    value={searchTerm}
                    onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                />
                <ChevronDown size={20} className={`absolute right-4 top-4 text-[color:var(--text-muted)] transition-transform duration-300 pointer-events-none ${showDropdown ? 'rotate-180 text-[color:var(--accent-positive)]' : ''}`} />
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
                                            {(p.full_name || '?').charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-[color:var(--text-primary)] font-bold text-sm group-hover/item:text-[color:var(--accent-positive)] transition-colors">{p.full_name}</p>
                                            <p className="text-[color:var(--text-muted)] text-[10px]">{p.email}</p>
                                        </div>
                                    </div>
                                    {p.role === 'admin' && <span className="type-micro bg-[color:var(--accent-positive-subtle)] text-[color:var(--accent-positive)] px-2 py-1 rounded border border-[color:var(--accent-positive-border)]">Admin</span>}
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

interface AdminContractsProps { autoOpenCreate?: boolean; onNavigate?: (view: AppView) => void; }
const AdminContracts: React.FC<AdminContractsProps> = ({ autoOpenCreate = false, onNavigate }) => {
  const { activeCompanyId } = useCompanyContext();
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
      calculation_mode: 'auto' as 'auto' | 'manual' | 'interest_only',
      source_profit_amount: 0,
      skip_saturday: false,
      skip_sunday: false,
      bullet_principal_mode: 'together' as 'together' | 'separate',
      capitalize_interest: true,
  });

  const [selectedInvestor, setSelectedInvestor] = useState<Profile | null>(null);
  const [selectedPayer, setSelectedPayer] = useState<Profile | null>(null);
  const [previewDateStrings, setPreviewDateStrings] = useState<string[]>([]);
  const [freelancerDates, setFreelancerDates] = useState<string[]>([]);
  const [freelancerInterval, setFreelancerInterval] = useState<number>(7);
  const [bulletHasFixedDuration, setBulletHasFixedDuration] = useState(false);
  const [installmentsInput, setInstallmentsInput] = useState(String(formData.total_installments));
  const [rateInput, setRateInput] = useState(String(formData.interest_rate));
  const [installmentValueInput, setInstallmentValueInput] = useState(String(formData.installment_value));
  const [monthOffset, setMonthOffset] = useState<0 | 1 | undefined>(undefined);
  const [viewingContractId, setViewingContractId] = useState<number | null>(null);
  const [viewingContract, setViewingContract] = useState<Investment | null>(null);
  const [contractsSubView, setContractsSubView] = useState<'list' | 'detail' | 'renewal' | 'create' | 'create-client' | 'edit'>(autoOpenCreate ? 'create' : 'list');
  const [renewalSource, setRenewalSource] = useState<Investment | null>(null);

  const [contractSearchTerm, setContractSearchTerm] = useState('');

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

  const filteredContracts = useMemo(() => {
      if (!contractSearchTerm) return contracts;
      const lower = contractSearchTerm.toLowerCase();
      return contracts.filter(c =>
          (c.asset_name || '').toLowerCase().includes(lower) ||
          (c.payer_name || '').toLowerCase().includes(lower) ||
          (c.investor_name || '').toLowerCase().includes(lower) ||
          String(c.id).includes(lower)
      );
  }, [contractSearchTerm, contracts]);

  const fetchData = async () => {
    setLoading(true);
    const supabase = getSupabase();
    if (!supabase) return;

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        setCurrentUserId(user.id);
        
        const { data: profile } = await fetchProfileByAuthUserId<Profile & { tenants?: Tenant }>(
            supabase,
            user.id,
            '*, tenants!profiles_tenant_id_fkey(*)'
        );
            
        if (!profile?.tenant_id) return;
        
        setCurrentUserId(profile.id);
        setCurrentTenant(profile.tenants as any);

        let profQuery = supabase.from('profiles').select('*').eq('tenant_id', profile.tenant_id).order('full_name');
        if (activeCompanyId) profQuery = profQuery.eq('company_id', activeCompanyId);
        const { data: profData } = await profQuery;

        let allProfiles = profData || [];
        if (profile && !allProfiles.find(p => p.id === profile.id)) {
            allProfiles = [profile, ...allProfiles];
        }
        setProfiles(allProfiles);

        let invQuery = supabase.from('investments')
            .select(`*, investor:profiles!investments_user_id_fkey(full_name, email), payer:profiles!investments_payer_id_fkey(full_name, email)`)
            .eq('tenant_id', profile.tenant_id)
            .order('created_at', { ascending: false });
        if (activeCompanyId) invQuery = invQuery.eq('company_id', activeCompanyId);
        const { data: invData } = await invQuery;

        setContracts((invData || []).map(i => ({
            ...i,
            investor_name: i.investor?.full_name || 'N/A',
            payer_name: i.payer?.full_name || 'N/A'
        })));

    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [activeCompanyId]);

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

      setFormData({
          asset_name: '',
          amount_invested: 0,
          total_installments: 12,
          frequency: 'monthly',
          due_day: 10,
          weekday: 1,
          start_date: today.toISOString().split('T')[0],
          interest_rate: 10,
          installment_value: 0,
          current_value: 0,
          calculation_mode: 'auto',
          source_profit_amount: 0,
          skip_saturday: false,
          skip_sunday: false,
          bullet_principal_mode: 'together',
          capitalize_interest: true,
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
      setFreelancerDates([]);
      setFreelancerInterval(7);
      setBulletHasFixedDuration(false);
      setMonthOffset(undefined);
      setInstallmentsInput('12');
      setRateInput('10');
      setInstallmentValueInput('0');
      setStep(1);
      setContractsSubView('create');
  };

  // buildFreelancerDates imported from utils/financials

  const updateFormState = (partial: Partial<typeof formData>) => {
      const merged = { ...formData, ...partial };
      const financial = calculateFinancials(
          merged.amount_invested,
          merged.total_installments,
          merged.interest_rate,
          merged.calculation_mode,
          merged.installment_value,
          merged.bullet_principal_mode
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

      if (partial.frequency !== undefined && partial.frequency !== 'monthly') {
          setMonthOffset(undefined);
      }

      if (merged.frequency === 'freelancer') {
          // Para freelancer, recalcular datas se count ou start_date mudou
          const currentInterval = freelancerInterval;
          setFreelancerDates(prev => {
              const newCount = merged.total_installments;
              const startChanged = partial.start_date !== undefined;
              if (prev.length !== newCount || startChanged || prev.length === 0) {
                  const baseDate = prev.length > 0 && !startChanged ? prev[0] : merged.start_date;
                  return buildFreelancerDates(newCount, baseDate, currentInterval);
              }
              return prev;
          });
          setPreviewDateStrings([]);
      } else {
          const dateObjects = calculateInstallmentDates(
              merged.frequency,
              merged.due_day,
              merged.weekday,
              merged.start_date,
              merged.total_installments,
              merged.skip_saturday,
              merged.skip_sunday,
              merged.frequency === 'monthly' ? monthOffset : undefined
          );
          setPreviewDateStrings(dateObjects.map(d =>
              d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })
          ));
      }
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
              p_start_date: formData.frequency === 'daily' ? formData.start_date : null,
              p_calculation_mode: formData.calculation_mode,
              p_skip_saturday: formData.frequency === 'daily' ? formData.skip_saturday : false,
              p_skip_sunday:   formData.frequency === 'daily' ? formData.skip_sunday   : false,
              p_custom_dates:  formData.frequency === 'freelancer' ? freelancerDates : null,
              p_company_id:    activeCompanyId || null,
              p_bullet_principal_mode: formData.calculation_mode === 'interest_only' ? null : formData.bullet_principal_mode,
              p_capitalize_interest: formData.capitalize_interest,
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
              p_company_id:   activeCompanyId || null,
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
          // Deletar registros filhos antes do contrato (FK constraints)
          await supabase.from('payment_transactions').delete().eq('investment_id', contractToDelete.id);
          await supabase.from('loan_installments').delete().eq('investment_id', contractToDelete.id);
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
                <h3 className="type-label text-[color:var(--text-primary)] flex items-center gap-2">
                    Novo Contrato
                </h3>
                <div className="flex gap-1.5 mt-2">
                    {[1, 2, 3].map(i => (
                        <div key={i} className={`h-1.5 w-8 rounded-full transition-all duration-300 ${step >= i ? 'bg-[color:var(--accent-positive)]' : 'bg-[color:var(--border-subtle)]'}`}></div>
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
                        <h3 className="type-heading uppercase text-[color:var(--text-primary)]">Partes Envolvidas</h3>
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
                        <h3 className="type-heading uppercase text-[color:var(--text-primary)]">Termos Financeiros</h3>
                        <p className="text-[color:var(--text-secondary)] text-xs mt-1">Detalhes do fluxo de caixa e prazos.</p>
                    </div>

                    <div>
                        <label className="type-label text-[color:var(--text-muted)] ml-1 mb-3 block">Tipo de Contrato</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => {
                                    if (formData.calculation_mode === 'interest_only') {
                                        setInstallmentsInput('12');
                                        updateFormState({ calculation_mode: 'auto', total_installments: 12 });
                                    }
                                }}
                                className={`flex flex-col items-center justify-center p-4 rounded-2xl border transition-all gap-1.5 ${
                                    formData.calculation_mode !== 'interest_only'
                                        ? 'bg-[color:var(--accent-positive)] border-[color:var(--accent-positive)] text-white shadow-lg'
                                        : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                                }`}
                            >
                                <Banknote size={20} />
                                <span className="type-label">Parcelado</span>
                                <span className="text-[10px] opacity-70 font-medium">Parcelas fixas com juros</span>
                            </button>
                            <button
                                onClick={() => {
                                    setBulletHasFixedDuration(false);
                                    updateFormState({ calculation_mode: 'interest_only', total_installments: 120 });
                                }}
                                className={`flex flex-col items-center justify-center p-4 rounded-2xl border transition-all gap-1.5 ${
                                    formData.calculation_mode === 'interest_only'
                                        ? 'bg-[color:var(--accent-caution)] border-[color:var(--accent-caution)] text-white shadow-lg'
                                        : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                                }`}
                            >
                                <Activity size={20} />
                                <span className="type-label">Juros Simples</span>
                                <span className="text-[10px] opacity-70 font-medium">Paga só os juros por período</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                        <div>
                            <label className="type-label text-[color:var(--text-muted)] ml-1 mb-1 block">Nome do Ativo</label>
                            <input
                                type="text"
                                className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)] font-bold focus:border-[color:var(--accent-positive)] outline-none transition-all"
                                placeholder={`Ex: Empréstimo ${selectedPayer?.full_name.split(' ')[0]}`}
                                value={formData.asset_name}
                                onChange={e => setFormData({...formData, asset_name: e.target.value})}
                            />
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="type-label text-[color:var(--text-muted)] ml-1 mb-1 block">Valor Principal (Aporte)</label>
                                <div className="relative group">
                                    <span className="absolute left-4 top-4 text-[color:var(--accent-positive)] font-bold transition-colors">R$</span>
                                    <input
                                        type="number" inputMode="decimal" step="0.01"
                                        className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl pl-12 pr-4 py-4 text-2xl font-semibold text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-positive)] transition-all"
                                        value={formData.amount_invested || ''}
                                        onChange={e => updateFormState({ amount_invested: parseFloat(e.target.value) })}
                                        onWheel={e => e.currentTarget.blur()}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>

                            <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 relative overflow-hidden">
                                <div className="absolute -right-4 -top-4 bg-emerald-500/10 w-24 h-24 rounded-full blur-2xl pointer-events-none"></div>

                                <div className="flex justify-between items-center mb-4 relative z-10">
                                    <h4 className="type-label text-[color:var(--accent-positive)] flex items-center gap-1.5">
                                        <Coins size={12}/> Fonte de Recursos
                                    </h4>
                                    <div className="text-[9px] text-[color:var(--text-muted)] font-bold bg-[color:var(--bg-base)] px-2 py-1 rounded border border-[color:var(--border-subtle)]">
                                        Caixa Livre: <span className="text-[color:var(--accent-positive)]">{formatCurrency(availableProfit)}</span>
                                    </div>
                                </div>

                                <div className="space-y-4 relative z-10">
                                    <div>
                                        <div className="flex justify-between items-center text-xs mb-2">
                                            <span className="text-[color:var(--accent-positive)] font-bold">Usar Lucro Acumulado</span>
                                            <span className="text-[color:var(--text-primary)] type-micro bg-[color:var(--accent-positive-subtle)] px-2 py-0.5 rounded">{formatCurrency(formData.source_profit_amount)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min={0}
                                            max={Math.min(availableProfit, formData.amount_invested)}
                                            step={0.01}
                                            value={formData.source_profit_amount}
                                            onChange={(e) => updateFormState({ source_profit_amount: Number(e.target.value) })}
                                            className="w-full h-2 bg-[color:var(--bg-elevated)] rounded-lg appearance-none cursor-pointer transition-all"
                                            style={{ accentColor: 'var(--accent-positive)' }}
                                            disabled={availableProfit <= 0 || formData.amount_invested <= 0}
                                        />
                                    </div>

                                    <div className="flex justify-between items-center pt-3 border-t border-[color:var(--border-subtle)]">
                                        <div className="type-label text-[color:var(--text-muted)]">
                                            Dinheiro Novo (Aporte)
                                        </div>
                                        <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                                            {formatCurrency(formData.amount_invested - formData.source_profit_amount)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {formData.calculation_mode !== 'interest_only' && (
                        <div className="bg-[color:var(--bg-base)]/50 p-5 rounded-3xl border border-[color:var(--border-subtle)]">
                            <label className="type-label text-[color:var(--text-secondary)] mb-3 block text-center">Duração do Contrato</label>
                            <div className="flex items-center justify-between bg-[color:var(--bg-base)] rounded-2xl p-1 border border-[color:var(--border-subtle)]">
                                <button onClick={() => { const v = Math.max(1, formData.total_installments - 1); updateFormState({ total_installments: v }); setInstallmentsInput(String(v)); }} className="w-12 h-12 flex items-center justify-center text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] rounded-xl transition-all"><Minus size={20}/></button>
                                <div className="text-center">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        className="w-16 bg-transparent text-center type-heading text-[color:var(--text-primary)] border-b border-transparent focus:border-[color:var(--accent-positive)] outline-none transition-colors cursor-text"
                                        value={installmentsInput}
                                        onChange={e => setInstallmentsInput(e.target.value.replace(/\D/g, ''))}
                                        onBlur={() => {
                                            const v = Math.min(120, Math.max(1, parseInt(installmentsInput) || 1));
                                            setInstallmentsInput(String(v));
                                            updateFormState({ total_installments: v });
                                        }}
                                        onFocus={e => e.target.select()}
                                        aria-label="Número de parcelas"
                                    />
                                    <span className="type-micro text-[color:var(--text-muted)] block">Parcelas</span>
                                </div>
                                <button onClick={() => { const v = Math.min(120, formData.total_installments + 1); updateFormState({ total_installments: v }); setInstallmentsInput(String(v)); }} className="w-12 h-12 flex items-center justify-center text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] rounded-xl transition-all"><Plus size={20}/></button>
                            </div>
                        </div>
                    )}

                    {formData.calculation_mode === 'interest_only' && (
                        <div className="bg-[color:var(--bg-base)]/50 p-5 rounded-3xl border border-[color:var(--border-subtle)]">
                            <label className="type-label text-[color:var(--text-secondary)] mb-3 block text-center">Prazo</label>
                            <div className="grid grid-cols-2 gap-2 mb-4">
                                <button
                                    onClick={() => {
                                        setBulletHasFixedDuration(false);
                                        updateFormState({ total_installments: 120 });
                                    }}
                                    className={`py-3 rounded-xl border transition-all type-label ${
                                        !bulletHasFixedDuration
                                            ? 'bg-[color:var(--accent-caution)] border-[color:var(--accent-caution)] text-white shadow-md'
                                            : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                                    }`}
                                >
                                    Indeterminado
                                </button>
                                <button
                                    onClick={() => {
                                        setBulletHasFixedDuration(true);
                                        const v = parseInt(installmentsInput) || 12;
                                        setInstallmentsInput(String(v));
                                        updateFormState({ total_installments: v });
                                    }}
                                    className={`py-3 rounded-xl border transition-all type-label ${
                                        bulletHasFixedDuration
                                            ? 'bg-[color:var(--accent-caution)] border-[color:var(--accent-caution)] text-white shadow-md'
                                            : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                                    }`}
                                >
                                    Determinado
                                </button>
                            </div>
                            {bulletHasFixedDuration ? (
                                <div className="flex items-center justify-between bg-[color:var(--bg-base)] rounded-2xl p-1 border border-[color:var(--border-subtle)] animate-fade-in">
                                    <button onClick={() => { const v = Math.max(1, formData.total_installments - 1); updateFormState({ total_installments: v }); setInstallmentsInput(String(v)); }} className="w-12 h-12 flex items-center justify-center text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] rounded-xl transition-all"><Minus size={20}/></button>
                                    <div className="text-center">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            className="w-16 bg-transparent text-center type-heading text-[color:var(--text-primary)] border-b border-transparent focus:border-[color:var(--accent-caution)] outline-none transition-colors cursor-text"
                                            value={installmentsInput}
                                            onChange={e => setInstallmentsInput(e.target.value.replace(/\D/g, ''))}
                                            onBlur={() => {
                                                const v = Math.min(120, Math.max(1, parseInt(installmentsInput) || 1));
                                                setInstallmentsInput(String(v));
                                                updateFormState({ total_installments: v });
                                            }}
                                            onFocus={e => e.target.select()}
                                            aria-label="Número de períodos"
                                        />
                                        <span className="type-micro text-[color:var(--text-muted)] block">Períodos</span>
                                    </div>
                                    <button onClick={() => { const v = Math.min(120, formData.total_installments + 1); updateFormState({ total_installments: v }); setInstallmentsInput(String(v)); }} className="w-12 h-12 flex items-center justify-center text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] rounded-xl transition-all"><Plus size={20}/></button>
                                </div>
                            ) : (
                                <p className="text-[11px] text-center text-[color:var(--text-muted)]">O contrato se encerra quando o saldo devedor zerar</p>
                            )}
                        </div>
                    )}

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
                                        ? 'bg-[color:var(--accent-positive)] border-[color:var(--accent-positive)] text-white shadow-lg'
                                        : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                                    }`}
                                >
                                    <opt.icon size={18} />
                                    <span className="type-micro">{opt.label}</span>
                                </button>
                            ))}
                        </div>

                        {formData.frequency === 'monthly' && (
                            <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-2 flex items-center animate-fade-in">
                                <div className="px-4 type-label text-[color:var(--text-muted)]">Todo dia</div>
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

                        {formData.frequency === 'monthly' && (
                            <div className="animate-fade-in">
                                <div className="type-label text-[color:var(--text-muted)] mb-2">Primeira cobrança</div>
                                <div className="flex gap-2">
                                    {([
                                        { label: 'Este mês', offset: 0 as const },
                                        { label: 'Próximo mês', offset: 1 as const },
                                    ] as { label: string; offset: 0 | 1 }[]).map(opt => (
                                        <button
                                            key={opt.label}
                                            onClick={() => {
                                                setMonthOffset(opt.offset);
                                                const dates = calculateInstallmentDates(
                                                    formData.frequency,
                                                    formData.due_day,
                                                    formData.weekday,
                                                    formData.start_date,
                                                    formData.total_installments,
                                                    formData.skip_saturday,
                                                    formData.skip_sunday,
                                                    opt.offset
                                                );
                                                setPreviewDateStrings(dates.map(d =>
                                                    d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })
                                                ));
                                            }}
                                            className={`type-label flex-1 py-3 rounded-2xl border transition-all ${
                                                monthOffset === opt.offset
                                                    ? 'bg-[color:var(--accent-positive)] border-[color:var(--accent-positive)] text-white shadow-lg'
                                                    : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {formData.frequency === 'weekly' && (
                            <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-2 flex items-center animate-fade-in">
                                <div className="px-4 type-label text-[color:var(--text-muted)]">Toda</div>
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
                        <div className="flex gap-2 animate-fade-in">
                            <button
                                onClick={() => updateFormState({ skip_saturday: !formData.skip_saturday })}
                                className={`flex items-center gap-3 flex-1 p-3 rounded-2xl border transition-all ${
                                    formData.skip_saturday
                                        ? 'bg-[color:var(--accent-positive-subtle)] border-[color:var(--accent-positive-border)] text-[color:var(--accent-positive)]'
                                        : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'
                                }`}
                            >
                                <div className={`w-9 h-5 rounded-full relative transition-all flex-shrink-0 ${formData.skip_saturday ? 'bg-[color:var(--accent-positive)]' : 'bg-[color:var(--bg-elevated)]'}`}>
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${formData.skip_saturday ? 'left-4' : 'left-0.5'}`} />
                                </div>
                                <span className="type-label">Pular Sábado</span>
                            </button>
                            <button
                                onClick={() => updateFormState({ skip_sunday: !formData.skip_sunday })}
                                className={`flex items-center gap-3 flex-1 p-3 rounded-2xl border transition-all ${
                                    formData.skip_sunday
                                        ? 'bg-[color:var(--accent-positive-subtle)] border-[color:var(--accent-positive-border)] text-[color:var(--accent-positive)]'
                                        : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'
                                }`}
                            >
                                <div className={`w-9 h-5 rounded-full relative transition-all flex-shrink-0 ${formData.skip_sunday ? 'bg-[color:var(--accent-positive)]' : 'bg-[color:var(--bg-elevated)]'}`}>
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${formData.skip_sunday ? 'left-4' : 'left-0.5'}`} />
                                </div>
                                <span className="type-label">Pular Domingo</span>
                            </button>
                        </div>
                    )}

                    {formData.frequency === 'daily' && (
                        <div className="animate-fade-in">
                            <div className="type-label text-[color:var(--text-muted)] mb-2">Primeira cobrança</div>
                            <div className="flex gap-2">
                                {[
                                    { label: 'Hoje', offset: 0 },
                                    { label: 'Amanhã', offset: 1 },
                                ].map(opt => {
                                    const d = new Date();
                                    d.setDate(d.getDate() + opt.offset);
                                    const val = d.toISOString().split('T')[0];
                                    return (
                                        <button
                                            key={opt.label}
                                            onClick={() => updateFormState({ start_date: val })}
                                            className={`type-label flex-1 py-3 rounded-2xl border transition-all ${
                                                formData.start_date === val
                                                    ? 'bg-[color:var(--accent-positive)] border-[color:var(--accent-positive)] text-white shadow-lg'
                                                    : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {formData.frequency === 'freelancer' && (
                        <div className="space-y-3 animate-fade-in">
                            <div className="rounded-2xl border border-[color:var(--border-subtle)] overflow-hidden">
                                <div className="px-4 py-3 bg-[color:var(--bg-base)] border-b border-[color:var(--border-subtle)]">
                                    <span className="type-label text-[color:var(--text-muted)]">Distribuição rápida</span>
                                </div>
                                <div className="p-3 flex flex-wrap gap-2 items-center bg-[color:var(--bg-elevated)]">
                                    {[
                                        { label: 'Semanal', days: 7 },
                                        { label: 'Quinzenal', days: 15 },
                                        { label: 'Mensal', days: 30 },
                                    ].map(opt => (
                                        <button
                                            key={opt.label}
                                            onClick={() => {
                                                setFreelancerInterval(opt.days);
                                                if (freelancerDates.length > 0) {
                                                    const newDates = buildFreelancerDates(formData.total_installments, freelancerDates[0], opt.days);
                                                    setFreelancerDates(newDates);
                                                }
                                            }}
                                            className={`type-label px-4 py-2 rounded-xl border transition-all ${
                                                freelancerInterval === opt.days
                                                    ? 'bg-[color:var(--accent-positive)] border-[color:var(--accent-positive)] text-white'
                                                    : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)]'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                    <div className="flex items-center gap-1.5 ml-auto">
                                        <span className="text-[10px] text-[color:var(--text-muted)] font-bold">A cada</span>
                                        <input
                                            type="number"
                                            min={1}
                                            className="w-14 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-2 py-1.5 text-sm text-center font-bold text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-positive)]"
                                            value={freelancerInterval}
                                            onChange={e => setFreelancerInterval(Math.max(1, parseInt(e.target.value) || 1))}
                                        />
                                        <span className="text-[10px] text-[color:var(--text-muted)] font-bold">dias</span>
                                        <button
                                            onClick={() => {
                                                if (freelancerDates.length > 0) {
                                                    const newDates = buildFreelancerDates(formData.total_installments, freelancerDates[0], freelancerInterval);
                                                    setFreelancerDates(newDates);
                                                }
                                            }}
                                            className="type-label px-3 py-1.5 bg-[color:var(--accent-positive)] hover:opacity-90 text-white rounded-xl transition-all"
                                        >
                                            Aplicar
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-[color:var(--border-subtle)] overflow-hidden">
                                <div className="flex items-center justify-between px-4 py-3 bg-[color:var(--bg-base)] border-b border-[color:var(--border-subtle)]">
                                    <span className="type-label text-[color:var(--text-muted)]">
                                        {freelancerDates.length} parcelas — datas editáveis
                                    </span>
                                    <span className="text-[10px] font-bold text-[color:var(--accent-brass)]">
                                        {formatCurrency(formData.installment_value)} cada
                                    </span>
                                </div>
                                <div className="max-h-64 overflow-y-auto divide-y divide-[color:var(--border-subtle)]">
                                    {freelancerDates.map((dateStr, idx) => (
                                        <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                                            <span className="type-micro text-[color:var(--text-faint)] w-6 text-right flex-shrink-0">
                                                #{idx + 1}
                                            </span>
                                            <input
                                                type="date"
                                                className="flex-1 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-1.5 text-sm font-bold text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-positive)] transition-all"
                                                value={dateStr}
                                                onChange={e => {
                                                    const updated = [...freelancerDates];
                                                    updated[idx] = e.target.value;
                                                    setFreelancerDates(updated);
                                                }}
                                            />
                                            <span className="text-xs font-bold text-[color:var(--accent-positive)] flex-shrink-0">
                                                {formatCurrency(formData.installment_value)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Preview de parcelas: oculto para bullet indeterminado (120 datas fictícias) */}
                    {previewDateStrings.length > 0 && !(formData.calculation_mode === 'interest_only' && !bulletHasFixedDuration) && (
                        <div className="rounded-2xl border border-[color:var(--border-subtle)] overflow-hidden animate-fade-in">
                            <div className="flex items-center justify-between px-4 py-3 bg-[color:var(--bg-base)] border-b border-[color:var(--border-subtle)]">
                                <span className="type-label text-[color:var(--text-muted)]">
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
                                            <span className="type-micro text-[color:var(--text-faint)] w-6 text-right">
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

                    {/* Preview de parcela para bullet indeterminado */}
                    {formData.calculation_mode === 'interest_only' && !bulletHasFixedDuration && formData.installment_value > 0 && (
                        <div className="rounded-2xl border border-[color:var(--accent-caution-border)] overflow-hidden animate-fade-in">
                            <div className="flex items-center justify-between px-4 py-3 bg-[color:var(--accent-caution-bg)] border-b border-[color:var(--accent-caution-border)]">
                                <span className="type-label text-[color:var(--accent-caution)]">Exemplo da próxima cobrança</span>
                                <span className="text-[10px] font-bold text-[color:var(--text-muted)]">Prazo indeterminado</span>
                            </div>
                            <div className="flex items-center justify-between px-4 py-3 bg-[color:var(--bg-base)]">
                                <div className="flex items-center gap-3">
                                    <span className="type-micro text-[color:var(--text-faint)] w-6 text-right">1</span>
                                    <span className="text-xs font-bold text-[color:var(--text-primary)] font-mono">
                                        {previewDateStrings[0] ?? '—'}
                                    </span>
                                </div>
                                <span className="text-xs font-bold text-[color:var(--accent-caution)]">
                                    {formatCurrency(formData.installment_value)}
                                </span>
                            </div>
                            <div className="px-4 py-2 bg-[color:var(--accent-caution-bg)]/50 border-t border-[color:var(--accent-caution-border)]">
                                <p className="text-[10px] text-[color:var(--text-muted)] text-center">Parcelas seguintes geradas automaticamente a cada período</p>
                            </div>
                        </div>
                    )}

                    {formData.calculation_mode !== 'interest_only' && (
                        <>
                            <div className="bg-[color:var(--bg-base)] p-1.5 rounded-2xl border border-[color:var(--border-subtle)] flex relative">
                                <button
                                    onClick={() => updateFormState({ calculation_mode: 'auto' })}
                                    className={`type-label flex-1 py-3 relative z-10 flex items-center justify-center gap-2 rounded-xl transition-all ${
                                        formData.calculation_mode === 'auto'
                                            ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] shadow-md'
                                            : 'text-[color:var(--text-muted)]'
                                    }`}
                                >
                                    <Percent size={14}/> Definir Taxa %
                                </button>
                                <button
                                    onClick={() => updateFormState({ calculation_mode: 'manual' })}
                                    className={`type-label flex-1 py-3 relative z-10 flex items-center justify-center gap-2 rounded-xl transition-all ${
                                        formData.calculation_mode === 'manual'
                                            ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] shadow-md'
                                            : 'text-[color:var(--text-muted)]'
                                    }`}
                                >
                                    <Banknote size={14}/> Definir Parcela
                                </button>
                            </div>

                            {formData.calculation_mode === 'auto' && (
                                <div className="space-y-2 animate-fade-in">
                                    <label className="type-label text-[color:var(--text-muted)] ml-1 block">Taxa de Juros</label>
                                    <div className="relative">
                                        <input
                                            type="text" inputMode="decimal"
                                            className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)] font-bold text-lg outline-none focus:border-[color:var(--accent-positive)] transition-all text-center"
                                            value={rateInput}
                                            onChange={e => setRateInput(e.target.value)}
                                            onFocus={e => { setRateInput(String(parseFloat(rateInput.replace(',', '.')) || '')); e.target.select(); }}
                                            onBlur={() => {
                                                const parsed = parseFloat(rateInput.replace(',', '.'));
                                                if (!isNaN(parsed) && parsed > 0) {
                                                    const rounded = Math.round(parsed * 100) / 100;
                                                    setRateInput(String(rounded));
                                                    updateFormState({ interest_rate: rounded });
                                                } else {
                                                    setRateInput(String(formData.interest_rate));
                                                }
                                            }}
                                        />
                                        <span className="absolute right-6 top-5 text-[color:var(--text-muted)] font-bold">%</span>
                                    </div>
                                    <div className="text-center text-xs text-[color:var(--text-secondary)]">
                                        Parcela Estimada: <strong className="text-[color:var(--text-primary)]">{formatCurrency(formData.installment_value)}</strong>
                                    </div>
                                </div>
                            )}

                            {formData.calculation_mode === 'manual' && (
                                <div className="space-y-2 animate-fade-in">
                                    <label className="type-label text-[color:var(--text-muted)] ml-1 block">Valor da Parcela</label>
                                    <div className="relative">
                                        <input
                                            type="text" inputMode="decimal"
                                            className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)] font-bold text-lg outline-none focus:border-indigo-500 transition-all text-center"
                                            value={installmentValueInput}
                                            onChange={e => setInstallmentValueInput(e.target.value)}
                                            onFocus={e => { setInstallmentValueInput(String(parseFloat(installmentValueInput.replace(',', '.')) || '')); e.target.select(); }}
                                            onBlur={() => {
                                                const parsed = parseFloat(installmentValueInput.replace(',', '.'));
                                                if (!isNaN(parsed) && parsed > 0) {
                                                    const rounded = Math.round(parsed * 100) / 100;
                                                    setInstallmentValueInput(String(rounded));
                                                    updateFormState({ installment_value: rounded });
                                                } else {
                                                    setInstallmentValueInput(String(formData.installment_value));
                                                }
                                            }}
                                        />
                                        <span className="absolute left-6 top-5 text-[color:var(--text-muted)] font-bold">R$</span>
                                    </div>
                                    <div className="text-center text-xs text-[color:var(--text-secondary)]">
                                        Taxa Implícita: <strong className="text-[color:var(--text-primary)]">{(Number(formData.interest_rate) || 0).toFixed(2)}%</strong>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {formData.calculation_mode === 'interest_only' && (
                        <div className="space-y-4 animate-fade-in">
                            <div className="space-y-2">
                                <p className="type-label text-[color:var(--text-secondary)]">Taxa de Juros</p>
                                <p className="text-[11px] text-[color:var(--text-secondary)] leading-relaxed -mt-1">Percentual cobrado por período sobre o saldo devedor</p>
                                <div className="relative">
                                    <input
                                        type="text" inputMode="decimal"
                                        className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-4 text-[color:var(--text-primary)] font-bold text-lg outline-none focus:border-[color:var(--accent-caution)] transition-all text-center"
                                        value={rateInput}
                                        onChange={e => {
                                            setRateInput(e.target.value);
                                            const parsed = parseFloat(e.target.value.replace(',', '.'));
                                            if (!isNaN(parsed) && parsed > 0) {
                                                updateFormState({ interest_rate: Math.round(parsed * 100) / 100 });
                                            }
                                        }}
                                        onFocus={e => { setRateInput(String(parseFloat(rateInput.replace(',', '.')) || '')); e.target.select(); }}
                                        onBlur={() => {
                                            const parsed = parseFloat(rateInput.replace(',', '.'));
                                            if (!isNaN(parsed) && parsed > 0) {
                                                const rounded = Math.round(parsed * 100) / 100;
                                                setRateInput(String(rounded));
                                                updateFormState({ interest_rate: rounded });
                                            } else {
                                                setRateInput(String(formData.interest_rate));
                                            }
                                        }}
                                    />
                                    <span className="absolute right-6 top-5 text-[color:var(--text-muted)] font-bold">% a.m.</span>
                                </div>
                                <div className="text-center text-xs text-[color:var(--text-secondary)]">
                                    Juros 1ª cobrança: <strong className="text-[color:var(--accent-caution)]">{formatCurrency(formData.installment_value)}</strong>
                                </div>
                            </div>

                            <div>
                                <p className="type-label text-[color:var(--accent-caution)] dark:text-amber-300 text-amber-700 mb-1">Capitalizar Juros</p>
                                <p className="text-[11px] text-[color:var(--text-secondary)] leading-relaxed mb-2">Se ativo, juros não pago é somado ao saldo devedor no próximo mês</p>
                                <button
                                    onClick={() => updateFormState({ capitalize_interest: !formData.capitalize_interest })}
                                    className={`w-full p-3 rounded-2xl border transition-all flex items-center justify-between ${
                                        formData.capitalize_interest
                                            ? 'bg-[color:var(--accent-positive-bg)] border-[color:var(--accent-positive-border)] text-[color:var(--accent-positive)]'
                                            : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'
                                    }`}
                                >
                                    <span className="type-label font-bold">{formData.capitalize_interest ? 'Capitalizar (ativo)' : 'Não capitalizar'}</span>
                                    <span className="text-[11px]">{formData.capitalize_interest ? 'Juros soma ao saldo devedor' : 'Juros fica como multa separada'}</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {step === 3 && (
                <div className="space-y-8 animate-fade-in-right">
                    <div className="text-center">
                        <h3 className="type-heading uppercase text-[color:var(--text-primary)]">Revisão Final</h3>
                        <p className="text-[color:var(--text-secondary)] text-xs mt-1">Confirme os dados para gerar o contrato.</p>
                    </div>

                    <div className="bg-gradient-to-b from-[color:var(--bg-elevated)] to-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

                        <div className="flex flex-wrap justify-between items-end gap-y-2 border-b border-[color:var(--border-subtle)] pb-6 mb-6">
                            <div className="min-w-0">
                                <p className="type-label text-[color:var(--text-muted)] mb-1">
                                    {formData.calculation_mode === 'interest_only' ? 'Saldo Devedor Inicial' : 'Total a Receber'}
                                </p>
                                <p className="type-title text-[color:var(--text-primary)] truncate">
                                    {formData.calculation_mode === 'interest_only'
                                        ? formatCurrency(formData.amount_invested)
                                        : formatCurrency(formData.current_value)
                                    }
                                </p>
                            </div>
                            {formData.calculation_mode !== 'interest_only' && (
                                <div className="text-right">
                                    <div className="bg-[color:var(--accent-positive-subtle)] border border-[color:var(--accent-positive-border)] text-[color:var(--accent-positive)] px-3 py-1 rounded-lg text-xs font-bold inline-block mb-1">
                                        +{formatCurrency(formData.current_value - formData.amount_invested)} Lucro
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-y-6 gap-x-4 text-sm mb-4">
                            <div>
                                <p className="type-label text-[color:var(--text-muted)] mb-1">Investimento Total</p>
                                <p className="text-[color:var(--text-primary)] font-bold">{formatCurrency(formData.amount_invested)}</p>
                            </div>
                            <div>
                                <p className="type-label text-[color:var(--text-muted)] mb-1">Fluxo</p>
                                <p className="text-[color:var(--text-primary)] font-bold">
                                    {formData.calculation_mode === 'interest_only'
                                        ? bulletHasFixedDuration
                                            ? `${formData.total_installments}x ${formatCurrency(formData.installment_value)} (juros)`
                                            : `${formatCurrency(formData.installment_value)}/período · Prazo indeterminado`
                                        : `${formData.total_installments}x de ${formatCurrency(formData.installment_value)}`
                                    }
                                </p>
                            </div>
                            <div>
                                <p className="type-label text-[color:var(--text-muted)] mb-1">Investidor</p>
                                <p className="text-[color:var(--text-primary)] font-bold truncate">{selectedInvestor?.full_name}</p>
                            </div>
                            <div>
                                <p className="type-label text-[color:var(--text-muted)] mb-1">Cliente</p>
                                <p className="text-[color:var(--text-primary)] font-bold truncate">{selectedPayer?.full_name}</p>
                            </div>
                        </div>

                        <div className="bg-[color:var(--bg-base)]/50 p-4 rounded-xl border border-[color:var(--border-subtle)] mt-4">
                            <div className="type-micro text-[color:var(--text-muted)] mb-3 flex items-center gap-2">
                                <Sparkles size={10} className="text-[color:var(--accent-positive)]"/> Composição do Aporte
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] p-3 rounded-xl text-center">
                                    <p className="text-[9px] text-[color:var(--text-secondary)] font-bold uppercase mb-1">Novo</p>
                                    <p className="text-sm font-semibold text-[color:var(--text-primary)]">{formatCurrency(formData.amount_invested - formData.source_profit_amount)}</p>
                                </div>
                                <div className="flex-1 bg-[color:var(--accent-positive-subtle)] border border-[color:var(--accent-positive-border)] p-3 rounded-xl text-center">
                                    <p className="text-[9px] text-[color:var(--accent-positive)] font-bold uppercase mb-1">Reinvestido</p>
                                    <p className="text-sm font-semibold text-[color:var(--accent-positive)]">{formatCurrency(formData.source_profit_amount)}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {formData.calculation_mode === 'interest_only' && (
                        <div className="bg-[color:var(--accent-caution-bg)] border border-[color:var(--accent-caution-border)] rounded-2xl p-4 animate-fade-in">
                            <div className="flex items-center gap-2 mb-2">
                                <Activity size={14} className="text-[color:var(--accent-caution)]"/>
                                <span className="type-label text-[color:var(--accent-caution)] font-bold">Contrato Bullet (Juros Apenas)</span>
                            </div>
                            <div className="text-[11px] text-[color:var(--text-secondary)] space-y-1">
                                <p>Juros 1ª parcela: <strong className="text-[color:var(--accent-caution)]">{formatCurrency(formData.installment_value)}</strong> ({formData.interest_rate}% a.m. sobre {formatCurrency(formData.amount_invested)})</p>
                                <p>Saldo devedor inicial: <strong className="text-[color:var(--text-primary)]">{formatCurrency(formData.amount_invested)}</strong></p>
                                <p>Capitalização: <strong className="text-[color:var(--text-primary)]">{formData.capitalize_interest ? 'Sim — juros não pago soma ao saldo' : 'Não — juros fica separado'}</strong></p>
                                <p className="text-[color:var(--accent-caution)] opacity-80">Parcelas seguintes geradas automaticamente a cada período</p>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-center gap-2 text-xs text-[color:var(--text-muted)] font-medium">
                        <ShieldCheck size={14} className="text-[color:var(--accent-positive)]"/> Contrato Validado pelo Banco
                    </div>
                </div>
            )}
        </div>

        <div className="flex gap-4 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-base)]/90 px-6 pt-6 pb-[max(calc(env(safe-area-inset-bottom,0px)+5.5rem),5.5rem)] md:pb-6 backdrop-blur">
            {step > 1 && (
                <button onClick={() => setStep(s => s - 1)} className="flex-1 bg-[color:var(--bg-elevated)] hover:bg-[color:var(--bg-soft)] text-[color:var(--text-primary)] py-4 rounded-2xl type-label transition-all border border-[color:var(--border-subtle)]">
                    Voltar
                </button>
            )}

            {step < 3 ? (
                <button onClick={() => setStep(s => s + 1)} disabled={(step === 1 && (!selectedInvestor || !selectedPayer)) || (step === 2 && !(formData.amount_invested > 0))} className="flex-[2] bg-[color:var(--accent-positive)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-2xl type-label flex items-center justify-center gap-2 transition-all shadow-lg shadow-[0_4px_16px_var(--accent-positive-subtle)]">
                    Próximo <ChevronRight size={16}/>
                </button>
            ) : (
                <button onClick={handleCreateContract} disabled={wizardLoading} className="flex-[2] bg-[color:var(--accent-positive)] hover:opacity-90 disabled:opacity-50 text-white py-4 rounded-2xl type-label flex items-center justify-center gap-2 transition-all shadow-lg shadow-[0_4px_16px_var(--accent-positive-subtle)]">
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
                <h3 className="type-heading uppercase text-[color:var(--text-primary)]">Novo Cliente</h3>
                <p className="type-label text-[color:var(--text-muted)]">Cadastro para emissão imediata</p>
            </div>
            <button onClick={() => setContractsSubView('create')}><X className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" size={22}/></button>
        </div>
        {/* Body scrollável */}
        <div className="flex-1 overflow-y-auto p-6 pb-2 custom-scrollbar">
        <form id="quick-create-debtor-form" onSubmit={handleQuickCreateDebtor} className="space-y-4">
            {/* Identificação */}
            <div className="bg-[color:var(--bg-base)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="type-label text-[color:var(--text-muted)]">Identificação</p>
                <div>
                    <label className="type-label text-[color:var(--text-muted)] block mb-1">Nome Completo *</label>
                    <div className="relative">
                        <UserPlus size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input required type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl pl-9 pr-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.full_name} onChange={e => setNewDebtorData({...newDebtorData, full_name: e.target.value})} placeholder="Nome completo" />
                    </div>
                </div>
                <div>
                    <label className="type-label text-[color:var(--text-muted)] block mb-1">E-mail</label>
                    <div className="relative">
                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input type="email" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl pl-9 pr-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.email} onChange={e => setNewDebtorData({...newDebtorData, email: e.target.value})} placeholder="email@exemplo.com (opcional)" />
                    </div>
                </div>
                <div>
                    <label className="type-label text-[color:var(--text-muted)] block mb-1">Telefone</label>
                    <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input type="tel" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl pl-9 pr-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.phone_number} onChange={e => setNewDebtorData({...newDebtorData, phone_number: e.target.value})} placeholder="(11) 99999-9999 (opcional)" />
                    </div>
                </div>
            </div>
            {/* Documento */}
            <div className="bg-[color:var(--bg-base)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="type-label text-[color:var(--text-muted)]">Documento</p>
                <div>
                    <label className="type-label text-[color:var(--text-muted)] block mb-1">CPF</label>
                    <div className="relative">
                        <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input type="text" maxLength={14} className={`w-full bg-[color:var(--bg-elevated)] border rounded-xl pl-9 pr-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)] ${quickCreateCpfError ? 'border-red-500' : 'border-[color:var(--border-subtle)]'}`} value={newDebtorData.cpf} onChange={e => { setQuickCreateCpfError(''); setNewDebtorData({...newDebtorData, cpf: maskCPFAdmin(e.target.value)}); }} placeholder="000.000.000-00 (opcional)" />
                    </div>
                    {quickCreateCpfError && <p className="text-red-400 text-[10px] mt-1 font-bold">{quickCreateCpfError}</p>}
                </div>
            </div>
            {/* Endereço */}
            <div className="bg-[color:var(--bg-base)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="type-label text-[color:var(--text-muted)]">Endereço</p>
                <div>
                    <label className="type-label text-[color:var(--text-muted)] block mb-1">CEP</label>
                    <div className="relative">
                        <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)] pointer-events-none" />
                        <input type="text" maxLength={9} className={`w-full bg-[color:var(--bg-elevated)] border rounded-xl pl-9 pr-9 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)] ${quickCreateCepError ? 'border-red-500' : 'border-[color:var(--border-subtle)]'}`}
                            value={newDebtorData.cep}
                            onChange={e => {
                                const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                                const formatted = digits.length > 5 ? `${digits.slice(0,5)}-${digits.slice(5)}` : digits;
                                setNewDebtorData(p => ({ ...p, cep: formatted }));
                                setQuickCreateCepError('');
                                if (digits.length === 8) handleQuickCepLookup(digits);
                            }}
                            placeholder="00000-000 (opcional)" />
                        {quickCreateCepLoading && <Activity size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--accent-positive)] animate-spin" />}
                    </div>
                    {quickCreateCepError && <p className="text-red-400 text-[10px] mt-1 font-bold">{quickCreateCepError}</p>}
                </div>
                <div>
                    <label className="type-label text-[color:var(--text-muted)] block mb-1">Logradouro</label>
                    <input type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.logradouro} onChange={e => setNewDebtorData(p => ({ ...p, logradouro: e.target.value }))} placeholder="Rua, Av..." />
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className="type-label text-[color:var(--text-muted)] block mb-1">Número</label>
                        <input type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.numero} onChange={e => setNewDebtorData(p => ({ ...p, numero: e.target.value }))} placeholder="Nº" />
                    </div>
                    <div className="col-span-2">
                        <label className="type-label text-[color:var(--text-muted)] block mb-1">Bairro</label>
                        <input type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.bairro} onChange={e => setNewDebtorData(p => ({ ...p, bairro: e.target.value }))} placeholder="Bairro" />
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                        <label className="type-label text-[color:var(--text-muted)] block mb-1">Cidade</label>
                        <input type="text" className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)]" value={newDebtorData.cidade} onChange={e => setNewDebtorData(p => ({ ...p, cidade: e.target.value }))} placeholder="Cidade" />
                    </div>
                    <div>
                        <label className="type-label text-[color:var(--text-muted)] block mb-1">UF</label>
                        <input type="text" maxLength={2} className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5 text-[color:var(--text-primary)] text-sm focus:border-[color:var(--accent-positive)] outline-none transition-all placeholder:text-[color:var(--text-faint)] uppercase" value={newDebtorData.uf} onChange={e => setNewDebtorData(p => ({ ...p, uf: e.target.value.toUpperCase() }))} placeholder="SP" />
                    </div>
                </div>
            </div>
        </form>
        </div>
        {/* Footer fixo */}
        <div className="shrink-0 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]/90 px-6 pt-4 pb-[max(calc(env(safe-area-inset-bottom,0px)+5.5rem),5.5rem)] md:pb-5 backdrop-blur">
            <button type="submit" form="quick-create-debtor-form" disabled={quickCreateLoading} className="w-full bg-[color:var(--accent-positive)] hover:opacity-90 disabled:opacity-50 text-white py-4 rounded-2xl type-label flex items-center justify-center gap-2 transition-all shadow-lg shadow-[0_4px_16px_var(--accent-positive-subtle)]">
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
                  <h3 className="type-title text-[color:var(--text-primary)]">Editar contrato</h3>
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
                              <label className="type-label mb-2 ml-1 block text-[color:var(--text-faint)]">Nome do contrato</label>
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
                                  <label className="type-label mb-2 ml-1 block text-[color:var(--text-faint)]">Valor emprestado</label>
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
                                  <label className="type-label mb-2 ml-1 block text-[color:var(--text-faint)]">Valor da parcela aberta</label>
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
                              <p className="type-label text-[color:var(--text-faint)]">Parcelas abertas</p>
                              <p className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{editOpenInstallments.length}</p>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                              <p className="type-label text-[color:var(--text-faint)]">Parcelas pagas</p>
                              <p className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{editPaidInstallments.length}</p>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                              <p className="type-label text-[color:var(--text-faint)]">Valor total recalculado</p>
                              <p className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{formatCurrency(editCurrentValuePreview)}</p>
                          </div>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                              <p className="type-label text-[color:var(--text-faint)]">Taxa implícita</p>
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
                          <h4 className="type-title text-[color:var(--text-primary)]">Datas das parcelas</h4>
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
                                              <p className="type-label text-[color:var(--text-faint)]">Parcela {installment.number}</p>
                                              <p className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">
                                                  {locked ? 'Parcela liquidada' : 'Parcela em aberto'}
                                              </p>
                                              <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
                                                  {locked
                                                      ? `Recebido ${formatCurrency(Number(installment.amount_paid || 0))}`
                                                      : `Valor previsto ${formatCurrency(Number(installment.amount_total || 0))}`}
                                              </p>
                                          </div>
                                          <div className="flex flex-col items-start gap-1">
                                              <div className="flex items-center gap-3">
                                                  <input
                                                      type="date"
                                                      disabled={locked}
                                                      value={installment.due_date}
                                                      onChange={(event) => handleEditInstallmentDateChange(installment.id, event.target.value)}
                                                      className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-[color:var(--text-primary)] outline-none transition-all focus:border-[color:var(--accent-brass)] disabled:cursor-not-allowed disabled:opacity-45"
                                                  />
                                              </div>
                                              {installment.due_date && (
                                                  <p className="text-[10px] text-[color:var(--text-faint)] capitalize pl-1">
                                                      {new Date(installment.due_date + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long' })}
                                                  </p>
                                              )}
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
              <button onClick={() => setContractsSubView('list')} className="flex-1 bg-[color:var(--bg-soft)] hover:bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] py-4 rounded-2xl type-label transition-all">
                  Cancelar
              </button>
              <button onClick={handleEditContractSave} disabled={editContractLoading || !editContractName.trim()} className="flex-1 bg-[color:var(--accent-positive)] hover:opacity-90 disabled:opacity-50 text-white py-4 rounded-2xl type-label flex items-center justify-center gap-2 transition-all">
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
            <h2 className="type-display text-[color:var(--text-primary)]">Contratos</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[color:var(--text-secondary)]">Crie, acompanhe e revise contratos com leitura clara de principal, prazo e cronograma financeiro.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
            <button onClick={() => onNavigate ? onNavigate(AppView.LEGACY_CONTRACT) : setIsNLContractOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-6 py-3 text-sm font-semibold text-[color:var(--text-primary)] transition-all hover:bg-white/[0.08]">
                <History size={16} className="text-[color:var(--accent-caution)]"/> Contrato Antigo
            </button>
<button onClick={handleOpenWizard} className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent-brass)] px-6 py-3 text-sm font-semibold text-[color:var(--text-on-accent)] transition-all hover:bg-[color:var(--accent-brass-strong)]">
                <PlusCircle size={16} /> Novo Contrato
            </button>
        </div>
      </div>
      {contracts.length > 0 && (
        <div className="flex items-center gap-3 mt-5 px-1">
            <div className="relative flex-1 sm:flex-none sm:w-80">
                <Search className="absolute left-3 top-2.5 text-[color:var(--text-muted)]" size={18} />
                <input type="text" placeholder="Buscar contrato, credor ou devedor..." value={contractSearchTerm} onChange={(e) => setContractSearchTerm(e.target.value)}
                    className="w-full bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl pl-10 pr-4 py-2 text-[color:var(--text-primary)] outline-none focus:ring-2 focus:ring-teal-500 transition-all font-medium" />
            </div>
        </div>
      )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="animate-spin text-[color:var(--accent-brass)] w-12" /></div>
      ) : contracts.length === 0 ? (
        <div className="panel-card rounded-[2rem] border border-dashed border-white/10 py-24 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]">
                <Wallet size={32}/>
            </div>
            <h3 className="type-title text-[color:var(--text-primary)]">Carteira vazia</h3>
            <p className="mx-auto mt-4 max-w-xs text-sm leading-7 text-[color:var(--text-secondary)]">Nenhum contrato ativo no momento. Inicie um novo empréstimo para começar.</p>
        </div>
      ) : filteredContracts.length === 0 ? (
        <div className="panel-card rounded-[2rem] border border-dashed border-white/10 py-16 text-center">
            <Search size={40} className="mx-auto text-[color:var(--text-faint)] mb-4" />
            <p className="type-label text-[color:var(--text-secondary)]">Nenhum contrato encontrado</p>
            {contractSearchTerm && <p className="type-caption text-[color:var(--text-faint)] mt-2">Tente outro termo de busca</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredContracts.map(contract => (
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
                        <div className="flex items-center gap-2 mb-2">
                            <span className="section-kicker">Contrato #{contract.id}</span>
                            {contract.calculation_mode === 'interest_only' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[color:var(--accent-caution-bg)] text-[color:var(--accent-caution)] text-[10px] font-bold uppercase tracking-wider">
                                    <Activity size={10}/> Juros Simples
                                </span>
                            )}
                        </div>
                        <h3 className="type-title text-[color:var(--text-primary)] truncate mb-1">{contract.asset_name}</h3>
                        <div className="flex items-center gap-2 mb-6">
                            <span className="h-2 w-2 rounded-full bg-[color:var(--accent-positive)]"></span>
                            <p className="type-label text-[color:var(--text-faint)]">{contract.payer_name}</p>
                        </div>
                    </div>
                    
                    {(contract.source_profit || 0) > 0 && (
                        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[rgba(143,179,157,0.16)] bg-[rgba(143,179,157,0.08)] p-3">
                            <div className="rounded-xl bg-[rgba(143,179,157,0.12)] p-2 text-[color:var(--accent-positive)]"><TrendingUp size={12}/></div>
                            <div className="flex flex-col">
                                <span className="type-label text-[color:var(--accent-positive)]">
                                    {((contract.source_profit! / contract.amount_invested) * 100).toFixed(0)}% Reinvestido
                                </span>
                                {contract.source_capital! > 0 && (
                                    <span className="type-label text-[color:var(--text-faint)]">
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
                                <p className="section-kicker mb-1">{contract.calculation_mode === 'interest_only' ? 'Juros/mês' : 'Parcela'}</p>
                                <p className="truncate text-sm font-semibold text-[color:var(--text-secondary)]">{formatCurrency(Number(contract.installment_value || 0))}</p>
                            </div>
                            <div className="min-w-0 text-right">
                                <p className="section-kicker mb-1">{contract.calculation_mode === 'interest_only' ? 'Saldo Devedor' : 'Prazo'}</p>
                                <p className="truncate text-sm font-semibold text-[color:var(--text-secondary)]">
                                  {contract.calculation_mode === 'interest_only'
                                    ? (contract.remaining_balance != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(contract.remaining_balance)) : '—')
                                    : `${contract.total_installments}x`}
                                </p>
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
                      <h3 className="type-heading uppercase text-[color:var(--text-primary)]">Excluir Contrato</h3>
                      <p className="text-[color:var(--text-secondary)] text-sm mt-2">Esta ação é <strong className="text-red-400">irreversível</strong>. Todas as parcelas do contrato serão apagadas.</p>
                      <p className="text-[color:var(--text-primary)] font-bold mt-3 bg-[color:var(--bg-base)] px-4 py-2 rounded-xl border border-[color:var(--border-subtle)] truncate">"{contractToDelete.asset_name}"</p>
                  </div>
                  <div className="flex gap-3">
                      <button onClick={() => { setIsDeleteConfirmOpen(false); setContractToDelete(null); }} className="flex-1 bg-[color:var(--bg-soft)] hover:bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] py-4 rounded-2xl type-label transition-all">
                          Cancelar
                      </button>
                      <button onClick={handleDeleteContract} disabled={deleteLoading} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl type-label flex items-center justify-center gap-2 transition-all">
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
        initialMode="legacy"
      />
    </div>
  );
};

export default AdminContracts;
