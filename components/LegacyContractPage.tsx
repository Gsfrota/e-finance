
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowLeft, CheckCircle2, Loader2, AlertTriangle,
  User, UserPlus, Search, X, Key, Mail, Phone, History,
  Percent, Banknote, Activity, Calendar, CalendarDays, CalendarClock, Zap,
} from 'lucide-react';
import { fetchProfileByAuthUserId, getSupabase, parseSupabaseError, isValidCPF } from '../services/supabase';
import { Profile, Tenant } from '../types';
import { useCompanyContext } from '../services/companyScope';
import { calculateFinancials, formatCurrency, buildFreelancerDates } from '../utils/financials';

interface LegacyContractPageProps {
  onBack: () => void;
  onSuccess: () => void;
}

const maskCPF = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
          .replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3')
          .replace(/(\d{3})(\d{0,3})/, '$1.$2');
};

const inputCls = "w-full min-w-0 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2 text-white text-sm focus:border-teal-500 outline-none transition-all";
const labelCls = "type-micro text-[color:var(--text-muted)] block mb-1";
const sectionCls = "bg-[color:var(--bg-elevated)] rounded-2xl p-4 md:p-6 border border-[color:var(--border-subtle)] space-y-3 overflow-hidden";

const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const LegacyContractPage: React.FC<LegacyContractPageProps> = ({ onBack, onSuccess }) => {
  const { activeCompanyId } = useCompanyContext();
  // Data
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // Devedor
  const [matchedDebtor, setMatchedDebtor] = useState<Profile | null>(null);
  const [debtorSearch, setDebtorSearch] = useState('');
  const [debtorDropdownOpen, setDebtorDropdownOpen] = useState(false);
  const debtorInputRef = useRef<HTMLInputElement>(null);

  // Novo devedor inline
  const [showNewDebtor, setShowNewDebtor] = useState(false);
  const [newDebtor, setNewDebtor] = useState({ full_name: '', email: '', phone_number: '', cpf: '' });
  const [cpfError, setCpfError] = useState('');

  // Valores
  const [amountInvested, setAmountInvested] = useState('');
  const [totalInstallments, setTotalInstallments] = useState('12');

  // Modo de cálculo
  const [calculationMode, setCalculationMode] = useState<'auto' | 'manual' | 'interest_only'>('manual');
  const [interestRate, setInterestRate] = useState('');
  const [installmentValue, setInstallmentValue] = useState('');
  const [bulletPrincipalMode, setBulletPrincipalMode] = useState<'together' | 'separate'>('together');

  // Origem
  const [sourceType, setSourceType] = useState<'own' | 'profit'>('own');

  // Vencimento
  const [frequency, setFrequency] = useState<'monthly' | 'weekly' | 'daily' | 'freelancer'>('monthly');
  const [dueDay, setDueDay] = useState('10');
  const [weekday, setWeekday] = useState(1);
  const [skipSaturday, setSkipSaturday] = useState(false);
  const [skipSunday, setSkipSunday] = useState(false);
  const [freelancerDates, setFreelancerDates] = useState<string[]>([]);
  const [freelancerInterval, setFreelancerInterval] = useState(7);

  // Dados do contrato antigo
  const [legacyFirstDueDate, setLegacyFirstDueDate] = useState('');
  const [legacyPaidCount, setLegacyPaidCount] = useState(0);
  const [legacyCode, setLegacyCode] = useState('');

  // Status
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [done, setDone] = useState(false);

  // Financials calculados
  const financials = useMemo(() => {
    return calculateFinancials(
      Number(amountInvested) || 0,
      parseInt(totalInstallments) || 1,
      Number(interestRate) || 0,
      calculationMode,
      Number(installmentValue) || 0,
      bulletPrincipalMode,
    );
  }, [amountInvested, totalInstallments, interestRate, calculationMode, installmentValue, bulletPrincipalMode]);

  const totalParcelasGeradas = useMemo(() => {
    const n = parseInt(totalInstallments) || 1;
    if (calculationMode === 'interest_only' && bulletPrincipalMode === 'separate') return n + 1;
    return n;
  }, [totalInstallments, calculationMode, bulletPrincipalMode]);

  // Carregar dados ao montar
  useEffect(() => {
    const load = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profileData } = await fetchProfileByAuthUserId<Profile & { tenants?: Tenant }>(
          supabase,
          user.id,
          '*, tenants!profiles_tenant_id_fkey(*)'
        );

        if (profileData) {
          setCurrentUserId(profileData.id);
        }

        if (profileData?.tenants) {
          const tenant = profileData.tenants as unknown as Tenant;
          setCurrentTenant(tenant);

          const { data: allProfiles } = await supabase
            .from('profiles')
            .select('*')
            .eq('tenant_id', tenant.id);
          setProfiles(allProfiles || []);
        }
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, []);

  const getInvestorId = (): string | null => {
    if (currentUserId) return currentUserId;
    const admin = profiles.find(p => p.role === 'admin');
    return admin?.id || profiles[0]?.id || null;
  };

  const handleConfirm = async (debtorId: string) => {
    if (!currentTenant) return;
    const investorId = getInvestorId();
    if (!investorId) { setCreateError('Nenhum investidor encontrado.'); return; }

    const principal = Number(amountInvested) || 0;
    const nParcelas = parseInt(totalInstallments) || 0;

    if (!principal || !nParcelas) {
      setCreateError('Preencha o valor emprestado e o número de parcelas.');
      return;
    }

    if (calculationMode === 'manual' && !financials.installmentValue) {
      setCreateError('Preencha o valor da parcela.');
      return;
    }

    if ((calculationMode === 'auto' || calculationMode === 'interest_only') && !(Number(interestRate) > 0)) {
      setCreateError('Preencha a taxa de juros.');
      return;
    }

    if (!legacyFirstDueDate) {
      setCreateError('Informe a data da 1ª parcela.');
      return;
    }

    if (frequency === 'freelancer' && freelancerDates.length !== nParcelas) {
      setCreateError(`Informe exatamente ${nParcelas} datas para o modo livre.`);
      return;
    }

    setCreating(true);
    setCreateError('');
    const supabase = getSupabase();
    if (!supabase) return;

    const sourceCapital = sourceType === 'own' ? principal : 0;
    const sourceProfit = sourceType === 'profit' ? principal : 0;

    const debtorName = matchedDebtor?.full_name || newDebtor.full_name || 'Cliente';

    try {
      const { error } = await supabase.rpc('create_legacy_investment', {
        p_tenant_id:          currentTenant.id,
        p_user_id:            investorId,
        p_payer_id:           debtorId,
        p_asset_name:         `Contrato ${debtorName.split(' ')[0]}`,
        p_amount_invested:    principal,
        p_source_capital:     sourceCapital,
        p_source_profit:      sourceProfit,
        p_current_value:      financials.totalValue,
        p_interest_rate:      financials.interestRate,
        p_installment_value:  financials.installmentValue,
        p_total_installments: nParcelas,
        p_frequency:          frequency,
        p_first_due_date:     legacyFirstDueDate,
        p_paid_count:         legacyPaidCount,
        p_calculation_mode:   calculationMode,
        p_original_code:      legacyCode.trim() || null,
        p_company_id:         activeCompanyId || null,
        p_skip_saturday:      frequency === 'daily' ? skipSaturday : false,
        p_skip_sunday:        frequency === 'daily' ? skipSunday : false,
        p_weekday:            frequency === 'weekly' ? weekday : null,
        p_custom_dates:       frequency === 'freelancer' ? freelancerDates : null,
        p_bullet_principal_mode: calculationMode === 'interest_only' ? bulletPrincipalMode : null,
      });
      if (error) throw error;
      setDone(true);
    } catch (err: any) {
      setCreateError(parseSupabaseError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateDebtorAndConfirm = async () => {
    if (!newDebtor.full_name || !currentTenant) return;

    const cpfDigits = newDebtor.cpf.replace(/\D/g, '');
    if (cpfDigits && !isValidCPF(cpfDigits)) {
      setCpfError('CPF inválido');
      return;
    }

    setCreating(true);
    setCreateError('');
    setCpfError('');
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { data, error } = await supabase.rpc('create_client_direct', {
        p_full_name:    newDebtor.full_name,
        p_email:        newDebtor.email.trim() || null,
        p_role:         'debtor',
        p_phone_number: newDebtor.phone_number.trim() || null,
        p_cpf:          cpfDigits || null,
        p_photo_url:    null,
        p_company_id:   activeCompanyId || null,
      });
      if (error) throw error;
      await handleConfirm(data as string);
    } catch (err: any) {
      setCreateError(parseSupabaseError(err));
      setCreating(false);
    }
  };

  const resetForm = () => {
    setMatchedDebtor(null);
    setDebtorSearch('');
    setShowNewDebtor(false);
    setNewDebtor({ full_name: '', email: '', phone_number: '', cpf: '' });
    setCpfError('');
    setAmountInvested('');
    setTotalInstallments('12');
    setCalculationMode('manual');
    setInterestRate('');
    setInstallmentValue('');
    setBulletPrincipalMode('together');
    setSourceType('own');
    setFrequency('monthly');
    setDueDay('10');
    setWeekday(1);
    setSkipSaturday(false);
    setSkipSunday(false);
    setFreelancerDates([]);
    setFreelancerInterval(7);
    setLegacyFirstDueDate('');
    setLegacyPaidCount(0);
    setLegacyCode('');
    setCreateError('');
    setDone(false);
  };

  if (loadingData) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-teal-400" />
      </div>
    );
  }

  // Tela de sucesso inline
  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className={sectionCls}>
          <div className="flex flex-col items-center text-center space-y-4 py-6">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center">
              <CheckCircle2 size={36} className="text-emerald-400" />
            </div>
            <h3 className="type-subheading text-[color:var(--text-primary)]">Contrato Criado!</h3>
            <p className="text-[color:var(--text-secondary)] text-sm">As parcelas foram geradas automaticamente.</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={resetForm}
                className="px-6 py-3 rounded-2xl border border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] hover:text-white type-label transition-all hover:bg-[color:var(--bg-elevated)]"
              >
                Criar Outro
              </button>
              <button
                onClick={onBack}
                className="px-6 py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white type-label transition-all"
              >
                Ver Contratos
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const debtors = profiles.filter(p => p.role === 'debtor');
  const filteredDebtors = debtors.filter(p =>
    !debtorSearch.trim() ||
    p.full_name.toLowerCase().includes(debtorSearch.toLowerCase()) ||
    (p.phone_number || '').includes(debtorSearch)
  ).slice(0, 8);

  const hasDebtor = !!matchedDebtor;

  const handleSubmit = () => {
    if (matchedDebtor) {
      handleConfirm(matchedDebtor.id);
    } else if (showNewDebtor && newDebtor.full_name) {
      handleCreateDebtorAndConfirm();
    } else {
      setCreateError('Selecione ou cadastre um devedor.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-10 h-10 rounded-xl border border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] hover:text-white hover:bg-[color:var(--bg-elevated)] transition-all"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <History size={16} className="text-amber-400" />
            <h1 className="type-subheading uppercase text-[color:var(--text-primary)]">Contrato Antigo</h1>
          </div>
          <p className="type-label text-[color:var(--text-muted)]">Cadastro Manual</p>
        </div>
      </div>

      {/* Secao 1: Devedor */}
      <div className="bg-[color:var(--bg-elevated)] rounded-2xl p-4 md:p-6 border border-[color:var(--border-subtle)] space-y-3">
        <p className="type-label text-[color:var(--text-muted)]">Devedor</p>

        {matchedDebtor ? (
          <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs text-emerald-300 font-bold">{matchedDebtor.full_name}</p>
                {matchedDebtor.phone_number && (
                  <p className="text-[10px] text-[color:var(--text-muted)]">{matchedDebtor.phone_number}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setMatchedDebtor(null); setDebtorSearch(''); setDebtorDropdownOpen(true); setTimeout(() => debtorInputRef.current?.focus(), 50); }}
              className="text-[color:var(--text-muted)] hover:text-white transition-colors ml-2"
            >
              <X size={14} />
            </button>
          </div>
        ) : !showNewDebtor ? (
          <div className="relative">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] pointer-events-none" />
              <input
                ref={debtorInputRef}
                className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl pl-8 pr-3 py-2 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]"
                placeholder="Buscar cliente existente..."
                value={debtorSearch}
                onChange={e => { setDebtorSearch(e.target.value); setDebtorDropdownOpen(true); }}
                onFocus={() => setDebtorDropdownOpen(true)}
                onBlur={() => setTimeout(() => setDebtorDropdownOpen(false), 150)}
              />
            </div>

            {debtorDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl shadow-2xl overflow-hidden max-h-52 overflow-y-auto">
                {filteredDebtors.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      setMatchedDebtor(p);
                      setDebtorSearch('');
                      setDebtorDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[color:var(--bg-elevated)] text-left transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-[color:var(--bg-soft)] flex items-center justify-center shrink-0">
                      <User size={13} className="text-[color:var(--text-secondary)]" />
                    </div>
                    <div>
                      <p className="text-xs text-white font-semibold">{p.full_name}</p>
                      {p.phone_number && <p className="text-[10px] text-[color:var(--text-muted)]">{p.phone_number}</p>}
                    </div>
                  </button>
                ))}
                {debtors.length === 0 && (
                  <p className="text-xs text-[color:var(--text-muted)] px-3 py-2.5">Nenhum cliente cadastrado</p>
                )}
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    setDebtorDropdownOpen(false);
                    setNewDebtor({ full_name: debtorSearch, email: '', phone_number: '', cpf: '' });
                    setCpfError('');
                    setShowNewDebtor(true);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] text-left transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0">
                    <UserPlus size={13} className="text-teal-400" />
                  </div>
                  <p className="text-xs text-teal-400 font-bold">
                    {debtorSearch ? `Criar "${debtorSearch}"` : 'Criar novo devedor'}
                  </p>
                </button>
              </div>
            )}
          </div>
        ) : null}

        {/* Novo devedor inline */}
        {showNewDebtor && !matchedDebtor && (
          <div className="bg-[color:var(--bg-base)] rounded-xl p-4 border border-[color:var(--border-subtle)] space-y-3">
            <div className="flex items-center justify-between">
              <p className="type-label text-teal-400 flex items-center gap-1.5">
                <UserPlus size={12} /> Novo Devedor
              </p>
              <button
                type="button"
                onClick={() => setShowNewDebtor(false)}
                className="text-[color:var(--text-muted)] hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div>
              <label className={labelCls}>Nome Completo *</label>
              <input
                type="text"
                required
                value={newDebtor.full_name}
                onChange={e => setNewDebtor({ ...newDebtor, full_name: e.target.value })}
                className={inputCls}
                placeholder="Nome completo"
              />
            </div>
            <div>
              <label className={labelCls}>E-mail</label>
              <input
                type="email"
                value={newDebtor.email}
                onChange={e => setNewDebtor({ ...newDebtor, email: e.target.value })}
                className={inputCls}
                placeholder="email@exemplo.com (opcional)"
              />
            </div>
            <div>
              <label className={labelCls}>Telefone</label>
              <input
                type="tel"
                value={newDebtor.phone_number}
                onChange={e => setNewDebtor({ ...newDebtor, phone_number: e.target.value })}
                className={inputCls}
                placeholder="(11) 99999-9999 (opcional)"
              />
            </div>
            <div>
              <label className={labelCls}>CPF</label>
              <input
                type="text"
                value={newDebtor.cpf}
                onChange={e => { setCpfError(''); setNewDebtor({ ...newDebtor, cpf: maskCPF(e.target.value) }); }}
                className={`${inputCls} ${cpfError ? 'border-red-500' : ''}`}
                placeholder="000.000.000-00 (opcional)"
                maxLength={14}
              />
              {cpfError && <p className="text-red-400 text-[10px] mt-1 font-bold">{cpfError}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Secao 2: Valor Emprestado + Parcelas */}
      <div className={sectionCls}>
        <p className="type-label text-[color:var(--text-muted)]">Valores</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Valor Emprestado (R$)</label>
            <input type="number" inputMode="decimal" className={inputCls} value={amountInvested}
              onChange={e => setAmountInvested(e.target.value)} placeholder="0.00" />
            <p className="text-[10px] text-[color:var(--text-muted)] mt-0.5">Quanto foi emprestado ao devedor</p>
          </div>
          <div>
            <label className={labelCls}>N. de Parcelas</label>
            <input type="number" inputMode="numeric" className={inputCls} value={totalInstallments}
              onChange={e => { setTotalInstallments(e.target.value); setLegacyPaidCount(0); }} placeholder="12" />
          </div>
        </div>
      </div>

      {/* Secao 3: Modo de Calculo */}
      <div className={sectionCls}>
        <p className="type-label text-[color:var(--text-muted)]">Modo de Calculo</p>

        {/* Seletor de modo */}
        <div className="bg-[color:var(--bg-base)] p-1 rounded-xl border border-[color:var(--border-subtle)] flex">
          {([
            { mode: 'auto' as const, icon: <Percent size={13} />, label: 'Taxa (%)' },
            { mode: 'manual' as const, icon: <Banknote size={13} />, label: 'Fixo (R$)' },
            { mode: 'interest_only' as const, icon: <Activity size={13} />, label: 'Bullet' },
          ]).map(({ mode, icon, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setCalculationMode(mode)}
              className={`flex-1 py-2 rounded-lg type-label flex items-center justify-center gap-1.5 transition-all text-xs ${
                calculationMode === mode
                  ? 'bg-[color:var(--bg-soft)] text-white shadow-sm'
                  : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Modo Auto: input taxa */}
        {calculationMode === 'auto' && (
          <div className="space-y-2">
            <div>
              <label className={labelCls}>Taxa de Juros (%)</label>
              <input type="number" inputMode="decimal" step="0.1" className={inputCls}
                value={interestRate}
                onChange={e => setInterestRate(e.target.value)}
                placeholder="Ex: 5" />
            </div>
            {financials.installmentValue > 0 && (
              <div className="text-xs text-[color:var(--text-secondary)]">
                Parcela estimada: <strong className="text-white">{formatCurrency(financials.installmentValue)}</strong>
              </div>
            )}
          </div>
        )}

        {/* Modo Manual: input valor da parcela */}
        {calculationMode === 'manual' && (
          <div className="space-y-2">
            <div>
              <label className={labelCls}>Valor da Parcela (R$)</label>
              <input type="number" inputMode="decimal" step="0.01" className={inputCls}
                value={installmentValue}
                onChange={e => setInstallmentValue(e.target.value)}
                placeholder="0.00" />
            </div>
            {financials.interestRate > 0 && (
              <div className="text-xs text-[color:var(--text-secondary)]">
                Taxa implicita: <strong className="text-white">{financials.interestRate.toFixed(2)}%</strong>
              </div>
            )}
          </div>
        )}

        {/* Modo Bullet: taxa + modo de devolucao */}
        {calculationMode === 'interest_only' && (
          <div className="space-y-3">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <p className="text-[11px] text-amber-300 leading-relaxed">
                O devedor paga somente juros por parcela (simples, sobre o principal original). O principal e devolvido no final.
              </p>
            </div>
            <div>
              <label className={labelCls}>Taxa de Juros (% a.m.)</label>
              <input type="number" inputMode="decimal" step="0.1" className={inputCls}
                value={interestRate}
                onChange={e => setInterestRate(e.target.value)}
                placeholder="Ex: 3" />
            </div>
            {financials.installmentValue > 0 && (
              <div className="text-xs text-[color:var(--text-secondary)]">
                Juros por parcela: <strong className="text-amber-400">{formatCurrency(financials.installmentValue)}</strong>
              </div>
            )}
            <div>
              <p className="type-micro text-[color:var(--text-muted)] mb-1.5">Devolucao do Principal</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBulletPrincipalMode('together')}
                  className={`p-2.5 rounded-xl border transition-all text-left ${
                    bulletPrincipalMode === 'together'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)]'
                  }`}
                >
                  <p className="text-xs font-bold">Junto</p>
                  <p className="text-[10px] text-[color:var(--text-muted)] mt-0.5">Ultima parcela = juros + principal</p>
                </button>
                <button
                  type="button"
                  onClick={() => setBulletPrincipalMode('separate')}
                  className={`p-2.5 rounded-xl border transition-all text-left ${
                    bulletPrincipalMode === 'separate'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)]'
                  }`}
                >
                  <p className="text-xs font-bold">Separado</p>
                  <p className="text-[10px] text-[color:var(--text-muted)] mt-0.5">Parcela extra so para o principal</p>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Resumo calculado */}
        {(Number(amountInvested) > 0 && financials.totalValue > 0) && (
          <div className="bg-[color:var(--bg-base)] rounded-xl p-3 border border-[color:var(--border-subtle)] space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[color:var(--text-muted)]">Total a receber</span>
              <span className="text-white font-bold">{formatCurrency(financials.totalValue)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[color:var(--text-muted)]">Lucro</span>
              <span className="text-emerald-400 font-bold">{formatCurrency(financials.totalValue - (Number(amountInvested) || 0))}</span>
            </div>
            {calculationMode === 'interest_only' && bulletPrincipalMode === 'separate' && (
              <div className="flex justify-between text-xs">
                <span className="text-[color:var(--text-muted)]">Parcelas geradas</span>
                <span className="text-amber-400 font-bold">{parseInt(totalInstallments) || 1} juros + 1 principal</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Secao 4: Origem do Capital */}
      <div className={sectionCls}>
        <p className="type-label text-[color:var(--text-muted)]">Origem do Capital</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSourceType('own')}
            className={`flex-1 py-2 rounded-xl type-label transition-all ${sourceType === 'own' ? 'bg-teal-600 text-white' : 'bg-[color:var(--bg-base)] text-[color:var(--text-secondary)] border border-[color:var(--border-subtle)] hover:border-[color:var(--border-strong)]'}`}
          >
            Capital Proprio
          </button>
          <button
            type="button"
            onClick={() => setSourceType('profit')}
            className={`flex-1 py-2 rounded-xl type-label transition-all ${sourceType === 'profit' ? 'bg-emerald-600 text-white' : 'bg-[color:var(--bg-base)] text-[color:var(--text-secondary)] border border-[color:var(--border-subtle)] hover:border-[color:var(--border-strong)]'}`}
          >
            Lucro Reinvestido
          </button>
        </div>
      </div>

      {/* Secao 5: Vencimento */}
      <div className={sectionCls}>
        <p className="type-label text-[color:var(--text-muted)]">Frequencia</p>

        {/* Seletor de frequencia - 4 botoes */}
        <div className="grid grid-cols-4 gap-1.5">
          {([
            { freq: 'monthly' as const, icon: <Calendar size={14} />, label: 'Mensal' },
            { freq: 'weekly' as const, icon: <CalendarDays size={14} />, label: 'Semanal' },
            { freq: 'daily' as const, icon: <CalendarClock size={14} />, label: 'Diario' },
            { freq: 'freelancer' as const, icon: <Zap size={14} />, label: 'Livre' },
          ]).map(({ freq, icon, label }) => (
            <button
              key={freq}
              type="button"
              onClick={() => setFrequency(freq)}
              className={`py-2 rounded-xl type-label flex flex-col items-center gap-1 transition-all text-[10px] ${
                frequency === freq
                  ? 'bg-teal-600 text-white'
                  : 'bg-[color:var(--bg-base)] text-[color:var(--text-muted)] border border-[color:var(--border-subtle)] hover:border-[color:var(--border-strong)]'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Mensal: dia do mes */}
        {frequency === 'monthly' && (
          <div>
            <label className={labelCls}>Dia do vencimento</label>
            <select className={inputCls} value={dueDay} onChange={e => setDueDay(e.target.value)}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}

        {/* Semanal: dia da semana */}
        {frequency === 'weekly' && (
          <div>
            <label className={labelCls}>Dia da semana</label>
            <select className={inputCls} value={weekday} onChange={e => setWeekday(Number(e.target.value))}>
              {WEEKDAY_NAMES.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Diario: skip weekends */}
        {frequency === 'daily' && (
          <div className="flex gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={skipSaturday}
                onChange={e => setSkipSaturday(e.target.checked)}
                className="rounded accent-teal-500"
              />
              <span className="text-xs text-[color:var(--text-secondary)]">Pular Sabado</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={skipSunday}
                onChange={e => setSkipSunday(e.target.checked)}
                className="rounded accent-teal-500"
              />
              <span className="text-xs text-[color:var(--text-secondary)]">Pular Domingo</span>
            </label>
          </div>
        )}

        {/* Freelancer: datas customizadas */}
        {frequency === 'freelancer' && legacyFirstDueDate && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              {[
                { label: 'Semanal', days: 7 },
                { label: 'Quinzenal', days: 15 },
                { label: 'Mensal', days: 30 },
              ].map(opt => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => {
                    setFreelancerInterval(opt.days);
                    const dates = buildFreelancerDates(parseInt(totalInstallments) || 1, legacyFirstDueDate, opt.days);
                    setFreelancerDates(dates);
                  }}
                  className={`type-label px-3 py-1.5 rounded-lg border transition-all text-xs ${
                    freelancerInterval === opt.days
                      ? 'bg-teal-600 border-teal-600 text-white'
                      : 'bg-[color:var(--bg-base)] border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-[10px] text-[color:var(--text-muted)]">A cada</span>
                <input
                  type="number"
                  min={1}
                  className="w-12 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-lg px-2 py-1 text-xs text-center text-white outline-none focus:border-teal-500"
                  value={freelancerInterval}
                  onChange={e => setFreelancerInterval(Math.max(1, parseInt(e.target.value) || 1))}
                />
                <span className="text-[10px] text-[color:var(--text-muted)]">dias</span>
                <button
                  type="button"
                  onClick={() => {
                    const dates = buildFreelancerDates(parseInt(totalInstallments) || 1, legacyFirstDueDate, freelancerInterval);
                    setFreelancerDates(dates);
                  }}
                  className="type-label px-2 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-all text-xs"
                >
                  Aplicar
                </button>
              </div>
            </div>

            {freelancerDates.length > 0 && (
              <div className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-[color:var(--bg-base)] border-b border-[color:var(--border-subtle)]">
                  <span className="text-[10px] text-[color:var(--text-muted)]">{freelancerDates.length} datas editaveis</span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-800">
                  {freelancerDates.map((dateStr, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="text-[10px] text-[color:var(--text-muted)] w-5 text-right">#{idx + 1}</span>
                      <input
                        type="date"
                        className="flex-1 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-teal-500"
                        value={dateStr}
                        onChange={e => {
                          const updated = [...freelancerDates];
                          updated[idx] = e.target.value;
                          setFreelancerDates(updated);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Secao 6: Dados do Contrato Antigo */}
      <div className={sectionCls}>
        <p className="type-label text-amber-400 flex items-center gap-1.5">
          <History size={12} /> Dados do Contrato Antigo
        </p>
        <div>
          <label className={labelCls}>Data da 1a Parcela *</label>
          <input
            type="date"
            value={legacyFirstDueDate}
            onChange={e => { setLegacyFirstDueDate(e.target.value); setLegacyPaidCount(0); }}
            className={inputCls}
            style={{ maxWidth: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {legacyFirstDueDate && (
          <div>
            <label className={labelCls}>
              Parcelas ja recebidas: <span className="text-amber-400">{legacyPaidCount} de {totalParcelasGeradas}</span>
            </label>
            <input
              type="range"
              min={0}
              max={totalParcelasGeradas}
              value={legacyPaidCount}
              onChange={e => setLegacyPaidCount(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            {legacyPaidCount > 0 && (
              <p className="text-[10px] text-amber-400 mt-1">
                Parcelas 1 a {legacyPaidCount} → <strong>PAGAS</strong> · Parcelas {legacyPaidCount + 1} a {totalParcelasGeradas} → <strong>PENDENTES</strong>
              </p>
            )}
          </div>
        )}

        <div>
          <label className={labelCls}>Codigo do Contrato Original (opcional)</label>
          <input
            type="text"
            value={legacyCode}
            onChange={e => setLegacyCode(e.target.value)}
            placeholder="Ex: CT14383727"
            className={inputCls}
          />
        </div>
      </div>

      {/* Erro */}
      {createError && (
        <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/30 rounded-xl text-xs text-red-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />{createError}
        </div>
      )}

      {/* Botao de submissao */}
      <button
        onClick={handleSubmit}
        disabled={creating || (!hasDebtor && !(showNewDebtor && newDebtor.full_name))}
        className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3.5 rounded-2xl type-label flex items-center justify-center gap-2 transition-all"
      >
        {creating ? <><Loader2 size={16} className="animate-spin" /> Criando...</> : <><CheckCircle2 size={16} /> Confirmar e Criar Contrato</>}
      </button>
    </div>
  );
};

export default LegacyContractPage;
