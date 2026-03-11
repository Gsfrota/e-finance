
import React, { useState } from 'react';
import { Zap, X, Loader2, CheckCircle2, AlertTriangle, User, UserPlus, ArrowLeft, Pencil, Mail, Phone, Key } from 'lucide-react';
import { parseContractFromText, ParsedContract } from '../services/gemini';
import { getSupabase, parseSupabaseError, isValidCPF } from '../services/supabase';
import { Profile, Tenant } from '../types';

interface QuickContractInputProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  profiles: Profile[];
  currentTenant: Tenant | null;
  currentUserId: string | null;
}

type Step = 'input' | 'confirm' | 'new-debtor' | 'done';

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
}) => {
  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [editable, setEditable] = useState<EditableContract | null>(null);
  const [matchedDebtor, setMatchedDebtor] = useState<Profile | null>(null);
  const [parseError, setParseError] = useState('');
  const [newDebtor, setNewDebtor] = useState({ full_name: '', email: '', phone_number: '', cpf: '' });
  const [cpfError, setCpfError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [sourceType, setSourceType] = useState<'own' | 'profit'>('own');

  if (!isOpen) return null;

  const resetAndClose = () => {
    setStep('input');
    setText('');
    setEditable(null);
    setParseError('');
    setMatchedDebtor(null);
    setNewDebtor({ full_name: '', email: '', phone_number: '', cpf: '' });
    setCpfError('');
    setCreateError('');
    setSourceType('own');
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

  const handleParse = async () => {
    if (!text.trim()) return;
    setParsing(true);
    setParseError('');
    try {
      const result = await parseContractFromText(text);
      setEditable(toEditable(result));
      setMatchedDebtor(findDebtorByName(result.debtor_name));
      setStep('confirm');
    } catch (err: any) {
      setParseError(err.message || 'Erro ao interpretar a frase.');
    } finally {
      setParsing(false);
    }
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
      const { data: investmentId, error } = await supabase.rpc('create_investment_validated', {
        p_tenant_id: currentTenant.id,
        p_user_id: investorId,
        p_payer_id: debtorId,
        p_asset_name: `Contrato ${parsed.debtor_name.split(' ')[0]}`,
        p_amount_invested: parsed.amount_invested,
        p_source_capital: sourceCapital,
        p_source_profit: sourceProfit,
        p_current_value: parsed.current_value,
        p_interest_rate: parsed.amount_invested > 0
          ? Number((((parsed.current_value - parsed.amount_invested) / parsed.amount_invested) * 100).toFixed(2))
          : 0,
        p_installment_value: parsed.installment_value,
        p_total_installments: parsed.total_installments,
        p_frequency: parsed.frequency,
        p_due_day: parsed.frequency === 'monthly' ? parsed.due_day : null,
        p_weekday: parsed.frequency === 'weekly' ? 1 : null,
        p_start_date: parsed.frequency === 'daily' ? new Date().toISOString().split('T')[0] : null,
        p_calculation_mode: 'manual',
      });
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

  const inputCls = "w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm focus:border-teal-500 outline-none transition-all";
  const labelCls = "text-[9px] font-black uppercase text-slate-500 tracking-widest block mb-1";

  return (
    <>
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-[2rem] w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/10 rounded-xl text-teal-400"><Zap size={20} /></div>
            <div>
              <h2 className="text-white font-black text-base uppercase tracking-wide">Cadastro Rápido</h2>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Linguagem Natural</p>
            </div>
          </div>
          <button onClick={resetAndClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">

          {/* STEP: INPUT */}
          {step === 'input' && (
            <div className="p-6 space-y-5">
              <p className="text-slate-400 text-xs leading-relaxed">
                Descreva o contrato em português. A IA vai extrair os dados automaticamente.
              </p>
              <textarea
                className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-white text-sm resize-none focus:border-teal-500 outline-none transition-all placeholder:text-slate-600 min-h-[110px]"
                placeholder='Ex: "Emprestei 1000 reais ao Guilherme, ele paga 2mil todo dia 10 em 10 parcelas de 200"'
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleParse(); }}
              />
              {parseError && (
                <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/30 rounded-xl text-xs text-red-400">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />{parseError}
                </div>
              )}
              <button
                onClick={handleParse}
                disabled={!text.trim() || parsing}
                className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
              >
                {parsing ? <><Loader2 size={16} className="animate-spin"/> Interpretando...</> : <><Zap size={16}/> Interpretar</>}
              </button>
              <p className="hidden md:block text-center text-[10px] text-slate-600">Ctrl+Enter para enviar</p>
            </div>
          )}

          {/* STEP: CONFIRM (com campos editáveis) */}
          {step === 'confirm' && editable && (
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-2">
                <Pencil size={13} className="text-teal-400"/>
                <p className="text-slate-400 text-xs">Revise e ajuste os dados extraídos:</p>
              </div>

              {/* Devedor */}
              <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 space-y-3">
                <p className="text-[10px] font-black uppercase text-slate-500">Devedor</p>
                <div>
                  <label className={labelCls}>Nome</label>
                  <input
                    className={inputCls}
                    value={editable.debtor_name}
                    onChange={e => handleDebtorNameChange(e.target.value)}
                  />
                </div>
                {/* Status do match */}
                {matchedDebtor ? (
                  <div className="flex items-center gap-2 text-xs text-emerald-400">
                    <CheckCircle2 size={13}/>
                    <span>Vinculado a <strong>{matchedDebtor.full_name}</strong></span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle size={13}/>
                    <span>Não encontrado — será criado como novo devedor</span>
                  </div>
                )}
              </div>

              {/* Valores financeiros */}
              <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 space-y-3">
                <p className="text-[10px] font-black uppercase text-slate-500">Valores</p>
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
              <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 space-y-3">
                <p className="text-[10px] font-black uppercase text-slate-500">Origem do Capital</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSourceType('own')}
                    className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${sourceType === 'own' ? 'bg-teal-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-700 hover:border-slate-600'}`}
                  >
                    Capital Próprio
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceType('profit')}
                    className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${sourceType === 'profit' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-400 border border-slate-700 hover:border-slate-600'}`}
                  >
                    Lucro Reinvestido
                  </button>
                </div>
              </div>

              {/* Datas */}
              <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 space-y-3">
                <p className="text-[10px] font-black uppercase text-slate-500">Vencimento</p>
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

              {createError && (
                <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/30 rounded-xl text-xs text-red-400">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />{createError}
                </div>
              )}

              <div className="flex gap-3 pb-1">
                <button
                  onClick={() => { setStep('input'); setCreateError(''); }}
                  className="flex-1 py-3 rounded-2xl border border-slate-700 text-slate-400 hover:text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:bg-slate-800"
                >
                  <ArrowLeft size={14}/> Voltar
                </button>
                {matchedDebtor ? (
                  <button
                    onClick={() => handleConfirm(matchedDebtor.id)}
                    disabled={creating}
                    className="flex-[2] bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                  >
                    {creating ? <><Loader2 size={14} className="animate-spin"/> Criando...</> : <><CheckCircle2 size={14}/> Confirmar e Criar</>}
                  </button>
                ) : (
                  <button
                    onClick={() => { setNewDebtor({ full_name: editable.debtor_name, email: '', phone_number: '', cpf: '' }); setCpfError(''); setStep('new-debtor'); }}
                    className="flex-[2] bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
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
              <h3 className="text-white font-black text-lg">Contrato Criado!</h3>
              <p className="text-slate-400 text-sm">As parcelas foram geradas automaticamente.</p>
              <button
                onClick={() => { resetAndClose(); onSuccess(); }}
                className="bg-teal-600 hover:bg-teal-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
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
        <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-slate-900 shadow-2xl border-l border-slate-700 animate-slide-in-right">
          {/* Header fixo */}
          <div className="shrink-0 flex items-center gap-3 px-6 py-5 border-b border-slate-800">
            <button type="button" onClick={() => { setStep('confirm'); setCpfError(''); }} className="text-slate-400 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </button>
            <div className="flex-1">
              <h3 className="text-white font-black text-base uppercase tracking-wide">Novo Devedor</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Dados do cliente</p>
            </div>
            <button type="button" onClick={resetAndClose} className="text-slate-500 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          {/* Body scrollável */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <form onSubmit={handleCreateDebtorAndConfirm} className="space-y-4">
              {/* Identificação */}
              <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 space-y-3">
                <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Identificação</p>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Nome Completo *</label>
                  <div className="relative">
                    <User size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input required type="text" value={newDebtor.full_name} onChange={e => setNewDebtor({ ...newDebtor, full_name: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3 py-2.5 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-slate-600" placeholder="Nome completo" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">E-mail</label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input type="email" value={newDebtor.email} onChange={e => setNewDebtor({ ...newDebtor, email: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3 py-2.5 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-slate-600" placeholder="email@exemplo.com (opcional)" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Telefone</label>
                  <div className="relative">
                    <Phone size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input type="tel" value={newDebtor.phone_number} onChange={e => setNewDebtor({ ...newDebtor, phone_number: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3 py-2.5 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-slate-600" placeholder="(11) 99999-9999 (opcional)" />
                  </div>
                </div>
              </div>
              {/* Documento */}
              <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 space-y-3">
                <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Documento</p>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">CPF</label>
                  <div className="relative">
                    <Key size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input type="text" value={newDebtor.cpf} onChange={e => { setCpfError(''); setNewDebtor({ ...newDebtor, cpf: maskCPF(e.target.value) }); }} className={`w-full bg-slate-950 border rounded-xl pl-10 pr-3 py-2.5 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-slate-600 ${cpfError ? 'border-red-500' : 'border-slate-700'}`} placeholder="000.000.000-00 (opcional)" maxLength={14} />
                  </div>
                  {cpfError && <p className="text-red-400 text-[10px] mt-1 font-bold">{cpfError}</p>}
                </div>
              </div>
              {createError && (
                <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/30 rounded-xl text-xs text-red-400">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />{createError}
                </div>
              )}
              <div className="pb-4">
                <button type="submit" disabled={creating} className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
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
