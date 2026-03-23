
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { LoanInstallment, Tenant } from '../types';
import { getSupabase } from '../services/supabase';
import { X, CheckCircle2, Calendar, DollarSign, Loader2, AlertTriangle, RefreshCw, Pencil, Save, Printer, Percent, ArrowDownToLine, ArrowRight, Plus, ChevronLeft, TrendingUp, Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { parseSupabaseError } from '../services/supabase';
import ReceiptTemplate from './ReceiptTemplate';

// --- PAYMENT TRANSACTION LOGGER ---

/** Grava uma entrada de auditoria em payment_transactions (non-blocking) */
const logPaymentTransaction = async (tx: {
  tenant_id: string;
  investment_id: number;
  installment_id: string;
  transaction_type: 'payment' | 'surplus_applied' | 'surplus_received' | 'deferred' | 'missed';
  amount: number;
  principal_portion?: number;
  interest_portion?: number;
  extras_portion?: number;
  related_installment_id?: string;
  related_installment_number?: number;
  payment_method?: string;
  notes?: string;
}) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('payment_transactions').insert({
      ...tx,
      principal_portion: tx.principal_portion ?? 0,
      interest_portion: tx.interest_portion ?? 0,
      extras_portion: tx.extras_portion ?? 0,
    });
  } catch { /* non-critical — não bloqueia o fluxo de pagamento */ }
};

/** Calcula breakdown proporcional de um pagamento */
const calcBreakdown = (inst: LoanInstallment, paidAmount: number) => {
  const principal = normalizeNumber(inst.amount_principal);
  const interest = normalizeNumber(inst.amount_interest);
  const fine = normalizeNumber(inst.fine_amount);
  const delay = normalizeNumber(inst.interest_delay_amount);
  const obligation = principal + interest + fine + delay;
  if (obligation <= 0) return { principal_portion: 0, interest_portion: 0, extras_portion: 0 };
  return {
    principal_portion: paidAmount * (principal / obligation),
    interest_portion: paidAmount * (interest / obligation),
    extras_portion: paidAmount * ((fine + delay) / obligation),
  };
};

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
        <h3 className="type-heading uppercase text-[color:var(--text-primary)]">{title}</h3>
        <p className="type-label text-[color:var(--text-secondary)]">{subtitle}</p>
      </div>
    </div>
    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-2 hover:bg-slate-700 rounded-full">
      <X size={20} />
    </button>
  </div>
);

// --- 1. PAYMENT MODAL (Dar Baixa & Comprovante) ---

type DeferAction = 'last' | 'next' | 'new';
type SurplusAction = 'next' | 'last' | 'spread' | 'pay_late';

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
  const [step2Mode, setStep2Mode]         = useState<'partial' | 'surplus'>('partial');
  const [deferAction, setDeferAction]     = useState<DeferAction>('last');
  const [useInterest, setUseInterest]     = useState(false);
  const [interestPercent, setInterestPercent] = useState('');
  const [context, setContext]             = useState<InstallmentContext>({ nextInst: null, lastInst: null });
  const [loadingContext, setLoadingContext] = useState(false);
  // ── Surplus state ────────────────────────────────────────────────────────────
  const [surplusAction, setSurplusAction] = useState<SurplusAction>('next');
  const [pendingInstallments, setPendingInstallments] = useState<Array<{id: string; number: number; amount_total: number}>>([]);
  const [showSpreadPreview, setShowSpreadPreview] = useState(false);
  // ── Late installments state ─────────────────────────────────────────────────
  const [lateInstallments, setLateInstallments] = useState<Array<{
    id: string; number: number; amount_total: number;
    amount_paid: number; fine_amount: number; interest_delay_amount: number;
    outstanding: number;
  }>>([]);
  const [showLatePreview, setShowLatePreview] = useState(false);
  const [postLateSurplus, setPostLateSurplus] = useState<number | null>(null);

  // ── Shared state ─────────────────────────────────────────────────────────────
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [isReceiptMode, setIsReceiptMode] = useState(false);

  const outstanding = calculateOutstanding(installment);
  const amountVal   = parseFloat(amount) || 0;
  const remainder   = Math.max(0, outstanding - amountVal);
  const surplus     = Math.max(0, amountVal - outstanding);
  const isPartial   = amountVal > 0 && remainder > 0.01;
  const hasExcedente = surplus > 0.01;
  const interestAmt = useInterest && interestPercent ? remainder * (parseFloat(interestPercent) || 0) / 100 : 0;
  const remainderWithInterest = remainder + interestAmt;
  const discountPerInstallment = pendingInstallments.length > 0 ? surplus / pendingInstallments.length : 0;

  // ── Late payment preview ─────────────────────────────────────────────────────
  const activeSurplus = postLateSurplus !== null ? postLateSurplus : surplus;
  const latePaymentPreview = React.useMemo(() => {
    let remaining = surplus;
    return lateInstallments.map(inst => {
      const toPay = Math.min(remaining, inst.outstanding);
      remaining = Math.max(0, remaining - toPay);
      return { ...inst, willPay: toPay, willFullyPay: toPay >= inst.outstanding - 0.01 };
    }).filter(p => p.willPay > 0);
  }, [surplus, lateInstallments]);
  const latePaymentTotal = latePaymentPreview.reduce((s, p) => s + p.willPay, 0);
  const lateSurplusLeftover = Math.max(0, surplus - latePaymentTotal);

  // ── Reset on open ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && installment) {
      setStep(1);
      setStep2Mode('partial');
      setError(null);
      setPaymentMethod('PIX');
      setDeferAction('last');
      setUseInterest(false);
      setInterestPercent('');
      setContext({ nextInst: null, lastInst: null });
      setSurplusAction('next');
      setPendingInstallments([]);
      setShowSpreadPreview(false);
      setLateInstallments([]);
      setShowLatePreview(false);
      setPostLateSurplus(null);
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
        .select('id, number, amount_total, amount_paid, fine_amount, interest_delay_amount, due_date, status')
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
        // Parcelas pendentes para surplus 'spread'
        const pendingAfter = pending.filter(r => r.number > installment.number);
        setPendingInstallments(pendingAfter.map(r => ({ id: r.id, number: r.number, amount_total: r.amount_total })));
        // Parcelas atrasadas para surplus 'pay_late'
        const lateRows = rows.filter(r => r.status === 'late');
        const lateWithOutstanding = lateRows.map(r => {
          const ost = Math.max(0,
            (normalizeNumber(r.amount_total) + normalizeNumber(r.fine_amount || 0) + normalizeNumber(r.interest_delay_amount || 0))
            - normalizeNumber(r.amount_paid || 0)
          );
          return { id: r.id, number: r.number, amount_total: r.amount_total, amount_paid: r.amount_paid || 0, fine_amount: r.fine_amount || 0, interest_delay_amount: r.interest_delay_amount || 0, outstanding: ost };
        }).filter(r => r.outstanding > 0);
        setLateInstallments(lateWithOutstanding);
        // Default surplus action: prefer pay_late if there are late installments
        if (lateWithOutstanding.length > 0) setSurplusAction('pay_late');
        else if (nextInst) setSurplusAction('next');
        else setSurplusAction('last');
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
    setError(null);
    if (hasExcedente) {
      await loadContext();
      setStep2Mode('surplus');
      setStep(2);
    } else if (isPartial) {
      await loadContext();
      setStep2Mode('partial');
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

  const handleStep2SurplusConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installment) return;
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      const effectiveSurplus = postLateSurplus !== null ? postLateSurplus : surplus;
      const effectiveAction = surplusAction === 'pay_late' ? 'pay_late' : surplusAction;

      if (effectiveAction === 'pay_late') {
        // 1. Paga parcela atual (só o outstanding)
        const { error: payErr } = await supabase.rpc('pay_installment', {
          p_installment_id: installment.id,
          p_amount_paid: outstanding,
        });
        if (payErr) throw payErr;

        // 2. Iterar atrasadas em ordem, pagando cada uma
        let remaining = surplus;
        const paidNumbers: number[] = [];

        for (const late of latePaymentPreview) {
          if (remaining <= 0.01) break;
          const toPay = Math.min(remaining, late.outstanding);

          const { error: latePayErr } = await supabase.rpc('pay_installment', {
            p_installment_id: late.id,
            p_amount_paid: toPay,
          });
          if (latePayErr) throw latePayErr;

          const noteText = toPay >= late.outstanding - 0.01
            ? `Quitada com excedente da parcela #${installment.number}`
            : `Pgto parcial (${formatCurrency(toPay)}) com excedente da parcela #${installment.number}`;

          await supabase.from('loan_installments')
            .update({ notes: noteText, payment_method: paymentMethod })
            .eq('id', late.id);

          // Log: excedente recebido pela parcela atrasada
          logPaymentTransaction({
            tenant_id: installment.tenant_id,
            investment_id: installment.investment_id,
            installment_id: late.id,
            transaction_type: 'surplus_received',
            amount: toPay,
            related_installment_id: installment.id,
            related_installment_number: installment.number,
            payment_method: paymentMethod,
            notes: `${formatCurrency(toPay)} recebido via excedente da parcela #${installment.number}`,
          });

          paidNumbers.push(late.number);
          remaining -= toPay;
        }

        // 3. Notes na parcela atual
        const totalPaid = outstanding + surplus;
        await supabase.from('loan_installments')
          .update({
            notes: `Recebido ${formatCurrency(totalPaid)} (parcela ${formatCurrency(outstanding)} + excedente ${formatCurrency(surplus)} → atrasadas #${paidNumbers.join(', #')})`,
            payment_method: paymentMethod,
          })
          .eq('id', installment.id);

        // Log: pagamento da parcela atual
        const breakdown = calcBreakdown(installment, outstanding);
        logPaymentTransaction({
          tenant_id: installment.tenant_id,
          investment_id: installment.investment_id,
          installment_id: installment.id,
          transaction_type: 'payment',
          amount: totalPaid,
          ...breakdown,
          payment_method: paymentMethod,
          notes: `Recebido ${formatCurrency(totalPaid)}: parcela ${formatCurrency(outstanding)} + excedente ${formatCurrency(surplus)} → atrasadas #${paidNumbers.join(', #')}`,
        });

        // Log: excedente aplicado (saindo da parcela atual)
        logPaymentTransaction({
          tenant_id: installment.tenant_id,
          investment_id: installment.investment_id,
          installment_id: installment.id,
          transaction_type: 'surplus_applied',
          amount: surplus,
          payment_method: paymentMethod,
          notes: `Excedente de ${formatCurrency(surplus)} aplicado nas parcelas atrasadas #${paidNumbers.join(', #')}`,
        });

        // 4. Se sobrou excedente após quitar todas as atrasadas → perguntar destino
        if (remaining > 0.01) {
          setPostLateSurplus(remaining);
          setLateInstallments([]);
          setSurplusAction('next');
          setLoading(false);
          return; // Volta ao step 2 sem pay_late, com surplus reduzido
        }

        // 5. Finalizar
        installment.amount_paid = (installment.amount_paid || 0) + outstanding;
        installment.status = 'paid';
        installment.paid_at = new Date().toISOString();
        onSuccess();
        setIsReceiptMode(true);
        return;
      }

      // ── Fluxo original (next/last/spread) ──────────────────────────────────
      // 1. Paga apenas o saldo devedor da parcela atual
      if (postLateSurplus === null) {
        const { error: payErr } = await supabase.rpc('pay_installment', {
          p_installment_id: installment.id,
          p_amount_paid: outstanding,
        });
        if (payErr) throw payErr;
      }

      // 2. Aplica o excedente na ação escolhida
      const { error: surplusErr } = await supabase.rpc('apply_surplus_action', {
        p_installment_id: installment.id,
        p_surplus_amount: effectiveSurplus,
        p_action: surplusAction as 'next' | 'last' | 'spread',
      });
      if (surplusErr) throw surplusErr;

      // 3. Persiste método de pagamento e notes
      const actionLabel = surplusAction === 'next' ? 'próxima parcela' : surplusAction === 'last' ? 'última parcela' : 'distribuído';
      const notesArr: string[] = [];
      if (postLateSurplus !== null) notesArr.push(`Sobra de ${formatCurrency(effectiveSurplus)} após quitar atrasadas → ${actionLabel}`);
      else notesArr.push(`Recebido ${formatCurrency(outstanding + effectiveSurplus)} (parcela ${formatCurrency(outstanding)} + excedente ${formatCurrency(effectiveSurplus)} → ${actionLabel})`);
      await supabase
        .from('loan_installments')
        .update({ payment_method: paymentMethod, notes: notesArr.join('; ') })
        .eq('id', installment.id);

      // Log: pagamento + excedente
      if (postLateSurplus === null) {
        const breakdown = calcBreakdown(installment, outstanding);
        logPaymentTransaction({
          tenant_id: installment.tenant_id,
          investment_id: installment.investment_id,
          installment_id: installment.id,
          transaction_type: 'payment',
          amount: outstanding + effectiveSurplus,
          ...breakdown,
          payment_method: paymentMethod,
          notes: notesArr[0],
        });
      }
      logPaymentTransaction({
        tenant_id: installment.tenant_id,
        investment_id: installment.investment_id,
        installment_id: installment.id,
        transaction_type: 'surplus_applied',
        amount: effectiveSurplus,
        payment_method: paymentMethod,
        notes: `Excedente de ${formatCurrency(effectiveSurplus)} → ${actionLabel}`,
      });

      onSuccess();
      installment.amount_paid = (installment.amount_paid || 0) + outstanding;
      installment.status = 'paid';
      installment.paid_at = new Date().toISOString();
      setIsReceiptMode(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao processar pagamento.');
    } finally {
      setLoading(false);
    }
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

      // Persiste método de pagamento (non-critical — ignora erro)
      await supabase
        .from('loan_installments')
        .update({ payment_method: paymentMethod })
        .eq('id', installment.id);

      // Log de auditoria
      const isPartialPayment = val < calculateOutstanding(installment) - 0.01;
      const breakdown = calcBreakdown(installment, val);
      logPaymentTransaction({
        tenant_id: installment.tenant_id,
        investment_id: installment.investment_id,
        installment_id: installment.id,
        transaction_type: 'payment',
        amount: val,
        ...breakdown,
        payment_method: paymentMethod,
        notes: isPartialPayment
          ? `Pagamento parcial de ${formatCurrency(val)} na parcela #${installment.number}`
          : `Pagamento integral de ${formatCurrency(val)} na parcela #${installment.number}`,
      });

      onSuccess();
      installment.amount_paid = (installment.amount_paid || 0) + val;
      installment.status = isPartialPayment ? 'partial' : 'paid';
      if (!isPartialPayment) installment.paid_at = new Date().toISOString();
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
          <h3 className="type-heading text-[color:var(--text-primary)] mb-2">Pagamento Confirmado!</h3>
          <button onClick={onClose} className="type-label bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] px-6 py-2 rounded-xl">Fechar</button>
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
          <span className={`shrink-0 ${active ? 'text-emerald-400' : 'text-[color:var(--text-muted)]'}`}>{icon}</span>
          <div className="min-w-0">
            <p className={`text-sm font-bold leading-tight ${active ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-secondary)]'}`}>{label}</p>
            <p className="type-caption text-[color:var(--text-muted)] mt-0.5 leading-tight truncate">{sublabel}</p>
          </div>
        </div>
        {/* Preview amount */}
        <div className="shrink-0 text-right">
          <p className={`type-metric-sm ${active ? 'text-emerald-300' : 'text-[color:var(--text-muted)]'}`}>
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
          <p className="type-label text-emerald-400 mb-2 text-center">Saldo Devedor</p>
          <p className="type-metric-xl text-[color:var(--text-primary)] text-center mb-3">{formatCurrency(outstanding)}</p>
          <div className="space-y-1.5 text-xs border-t border-emerald-900/30 pt-3">
            <div className="flex justify-between text-[color:var(--text-secondary)]">
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
            <label className="block type-label text-[color:var(--text-muted)] mb-2 ml-1">Valor Recebido (R$)</label>
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
                  <span className="type-caption font-bold">Faltam</span>
                </div>
                <span className="text-amber-200 type-metric-sm">{formatCurrency(remainder)}</span>
              </div>
            )}
            {/* Aviso excedente em tempo real */}
            {hasExcedente && (
              <div className="mt-2 flex items-center justify-between bg-emerald-900/20 border border-emerald-800/40 rounded-xl px-4 py-2.5">
                <div className="flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 size={13} className="shrink-0"/>
                  <span className="type-caption font-bold">Excedente</span>
                </div>
                <span className="text-emerald-200 type-metric-sm">{formatCurrency(surplus)}</span>
              </div>
            )}
          </div>

          {/* Data */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] text-xs">
            <Calendar size={14} className="shrink-0"/>
            <span>Data da baixa: <strong>Hoje ({new Date().toLocaleDateString('pt-BR')})</strong></span>
          </div>

          {/* Forma de pagamento */}
          <div>
            <label className="block type-label text-[color:var(--text-muted)] mb-2 ml-1">Forma de Pagamento</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
              className="w-full bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3.5 text-[color:var(--text-primary)] outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm">
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
          className="type-label w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-[0.98]">
          {loading || loadingContext
            ? <Loader2 className="animate-spin" size={18}/>
            : (isPartial || hasExcedente) ? <ArrowRight size={18}/> : <CheckCircle2 size={18}/>}
          {loading || loadingContext
            ? 'Aguarde...'
            : isPartial ? `Próximo — destinar ${formatCurrency(remainder)}`
            : hasExcedente ? `Próximo — aplicar excedente ${formatCurrency(surplus)}`
            : 'Confirmar Recebimento'}
        </button>
      </form>
    </ModalBackdrop>
  );

  // ── Step 2 — Surplus ─────────────────────────────────────────────────────────
  if (step === 2 && step2Mode === 'surplus') {
    const surplusNextInst = context.nextInst;
    const surplusLastInst = context.lastInst;

    const SurplusCard = ({
      id, icon, label, sublabel, active, onClick, previewContent
    }: { id: string; icon: React.ReactNode; label: string; sublabel: string; active: boolean; onClick: () => void; previewContent?: React.ReactNode }) => (
      <div className={`w-full rounded-2xl border text-left transition-all duration-150 ${
        active
          ? 'border-emerald-500/50 bg-emerald-900/20 ring-1 ring-emerald-500/20'
          : 'border-slate-700 bg-slate-900/40'
      }`}>
        <button type="button" onClick={onClick} className="w-full p-4 text-left">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${active ? 'border-emerald-400' : 'border-slate-600'}`}>
              {active && <div className="h-2 w-2 rounded-full bg-emerald-400"/>}
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className={`shrink-0 ${active ? 'text-emerald-400' : 'text-[color:var(--text-muted)]'}`}>{icon}</span>
              <div className="min-w-0">
                <p className={`text-sm font-bold leading-tight ${active ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-secondary)]'}`}>{label}</p>
                <p className="type-caption text-[color:var(--text-muted)] mt-0.5 leading-tight">{sublabel}</p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className={`type-metric-sm ${active ? 'text-emerald-300' : 'text-[color:var(--text-muted)]'}`}>
                −{formatCurrency(surplus)}
              </p>
            </div>
          </div>
        </button>
        {active && previewContent && (
          <div className="px-4 pb-4">{previewContent}</div>
        )}
      </div>
    );

    const spreadPreview = (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setShowSpreadPreview(v => !v)}
          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors mb-2"
        >
          {showSpreadPreview ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
          {showSpreadPreview ? 'Ocultar detalhes' : 'Ver detalhes por parcela'}
        </button>
        {showSpreadPreview && (
          <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-3 space-y-1 text-xs">
            <div className="flex justify-between text-slate-500 pb-1 border-b border-slate-700 font-semibold">
              <span>Parcela</span>
              <span>Antes → Depois</span>
            </div>
            {pendingInstallments.map(inst => (
              <div key={inst.id} className="flex justify-between text-slate-300">
                <span className="text-slate-400">#{inst.number}</span>
                <span className="font-mono">
                  {formatCurrency(inst.amount_total)}
                  <span className="text-slate-500 mx-1">→</span>
                  <span className="text-emerald-300">{formatCurrency(Math.max(0, inst.amount_total - discountPerInstallment))}</span>
                </span>
              </div>
            ))}
            {pendingInstallments.length === 0 && (
              <p className="text-slate-500 text-center py-1">Nenhuma parcela pendente após a atual.</p>
            )}
          </div>
        )}
      </div>
    );

    return (
      <ModalBackdrop onClose={onClose}>
        <div className="p-5 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-soft)] flex items-center gap-3">
          <button onClick={() => setStep(1)} className="p-2 rounded-xl text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] transition-colors">
            <ChevronLeft size={18}/>
          </button>
          <div className="flex-1">
            <p className="type-label text-emerald-400 mb-0.5">{postLateSurplus !== null ? 'Sobra restante' : 'Excedente'}</p>
            <p className="type-metric-lg text-emerald-300 leading-none">{formatCurrency(activeSurplus)}</p>
          </div>
          <div className="text-right">
            <p className="type-label text-[color:var(--text-muted)]">{postLateSurplus !== null ? 'Atrasadas pagas' : 'Parcela paga'}</p>
            <p className="type-metric-sm text-emerald-400">{postLateSurplus !== null ? formatCurrency(surplus - postLateSurplus) : formatCurrency(outstanding)}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] transition-colors ml-1">
            <X size={18}/>
          </button>
        </div>

        <form onSubmit={handleStep2SurplusConfirm} className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          <p className="type-label text-center text-[color:var(--text-secondary)]">
            {postLateSurplus !== null ? 'Para onde vai a sobra restante?' : 'O que fazer com o valor excedente?'}
          </p>

          <div className="space-y-2">
            <SurplusCard
              id="next"
              icon={<ArrowRight size={16}/>}
              label="Próxima parcela"
              sublabel={surplusNextInst
                ? `Parcela #${surplusNextInst.number} · ${formatCurrency(surplusNextInst.amount_total)} → ${formatCurrency(Math.max(0, surplusNextInst.amount_total - surplus))}`
                : 'Descontar da parcela seguinte'}
              active={surplusAction === 'next'}
              onClick={() => setSurplusAction('next')}
            />
            <SurplusCard
              id="last"
              icon={<ArrowDownToLine size={16}/>}
              label="Última parcela"
              sublabel={surplusLastInst
                ? `Parcela #${surplusLastInst.number} · ${formatCurrency(surplusLastInst.amount_total)} → ${formatCurrency(Math.max(0, surplusLastInst.amount_total - surplus))}`
                : 'Descontar da última parcela do contrato'}
              active={surplusAction === 'last'}
              onClick={() => setSurplusAction('last')}
            />
            <SurplusCard
              id="spread"
              icon={<Layers size={16}/>}
              label="Diminuir contrato"
              sublabel={pendingInstallments.length > 0
                ? `${pendingInstallments.length} parcelas restantes · desconto de ${formatCurrency(discountPerInstallment)} cada`
                : 'Distribuir proporcionalmente entre parcelas restantes'}
              active={surplusAction === 'spread'}
              onClick={() => { setSurplusAction('spread'); }}
              previewContent={spreadPreview}
            />
            {lateInstallments.length > 0 && postLateSurplus === null && (
              <SurplusCard
                id="pay_late"
                icon={<RefreshCw size={16}/>}
                label="Quitar parcelas atrasadas"
                sublabel={`${latePaymentPreview.length} ${latePaymentPreview.length === 1 ? 'parcela' : 'parcelas'} · total ${formatCurrency(latePaymentTotal)}`
                  + (lateSurplusLeftover > 0.01 ? ` · sobra ${formatCurrency(lateSurplusLeftover)}` : '')}
                active={surplusAction === 'pay_late'}
                onClick={() => setSurplusAction('pay_late')}
                previewContent={
                  <div className="mt-1">
                    <button type="button" onClick={() => setShowLatePreview(v => !v)}
                      className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors mb-2">
                      {showLatePreview ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                      {showLatePreview ? 'Ocultar detalhes' : 'Ver detalhes por parcela'}
                    </button>
                    {showLatePreview && (
                      <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl p-3 space-y-1 text-xs">
                        <div className="flex justify-between text-[color:var(--text-muted)] pb-1 border-b border-[color:var(--border-subtle)] font-semibold">
                          <span>Parcela</span>
                          <span>Devendo → Pagamento</span>
                        </div>
                        {latePaymentPreview.map(inst => (
                          <div key={inst.id} className="flex justify-between text-[color:var(--text-secondary)]">
                            <span className="text-[color:var(--text-muted)]">#{inst.number}</span>
                            <span className="font-mono">
                              {formatCurrency(inst.outstanding)}
                              <span className="text-[color:var(--text-muted)] mx-1">→</span>
                              <span className={inst.willFullyPay ? 'text-emerald-300' : 'text-amber-300'}>
                                {inst.willFullyPay ? 'Quitada' : formatCurrency(inst.willPay) + ' (parcial)'}
                              </span>
                            </span>
                          </div>
                        ))}
                        {lateSurplusLeftover > 0.01 && (
                          <div className="flex justify-between text-amber-300 pt-1 border-t border-[color:var(--border-subtle)]">
                            <span>Sobra</span>
                            <span className="font-mono">{formatCurrency(lateSurplusLeftover)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                }
              />
            )}
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <AlertTriangle size={14}/> {error}
            </div>
          )}

          <div className="bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] rounded-2xl p-3 type-caption space-y-1.5">
            <div className="flex justify-between text-[color:var(--text-secondary)]">
              <span>Parcela paga</span>
              <span className="font-mono text-emerald-400">{formatCurrency(outstanding)}</span>
            </div>
            <div className="flex justify-between text-[color:var(--text-secondary)]">
              <span>Excedente aplicado</span>
              <span className="font-mono text-emerald-300">−{formatCurrency(activeSurplus)}</span>
            </div>
            <div className="flex justify-between text-[color:var(--text-secondary)] border-t border-[color:var(--border-subtle)] pt-1.5">
              <span>Destino</span>
              <span className="font-bold text-[color:var(--text-primary)]">
                {surplusAction === 'next' && (surplusNextInst ? `Parcela #${surplusNextInst.number}` : 'Próxima')}
                {surplusAction === 'last' && (surplusLastInst ? `Parcela #${surplusLastInst.number}` : 'Última')}
                {surplusAction === 'spread' && `${pendingInstallments.length} parcelas`}
                {surplusAction === 'pay_late' && `${latePaymentPreview.length} parcela(s) atrasada(s)`}
              </span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => { if (postLateSurplus !== null) { setPostLateSurplus(null); onSuccess(); setIsReceiptMode(true); } else { setStep(1); } }}
              className="flex-1 bg-[color:var(--bg-elevated)] hover:bg-[color:var(--bg-soft)] text-[color:var(--text-secondary)] py-3.5 rounded-xl type-label flex items-center justify-center gap-1.5 transition-colors">
              <ChevronLeft size={14}/> {postLateSurplus !== null ? 'Pular' : 'Voltar'}
            </button>
            <button type="submit" disabled={loading}
              className="flex-[2] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-3.5 rounded-xl type-label flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-[0.98]">
              {loading ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>}
              {loading ? 'Processando...' : 'Confirmar tudo'}
            </button>
          </div>
        </form>
      </ModalBackdrop>
    );
  }

  // ── Step 2 — Partial ─────────────────────────────────────────────────────────
  const { nextInst, lastInst } = context;

  return (
    <ModalBackdrop onClose={onClose}>
      {/* Step 2 header custom */}
      <div className="p-5 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-soft)] flex items-center gap-3">
        <button onClick={() => setStep(1)} className="p-2 rounded-xl text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] transition-colors">
          <ChevronLeft size={18}/>
        </button>
        <div className="flex-1">
          <p className="type-label text-amber-400 mb-0.5">Faltam</p>
          <p className="type-metric-lg text-[color:var(--text-primary)] leading-none">{formatCurrency(remainder)}</p>
        </div>
        <div className="text-right">
          <p className="type-label text-[color:var(--text-muted)]">Recebido</p>
          <p className="type-metric-sm text-emerald-400">{formatCurrency(amountVal)}</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] transition-colors ml-1">
          <X size={18}/>
        </button>
      </div>

      <form onSubmit={handleStep2Confirm} className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
        <p className="type-label text-center text-[color:var(--text-secondary)]">Como tratar o saldo restante?</p>

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
        <div className="bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="type-label text-[color:var(--text-secondary)] flex items-center gap-1.5">
              <TrendingUp size={12}/> Juros sobre o restante
            </span>
            <div className="flex rounded-lg overflow-hidden border border-[color:var(--border-subtle)] type-label uppercase">
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
                  <span className="text-amber-300 font-semibold">{formatCurrency(remainderWithInterest)}</span>
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
        <div className="bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] rounded-2xl p-3 type-caption space-y-1.5">
          <div className="flex justify-between text-[color:var(--text-secondary)]">
            <span>Recebido agora</span>
            <span className="font-mono text-emerald-400">{formatCurrency(amountVal)}</span>
          </div>
          <div className="flex justify-between text-[color:var(--text-secondary)]">
            <span>Saldo a destinar</span>
            <span className="font-mono text-amber-300">{formatCurrency(remainderWithInterest)}</span>
          </div>
          <div className="flex justify-between text-[color:var(--text-secondary)] border-t border-[color:var(--border-subtle)] pt-1.5">
            <span>Destino</span>
            <span className="font-bold text-[color:var(--text-primary)] capitalize">
              {deferAction === 'last' && (lastInst ? `Parcela #${lastInst.number}` : 'Última')}
              {deferAction === 'next' && (nextInst ? `Parcela #${nextInst.number}` : 'Próxima')}
              {deferAction === 'new' && 'Nova parcela extra'}
            </span>
          </div>
        </div>

        {/* Botões */}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => setStep(1)}
            className="flex-1 bg-[color:var(--bg-elevated)] hover:bg-[color:var(--bg-soft)] text-[color:var(--text-secondary)] py-3.5 rounded-xl type-label flex items-center justify-center gap-1.5 transition-colors">
            <ChevronLeft size={14}/> Voltar
          </button>
          <button type="submit" disabled={loading || (useInterest && !interestPercent)}
            className="flex-[2] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-3.5 rounded-xl type-label flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-[0.98]">
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
            <label className="block type-label text-[color:var(--text-muted)] mb-2 ml-1">
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
            <label className="block type-label text-[color:var(--text-muted)] mb-2 ml-1">
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
          className="w-full bg-purple-600 hover:bg-purple-500 text-white py-4 rounded-xl type-label flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 transition-all active:scale-[0.98]"
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
            <label className="block type-label text-[color:var(--text-muted)] mb-2 ml-1">
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
            <label className="block type-label text-[color:var(--text-muted)] mb-2 ml-1">
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
          className="w-full bg-sky-600 hover:bg-sky-500 text-white py-4 rounded-xl type-label flex items-center justify-center gap-2 shadow-lg shadow-sky-900/20 transition-all active:scale-[0.98]"
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
          <p className="type-label text-[color:var(--accent-caution)] mb-1 opacity-80">Parcela Original</p>
          <p className="type-metric-xl text-[color:var(--text-primary)]">{formatCurrency(outstanding)}</p>
          <p className="type-label text-[color:var(--accent-caution)] mt-1 opacity-70">Ainda em aberto</p>
        </div>

        {totalInterestPaid > 0 && (
          <div className="bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] p-3 rounded-xl flex justify-between items-center">
            <span className="type-label text-[color:var(--text-muted)]">Juros já cobrados</span>
            <span className="text-[color:var(--accent-caution)] font-semibold text-sm">{formatCurrency(totalInterestPaid)}</span>
          </div>
        )}

        <div>
          <label className="block type-label text-[color:var(--text-muted)] mb-2 ml-1">
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
          <p className="type-caption text-[color:var(--text-secondary)] leading-relaxed font-medium">
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
          className="w-full bg-[color:var(--accent-caution-btn)] hover:bg-[color:var(--accent-caution-btn-hover)] text-white py-4 rounded-xl type-label flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98]"
        >
          {loading ? <Loader2 className="animate-spin" size={18}/> : <Percent size={18}/>}
          {loading ? 'Registrando...' : 'Registrar Pagamento de Juros'}
        </button>
      </form>
    </ModalBackdrop>
  );
};
