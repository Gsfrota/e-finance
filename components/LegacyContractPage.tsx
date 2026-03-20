
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, CheckCircle2, Loader2, AlertTriangle,
  User, UserPlus, Search, X, Key, Mail, Phone, History,
} from 'lucide-react';
import { getSupabase, parseSupabaseError, isValidCPF } from '../services/supabase';
import { Profile, Tenant } from '../types';

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

const inputCls = "w-full min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:border-teal-500 outline-none transition-all";
const labelCls = "type-micro text-[color:var(--text-muted)] block mb-1";
const sectionCls = "bg-slate-800 rounded-2xl p-4 md:p-6 border border-slate-700 space-y-3 overflow-hidden";

const LegacyContractPage: React.FC<LegacyContractPageProps> = ({ onBack, onSuccess }) => {
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
  const [currentValue, setCurrentValue] = useState('');
  const [installmentValue, setInstallmentValue] = useState('');
  const [totalInstallments, setTotalInstallments] = useState('12');

  // Origem
  const [sourceType, setSourceType] = useState<'own' | 'profit'>('own');

  // Vencimento
  const [frequency, setFrequency] = useState<'monthly' | 'weekly' | 'daily'>('monthly');
  const [dueDay, setDueDay] = useState('10');

  // Dados do contrato antigo
  const [legacyFirstDueDate, setLegacyFirstDueDate] = useState('');
  const [legacyPaidCount, setLegacyPaidCount] = useState(0);
  const [legacyCode, setLegacyCode] = useState('');

  // Status
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [done, setDone] = useState(false);

  // Carregar dados ao montar
  useEffect(() => {
    const load = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setCurrentUserId(user.id);

        const { data: profileData } = await supabase
          .from('profiles')
          .select('*, tenants!profiles_tenant_id_fkey(*)')
          .eq('id', user.id)
          .maybeSingle();

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
    const total = Number(currentValue) || 0;
    const parcela = Number(installmentValue) || 0;
    const nParcelas = parseInt(totalInstallments) || 0;

    if (!principal || !total || !parcela || !nParcelas) {
      setCreateError('Preencha todos os campos de valores.');
      return;
    }

    if (!legacyFirstDueDate) {
      setCreateError('Informe a data da 1ª parcela.');
      return;
    }

    setCreating(true);
    setCreateError('');
    const supabase = getSupabase();
    if (!supabase) return;

    const sourceCapital = sourceType === 'own' ? principal : 0;
    const sourceProfit = sourceType === 'profit' ? principal : 0;
    const interestRate = principal > 0
      ? Number((((total - principal) / principal) * 100).toFixed(2))
      : 0;

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
        p_current_value:      total,
        p_interest_rate:      interestRate,
        p_installment_value:  parcela,
        p_total_installments: nParcelas,
        p_frequency:          frequency,
        p_first_due_date:     legacyFirstDueDate,
        p_paid_count:         legacyPaidCount,
        p_calculation_mode:   'manual',
        p_original_code:      legacyCode.trim() || null,
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
    setCurrentValue('');
    setInstallmentValue('');
    setTotalInstallments('12');
    setSourceType('own');
    setFrequency('monthly');
    setDueDay('10');
    setLegacyFirstDueDate('');
    setLegacyPaidCount(0);
    setLegacyCode('');
    setCreateError('');
    setDone(false);
  };

  const maxParcelas = parseInt(totalInstallments) || 1;

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
            <p className="text-slate-400 text-sm">As parcelas foram geradas automaticamente.</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={resetForm}
                className="px-6 py-3 rounded-2xl border border-slate-700 text-slate-400 hover:text-white type-label transition-all hover:bg-slate-800"
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
          className="flex items-center justify-center w-10 h-10 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
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

      {/* Seção 1: Devedor */}
      <div className="bg-slate-800 rounded-2xl p-4 md:p-6 border border-slate-700 space-y-3">
        <p className="type-label text-[color:var(--text-muted)]">Devedor</p>

        {matchedDebtor ? (
          <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs text-emerald-300 font-bold">{matchedDebtor.full_name}</p>
                {matchedDebtor.phone_number && (
                  <p className="text-[10px] text-slate-500">{matchedDebtor.phone_number}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setMatchedDebtor(null); setDebtorSearch(''); setDebtorDropdownOpen(true); setTimeout(() => debtorInputRef.current?.focus(), 50); }}
              className="text-slate-500 hover:text-white transition-colors ml-2"
            >
              <X size={14} />
            </button>
          </div>
        ) : !showNewDebtor ? (
          <div className="relative">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                ref={debtorInputRef}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-slate-600"
                placeholder="Buscar cliente existente..."
                value={debtorSearch}
                onChange={e => { setDebtorSearch(e.target.value); setDebtorDropdownOpen(true); }}
                onFocus={() => setDebtorDropdownOpen(true)}
                onBlur={() => setTimeout(() => setDebtorDropdownOpen(false), 150)}
              />
            </div>

            {debtorDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-52 overflow-y-auto">
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
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800 text-left transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                      <User size={13} className="text-slate-400" />
                    </div>
                    <div>
                      <p className="text-xs text-white font-semibold">{p.full_name}</p>
                      {p.phone_number && <p className="text-[10px] text-slate-500">{p.phone_number}</p>}
                    </div>
                  </button>
                ))}
                {debtors.length === 0 && (
                  <p className="text-xs text-slate-500 px-3 py-2.5">Nenhum cliente cadastrado</p>
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
                  className="w-full flex items-center gap-3 px-3 py-2.5 border-t border-slate-800 hover:bg-slate-800 text-left transition-colors"
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
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <p className="type-label text-teal-400 flex items-center gap-1.5">
                <UserPlus size={12} /> Novo Devedor
              </p>
              <button
                type="button"
                onClick={() => setShowNewDebtor(false)}
                className="text-slate-500 hover:text-white transition-colors"
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

      {/* Seção 2: Valores */}
      <div className={sectionCls}>
        <p className="type-label text-[color:var(--text-muted)]">Valores</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Principal (R$)</label>
            <input type="number" inputMode="decimal" className={inputCls} value={amountInvested}
              onChange={e => setAmountInvested(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className={labelCls}>Total a Receber (R$)</label>
            <input type="number" inputMode="decimal" className={inputCls} value={currentValue}
              onChange={e => setCurrentValue(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className={labelCls}>Valor da Parcela (R$)</label>
            <input type="number" inputMode="decimal" className={inputCls} value={installmentValue}
              onChange={e => setInstallmentValue(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className={labelCls}>Nº de Parcelas</label>
            <input type="number" inputMode="numeric" className={inputCls} value={totalInstallments}
              onChange={e => { setTotalInstallments(e.target.value); setLegacyPaidCount(0); }} placeholder="12" />
          </div>
        </div>
      </div>

      {/* Seção 3: Origem do Capital */}
      <div className={sectionCls}>
        <p className="type-label text-[color:var(--text-muted)]">Origem do Capital</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSourceType('own')}
            className={`flex-1 py-2 rounded-xl type-label transition-all ${sourceType === 'own' ? 'bg-teal-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-700 hover:border-slate-600'}`}
          >
            Capital Próprio
          </button>
          <button
            type="button"
            onClick={() => setSourceType('profit')}
            className={`flex-1 py-2 rounded-xl type-label transition-all ${sourceType === 'profit' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-700 hover:border-slate-600'}`}
          >
            Lucro Reinvestido
          </button>
        </div>
      </div>

      {/* Seção 4: Vencimento */}
      <div className={sectionCls}>
        <p className="type-label text-[color:var(--text-muted)]">Vencimento</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Frequência</label>
            <select
              className={inputCls}
              value={frequency}
              onChange={e => setFrequency(e.target.value as any)}
            >
              <option value="monthly">Mensal</option>
              <option value="weekly">Semanal</option>
              <option value="daily">Diária</option>
            </select>
          </div>
          {frequency === 'monthly' && (
            <div>
              <label className={labelCls}>Dia do mês</label>
              <input type="number" inputMode="numeric" min="1" max="31" className={inputCls} value={dueDay}
                placeholder="Ex: 10"
                onChange={e => setDueDay(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {/* Seção 5: Dados do Contrato Antigo */}
      <div className={sectionCls}>
        <p className="type-label text-amber-400 flex items-center gap-1.5">
          <History size={12} /> Dados do Contrato Antigo
        </p>
        <div>
          <label className={labelCls}>Data da 1ª Parcela *</label>
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
              Parcelas já recebidas: <span className="text-amber-400">{legacyPaidCount} de {maxParcelas}</span>
            </label>
            <input
              type="range"
              min={0}
              max={maxParcelas}
              value={legacyPaidCount}
              onChange={e => setLegacyPaidCount(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            {legacyPaidCount > 0 && (
              <p className="text-[10px] text-amber-400 mt-1">
                Parcelas 1 a {legacyPaidCount} → <strong>PAGAS</strong> · Parcelas {legacyPaidCount + 1} a {maxParcelas} → <strong>PENDENTES</strong>
              </p>
            )}
          </div>
        )}

        <div>
          <label className={labelCls}>Código do Contrato Original (opcional)</label>
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

      {/* Botão de submissão */}
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
