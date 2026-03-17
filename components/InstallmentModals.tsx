
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { LoanInstallment, Tenant } from '../types';
import { getSupabase } from '../services/supabase';
import { X, CheckCircle2, Calendar, DollarSign, Loader2, AlertTriangle, RefreshCw, Pencil, Save, Printer, Percent, ArrowDownToLine, ArrowRight, Plus, ChevronLeft, TrendingUp } from 'lucide-react';
import { parseSupabaseError } from '../services/supabase';
import ReceiptTemplate from './ReceiptTemplate';

// --- SHARED TYPES & HELPERS ---

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  installment: LoanInstallment | null;
  tenant?: Tenant | null; // Added Tenant for Receipts
  payerName?: string;     // Added Payer Name for Receipts
}

const formatCurrency = (val: number) => 
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const normalizeNumber = (val: any): number => {
    if (val === null || val === undefined) return 0;
    const num = Number(val);
    return isNaN(num) ? 0 : num;
};

const calculateOutstanding = (inst: LoanInstallment | null): number => {
    if (!inst) return 0;
    const total = normalizeNumber(inst.amount_total);
    const fine = normalizeNumber(inst.fine_amount);
    const delay = normalizeNumber(inst.interest_delay_amount);
    const paid = normalizeNumber(inst.amount_paid);
    return Math.max(0, (total + fine + delay) - paid);
};

const ModalBackdrop: React.FC<{ children: React.ReactNode, onClose: () => void }> = ({ children, onClose }) => (
  <div 
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
    onClick={onClose}
  >
    <div 
      className="bg-slate-800 border border-slate-700 rounded-[2rem] w-full max-w-md shadow-2xl relative overflow-hidden animate-fade-in-up"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  </div>
);

const Header: React.FC<{ title: string, subtitle: string, icon: React.ReactNode, onClose: () => void, colorClass: string }> = ({ 
  title, subtitle, icon, onClose, colorClass 
}) => (
  <div className="p-6 border-b border-slate-700 bg-slate-900/30 flex justify-between items-start">
    <div className="flex items-center gap-3">
      <div className={`p-3 rounded-xl bg-opacity-20 ${colorClass.replace('text-', 'bg-')} ${colorClass}`}>
        {icon}
      </div>
      <div>
        <h3 className="text-lg font-black text-white uppercase tracking-tighter">{title}</h3>
        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{subtitle}</p>
      </div>
    </div>
    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-2 hover:bg-slate-700 rounded-full">
      <X size={20} />
    </button>
  </div>
);

// --- 1. PAYMENT MODAL (Dar Baixa & Comprovante) ---

type DeferAction = 'last' | 'next' | 'new';

interface InstallmentContext {
  nextInst: { id: string; number: number; amount_total: number } | null;
  lastInst: { id: string; number: number; amount_total: number } | null;
}

export const PaymentModal: React.FC<BaseModalProps> = ({ isOpen, onClose, onSuccess, installment, tenant, payerName }) => {
  // ── Step control ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1);

  // ── Step 1 state ────────────────────────────────────────────────────────────
  const [amount, setAmount]           = useState('');
  const [paymentMethod, setPaymentMethod] = useState('PIX');

  // ── Step 2 state ────────────────────────────────────────────────────────────
  const [deferAction, setDeferAction]     = useState<DeferAction>('last');
  const [useInterest, setUseInterest]     = useState(false);
  const [interestPercent, setInterestPercent] = useState('');
  const [context, setContext]             = useState<InstallmentContext>({ nextInst: null, lastInst: null });
  const [loadingContext, setLoadingContext] = useState(false);

  // ── Shared state ─────────────────────────────────────────────────────────────
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [isReceiptMode, setIsReceiptMode] = useState(false);

  const outstanding = calculateOutstanding(installment);
  const amountVal   = parseFloat(amount) || 0;
  const remainder   = Math.max(0, outstanding - amountVal);
  const isPartial   = amountVal > 0 && remainder > 0.01;
  const interestAmt = useInterest && interestPercent ? remainder * (parseFloat(interestPercent) || 0) / 100 : 0;
  const remainderWithInterest = remainder + interestAmt;

  // ── Reset on open ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && installment) {
      setStep(1);
      setError(null);
      setPaymentMethod('PIX');
      setDeferAction('last');
      setUseInterest(false);
      setInterestPercent('');
      setContext({ nextInst: null, lastInst: null });
      setIsReceiptMode(installment.status === 'paid');
      if (installment.status !== 'paid') setAmount(outstanding.toFixed(2));
    }
  }, [isOpen, installment, outstanding]);

  // ── Inert background when receipt ───────────────────────────────────────────
  useEffect(() => {
    if (!isReceiptMode) return;
    const root = document.getElementById('root');
    root?.setAttribute('inert', 'true');
    return () => root?.removeAttribute('inert');
  }, [isReceiptMode]);

  // ── Load adjacent installments for step 2 ───────────────────────────────────
  const loadContext = async () => {
    if (!installment) return;
    setLoadingContext(true);
    const supabase = getSupabase();
    if (!supabase) { setLoadingContext(false); return; }
    try {
      const { data } = await supabase
        .from('loan_installments')
        .select('id, number, amount_total, due_date, status')
        .eq('investment_id', installment.investment_id)
        .neq('id', installment.id)
        .order('number', { ascending: true });
      if (data) {
        const rows = data as any[];
        const pending = rows.filter(r => ['pending', 'late', 'partial'].includes(r.status));
        const nextInst = rows.find(r => r.number > installment.number) ?? null;
        const lastInst = pending.length ? pending[pending.length - 1] : null;
        setContext({ nextInst, lastInst });
        // Default: se tem última, seleciona 'last'; se só tem próxima, seleciona 'next'
        if (lastInst) setDeferAction('last');
        else if (nextInst) setDeferAction('next');
        else setDeferAction('new');
      }
    } finally {
      setLoadingContext(false);
    }
  };

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleStep1Next = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) { setError('O valor deve ser maior que zero.'); return; }
    if (val > outstanding + 0.01) { setError('Valor excede o saldo devedor.'); return; }
    setError(null);
    if (isPartial) {
      await loadContext();
      setStep(2);
    } else {
      await submitPayment(val, null, 0);
    }
  };

  const handleStep2Confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    const rate = useInterest ? parseFloat(interestPercent) || 0 : 0;
    await submitPayment(val, deferAction, rate);
  };

  const submitPayment = async (val: number, action: DeferAction | null, rate: number) => {
    if (!installment) return;
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      const { error: payErr } = await supabase.rpc('pay_installment', {
        p_installment_id: installment.id,
        p_amount_paid: val,
      });
      if (payErr) throw payErr;

      if (action) {
        const { error: deferErr } = await supabase.rpc('apply_remainder_action', {
          p_installment_id: installment.id,
          p_action: action,
          p_interest_rate: rate,
        });
        if (deferErr) throw deferErr;
      }

      onSuccess();
      installment.amount_paid = val;
      installment.paid_at = new Date().toISOString();
      setIsReceiptMode(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao processar pagamento.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !installment) return null;

  // ── Receipt mode ─────────────────────────────────────────────────────────────
  if (isReceiptMode && tenant) {
    return ReactDOM.createPortal(
      <div data-html2canvas-ignore="true" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#0d0d14' }} onClick={(e) => e.stopPropagation()}>
        <ReceiptTemplate installment={installment} tenant={tenant} payerName={payerName || installment.investment?.payer?.full_name} paymentMethod={paymentMethod} onClose={onClose} />
      </div>,
      document.body
    );
  }
  if (isReceiptMode) {
    return (
      <ModalBackdrop onClose={onClose}>
        <div className="p-8 text-center">
          <CheckCircle2 size={48} className="mx-auto text-emerald-500 mb-4"/>
          <h3 className="text-white font-bold text-xl mb-2">Pagamento Confirmado!</h3>
          <button onClick={onClose} className="bg-slate-700 text-white px-6 py-2 rounded-xl text-xs font-bold uppercase">Fechar</button>
        </div>
      </ModalBackdrop>
    );
  }

  // ── Deferred action card component ──────────────────────────────────────────
  const ActionCard = ({
    id, icon, label, sublabel, active, onClick
  }: { id: DeferAction; icon: React.ReactNode; label: string; sublabel: string; active: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full p-4 rounded-2xl border text-left transition-all duration-150 ${
        active
          ? 'border-emerald-500/50 bg-emerald-900/20 ring-1 ring-emerald-500/20'
          : 'border-slate-700 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-900/60'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Radio dot */}
        <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${active ? 'border-emerald-400' : 'border-slate-600'}`}>
          {active && <div className="h-2 w-2 rounded-full bg-emerald-400"/>}
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`}>{icon}</span>
          <div className="min-w-0">
            <p className={`text-sm font-bold leading-tight ${active ? 'text-white' : 'text-slate-300'}`}>{label}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-tight truncate">{sublabel}</p>
          </div>
        </div>
        {/* Preview amount */}
        <div className="shrink-0 text-right">
          <p className={`text-sm font-black tabular-nums ${active ? 'text-emerald-300' : 'text-slate-500'}`}>
            +{formatCurrency(remainderWithInterest)}
          </p>
        </div>
      </div>
    </button>
  );

  // ── Step 1 ───────────────────────────────────────────────────────────────────
  if (step === 1) return (
    <ModalBackdrop onClose={onClose}>
      <Header title="Baixa de Pagamento" subtitle={`Parcela #${installment.number}`} icon={<CheckCircle2 size={24}/>} onClose={onClose} colorClass="text-emerald-500"/>

      <form onSubmit={handleStep1Next} className="p-6 space-y-5">
        {/* Saldo devedor breakdown */}
        <div className="bg-emerald-900/10 border border-emerald-900/30 p-4 rounded-2xl">
          <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mb-2 text-center">Saldo Devedor</p>
          <p className="text-3xl font-black text-white text-center mb-3">{formatCurrency(outstanding)}</p>
          <div className="space-y-1.5 text-xs border-t border-emerald-900/30 pt-3">
            <div className="flex justify-between text-slate-400">
              <span>Valor original</span>
              <span className="font-mono">{formatCurrency(normalizeNumber(installment.amount_total))}</span>
            </div>
            {(normalizeNumber(installment.fine_amount) + normalizeNumber(installment.interest_delay_amount)) > 0 && (
              <div className="flex justify-between text-amber-400">
                <span>Multa + juros mora</span>
                <span className="font-mono">+ {formatCurrency(normalizeNumber(installment.fine_amount) + normalizeNumber(installment.interest_delay_amount))}</span>
              </div>
            )}
            {normalizeNumber(installment.amount_paid) > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Já pago</span>
                <span className="font-mono">− {formatCurrency(normalizeNumber(installment.amount_paid))}</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {/* Valor recebido */}
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Valor Recebido (R$)</label>
            <div className="relative">
              <DollarSign size={16} className="absolute left-4 top-4 text-emerald-500"/>
              <input
                type="number" step="0.01" inputMode="decimal" required autoFocus
                value={amount} onChange={e => { setAmount(e.target.value); setError(null); }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
            </div>
            {/* Aviso parcial em tempo real */}
            {isPartial && (
              <div className="mt-2 flex items-center justify-between bg-amber-900/20 border border-amber-800/40 rounded-xl px-4 py-2.5">
                <div className="flex items-center gap-2 text-amber-300">
                  <AlertTriangle size={13} className="shrink-0"/>
                  <span className="text-[11px] font-bold">Faltam</span>
                </div>
                <span className="text-amber-200 font-black text-sm tabular-nums">{formatCurrency(remainder)}</span>
              </div>
            )}
          </div>

          {/* Data */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/50 border border-slate-700/50 text-slate-400 text-xs">
            <Calendar size={14} className="shrink-0"/>
            <span>Data da baixa: <strong>Hoje ({new Date().toLocaleDateString('pt-BR')})</strong></span>
          </div>

          {/* Forma de pagamento */}
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Forma de Pagamento</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3.5 text-white outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm">
              <option value="PIX">PIX</option>
              <option value="Dinheiro">Dinheiro</option>
              <option value="Transferência Bancária">Transferência Bancária</option>
              <option value="Boleto Bancário">Boleto Bancário</option>
              <option value="Cartão">Cartão</option>
              <option value="Cheque">Cheque</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <AlertTriangle size={14}/> {error}
            </div>
          )}
        </div>

        <button type="submit" disabled={loading || loadingContext}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-[0.98]">
          {loading || loadingContext
            ? <Loader2 className="animate-spin" size={18}/>
            : isPartial ? <ArrowRight size={18}/> : <CheckCircle2 size={18}/>}
          {loading || loadingContext
            ? 'Aguarde...'
            : isPartial ? `Próximo — destinar ${formatCurrency(remainder)}` : 'Confirmar Recebimento'}
        </button>
      </form>
    </ModalBackdrop>
  );

  // ── Step 2 ───────────────────────────────────────────────────────────────────
  const { nextInst, lastInst } = context;

  return (
    <ModalBackdrop onClose={onClose}>
      {/* Step 2 header custom */}
      <div className="p-5 border-b border-slate-700 bg-slate-900/30 flex items-center gap-3">
        <button onClick={() => setStep(1)} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-slate-700 transition-colors">
          <ChevronLeft size={18}/>
        </button>
        <div className="flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-0.5">Faltam</p>
          <p className="text-xl font-black text-white tabular-nums leading-none">{formatCurrency(remainder)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest">Recebido</p>
          <p className="text-sm font-black text-emerald-400 tabular-nums">{formatCurrency(amountVal)}</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-slate-700 transition-colors ml-1">
          <X size={18}/>
        </button>
      </div>

      <form onSubmit={handleStep2Confirm} className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
        <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest text-center">Como tratar o saldo restante?</p>

        {/* Opções de destino */}
        <div className="space-y-2">
          <ActionCard
            id="last"
            icon={<ArrowDownToLine size={16}/>}
            label="Última parcela"
            sublabel={lastInst
              ? `Parcela #${lastInst.number} · ${formatCurrency(lastInst.amount_total)} → ${formatCurrency(lastInst.amount_total + remainderWithInterest)}`
              : 'Acumular na última parcela pendente'}
            active={deferAction === 'last'}
            onClick={() => setDeferAction('last')}
          />
          <ActionCard
            id="next"
            icon={<ArrowRight size={16}/>}
            label="Próxima parcela"
            sublabel={nextInst
              ? `Parcela #${nextInst.number} · ${formatCurrency(nextInst.amount_total)} → ${formatCurrency(nextInst.amount_total + remainderWithInterest)}`
              : 'Adicionar à parcela seguinte'}
            active={deferAction === 'next'}
            onClick={() => setDeferAction('next')}
          />
          <ActionCard
            id="new"
            icon={<Plus size={16}/>}
            label="Nova parcela extra"
            sublabel="Será criada 30 dias após a última"
            active={deferAction === 'new'}
            onClick={() => setDeferAction('new')}
          />
        </div>

        {/* Juros */}
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <TrendingUp size={12}/> Juros sobre o restante
            </span>
            <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[10px] font-black uppercase">
              <button type="button" onClick={() => { setUseInterest(false); setInterestPercent(''); }}
                className={`px-3 py-1.5 transition-colors ${!useInterest ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                Sem juros
              </button>
              <button type="button" onClick={() => setUseInterest(true)}
                className={`px-3 py-1.5 transition-colors ${useInterest ? 'bg-amber-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                Com juros
              </button>
            </div>
          </div>

          {useInterest && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Percent size={14} className="absolute left-3 top-3 text-amber-400"/>
                  <input
                    type="number" step="0.01" min="0" max="100"
                    value={interestPercent}
                    onChange={e => setInterestPercent(e.target.value)}
                    placeholder="ex: 2,5"
                    className="w-full bg-slate-800 border border-amber-700/40 rounded-xl pl-9 pr-4 py-2.5 text-white font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                  />
                </div>
                <span className="text-xs text-slate-400 shrink-0">% ao mês</span>
              </div>
              {interestAmt > 0 && (
                <div className="flex items-center justify-between bg-amber-900/20 border border-amber-800/30 rounded-xl px-3 py-2 text-xs">
                  <span className="text-slate-400">{formatCurrency(remainder)} + {interestPercent}%</span>
                  <span className="text-amber-300 font-black">{formatCurrency(remainderWithInterest)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle size={14}/> {error}
          </div>
        )}

        {/* Resumo final */}
        <div className="bg-slate-900/60 border border-slate-700/50 rounded-2xl p-3 text-xs space-y-1.5">
          <div className="flex justify-between text-slate-400">
            <span>Recebido agora</span>
            <span className="font-mono text-emerald-400">{formatCurrency(amountVal)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Saldo a destinar</span>
            <span className="font-mono text-amber-300">{formatCurrency(remainderWithInterest)}</span>
          </div>
          <div className="flex justify-between text-slate-400 border-t border-slate-700/50 pt-1.5">
            <span>Destino</span>
            <span className="font-bold text-white capitalize">
              {deferAction === 'last' && (lastInst ? `Parcela #${lastInst.number}` : 'Última')}
              {deferAction === 'next' && (nextInst ? `Parcela #${nextInst.number}` : 'Próxima')}
              {deferAction === 'new' && 'Nova parcela extra'}
            </span>
          </div>
        </div>

        {/* Botões */}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setStep(1)}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-1.5 transition-colors">
            <ChevronLeft size={14}/> Voltar
          </button>
          <button type="submit" disabled={loading || (useInterest && !interestPercent)}
            className="flex-[2] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-[0.98]">
            {loading ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>}
            {loading ? 'Processando...' : 'Confirmar tudo'}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
};

// --- 2. REFINANCE MODAL (Refinanciar) ---

export const RefinanceModal: React.FC<BaseModalProps> = ({ isOpen, onClose, onSuccess, installment }) => {
  const [payAmount, setPayAmount] = useState('');
  const [newDate, setNewDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPayAmount('');
      // Default to 30 days from now
      const d = new Date();
      d.setDate(d.getDate() + 30);
      setNewDate(d.toISOString().split('T')[0]);
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installment) return;

    const val = parseFloat(payAmount);
    if (isNaN(val) || val < 0) {
        setError("O valor de entrada não pode ser negativo.");
        return;
    }
    if (!newDate) {
        setError("Selecione uma nova data de vencimento.");
        return;
    }

    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { error: rpcError } = await supabase.rpc('refinance_installment', {
        p_installment_id: installment.id,
        p_payment_amount: val,
        p_new_due_date: newDate
      });

      if (rpcError) throw rpcError;
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro no refinanciamento.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !installment) return null;

  return (
    <ModalBackdrop onClose={onClose}>
      <Header 
        title="Refinanciar Saldo" 
        subtitle="Postergar Dívida" 
        icon={<RefreshCw size={24}/>} 
        onClose={onClose}
        colorClass="text-purple-400"
      />
      
      <form onSubmit={handleSubmit} className="p-8 space-y-6">
        <div className="bg-purple-900/10 border border-purple-900/30 p-4 rounded-xl flex gap-3">
             <AlertTriangle className="text-purple-400 shrink-0 mt-0.5" size={18} />
             <p className="text-xs text-purple-200 leading-relaxed font-medium">
                Esta ação paga o valor de entrada e re-agenda o saldo restante para a nova data, mantendo o status "Pendente".
             </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Valor de Entrada (Pago Hoje)
            </label>
            <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-purple-400"/>
                <input
                  type="number" step="0.01" inputMode="decimal" required
                  value={payAmount} onChange={e => setPayAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                />
            </div>
          </div>
          
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Nova Data de Vencimento
            </label>
            <div className="relative">
                <Calendar size={16} className="absolute left-4 top-4 text-slate-500"/>
                <input 
                  type="date" required
                  value={newDate} onChange={e => setNewDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-sans text-sm outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                />
            </div>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        <button 
          type="submit" disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 transition-all active:scale-[0.98]"
        >
          {loading ? <Loader2 className="animate-spin" size={18}/> : <RefreshCw size={18}/>}
          {loading ? 'Calculando...' : 'Confirmar Refinanciamento'}
        </button>
      </form>
    </ModalBackdrop>
  );
};

// --- 3. EDIT MODAL (Admin Edit) ---

export const EditModal: React.FC<BaseModalProps> = ({ isOpen, onClose, onSuccess, installment }) => {
  const [totalAmount, setTotalAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && installment) {
      setTotalAmount(installment.amount_total.toString());
      // Ensure valid date format YYYY-MM-DD
      const dateVal = installment.due_date ? new Date(installment.due_date).toISOString().split('T')[0] : '';
      setDueDate(dateVal);
      setError(null);
    }
  }, [isOpen, installment]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installment) return;
    
    const val = parseFloat(totalAmount);
    if (isNaN(val) || val <= 0) {
        setError("O valor total deve ser positivo.");
        return;
    }
    if (!dueDate) {
        setError("Data de vencimento inválida.");
        return;
    }

    setLoading(true);
    setError(null);

    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { error: rpcError } = await supabase.rpc('admin_update_installment', {
        p_installment_id: installment.id,
        p_new_amount_total: val,
        p_new_due_date: dueDate
      });

      if (rpcError) throw rpcError;
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro na edição.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !installment) return null;

  return (
    <ModalBackdrop onClose={onClose}>
      <Header 
        title="Edição Administrativa" 
        subtitle="Correção Manual de Dados" 
        icon={<Pencil size={24}/>} 
        onClose={onClose}
        colorClass="text-sky-400"
      />
      
      <form onSubmit={handleSubmit} className="p-8 space-y-6">
        <div className="bg-sky-900/10 border border-sky-900/30 p-4 rounded-xl flex gap-3">
             <AlertTriangle className="text-sky-400 shrink-0 mt-0.5" size={18} />
             <p className="text-xs text-sky-200 leading-relaxed font-medium">
                Altera o valor total e o vencimento diretamente. Use apenas para corrigir erros de cadastro.
             </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Nova Data de Vencimento
            </label>
            <div className="relative">
                <Calendar size={16} className="absolute left-4 top-4 text-slate-500"/>
                <input 
                  type="date" required
                  value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-sans text-sm outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">
              Novo Valor Total (Principal + Juros)
            </label>
            <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-slate-500"/>
                <input
                  type="number" step="0.01" inputMode="decimal" required
                  value={totalAmount} onChange={e => setTotalAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3.5 text-white font-mono text-lg outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                />
            </div>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        <button
          type="submit" disabled={loading}
          className="w-full bg-sky-600 hover:bg-sky-500 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-sky-900/20 transition-all active:scale-[0.98]"
        >
          {loading ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>}
          {loading ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </form>
    </ModalBackdrop>
  );
};

// --- 4. INTEREST ONLY MODAL (Pagar Só Juros) ---

export const InterestOnlyModal: React.FC<BaseModalProps> = ({ isOpen, onClose, onSuccess, installment }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setError(null);
    }
  }, [isOpen]);

  const outstanding = calculateOutstanding(installment);
  const totalInterestPaid = normalizeNumber(installment?.interest_payments_total);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0 || !installment) { setError('Informe um valor válido.'); return; }
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      const { error: rpcError } = await supabase.rpc('pay_interest_only', {
        p_installment_id: installment.id,
        p_interest_amount: val
      });
      if (rpcError) throw rpcError;
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(parseSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !installment) return null;

  return (
    <ModalBackdrop onClose={onClose}>
      <Header
        title="Pagar Só Juros"
        subtitle={`Parcela #${installment.number}`}
        icon={<Percent size={24}/>}
        onClose={onClose}
        colorClass="text-[color:var(--accent-caution)]"
      />

      <form onSubmit={handleSubmit} className="p-8 space-y-5">
        <div className="bg-[color:var(--accent-caution-bg)] border border-[color:var(--accent-caution-border)] p-4 rounded-2xl">
          <p className="text-[10px] text-[color:var(--accent-caution)] font-black uppercase tracking-widest mb-1 opacity-80">Parcela Original</p>
          <p className="text-2xl font-black text-[color:var(--text-primary)]">{formatCurrency(outstanding)}</p>
          <p className="text-[10px] text-[color:var(--accent-caution)] mt-1 font-bold uppercase opacity-70">Ainda em aberto</p>
        </div>

        {totalInterestPaid > 0 && (
          <div className="bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] p-3 rounded-xl flex justify-between items-center">
            <span className="text-[10px] text-[color:var(--text-muted)] font-black uppercase tracking-widest">Juros já cobrados</span>
            <span className="text-[color:var(--accent-caution)] font-black text-sm">{formatCurrency(totalInterestPaid)}</span>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-black text-[color:var(--text-muted)] uppercase tracking-widest mb-2 ml-1">
            Valor dos Juros (R$)
          </label>
          <div className="relative">
            <Percent size={16} className="absolute left-4 top-4 text-[color:var(--accent-caution)]"/>
            <input
              type="number" step="0.01" required autoFocus
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0,00"
              className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl pl-10 pr-4 py-3.5 text-[color:var(--text-primary)] font-mono text-lg outline-none focus:ring-2 focus:ring-[color:var(--accent-caution)] focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div className="bg-[color:var(--accent-caution-bg)] border border-[color:var(--accent-caution-border)] p-3 rounded-xl flex gap-2.5 items-start">
          <AlertTriangle size={14} className="text-[color:var(--accent-caution)] shrink-0 mt-0.5"/>
          <p className="text-[10px] text-[color:var(--text-secondary)] leading-relaxed font-medium">
            O valor da parcela <strong>não será descontado</strong>. A parcela continua em aberto após este registro.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle size={14}/> {error}
          </div>
        )}

        <button
          type="submit" disabled={loading}
          className="w-full bg-[color:var(--accent-caution-btn)] hover:bg-[color:var(--accent-caution-btn-hover)] text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98]"
        >
          {loading ? <Loader2 className="animate-spin" size={18}/> : <Percent size={18}/>}
          {loading ? 'Registrando...' : 'Registrar Pagamento de Juros'}
        </button>
      </form>
    </ModalBackdrop>
  );
};
