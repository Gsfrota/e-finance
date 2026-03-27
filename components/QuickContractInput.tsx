
import React, { useState, useEffect, useRef } from 'react';
import { Zap, X, Loader2, CheckCircle2, AlertTriangle, User, UserPlus, ArrowLeft, Pencil, Mail, Phone, Key, History, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { getSupabase, parseSupabaseError, isValidCPF } from '../services/supabase';
import { useCompanyContext } from '../services/companyScope';

interface ParsedContract {
  debtor_name: string;
  amount_invested: number;
  current_value: number;
  installment_value: number;
  total_installments: number;
  due_day: number | null;
  frequency: 'monthly' | 'weekly' | 'daily';
  calculation_mode: string;
}
import { Profile, Tenant } from '../types';

interface QuickContractInputProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  profiles: Profile[];
  currentTenant: Tenant | null;
  currentUserId: string | null;
  initialMode?: 'legacy';
}

type Step = 'confirm' | 'new-debtor' | 'done';

// Versão editável do contrato (todos string para os inputs)
interface EditableContract {
  debtor_name: string;
  amount_invested: string;
  current_value: string;
  installment_value: string;
  total_installments: string;
  due_day: string;
  frequency: 'monthly' | 'weekly' | 'daily';
}

const toEditable = (p: ParsedContract): EditableContract => ({
  debtor_name: p.debtor_name,
  amount_invested: String(p.amount_invested),
  current_value: String(p.current_value),
  installment_value: String(p.installment_value),
  total_installments: String(p.total_installments),
  due_day: p.due_day != null ? String(p.due_day) : '',
  frequency: p.frequency,
});

const fromEditable = (e: EditableContract): ParsedContract => ({
  debtor_name: e.debtor_name,
  amount_invested: Number(e.amount_invested) || 0,
  current_value: Number(e.current_value) || 0,
  installment_value: Number(e.installment_value) || 0,
  total_installments: parseInt(e.total_installments) || 0,
  due_day: e.due_day ? parseInt(e.due_day) : null,
  frequency: e.frequency,
  calculation_mode: 'manual',
});

const QuickContractInput: React.FC<QuickContractInputProps> = ({
  isOpen,
  onClose,
  onSuccess,
  profiles,
  currentTenant,
  currentUserId,
  initialMode = 'ai',
}) => {
  const { activeCompanyId } = useCompanyContext();
  const [step, setStep] = useState<Step>('confirm');
  const [editable, setEditable] = useState<EditableContract | null>(null);
  const [matchedDebtor, setMatchedDebtor] = useState<Profile | null>(null);
  const [newDebtor, setNewDebtor] = useState({ full_name: '', email: '', phone_number: '', cpf: '' });
  const [cpfError, setCpfError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [sourceType, setSourceType] = useState<'own' | 'profit'>('own');

  // Debtor picker state
  const [debtorSearch, setDebtorSearch] = useState('');
  const [debtorDropdownOpen, setDebtorDropdownOpen] = useState(false);
  const debtorInputRef = useRef<HTMLInputElement>(null);

  // Legacy contract state
  const [isLegacy, setIsLegacy] = useState(false);
  const [legacyFirstDueDate, setLegacyFirstDueDate] = useState('');
  const [legacyPaidCount, setLegacyPaidCount] = useState(0);
  const [legacyCode, setLegacyCode] = useState('');
  const [legacyOpen, setLegacyOpen] = useState(false);

  // Inicializa modo legacy quando o modal abre
  useEffect(() => {
    if (!isOpen) return;
    if (initialMode === 'legacy') {
      setEditable({
        debtor_name: '',
        amount_invested: '0',
        current_value: '0',
        installment_value: '0',
        total_installments: '12',
        due_day: '10',
        frequency: 'monthly',
      });
      setMatchedDebtor(null);
      setDebtorSearch('');
      setDebtorDropdownOpen(false);
      setIsLegacy(true);
      setLegacyOpen(true);
      setStep('confirm');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const resetAndClose = () => {
    setStep('confirm');
    setEditable(null);
    setMatchedDebtor(null);
    setNewDebtor({ full_name: '', email: '', phone_number: '', cpf: '' });
    setCpfError('');
    setCreateError('');
    setSourceType('own');
    setIsLegacy(false);
    setLegacyFirstDueDate('');
    setLegacyPaidCount(0);
    setLegacyCode('');
    setLegacyOpen(false);
    setDebtorSearch('');
    setDebtorDropdownOpen(false);
    onClose();
  };

  const findDebtorByName = (name: string): Profile | null => {
    const normalized = name.toLowerCase().trim();
    return (
      profiles.find(p =>
        p.full_name.toLowerCase().includes(normalized) ||
        normalized.includes(p.full_name.toLowerCase().split(' ')[0])
      ) || null
    );
  };

  // Sincroniza devedor quando nome muda manualmente
  const handleDebtorNameChange = (name: string) => {
    setEditable(prev => prev ? { ...prev, debtor_name: name } : prev);
    setMatchedDebtor(findDebtorByName(name));
  };

  const getInvestorId = (): string | null => {
    if (currentUserId) return currentUserId;
    const admin = profiles.find(p => p.role === 'admin');
    return admin?.id || profiles[0]?.id || null;
  };

  const handleConfirm = async (debtorId: string) => {
    if (!editable || !currentTenant) return;
    const investorId = getInvestorId();
    if (!investorId) { setCreateError('Nenhum investidor encontrado.'); return; }

    const parsed = fromEditable(editable);
    setCreating(true);
    setCreateError('');
    const supabase = getSupabase();
    if (!supabase) return;

    const sourceCapital = sourceType === 'own' ? parsed.amount_invested : 0;
    const sourceProfit = sourceType === 'profit' ? parsed.amount_invested : 0;

    try {
      const interestRate = parsed.amount_invested > 0
      ? Number((((parsed.current_value - parsed.amount_invested) / parsed.amount_invested) * 100).toFixed(2))
      : 0;

    let investmentId: any;
    let error: any;

    if (isLegacy && legacyFirstDueDate) {
      ({ data: investmentId, error } = await supabase.rpc('create_legacy_investment', {
        p_tenant_id:          currentTenant.id,
        p_user_id:            investorId,
        p_payer_id:           debtorId,
        p_asset_name:         `Contrato ${parsed.debtor_name.split(' ')[0]}`,
        p_amount_invested:    parsed.amount_invested,
        p_source_capital:     sourceCapital,
        p_source_profit:      sourceProfit,
        p_current_value:      parsed.current_value,
        p_interest_rate:      interestRate,
        p_installment_value:  parsed.installment_value,
        p_total_installments: parsed.total_installments,
        p_frequency:          parsed.frequency,
        p_first_due_date:     legacyFirstDueDate,
        p_paid_count:         legacyPaidCount,
        p_calculation_mode:   'manual',
        p_original_code:      legacyCode.trim() || null,
        p_company_id:         activeCompanyId || null,
      }));
    } else {
      ({ data: investmentId, error } = await supabase.rpc('create_investment_validated', {
        p_tenant_id:          currentTenant.id,
        p_user_id:            investorId,
        p_payer_id:           debtorId,
        p_asset_name:         `Contrato ${parsed.debtor_name.split(' ')[0]}`,
        p_amount_invested:    parsed.amount_invested,
        p_source_capital:     sourceCapital,
        p_source_profit:      sourceProfit,
        p_current_value:      parsed.current_value,
        p_interest_rate:      interestRate,
        p_installment_value:  parsed.installment_value,
        p_total_installments: parsed.total_installments,
        p_frequency:          parsed.frequency,
        p_due_day:            parsed.frequency === 'monthly' ? parsed.due_day : null,
        p_weekday:            parsed.frequency === 'weekly' ? 1 : null,
        p_start_date:         parsed.frequency === 'daily' ? new Date().toISOString().split('T')[0] : null,
        p_calculation_mode:   'manual',
        p_company_id:         activeCompanyId || null,
      }));
    }
      if (error) throw error;
      setStep('done');
    } catch (err: any) {
      setCreateError(parseSupabaseError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateDebtorAndConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const maskCPF = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
            .replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3')
            .replace(/(\d{3})(\d{0,3})/, '$1.$2');
  };

  const inputCls = "w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-3 py-2 text-white text-sm focus:border-teal-500 outline-none transition-all [color-scheme:dark]";
  const labelCls = "type-micro text-[color:var(--text-muted)] block mb-1";

  return (
    <>
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-[2rem] w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[color:var(--border-subtle)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/10 rounded-xl text-teal-400"><Zap size={20} /></div>
            <div>
              <h2 className="type-subheading uppercase text-[color:var(--text-primary)]">
                Contrato Antigo
              </h2>
              <p className="type-label text-[color:var(--text-muted)]">
                Cadastro Manual
              </p>
            </div>
          </div>
          <button onClick={resetAndClose} className="text-[color:var(--text-muted)] hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">

          {/* STEP: CONFIRM (com campos editáveis) */}
          {step === 'confirm' && editable && (
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-2">
                <Pencil size={13} className="text-teal-400"/>
                <p className="text-[color:var(--text-secondary)] text-xs">Revise e ajuste os dados extraídos:</p>
              </div>

              {/* Devedor */}
              <div className="bg-[color:var(--bg-elevated)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="type-label text-[color:var(--text-muted)]">Devedor</p>

                {/* Cliente selecionado */}
                {matchedDebtor ? (
                  <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={15} className="text-emerald-400 shrink-0"/>
                      <div>
                        <p className="text-xs text-emerald-300 font-bold">{matchedDebtor.full_name}</p>
                        {matchedDebtor.phone_number && (
                          <p className="type-caption text-[color:var(--text-muted)]">{matchedDebtor.phone_number}</p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setMatchedDebtor(null); setDebtorSearch(''); setDebtorDropdownOpen(true); setTimeout(() => debtorInputRef.current?.focus(), 50); }}
                      className="text-[color:var(--text-muted)] hover:text-white transition-colors ml-2"
                    >
                      <X size={14}/>
                    </button>
                  </div>
                ) : (
                  /* Combobox de busca */
                  <div className="relative">
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] pointer-events-none"/>
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
                        {/* Clientes filtrados */}
                        {profiles
                          .filter(p => p.role === 'debtor' && (
                            !debtorSearch.trim() ||
                            p.full_name.toLowerCase().includes(debtorSearch.toLowerCase()) ||
                            (p.phone_number || '').includes(debtorSearch)
                          ))
                          .slice(0, 8)
                          .map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => {
                                setMatchedDebtor(p);
                                setEditable(prev => prev ? { ...prev, debtor_name: p.full_name } : prev);
                                setDebtorSearch('');
                                setDebtorDropdownOpen(false);
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[color:var(--bg-elevated)] text-left transition-colors"
                            >
                              <div className="w-7 h-7 rounded-full bg-[color:var(--bg-soft)] flex items-center justify-center shrink-0">
                                <User size={13} className="text-[color:var(--text-secondary)]"/>
                              </div>
                              <div>
                                <p className="text-xs text-white font-semibold">{p.full_name}</p>
                                {p.phone_number && <p className="type-caption text-[color:var(--text-muted)]">{p.phone_number}</p>}
                              </div>
                            </button>
                          ))
                        }
                        {profiles.filter(p => p.role === 'debtor').length === 0 && (
                          <p className="text-xs text-[color:var(--text-muted)] px-3 py-2.5">Nenhum cliente cadastrado</p>
                        )}
                        {/* Opção: criar novo */}
                        <button
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setDebtorDropdownOpen(false);
                            setNewDebtor({ full_name: debtorSearch, email: '', phone_number: '', cpf: '' });
                            setCpfError('');
                            setStep('new-debtor');
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] text-left transition-colors"
                        >
                          <div className="w-7 h-7 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0">
                            <UserPlus size={13} className="text-teal-400"/>
                          </div>
                          <p className="text-xs text-teal-400 font-bold">
                            {debtorSearch ? `Criar "${debtorSearch}"` : 'Criar novo devedor'}
                          </p>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Valores financeiros */}
              <div className="bg-[color:var(--bg-elevated)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="type-label text-[color:var(--text-muted)]">Valores</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Principal (R$)</label>
                    <input type="number" inputMode="decimal" className={inputCls} value={editable.amount_invested}
                      onChange={e => setEditable(prev => prev ? { ...prev, amount_invested: e.target.value } : prev)} />
                  </div>
                  <div>
                    <label className={labelCls}>Total a Receber (R$)</label>
                    <input type="number" inputMode="decimal" className={inputCls} value={editable.current_value}
                      onChange={e => setEditable(prev => prev ? { ...prev, current_value: e.target.value } : prev)} />
                  </div>
                  <div>
                    <label className={labelCls}>Valor da Parcela (R$)</label>
                    <input type="number" inputMode="decimal" className={inputCls} value={editable.installment_value}
                      onChange={e => setEditable(prev => prev ? { ...prev, installment_value: e.target.value } : prev)} />
                  </div>
                  <div>
                    <label className={labelCls}>Nº de Parcelas</label>
                    <input type="number" inputMode="numeric" className={inputCls} value={editable.total_installments}
                      onChange={e => setEditable(prev => prev ? { ...prev, total_installments: e.target.value } : prev)} />
                  </div>
                </div>
              </div>

              {/* Origem do Capital */}
              <div className="bg-[color:var(--bg-elevated)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="type-label text-[color:var(--text-muted)]">Origem do Capital</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSourceType('own')}
                    className={`flex-1 py-2 rounded-xl type-label transition-all ${sourceType === 'own' ? 'bg-teal-600 text-white' : 'bg-[color:var(--bg-base)] text-[color:var(--text-secondary)] border border-[color:var(--border-subtle)] hover:border-[color:var(--border-strong)]'}`}
                  >
                    Capital Próprio
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

              {/* Datas */}
              <div className="bg-[color:var(--bg-elevated)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="type-label text-[color:var(--text-muted)]">Vencimento</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Frequência</label>
                    <select
                      className={inputCls}
                      value={editable.frequency}
                      onChange={e => setEditable(prev => prev ? { ...prev, frequency: e.target.value as any } : prev)}
                    >
                      <option value="monthly">Mensal</option>
                      <option value="weekly">Semanal</option>
                      <option value="daily">Diária</option>
                    </select>
                  </div>
                  {editable.frequency === 'monthly' && (
                    <div>
                      <label className={labelCls}>Dia do mês</label>
                      <input type="number" inputMode="numeric" min="1" max="31" className={inputCls} value={editable.due_day}
                        placeholder="Ex: 10"
                        onChange={e => setEditable(prev => prev ? { ...prev, due_day: e.target.value } : prev)} />
                    </div>
                  )}
                </div>
              </div>

              {/* Contrato Legado / Antigo */}
              <div className="bg-[color:var(--bg-elevated)] rounded-2xl border border-[color:var(--border-subtle)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setLegacyOpen(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[color:var(--bg-soft)]/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <History size={14} className={isLegacy ? 'text-amber-400' : 'text-[color:var(--text-muted)]'} />
                    <span className={`type-label ${isLegacy ? 'text-amber-300' : 'text-[color:var(--text-muted)]'}`}>
                      Contrato Antigo {isLegacy && '(ativo)'}
                    </span>
                  </div>
                  {legacyOpen ? <ChevronUp size={14} className="text-[color:var(--text-muted)]"/> : <ChevronDown size={14} className="text-[color:var(--text-muted)]"/>}
                </button>

                {legacyOpen && (
                  <div className="px-4 pb-4 space-y-3 border-t border-[color:var(--border-subtle)]">
                    <p className="type-caption text-[color:var(--text-muted)] pt-3 leading-relaxed">
                      Ative se o contrato foi feito antes de usar a plataforma. As parcelas já recebidas serão marcadas como pagas automaticamente.
                    </p>

                    {/* Toggle ativo */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[color:var(--text-secondary)] font-bold">É um contrato antigo?</span>
                      <button
                        type="button"
                        onClick={() => setIsLegacy(v => !v)}
                        className={`relative w-11 h-6 rounded-full transition-colors ${isLegacy ? 'bg-amber-500' : 'bg-[color:var(--bg-soft)]'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isLegacy ? 'translate-x-6' : 'translate-x-1'}`}/>
                      </button>
                    </div>

                    {isLegacy && (
                      <div className="space-y-3">
                        <div>
                          <label className={labelCls}>Data da 1ª Parcela *</label>
                          <input
                            type="date"
                            value={legacyFirstDueDate}
                            onChange={e => {
                              setLegacyFirstDueDate(e.target.value);
                              setLegacyPaidCount(0);
                            }}
                            className={inputCls}
                          />
                        </div>

                        {legacyFirstDueDate && editable && (
                          <div>
                            <label className={labelCls}>
                              Parcelas já recebidas: <span className="text-amber-400">{legacyPaidCount} de {editable.total_installments}</span>
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={parseInt(editable.total_installments) || 1}
                              value={legacyPaidCount}
                              onChange={e => setLegacyPaidCount(Number(e.target.value))}
                              className="w-full accent-amber-500"
                            />
                            {legacyPaidCount > 0 && (
                              <p className="type-caption text-amber-400 mt-1">
                                Parcelas 1 a {legacyPaidCount} → <strong>PAGAS</strong> · Parcelas {legacyPaidCount + 1} a {editable.total_installments} → <strong>PENDENTES</strong>
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
                    )}
                  </div>
                )}
              </div>

              {createError && (
                <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/30 rounded-xl text-xs text-red-400">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />{createError}
                </div>
              )}

              <div className="flex gap-3 pb-1">
                <button
                  onClick={resetAndClose}
                  className="flex-1 py-3 rounded-2xl border border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] hover:text-white type-label flex items-center justify-center gap-2 transition-all hover:bg-[color:var(--bg-elevated)]"
                >
                  <ArrowLeft size={14}/> Cancelar
                </button>
                {matchedDebtor ? (
                  <button
                    onClick={() => handleConfirm(matchedDebtor.id)}
                    disabled={creating}
                    className="flex-[2] bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white py-3 rounded-2xl type-label flex items-center justify-center gap-2 transition-all"
                  >
                    {creating ? <><Loader2 size={14} className="animate-spin"/> Criando...</> : <><CheckCircle2 size={14}/> Confirmar e Criar</>}
                  </button>
                ) : (
                  <button
                    onClick={() => { setNewDebtor({ full_name: debtorSearch || editable.debtor_name, email: '', phone_number: '', cpf: '' }); setCpfError(''); setDebtorDropdownOpen(false); setStep('new-debtor'); }}
                    className="flex-[2] bg-[color:var(--accent-caution-btn)] hover:bg-[color:var(--accent-caution-btn-hover)] text-white py-3 rounded-2xl type-label flex items-center justify-center gap-2 transition-all"
                  >
                    <UserPlus size={14}/> Cadastrar Devedor
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP: DONE */}
          {step === 'done' && (
            <div className="p-8 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center">
                <CheckCircle2 size={36} className="text-emerald-400" />
              </div>
              <h3 className="type-subheading text-[color:var(--text-primary)]">Contrato Criado!</h3>
              <p className="text-[color:var(--text-secondary)] text-sm">As parcelas foram geradas automaticamente.</p>
              <button
                onClick={() => { resetAndClose(); onSuccess(); }}
                className="bg-teal-600 hover:bg-teal-500 text-white px-8 py-3 rounded-2xl type-label transition-all"
              >
                Ver Contratos
              </button>
            </div>
          )}

        </div>
      </div>
    </div>

    {/* SLIDE-OVER: NEW DEBTOR — renderizado fora do modal principal */}
    {step === 'new-debtor' && (
      <div className="fixed inset-0 z-[60] flex justify-end">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setStep('confirm'); setCpfError(''); }} />
        <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-[color:var(--bg-base)] shadow-2xl border-l border-[color:var(--border-subtle)] animate-slide-in-right">
          {/* Header fixo */}
          <div className="shrink-0 flex items-center gap-3 px-6 py-5 border-b border-[color:var(--border-subtle)]">
            <button type="button" onClick={() => { setStep('confirm'); setCpfError(''); }} className="text-[color:var(--text-secondary)] hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </button>
            <div className="flex-1">
              <h3 className="type-subheading uppercase text-[color:var(--text-primary)]">Novo Devedor</h3>
              <p className="type-label text-[color:var(--text-muted)]">Dados do cliente</p>
            </div>
            <button type="button" onClick={resetAndClose} className="text-[color:var(--text-muted)] hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          {/* Body scrollável */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <form onSubmit={handleCreateDebtorAndConfirm} className="space-y-4">
              {/* Identificação */}
              <div className="bg-[color:var(--bg-elevated)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="type-label text-[color:var(--text-muted)]">Identificação</p>
                <div>
                  <label className="type-label text-[color:var(--text-muted)] block mb-1">Nome Completo *</label>
                  <div className="relative">
                    <User size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] pointer-events-none" />
                    <input required type="text" value={newDebtor.full_name} onChange={e => setNewDebtor({ ...newDebtor, full_name: e.target.value })} className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl pl-10 pr-3 py-2.5 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" placeholder="Nome completo" />
                  </div>
                </div>
                <div>
                  <label className="type-label text-[color:var(--text-muted)] block mb-1">E-mail</label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] pointer-events-none" />
                    <input type="email" value={newDebtor.email} onChange={e => setNewDebtor({ ...newDebtor, email: e.target.value })} className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl pl-10 pr-3 py-2.5 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" placeholder="email@exemplo.com (opcional)" />
                  </div>
                </div>
                <div>
                  <label className="type-label text-[color:var(--text-muted)] block mb-1">Telefone</label>
                  <div className="relative">
                    <Phone size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] pointer-events-none" />
                    <input type="tel" value={newDebtor.phone_number} onChange={e => setNewDebtor({ ...newDebtor, phone_number: e.target.value })} className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl pl-10 pr-3 py-2.5 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)]" placeholder="(11) 99999-9999 (opcional)" />
                  </div>
                </div>
              </div>
              {/* Documento */}
              <div className="bg-[color:var(--bg-elevated)] rounded-2xl p-4 border border-[color:var(--border-subtle)] space-y-3">
                <p className="type-label text-[color:var(--text-muted)]">Documento</p>
                <div>
                  <label className="type-label text-[color:var(--text-muted)] block mb-1">CPF</label>
                  <div className="relative">
                    <Key size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] pointer-events-none" />
                    <input type="text" value={newDebtor.cpf} onChange={e => { setCpfError(''); setNewDebtor({ ...newDebtor, cpf: maskCPF(e.target.value) }); }} className={`w-full bg-[color:var(--bg-base)] border rounded-xl pl-10 pr-3 py-2.5 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-[color:var(--text-faint)] ${cpfError ? 'border-red-500' : 'border-[color:var(--border-subtle)]'}`} placeholder="000.000.000-00 (opcional)" maxLength={14} />
                  </div>
                  {cpfError && <p className="text-red-400 type-caption mt-1 font-bold">{cpfError}</p>}
                </div>
              </div>
              {createError && (
                <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/30 rounded-xl text-xs text-red-400">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />{createError}
                </div>
              )}
              <div className="pb-4">
                <button type="submit" disabled={creating} className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white py-3.5 rounded-2xl type-label flex items-center justify-center gap-2 transition-all">
                  {creating ? <><Loader2 size={14} className="animate-spin"/> Criando...</> : <><CheckCircle2 size={14}/> Cadastrar e Criar</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default QuickContractInput;
