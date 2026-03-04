
import React, { useState } from 'react';
import { Zap, X, Loader2, CheckCircle2, AlertTriangle, User, UserPlus, ArrowLeft } from 'lucide-react';
import { parseContractFromText, ParsedContract } from '../services/gemini';
import { getSupabase, parseSupabaseError } from '../services/supabase';
import { Profile, Tenant } from '../types';

interface QuickContractInputProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  profiles: Profile[];
  currentTenant: Tenant | null;
  currentUserId: string | null;
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

type Step = 'input' | 'confirm' | 'new-debtor' | 'done';

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
  const [parsed, setParsed] = useState<ParsedContract | null>(null);
  const [parseError, setParseError] = useState('');
  const [matchedDebtor, setMatchedDebtor] = useState<Profile | null>(null);
  const [newDebtor, setNewDebtor] = useState({ full_name: '', email: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  if (!isOpen) return null;

  const handleClose = () => {
    setStep('input');
    setText('');
    setParsed(null);
    setParseError('');
    setMatchedDebtor(null);
    setNewDebtor({ full_name: '', email: '' });
    setCreateError('');
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
      setParsed(result);
      const found = findDebtorByName(result.debtor_name);
      setMatchedDebtor(found);
      setStep('confirm');
    } catch (err: any) {
      setParseError(err.message || 'Erro ao interpretar a frase.');
    } finally {
      setParsing(false);
    }
  };

  const getInvestorId = (): string | null => {
    if (currentUserId) return currentUserId;
    const admin = profiles.find(p => p.role === 'admin');
    return admin?.id || profiles[0]?.id || null;
  };

  const handleConfirm = async (debtorId: string) => {
    if (!parsed || !currentTenant) return;
    const investorId = getInvestorId();
    if (!investorId) {
      setCreateError('Nenhum investidor encontrado no sistema.');
      return;
    }

    setCreating(true);
    setCreateError('');
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { error } = await supabase.rpc('create_investment_validated', {
        p_tenant_id: currentTenant.id,
        p_user_id: investorId,
        p_payer_id: debtorId,
        p_asset_name: `Contrato ${parsed.debtor_name.split(' ')[0]}`,
        p_amount_invested: parsed.amount_invested,
        p_source_profit: 0,
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
    if (!newDebtor.full_name || !newDebtor.email || !currentTenant) return;
    setCreating(true);
    setCreateError('');
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { data, error } = await supabase.from('profiles').insert({
        email: newDebtor.email,
        full_name: newDebtor.full_name,
        role: 'debtor',
        tenant_id: currentTenant.id,
      }).select().single();

      if (error) throw error;
      await handleConfirm(data.id);
    } catch (err: any) {
      setCreateError(parseSupabaseError(err));
      setCreating(false);
    }
  };

  const frequencyLabel: Record<string, string> = {
    monthly: 'Mensal',
    weekly: 'Semanal',
    daily: 'Diária',
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-[2rem] w-full max-w-lg shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/10 rounded-xl text-teal-400">
              <Zap size={20} />
            </div>
            <div>
              <h2 className="text-white font-black text-base uppercase tracking-wide">Cadastro Rápido</h2>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Linguagem Natural</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

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
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {parseError}
              </div>
            )}
            <button
              onClick={handleParse}
              disabled={!text.trim() || parsing}
              className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
            >
              {parsing ? <><Loader2 size={16} className="animate-spin"/> Interpretando...</> : <><Zap size={16}/> Interpretar</>}
            </button>
            <p className="text-center text-[10px] text-slate-600">Ctrl+Enter para enviar</p>
          </div>
        )}

        {/* STEP: CONFIRM */}
        {step === 'confirm' && parsed && (
          <div className="p-6 space-y-5">
            <p className="text-slate-400 text-xs">Confirme os dados extraídos:</p>

            {/* Dados do contrato */}
            <div className="bg-slate-800 rounded-2xl p-4 space-y-3 border border-slate-700">
              <div className="grid grid-cols-2 gap-3">
                <DataRow label="Principal" value={formatCurrency(parsed.amount_invested)} color="indigo" />
                <DataRow label="Total a Pagar" value={formatCurrency(parsed.current_value)} color="emerald" />
                <DataRow label="Valor Parcela" value={formatCurrency(parsed.installment_value)} color="white" />
                <DataRow label="Nº Parcelas" value={String(parsed.total_installments)} color="white" />
                <DataRow label="Frequência" value={frequencyLabel[parsed.frequency] || parsed.frequency} color="sky" />
                {parsed.due_day && <DataRow label="Dia Venc." value={`Dia ${parsed.due_day}`} color="amber" />}
              </div>
            </div>

            {/* Devedor */}
            <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
              <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Devedor identificado</p>
              {matchedDebtor ? (
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400">
                    <User size={16} />
                  </div>
                  <div>
                    <p className="text-white font-bold text-sm">{matchedDebtor.full_name}</p>
                    <p className="text-slate-500 text-[10px]">{matchedDebtor.email}</p>
                  </div>
                  <CheckCircle2 size={16} className="text-emerald-400 ml-auto" />
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 rounded-xl text-amber-400">
                    <AlertTriangle size={16} />
                  </div>
                  <div>
                    <p className="text-amber-400 font-bold text-sm">"{parsed.debtor_name}" não encontrado</p>
                    <p className="text-slate-500 text-[10px]">Será necessário cadastrá-lo</p>
                  </div>
                </div>
              )}
            </div>

            {createError && (
              <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/30 rounded-xl text-xs text-red-400">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {createError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setStep('input'); setCreateError(''); }}
                className="flex-1 py-3 rounded-2xl border border-slate-700 text-slate-400 hover:text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:bg-slate-800"
              >
                <ArrowLeft size={14}/> Editar
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
                  onClick={() => { setNewDebtor({ full_name: parsed.debtor_name, email: '' }); setStep('new-debtor'); }}
                  className="flex-[2] bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                >
                  <UserPlus size={14}/> Cadastrar Devedor
                </button>
              )}
            </div>
          </div>
        )}

        {/* STEP: NEW DEBTOR */}
        {step === 'new-debtor' && (
          <form onSubmit={handleCreateDebtorAndConfirm} className="p-6 space-y-4">
            <p className="text-slate-400 text-xs">Preencha os dados do novo devedor:</p>
            <input
              required
              type="text"
              placeholder="Nome Completo"
              value={newDebtor.full_name}
              onChange={e => setNewDebtor({ ...newDebtor, full_name: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-slate-600"
            />
            <input
              required
              type="email"
              placeholder="E-mail do Cliente"
              value={newDebtor.email}
              onChange={e => setNewDebtor({ ...newDebtor, email: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-white text-sm focus:border-teal-500 outline-none transition-all placeholder:text-slate-600"
            />
            {createError && (
              <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-900/30 rounded-xl text-xs text-red-400">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {createError}
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStep('confirm')}
                className="flex-1 py-3 rounded-2xl border border-slate-700 text-slate-400 hover:text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:bg-slate-800"
              >
                <ArrowLeft size={14}/> Voltar
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex-[2] bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white py-3 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
              >
                {creating ? <><Loader2 size={14} className="animate-spin"/> Criando...</> : <><CheckCircle2 size={14}/> Cadastrar e Criar</>}
              </button>
            </div>
          </form>
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
              onClick={() => { handleClose(); onSuccess(); }}
              className="bg-teal-600 hover:bg-teal-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
            >
              Ver Contratos
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const DataRow: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => {
  const colorMap: Record<string, string> = {
    indigo: 'text-indigo-300',
    emerald: 'text-emerald-300',
    sky: 'text-sky-300',
    amber: 'text-amber-300',
    white: 'text-white',
  };
  return (
    <div>
      <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest">{label}</p>
      <p className={`text-sm font-black ${colorMap[color] || 'text-white'}`}>{value}</p>
    </div>
  );
};

export default QuickContractInput;
