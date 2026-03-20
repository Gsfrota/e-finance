/**
 * Telas compartilhadas de detalhe/ação de parcela.
 * Usadas em ContractDetail e CollectionDashboard.
 */
import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Loader2, Clock3,
  DollarSign, Calendar, Percent, RefreshCw, Save, XCircle,
  Pencil, FileText, ArrowRight, ArrowDownToLine, Plus, ChevronLeft, TrendingUp,
  Layers, ChevronDown, ChevronUp,
} from 'lucide-react';

type SurplusAction = 'next' | 'last' | 'spread' | 'pay_late';
import { LoanInstallment, Tenant } from '../types';

interface ActionSummary {
  type: 'exact' | 'partial' | 'surplus';
  paidAmount: number;
  installmentNumber: number;
  remainder?: number;
  remainderDest?: 'last' | 'next' | 'new';
  remainderDestNumber?: number;
  surplusAmount?: number;
  surplusAction?: SurplusAction;
  surplusDestNumber?: number;
  surplusSpreadCount?: number;
  discountPerInstallment?: number;
  latePaidNumbers?: number[];
}
import { getSupabase, parseSupabaseError } from '../services/supabase';
import ReceiptTemplate from './ReceiptTemplate';

// ── Types ─────────────────────────────────────────────────────────────────────

export type InstallmentAction =
  | null
  | { type: 'pay';      installment: LoanInstallment }
  | { type: 'unpay';    installment: LoanInstallment }
  | { type: 'miss';     installment: LoanInstallment }
  | { type: 'refinance'; installment: LoanInstallment }
  | { type: 'edit';     installment: LoanInstallment }
  | { type: 'interest'; installment: LoanInstallment };

// ── Helpers ───────────────────────────────────────────────────────────────────

export const fmtMoney = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

export const fmtDate = (ymd?: string | null) => {
  if (!ymd) return '—';
  const base = ymd.includes('T') ? ymd.split('T')[0] : ymd;
  const [y, m, d] = base.split('-');
  return `${d}/${m}/${y}`;
};

export const fmtDatetime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export const normalizeNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

export const calcOutstanding = (inst: LoanInstallment): number => {
  const total = normalizeNum(inst.amount_total);
  const fine  = normalizeNum(inst.fine_amount);
  const delay = normalizeNum(inst.interest_delay_amount);
  const paid  = normalizeNum(inst.amount_paid);
  return Math.max(0, (total + fine + delay) - paid);
};

export const installmentStatusBadge = (status: LoanInstallment['status']) => {
  const map = {
    paid:    { label: 'Pago',     cls: 'chip chip-paid' },
    pending: { label: 'Pendente', cls: 'chip chip-pending' },
    late:    { label: 'Atrasado', cls: 'chip chip-late' },
    partial: { label: 'Parcial',  cls: 'chip chip-partial' },
  };
  const s = map[status] ?? map['pending'];
  return <span className={s.cls}>{s.label}</span>;
};

// ── InstallmentDetailScreen ───────────────────────────────────────────────────

interface InstallmentDetailScreenProps {
  installment: LoanInstallment;
  onBack: () => void;
  onAction: (action: NonNullable<InstallmentAction>) => void;
}

export const InstallmentDetailScreen: React.FC<InstallmentDetailScreenProps> = ({
  installment, onBack, onAction,
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [activeInst, setActiveInst] = useState(installment);

  const isPaid    = activeInst.status === 'paid';
  const isLate    = activeInst.status === 'late';
  const isPartial = activeInst.status === 'partial';
  const outstanding = calcOutstanding(activeInst);

  const debtorName = (installment as any).investment?.payer?.full_name
    || (installment as any).investment?.payer_name
    || 'Cliente';

  const contractName = (installment as any).investment?.asset_name
    || (installment as any).contract_name
    || 'Contrato';

  const contractId = (installment as any).investment?.id
    ? `CT${String((installment as any).investment.id).slice(-8)}`
    : '';

  // Contract-level summary from sibling installments
  const allInstallments: LoanInstallment[] = (installment as any).investment?.loan_installments || [];
  const totalInstallments = allInstallments.length || normalizeNum((installment as any).investment?.total_installments) || 0;
  const paidCount = allInstallments.filter((i: LoanInstallment) => i.status === 'paid').length;
  const lateCount = allInstallments.filter((i: LoanInstallment) => i.status === 'late').length;
  const remainingCount = totalInstallments - paidCount;
  const perInstallment = normalizeNum((installment as any).investment?.installment_value) || normalizeNum(installment.amount_total);
  const contractTotal = normalizeNum((installment as any).investment?.current_value) || perInstallment * totalInstallments;
  const progressPct = totalInstallments > 0 ? (paidCount / totalInstallments) * 100 : 0;

  const statusLabel = isPaid ? 'Pagamento efetivado'
    : isPartial ? 'Pagamento parcial'
    : isLate ? 'Pagamento em atraso'
    : 'Pagamento agendado';

  // History sub-view
  if (showHistory && (installment as any).investment) {
    const InstallmentHistory = React.lazy(() => import('./InstallmentHistory'));
    return (
      <React.Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin" style={{ color: 'var(--header-blue)' }} /></div>}>
        <InstallmentHistory
          investment={(installment as any).investment}
          debtorName={debtorName}
          onBack={() => setShowHistory(false)}
          onInstallmentClick={(inst) => { setActiveInst(inst); setShowHistory(false); }}
        />
      </React.Suspense>
    );
  }

  // Avatar helper
  const avatarUrl = (installment as any).investment?.payer?.photo_url;
  const initials  = debtorName.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase();

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-base)' }}>

      {/* ── Hero card ────────────────────────────────────────────────────── */}
      <div className="panel-card shrink-0 rounded-t-none rounded-b-[2rem] px-5 py-4">

        {/* Linha superior: voltar + badge status */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-bold active:scale-95 transition-all"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ChevronLeft size={18} />
            Voltar
          </button>
          {installmentStatusBadge(activeInst.status)}
        </div>

        {/* Avatar + nome */}
        <div className="flex items-center gap-4 mb-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={debtorName}
              className="w-14 h-14 rounded-full object-cover shrink-0"
              style={{ boxShadow: '0 0 0 2px rgba(255,255,255,0.2)' }}
            />
          ) : (
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0"
              style={{ background: 'var(--header-blue)' }}
            >
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="type-subheading truncate" style={{ color: 'var(--text-primary)' }}>{debtorName}</p>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{contractName}</p>
          </div>
        </div>

        {/* Parcela X de Y + Vencimento */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="rounded-xl p-3" style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-subtle)' }}>
            <p className="section-kicker mb-1">Parcela</p>
            <p className="type-metric-lg leading-none" style={{ color: 'var(--text-primary)' }}>
              {activeInst.number}
              {totalInstallments > 0 && (
                <span className="text-sm font-medium ml-1" style={{ color: 'var(--text-muted)' }}>/ {totalInstallments}</span>
              )}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-subtle)' }}>
            <p className="section-kicker mb-1">Vencimento</p>
            <p className="type-metric-sm leading-none" style={{ color: isLate ? 'var(--accent-danger)' : 'var(--text-primary)' }}>
              {fmtDate(activeInst.due_date)}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        {totalInstallments > 0 && (
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, progressPct)}%`, background: 'var(--accent-brass)' }}
            />
          </div>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-4 my-4 rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>

          <p className="section-kicker mb-3">Detalhes da Parcela</p>

          {/* Detail rows */}
          <div className="space-y-3">
            {isPaid && activeInst.paid_at && (
              <DetailRow label="Agendamento para pagamento" value={fmtDatetime(activeInst.paid_at)} />
            )}
            <DetailRow label="Valor da parcela" value={fmtMoney(normalizeNum(activeInst.amount_total))} />
            {activeInst.amount_interest != null && normalizeNum(activeInst.amount_interest) > 0 && (
              <DetailRow label="Juros ganho" value={fmtMoney(normalizeNum(activeInst.amount_interest))} />
            )}
            <DetailRow label="ID" value={String(activeInst.id).slice(0, 4)} />
            <DetailRow label="Valor total do contrato" value={fmtMoney(contractTotal)} />
            <DetailRow label="Total de parcelas" value={String(totalInstallments)} />
            <DetailRow label="Parcelas pagas" value={String(paidCount)} valueColor="var(--accent-positive)" labelColor="var(--accent-positive)" />
            {lateCount > 0 && (
              <DetailRow label="Parcelas em atraso" value={String(lateCount)} valueColor="var(--accent-danger)" labelColor="var(--accent-danger)" />
            )}
            <DetailRow label="Quantidade restante" value={String(remainingCount)} />
            {activeInst.notes && (
              <DetailRow label="Observação" value={activeInst.notes} />
            )}
          </div>

          {/* Resumo section */}
          <div className="mt-5 rounded-xl p-4" style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Resumo</p>
              <button
                onClick={() => setShowHistory(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-colors"
                style={{ background: 'linear-gradient(135deg, #7B1FA2, #9C27B0)' }}
              >
                <Clock3 size={13} />
                Histórico
              </button>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Parcelas pagas:
                </p>
              </div>
              <div className="flex justify-between">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {paidCount}  x  {fmtMoney(perInstallment)}
                </p>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  {fmtMoney(paidCount * perInstallment)}
                </p>
              </div>
              <div className="flex justify-between mt-1">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Parcelas abertas:
                </p>
              </div>
              <div className="flex justify-between">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {remainingCount}  x  {fmtMoney(perInstallment)}
                </p>
                <p className="text-sm font-bold" style={{ color: 'var(--accent-danger)' }}>
                  {fmtMoney(remainingCount * perInstallment)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Action Buttons (fixed bottom, ícone acima + texto abaixo) ────── */}
      <div className="shrink-0 flex items-stretch gap-2 px-4 py-3" style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)' }}>
        {!isPaid ? (
          <>
            <button
              onClick={() => onAction({ type: 'pay', installment: activeInst })}
              className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl py-2.5 font-bold text-white active:scale-95 transition-all"
              style={{ background: '#4CAF50' }}
            >
              <CheckCircle2 size={20} />
              <span className="text-[0.65rem] font-bold text-center leading-tight">Receber</span>
            </button>
            <button
              onClick={() => onAction({ type: 'miss', installment: activeInst })}
              className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl py-2.5 font-bold text-white active:scale-95 transition-all"
              style={{ background: '#F44336' }}
            >
              <XCircle size={20} />
              <span className="text-[0.65rem] font-bold text-center leading-tight">Não Recebido</span>
            </button>
            <button
              onClick={() => onAction({ type: 'refinance', installment: activeInst })}
              className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl py-2.5 font-bold active:scale-95 transition-all"
              style={{ background: '#B0BEC5', color: '#37474F' }}
            >
              <Calendar size={18} />
              <span className="text-[0.65rem] font-bold text-center leading-tight">Agendar</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onAction({ type: 'unpay', installment: activeInst })}
              className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl py-2.5 font-bold text-white active:scale-95 transition-all"
              style={{ background: '#F44336' }}
            >
              <XCircle size={20} />
              <span className="text-[0.65rem] font-bold text-center leading-tight">Reverter</span>
            </button>
            <button
              onClick={() => onAction({ type: 'pay', installment: activeInst })}
              className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl py-2.5 font-bold active:scale-95 transition-all"
              style={{ background: 'var(--bg-soft)', color: 'var(--text-secondary)' }}
            >
              <FileText size={20} />
              <span className="text-[0.65rem] font-bold text-center leading-tight">Comprovante</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ── Detail row helper ─────────────────────────────────────────────────────────
const DetailRow: React.FC<{
  label: string;
  value: string;
  danger?: boolean;
  valueColor?: string;
  labelColor?: string;
}> = ({ label, value, danger, valueColor, labelColor }) => (
  <div className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
    <p className="text-sm font-semibold" style={{ color: labelColor || 'var(--text-primary)' }}>{label}</p>
    <p className="text-sm font-bold tabular-nums" style={{ color: danger ? 'var(--accent-danger)' : valueColor || 'var(--text-primary)' }}>{value}</p>
  </div>
);

// ── Summary row helper (tela de conclusão) ────────────────────────────────────
const SummaryRow: React.FC<{ label: string; value: string; accent?: boolean; warn?: boolean }> = ({ label, value, accent, warn }) => (
  <div className="flex items-center justify-between">
    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</p>
    <p className="text-sm font-bold tabular-nums" style={{ color: warn ? 'var(--accent-brass)' : accent ? 'var(--accent-positive)' : 'var(--text-primary)' }}>{value}</p>
  </div>
);

// ── InstallmentFormScreen ─────────────────────────────────────────────────────

interface InstallmentFormScreenProps {
  action: NonNullable<InstallmentAction>;
  tenant: Tenant | null;
  payerName?: string;
  onBack: () => void;
  onSuccess: () => void;
}

export const InstallmentFormScreen: React.FC<InstallmentFormScreenProps> = ({
  action, tenant, payerName, onBack, onSuccess,
}) => {
  const { installment } = action;
  const outstanding = calcOutstanding(installment);

  const [amount, setAmount]           = useState('');
  const [newDate, setNewDate]         = useState('');
  const [dueDate, setDueDate]         = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [isReceiptMode, setIsReceiptMode] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('PIX');

  // Pay step 2 state
  const [payStep, setPayStep]             = useState<1 | 'missed' | 2 | 'surplus'>(1);
  const [deferAction, setDeferAction]     = useState<'last' | 'next' | 'new'>('last');
  const [useInterest, setUseInterest]     = useState(false);
  const [interestPercent, setInterestPercent] = useState('');
  const [context, setContext]             = useState<{ nextInst: any; lastInst: any }>({ nextInst: null, lastInst: null });
  const [loadingContext, setLoadingContext] = useState(false);
  // Surplus state
  const [surplusAction, setSurplusAction]           = useState<SurplusAction>('next');
  const [pendingInstallments, setPendingInstallments] = useState<Array<{id: string; number: number; amount_total: number}>>([]);
  const [showSpreadPreview, setShowSpreadPreview]   = useState(false);
  const [actionSummary, setActionSummary]           = useState<ActionSummary | null>(null);
  const [lateInstallments, setLateInstallments]     = useState<Array<{
    id: string; number: number; amount_total: number;
    amount_paid: number; fine_amount: number; interest_delay_amount: number;
    outstanding: number;
  }>>([]);
  const [showLatePreview, setShowLatePreview]       = useState(false);
  const [postLateSurplus, setPostLateSurplus]       = useState<number | null>(null);

  // Miss form state
  const [missStep, setMissStep]           = useState<1 | 2>(1);
  const [missDeferAction, setMissDeferAction] = useState<'postpone' | 'last' | 'new'>('postpone');

  // Pay-after-miss state
  const [useMissedInterest, setUseMissedInterest]   = useState(false);
  const [missedInterestRate, setMissedInterestRate] = useState('');
  const [deferredInstallment, setDeferredInstallment] = useState<{ id: string; number: number; amount_total: number; amount_principal: number; amount_interest: number } | null>(null);
  const [removeDeferral, setRemoveDeferral]         = useState(false);

  // Derived pay values
  const amountVal             = parseFloat(amount) || 0;
  const remainder             = action.type === 'pay' ? Math.max(0, outstanding - amountVal) : 0;
  const surplus               = action.type === 'pay' ? Math.max(0, amountVal - outstanding) : 0;
  const isPartialPay          = amountVal > 0 && remainder > 0.01;
  const hasExcedente          = surplus > 0.01;
  const interestAmt           = useInterest && interestPercent ? remainder * (parseFloat(interestPercent) || 0) / 100 : 0;
  const remainderWithInterest = remainder + interestAmt;
  const discountPerInstallment = pendingInstallments.length > 0 ? surplus / pendingInstallments.length : 0;

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

  useEffect(() => {
    setError(null); setIsReceiptMode(false); setActionSummary(null);
    setPayStep(1); setDeferAction('last'); setUseInterest(false); setInterestPercent(''); setContext({ nextInst: null, lastInst: null });
    setSurplusAction('next'); setPendingInstallments([]); setShowSpreadPreview(false);
    setLateInstallments([]); setShowLatePreview(false); setPostLateSurplus(null);
    setMissStep(1); setMissDeferAction('postpone');
    setUseMissedInterest(false); setMissedInterestRate('');
    setDeferredInstallment(null); setRemoveDeferral(false);
    if (action.type === 'pay') {
      if (installment.status === 'paid') { setIsReceiptMode(true); }
      else { setAmount(outstanding.toFixed(2)); }
    } else if (action.type === 'refinance') {
      setAmount('0.00');
      const d = new Date(); d.setDate(d.getDate() + 30);
      setNewDate(d.toISOString().split('T')[0]);
    } else if (action.type === 'edit') {
      setTotalAmount(installment.amount_total.toString());
      setDueDate(installment.due_date ? new Date(installment.due_date).toISOString().split('T')[0] : '');
    } else { setAmount(''); }
  }, [action]);

  const titles: Record<string, string> = {
    pay: 'Dar Baixa', unpay: 'Reverter Pagamento', miss: 'Registrar Falta',
    refinance: 'Renegociar Parcela', edit: 'Editar Parcela', interest: 'Pagar Só Juros',
  };

  const loadContext = async () => {
    setLoadingContext(true);
    const supabase = getSupabase(); if (!supabase) { setLoadingContext(false); return; }
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
        if (lastInst) setDeferAction('last');
        else if (nextInst) setDeferAction('next');
        else setDeferAction('new');
        // Parcelas pendentes após a atual para surplus spread
        const pendingAfter = pending.filter(r => r.number > installment.number);
        setPendingInstallments(pendingAfter.map(r => ({ id: r.id, number: r.number, amount_total: r.amount_total })));
        // Parcelas atrasadas para surplus 'pay_late'
        const lateRows = rows.filter(r => r.status === 'late');
        const lateWithOutstanding = lateRows.map(r => {
          const ost = Math.max(0,
            (normalizeNum(r.amount_total) + normalizeNum(r.fine_amount || 0) + normalizeNum(r.interest_delay_amount || 0))
            - normalizeNum(r.amount_paid || 0)
          );
          return { id: r.id, number: r.number, amount_total: r.amount_total, amount_paid: r.amount_paid || 0, fine_amount: r.fine_amount || 0, interest_delay_amount: r.interest_delay_amount || 0, outstanding: ost };
        }).filter(r => r.outstanding > 0);
        setLateInstallments(lateWithOutstanding);
        if (lateWithOutstanding.length > 0) setSurplusAction('pay_late');
        else if (nextInst) setSurplusAction('next');
        else setSurplusAction('last');
      }
    } finally {
      setLoadingContext(false);
    }
  };

  const loadDeferredInstallment = async () => {
    const supabase = getSupabase(); if (!supabase) return;
    const { data } = await supabase
      .from('loan_installments')
      .select('id, number, amount_total, amount_principal, amount_interest, due_date')
      .eq('deferred_from_id', installment.id)
      .limit(1)
      .maybeSingle();
    if (data) setDeferredInstallment(data as any);
  };

  const handlePayStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) { setError('O valor deve ser maior que zero.'); return; }
    setError(null);
    if (installment.missed_at) {
      await loadDeferredInstallment();
      setPayStep('missed');
      return;
    }
    if (hasExcedente) {
      await loadContext();
      setPayStep('surplus');
    } else if (isPartialPay) {
      await loadContext();
      setPayStep(2);
    } else {
      await submitPayment(val, null, 0);
    }
  };

  const handlePaySurplusStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const effectiveSurplus = postLateSurplus !== null ? postLateSurplus : surplus;
      const effectiveAction = surplusAction === 'pay_late' ? 'pay_late' : surplusAction;

      if (effectiveAction === 'pay_late') {
        // 1. Paga parcela atual
        const { error: payErr } = await supabase.rpc('pay_installment', {
          p_installment_id: installment.id,
          p_amount_paid: outstanding,
        });
        if (payErr) throw payErr;

        // 2. Iterar atrasadas em ordem
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
            : `Pgto parcial (${fmtMoney(toPay)}) com excedente da parcela #${installment.number}`;

          await supabase.from('loan_installments')
            .update({ notes: noteText, payment_method: paymentMethod })
            .eq('id', late.id);

          paidNumbers.push(late.number);
          remaining -= toPay;
        }

        // 3. Notes na parcela atual
        await supabase.from('loan_installments')
          .update({
            notes: `Excedente de ${fmtMoney(surplus)} → parcelas atrasadas #${paidNumbers.join(', #')}`,
            payment_method: paymentMethod,
          })
          .eq('id', installment.id);

        // 4. Se sobrou excedente → perguntar destino
        if (remaining > 0.01) {
          setPostLateSurplus(remaining);
          setLateInstallments([]);
          setSurplusAction('next');
          setLoading(false);
          return;
        }

        // 5. Finalizar
        setActionSummary({
          type: 'surplus',
          paidAmount: outstanding,
          installmentNumber: installment.number,
          surplusAmount: surplus,
          surplusAction: 'pay_late',
          latePaidNumbers: paidNumbers,
        });
        installment.amount_paid = (installment.amount_paid || 0) + outstanding;
        installment.status = 'paid';
        installment.paid_at = new Date().toISOString();
        onSuccess(); setIsReceiptMode(true);
        return;
      }

      // ── Fluxo original (next/last/spread) ──────────────────────────────────
      if (postLateSurplus === null) {
        const { error: payErr } = await supabase.rpc('pay_installment', {
          p_installment_id: installment.id,
          p_amount_paid: outstanding,
        });
        if (payErr) throw payErr;
      }

      const { error: surplusErr } = await supabase.rpc('apply_surplus_action', {
        p_installment_id: installment.id,
        p_surplus_amount: effectiveSurplus,
        p_action: surplusAction as 'next' | 'last' | 'spread',
      });
      if (surplusErr) throw surplusErr;

      // Nota e resumo da ação
      const surplusDestNum = surplusAction === 'next' ? context.nextInst?.number : surplusAction === 'last' ? context.lastInst?.number : undefined;
      const surplusNotes = postLateSurplus !== null
        ? `Sobra de ${fmtMoney(effectiveSurplus)} após quitar atrasadas → ${surplusAction === 'spread' ? `distribuído em ${pendingInstallments.length} parcelas` : `parcela #${surplusDestNum}`}`
        : surplusAction === 'next'
        ? `Pago com excedente de ${fmtMoney(effectiveSurplus)} → descontado da parcela #${context.nextInst?.number}`
        : surplusAction === 'last'
        ? `Pago com excedente de ${fmtMoney(effectiveSurplus)} → descontado da parcela #${context.lastInst?.number}`
        : `Pago com excedente de ${fmtMoney(effectiveSurplus)} → distribuído em ${pendingInstallments.length} parcelas`;
      await supabase.from('loan_installments').update({ payment_method: paymentMethod, notes: surplusNotes }).eq('id', installment.id);
      setActionSummary({
        type: 'surplus',
        paidAmount: outstanding,
        installmentNumber: installment.number,
        surplusAmount: effectiveSurplus,
        surplusAction,
        surplusDestNumber: surplusDestNum,
        surplusSpreadCount: pendingInstallments.length,
        discountPerInstallment,
      });
      installment.amount_paid = (installment.amount_paid || 0) + outstanding;
      installment.status = 'paid';
      installment.paid_at = new Date().toISOString();
      onSuccess(); setIsReceiptMode(true);
    } catch (e: any) { setError(e.message || 'Erro ao processar.'); }
    finally { setLoading(false); }
  };

  const handleMissedStep = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    setError(null);
    if (isNaN(val) || val <= 0) { setError('O valor deve ser maior que zero.'); return; }
    if (hasExcedente) { await loadContext(); setPayStep('surplus'); }
    else if (isPartialPay) { await loadContext(); setPayStep(2); }
    else { await submitPayment(val, null, 0); }
  };

  const handlePayStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    const rate = useInterest ? parseFloat(interestPercent) || 0 : 0;
    await submitPayment(val, deferAction, rate);
  };

  const submitPayment = async (val: number, action2: 'last' | 'next' | 'new' | null, rate: number) => {
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      // Se houve falta com juros, aplicar interest_delay_amount antes do pagamento
      if (useMissedInterest && missedInterestRate) {
        const interestAmt = Math.round(normalizeNum(installment.amount_total) * parseFloat(missedInterestRate) / 100 * 100) / 100;
        await supabase.from('loan_installments')
          .update({ interest_delay_amount: normalizeNum(installment.interest_delay_amount) + interestAmt })
          .eq('id', installment.id);
      }

      const { error: err } = await supabase.rpc('pay_installment', { p_installment_id: installment.id, p_amount_paid: val });
      if (err) throw err;
      if (action2) {
        const { error: deferErr } = await supabase.rpc('apply_remainder_action', {
          p_installment_id: installment.id,
          p_action: action2,
          p_interest_rate: rate,
        });
        if (deferErr) throw deferErr;
      }

      // Remover parcela postergada se solicitado
      if (removeDeferral && deferredInstallment) {
        await supabase.from('loan_installments')
          .update({
            amount_total:     Math.max(0, deferredInstallment.amount_total - normalizeNum(installment.amount_total)),
            amount_principal: Math.max(0, deferredInstallment.amount_principal - normalizeNum(installment.amount_principal)),
            amount_interest:  Math.max(0, deferredInstallment.amount_interest  - normalizeNum(installment.amount_interest)),
            deferred_from_id: null,
          })
          .eq('id', deferredInstallment.id);
      }

      // Limpar missed_at ao pagar
      if (installment.missed_at) {
        await supabase.from('loan_installments')
          .update({ missed_at: null })
          .eq('id', installment.id);
      }

      // Persiste método de pagamento (non-critical — ignora erro)
      await supabase.from('loan_installments').update({ payment_method: paymentMethod }).eq('id', installment.id);
      const instOutstanding = calcOutstanding(installment);
      const isPartialPayment = val < instOutstanding - 0.01;
      // Nota e resumo da ação
      if (action2) {
        const destNum = action2 === 'next' ? context.nextInst?.number : action2 === 'last' ? context.lastInst?.number : undefined;
        const rem = Math.max(0, instOutstanding - val);
        const payNotes = action2 === 'new'
          ? `Pagamento parcial de ${fmtMoney(val)} · saldo ${fmtMoney(rem)} → nova parcela criada`
          : `Pagamento parcial de ${fmtMoney(val)} · saldo ${fmtMoney(rem)} → parcela #${destNum}`;
        await supabase.from('loan_installments').update({ notes: payNotes }).eq('id', installment.id);
        setActionSummary({ type: 'partial', paidAmount: val, installmentNumber: installment.number, remainder: rem, remainderDest: action2, remainderDestNumber: destNum });
      } else {
        setActionSummary({ type: 'exact', paidAmount: val, installmentNumber: installment.number });
      }
      installment.amount_paid = (installment.amount_paid || 0) + val;
      installment.status = isPartialPayment ? 'partial' : 'paid';
      if (!isPartialPayment) installment.paid_at = new Date().toISOString();
      onSuccess(); setIsReceiptMode(true);
    } catch (e: any) { setError(e.message || 'Erro ao processar.'); }
    finally { setLoading(false); }
  };

  const handleMiss = async () => {
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: err } = await supabase.rpc('mark_installment_missed', {
        p_installment_id: installment.id,
        p_defer_action: missDeferAction,
      });
      if (err) throw err;
      onSuccess(); onBack();
    } catch (e: any) { setError(parseSupabaseError(e)); }
    finally { setLoading(false); }
  };

  const handleUnpay = async () => {
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: err } = await supabase.from('loan_installments')
        .update({ status: 'pending', amount_paid: 0, paid_at: null }).eq('id', installment.id);
      if (err) throw err;
      onSuccess(); onBack();
    } catch (e: any) { setError(parseSupabaseError(e)); }
    finally { setLoading(false); }
  };

  const handleRefinance = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val < 0) { setError('Valor inválido.'); return; }
    if (!newDate) { setError('Selecione uma nova data.'); return; }
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: err } = await supabase.rpc('refinance_installment', { p_installment_id: installment.id, p_payment_amount: val, p_new_due_date: newDate });
      if (err) throw err;
      onSuccess(); onBack();
    } catch (e: any) { setError(e.message || 'Erro.'); }
    finally { setLoading(false); }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(totalAmount);
    if (isNaN(val) || val <= 0) { setError('Valor inválido.'); return; }
    if (!dueDate) { setError('Data inválida.'); return; }
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: err } = await supabase.rpc('admin_update_installment', { p_installment_id: installment.id, p_new_amount_total: val, p_new_due_date: dueDate });
      if (err) throw err;
      onSuccess(); onBack();
    } catch (e: any) { setError(e.message || 'Erro.'); }
    finally { setLoading(false); }
  };

  const handleInterest = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0) { setError('Informe um valor válido.'); return; }
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: err } = await supabase.rpc('pay_interest_only', { p_installment_id: installment.id, p_interest_amount: val });
      if (err) throw err;
      onSuccess(); onBack();
    } catch (e: any) { setError(parseSupabaseError(e)); }
    finally { setLoading(false); }
  };

  const inputCls = "w-full bg-[color:var(--bg-soft)] border border-[color:var(--border-strong)] rounded-xl pr-4 py-3.5 text-[color:var(--text-primary)] font-mono text-lg outline-none focus:ring-2 transition-all";

  const errorBlock = error && (
    <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
      <AlertTriangle size={14} /> {error}
    </div>
  );

  if (isReceiptMode && tenant) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-4">
          <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors"><ArrowLeft size={20} /></button>
          <h2 className="type-subheading text-[color:var(--text-primary)]">Comprovante</h2>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ background: "#0a0a0f" }}>
          <ReceiptTemplate installment={installment} tenant={tenant}
            payerName={payerName || (installment as any).investment?.payer?.full_name} onClose={onBack} />
        </div>
      </div>
    );
  }
  if (isReceiptMode) {
    const sm = actionSummary;
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--bg-base)' }}>
        <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-4" style={{ background: 'var(--bg-elevated)' }}>
          <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors"><ArrowLeft size={20} /></button>
          <h2 className="type-subheading text-[color:var(--text-primary)]">Baixa Confirmada</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-8">
          {/* Ícone animado */}
          <div className="flex h-20 w-20 items-center justify-center rounded-full" style={{ background: 'rgba(52,211,153,0.12)', border: '2px solid rgba(52,211,153,0.3)' }}>
            <CheckCircle2 size={48} className="text-[color:var(--accent-positive)]" />
          </div>

          {/* Título */}
          <div className="text-center">
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              Parcela #{sm?.installmentNumber ?? installment.number} · Baixa confirmada
            </p>
          </div>

          {/* Card de detalhes */}
          <div className="w-full rounded-2xl p-5 space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            {sm?.type === 'exact' && (
              <>
                <SummaryRow label="Parcela quitada" value={`#${sm.installmentNumber}`} />
                <div style={{ height: 1, background: 'var(--border-subtle)' }} />
                <SummaryRow label="Valor recebido" value={fmtMoney(sm.paidAmount)} accent />
                <SummaryRow label="Forma" value={paymentMethod} />
              </>
            )}
            {sm?.type === 'partial' && (
              <>
                <SummaryRow label="Recebido" value={fmtMoney(sm.paidAmount)} accent />
                <SummaryRow label="Saldo restante" value={fmtMoney(sm.remainder ?? 0)} warn />
                <div style={{ height: 1, background: 'var(--border-subtle)' }} />
                <SummaryRow
                  label="Adicionado em"
                  value={sm.remainderDest === 'new' ? 'Nova parcela criada' : `Parcela #${sm.remainderDestNumber}`}
                />
              </>
            )}
            {sm?.type === 'surplus' && (
              <>
                <SummaryRow label="Recebido" value={fmtMoney(sm.paidAmount + (sm.surplusAmount ?? 0))} />
                <SummaryRow label="Parcela quitada" value={fmtMoney(sm.paidAmount)} accent />
                <SummaryRow label="Excedente" value={fmtMoney(sm.surplusAmount ?? 0)} />
                <div style={{ height: 1, background: 'var(--border-subtle)' }} />
                <SummaryRow
                  label="Aplicado em"
                  value={
                    sm.surplusAction === 'pay_late'
                      ? `${sm.latePaidNumbers?.length} parcela(s) atrasada(s) (#${sm.latePaidNumbers?.join(', #')})`
                      : sm.surplusAction === 'spread'
                      ? `${sm.surplusSpreadCount} parcelas (−${fmtMoney(sm.discountPerInstallment ?? 0)} cada)`
                      : `Parcela #${sm.surplusDestNumber}`
                  }
                  accent
                />
              </>
            )}
            {!sm && (
              <SummaryRow label="Pagamento registrado" value="com sucesso" accent />
            )}
          </div>

          <button
            onClick={onBack}
            className="type-label w-full rounded-2xl py-4 transition-all active:scale-95"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">
      <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-4 shrink-0">
        <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors"><ArrowLeft size={20} /></button>
        <h2 className="type-subheading text-[color:var(--text-primary)]">{titles[action.type]}</h2>
      </div>

      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="panel-card rounded-2xl p-4">
          <p className="type-label text-[color:var(--text-faint)]">
            Parcela {installment.number} · Venc. {fmtDate(installment.due_date)}
          </p>
          <p className="type-metric-xl text-[color:var(--text-primary)] mt-1">{fmtMoney(outstanding)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {action.type === 'pay' && payStep === 1 && (
          <form onSubmit={handlePayStep1} className="space-y-4 pt-2">
            <div>
              <label className="block type-label text-[color:var(--text-faint)] mb-2">Valor Recebido (R$)</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-[color:var(--accent-positive)]" />
                <input type="number" step="0.01" inputMode="decimal" required value={amount}
                  onChange={e => { setAmount(e.target.value); setError(null); }}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-positive)]`} />
              </div>
              {isPartialPay && (
                <div className="mt-2 flex items-center justify-between bg-amber-900/20 border border-amber-800/40 rounded-xl px-4 py-2.5">
                  <div className="flex items-center gap-2 text-amber-300">
                    <AlertTriangle size={13} className="shrink-0"/>
                    <span className="type-caption font-bold">Faltam</span>
                  </div>
                  <span className="type-metric-sm text-amber-200">{fmtMoney(remainder)}</span>
                </div>
              )}
              {hasExcedente && (
                <div className="mt-2 flex items-center justify-between bg-emerald-900/20 border border-emerald-800/40 rounded-xl px-4 py-2.5">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <CheckCircle2 size={13} className="shrink-0"/>
                    <span className="type-caption font-bold">Excedente</span>
                  </div>
                  <span className="type-metric-sm text-emerald-200">{fmtMoney(surplus)}</span>
                </div>
              )}
            </div>
            <div>
              <label className="block type-label text-[color:var(--text-faint)] mb-2">Forma de Pagamento</label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
                className="w-full bg-[color:var(--bg-soft)] border border-[color:var(--border-strong)] rounded-xl px-4 py-3.5 text-[color:var(--text-primary)] outline-none focus:ring-2 focus:ring-[color:var(--accent-positive)] transition-all text-sm">
                <option value="PIX">PIX</option>
                <option value="Dinheiro">Dinheiro</option>
                <option value="Transferência Bancária">Transferência Bancária</option>
                <option value="Boleto Bancário">Boleto Bancário</option>
                <option value="Cartão">Cartão</option>
                <option value="Cheque">Cheque</option>
              </select>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-xl bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] text-xs">
              <Calendar size={14} className="shrink-0" />
              <span>Data da baixa: <strong>Hoje ({new Date().toLocaleDateString('pt-BR')})</strong></span>
            </div>
            {errorBlock}
            <button type="submit" disabled={loading || loadingContext}
              className="type-label w-full rounded-xl bg-[rgba(52,211,153,0.12)] py-4 text-[color:var(--accent-positive)] ring-1 ring-[rgba(52,211,153,0.2)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading || loadingContext ? <Loader2 className="animate-spin" size={18} /> : (isPartialPay || hasExcedente) ? <ArrowRight size={18} /> : <CheckCircle2 size={18} />}
              {loading || loadingContext ? 'Aguarde...'
                : isPartialPay ? `Próximo — destinar ${fmtMoney(remainder)} →`
                : hasExcedente ? `Próximo — aplicar excedente ${fmtMoney(surplus)}`
                : 'Confirmar Recebimento'}
            </button>
          </form>
        )}

        {action.type === 'pay' && payStep === 2 && (
          <form onSubmit={handlePayStep2} className="space-y-4 pt-2">
            {/* Resumo do pagamento parcial */}
            <div className="flex items-center justify-between rounded-2xl bg-amber-900/15 border border-amber-800/30 px-4 py-3">
              <div>
                <p className="type-label text-amber-400/80 mb-0.5">Faltam</p>
                <p className="type-metric-md text-[color:var(--text-primary)]">{fmtMoney(remainder)}</p>
              </div>
              <div className="text-right">
                <p className="type-label text-[color:var(--text-faint)]">Recebido</p>
                <p className="type-metric-sm text-[color:var(--accent-positive)]">{fmtMoney(amountVal)}</p>
              </div>
            </div>

            <p className="type-label text-[color:var(--text-faint)] text-center">Como tratar o saldo restante?</p>

            {/* Opções de destino */}
            <div className="space-y-2">
              {([
                { id: 'last' as const, icon: <ArrowDownToLine size={15}/>, label: 'Última parcela',  sublabel: context.lastInst ? `Parcela #${context.lastInst.number} · ${fmtMoney(context.lastInst.amount_total)} → ${fmtMoney(context.lastInst.amount_total + remainderWithInterest)}` : 'Acumular na última parcela pendente' },
                { id: 'next' as const, icon: <ArrowRight size={15}/>,       label: 'Próxima parcela', sublabel: context.nextInst ? `Parcela #${context.nextInst.number} · ${fmtMoney(context.nextInst.amount_total)} → ${fmtMoney(context.nextInst.amount_total + remainderWithInterest)}` : 'Adicionar à parcela seguinte' },
                { id: 'new'  as const, icon: <Plus size={15}/>,              label: 'Nova parcela extra', sublabel: 'Será criada 30 dias após a última' },
              ] as const).map(opt => (
                <button key={opt.id} type="button" onClick={() => setDeferAction(opt.id)}
                  className={`w-full p-3.5 rounded-2xl border text-left transition-all ${deferAction === opt.id ? 'border-[rgba(52,211,153,0.4)] bg-[rgba(52,211,153,0.08)] ring-1 ring-[rgba(52,211,153,0.15)]' : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-soft)] hover:border-[color:var(--border-strong)]'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${deferAction === opt.id ? 'border-[color:var(--accent-positive)]' : 'border-[color:var(--border-strong)]'}`}>
                      {deferAction === opt.id && <div className="h-2 w-2 rounded-full bg-[color:var(--accent-positive)]"/>}
                    </div>
                    <span className={`shrink-0 mt-0.5 ${deferAction === opt.id ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--text-muted)]'}`}>{opt.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold leading-tight ${deferAction === opt.id ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-secondary)]'}`}>{opt.label}</p>
                      <p className="type-caption text-[color:var(--text-faint)] mt-0.5 leading-tight truncate">{opt.sublabel}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`type-metric-sm ${deferAction === opt.id ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--text-muted)]'}`}>+{fmtMoney(remainderWithInterest)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Juros sobre o restante */}
            <div className="rounded-2xl bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="type-label text-[color:var(--text-faint)] flex items-center gap-1.5">
                  <TrendingUp size={12}/> Juros sobre o restante
                </span>
                <div className="flex rounded-lg overflow-hidden border border-[color:var(--border-subtle)] type-label uppercase">
                  <button type="button" onClick={() => { setUseInterest(false); setInterestPercent(''); }}
                    className={`px-3 py-1.5 transition-colors ${!useInterest ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]' : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]'}`}>
                    Sem juros
                  </button>
                  <button type="button" onClick={() => setUseInterest(true)}
                    className={`px-3 py-1.5 transition-colors ${useInterest ? 'bg-amber-600 text-white' : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]'}`}>
                    Com juros
                  </button>
                </div>
              </div>
              {useInterest && (
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Percent size={14} className="absolute left-3 top-3 text-amber-400"/>
                    <input type="number" step="0.01" min="0" max="100" value={interestPercent}
                      onChange={e => setInterestPercent(e.target.value)} placeholder="ex: 2,5"
                      className="w-full bg-[color:var(--bg-base)] border border-amber-700/40 rounded-xl pl-9 pr-4 py-2.5 text-[color:var(--text-primary)] font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500 transition-all"/>
                  </div>
                  <span className="text-xs text-[color:var(--text-muted)] shrink-0">% ao mês</span>
                </div>
              )}
            </div>

            {errorBlock}

            <div className="flex gap-2">
              <button type="button" onClick={() => setPayStep(1)}
                className="type-label flex-1 rounded-xl bg-[color:var(--bg-soft)] py-3.5 text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] flex items-center justify-center gap-1.5 transition-colors hover:bg-[color:var(--bg-elevated)]">
                <ChevronLeft size={14}/> Voltar
              </button>
              <button type="submit" disabled={loading || (useInterest && !interestPercent)}
                className="type-label flex-[2] rounded-xl bg-[rgba(52,211,153,0.12)] py-3.5 text-[color:var(--accent-positive)] ring-1 ring-[rgba(52,211,153,0.2)] active:scale-95 transition-all flex items-center justify-center gap-2">
                {loading ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>}
                {loading ? 'Processando...' : 'Confirmar tudo'}
              </button>
            </div>
          </form>
        )}

        {action.type === 'pay' && payStep === 'surplus' && (
          <form onSubmit={handlePaySurplusStep} className="space-y-4 pt-2">
            {/* Resumo do excedente */}
            <div className="flex items-center justify-between rounded-2xl bg-emerald-900/15 border border-emerald-800/30 px-4 py-3">
              <div>
                <p className="type-label text-emerald-400/80 mb-0.5">{postLateSurplus !== null ? 'Sobra restante' : 'Excedente'}</p>
                <p className="type-metric-md text-emerald-300">{fmtMoney(activeSurplus)}</p>
              </div>
              <div className="text-right">
                <p className="type-label text-[color:var(--text-faint)]">{postLateSurplus !== null ? 'Atrasadas pagas' : 'Parcela paga'}</p>
                <p className="type-metric-sm text-[color:var(--accent-positive)]">{postLateSurplus !== null ? fmtMoney(surplus - postLateSurplus) : fmtMoney(outstanding)}</p>
              </div>
            </div>

            <p className="type-label text-[color:var(--text-faint)] text-center">
              {postLateSurplus !== null ? 'Para onde vai a sobra restante?' : 'O que fazer com o valor excedente?'}
            </p>

            <div className="space-y-2">
              {([
                {
                  id: 'next' as SurplusAction,
                  icon: <ArrowRight size={15}/>,
                  label: 'Próxima parcela',
                  sublabel: context.nextInst
                    ? `Parcela #${context.nextInst.number} · ${fmtMoney(context.nextInst.amount_total)} → ${fmtMoney(Math.max(0, context.nextInst.amount_total - activeSurplus))}`
                    : 'Descontar da parcela seguinte',
                },
                {
                  id: 'last' as SurplusAction,
                  icon: <ArrowDownToLine size={15}/>,
                  label: 'Última parcela',
                  sublabel: context.lastInst
                    ? `Parcela #${context.lastInst.number} · ${fmtMoney(context.lastInst.amount_total)} → ${fmtMoney(Math.max(0, context.lastInst.amount_total - activeSurplus))}`
                    : 'Descontar da última parcela do contrato',
                },
                {
                  id: 'spread' as SurplusAction,
                  icon: <Layers size={15}/>,
                  label: 'Diminuir contrato',
                  sublabel: pendingInstallments.length > 0
                    ? `${pendingInstallments.length} parcelas · desconto de ${fmtMoney(discountPerInstallment)} cada`
                    : 'Distribuir entre parcelas restantes',
                },
                ...(lateInstallments.length > 0 && postLateSurplus === null ? [{
                  id: 'pay_late' as SurplusAction,
                  icon: <RefreshCw size={15}/>,
                  label: 'Quitar parcelas atrasadas',
                  sublabel: `${latePaymentPreview.length} ${latePaymentPreview.length === 1 ? 'parcela' : 'parcelas'} · total ${fmtMoney(latePaymentTotal)}`
                    + (lateSurplusLeftover > 0.01 ? ` · sobra ${fmtMoney(lateSurplusLeftover)}` : ''),
                }] : []),
              ]).map(opt => (
                <div key={opt.id} className={`w-full rounded-2xl border transition-all ${surplusAction === opt.id ? 'border-[rgba(52,211,153,0.4)] bg-[rgba(52,211,153,0.08)] ring-1 ring-[rgba(52,211,153,0.15)]' : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-soft)]'}`}>
                  <button type="button" onClick={() => setSurplusAction(opt.id)} className="w-full p-3.5 text-left">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${surplusAction === opt.id ? 'border-[color:var(--accent-positive)]' : 'border-[color:var(--border-strong)]'}`}>
                        {surplusAction === opt.id && <div className="h-2 w-2 rounded-full bg-[color:var(--accent-positive)]"/>}
                      </div>
                      <span className={`shrink-0 mt-0.5 ${surplusAction === opt.id ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--text-muted)]'}`}>{opt.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-bold leading-tight ${surplusAction === opt.id ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-secondary)]'}`}>{opt.label}</p>
                        <p className="type-caption text-[color:var(--text-faint)] mt-0.5 leading-tight">{opt.sublabel}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`type-metric-sm ${surplusAction === opt.id ? 'text-emerald-300' : 'text-[color:var(--text-muted)]'}`}>−{fmtMoney(activeSurplus)}</p>
                      </div>
                    </div>
                  </button>
                  {surplusAction === 'spread' && opt.id === 'spread' && (
                    <div className="px-3.5 pb-3.5">
                      <button type="button" onClick={() => setShowSpreadPreview(v => !v)}
                        className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors mb-2">
                        {showSpreadPreview ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                        {showSpreadPreview ? 'Ocultar detalhes' : 'Ver detalhes por parcela'}
                      </button>
                      {showSpreadPreview && (
                        <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl p-3 space-y-1 text-xs">
                          <div className="flex justify-between text-[color:var(--text-faint)] pb-1 border-b border-[color:var(--border-subtle)] font-semibold">
                            <span>Parcela</span><span>Antes → Depois</span>
                          </div>
                          {pendingInstallments.map(inst => (
                            <div key={inst.id} className="flex justify-between text-[color:var(--text-secondary)]">
                              <span className="text-[color:var(--text-faint)]">#{inst.number}</span>
                              <span className="font-mono">
                                {fmtMoney(inst.amount_total)}
                                <span className="text-[color:var(--text-faint)] mx-1">→</span>
                                <span className="text-emerald-300">{fmtMoney(Math.max(0, inst.amount_total - discountPerInstallment))}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {surplusAction === 'pay_late' && opt.id === 'pay_late' && (
                    <div className="px-3.5 pb-3.5">
                      <button type="button" onClick={() => setShowLatePreview(v => !v)}
                        className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors mb-2">
                        {showLatePreview ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                        {showLatePreview ? 'Ocultar detalhes' : 'Ver detalhes por parcela'}
                      </button>
                      {showLatePreview && (
                        <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl p-3 space-y-1 text-xs">
                          <div className="flex justify-between text-[color:var(--text-faint)] pb-1 border-b border-[color:var(--border-subtle)] font-semibold">
                            <span>Parcela</span><span>Devendo → Pagamento</span>
                          </div>
                          {latePaymentPreview.map(inst => (
                            <div key={inst.id} className="flex justify-between text-[color:var(--text-secondary)]">
                              <span className="text-[color:var(--text-faint)]">#{inst.number}</span>
                              <span className="font-mono">
                                {fmtMoney(inst.outstanding)}
                                <span className="text-[color:var(--text-faint)] mx-1">→</span>
                                <span className={inst.willFullyPay ? 'text-emerald-300' : 'text-amber-300'}>
                                  {inst.willFullyPay ? 'Quitada' : fmtMoney(inst.willPay) + ' (parcial)'}
                                </span>
                              </span>
                            </div>
                          ))}
                          {lateSurplusLeftover > 0.01 && (
                            <div className="flex justify-between text-amber-300 pt-1 border-t border-[color:var(--border-subtle)]">
                              <span>Sobra</span>
                              <span className="font-mono">{fmtMoney(lateSurplusLeftover)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {errorBlock}

            <div className="flex gap-2">
              <button type="button" onClick={() => { if (postLateSurplus !== null) { setPostLateSurplus(null); onSuccess(); setIsReceiptMode(true); } else { setPayStep(1); } }}
                className="type-label flex-1 rounded-xl bg-[color:var(--bg-soft)] py-3.5 text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] flex items-center justify-center gap-1.5 transition-colors hover:bg-[color:var(--bg-elevated)]">
                <ChevronLeft size={14}/> {postLateSurplus !== null ? 'Pular' : 'Voltar'}
              </button>
              <button type="submit" disabled={loading}
                className="type-label flex-[2] rounded-xl bg-[rgba(52,211,153,0.12)] py-3.5 text-[color:var(--accent-positive)] ring-1 ring-[rgba(52,211,153,0.2)] active:scale-95 transition-all flex items-center justify-center gap-2">
                {loading ? <Loader2 className="animate-spin" size={16}/> : <CheckCircle2 size={16}/>}
                {loading ? 'Processando...' : 'Confirmar tudo'}
              </button>
            </div>
          </form>
        )}

        {action.type === 'pay' && payStep === 'missed' && (
          <form onSubmit={handleMissedStep} className="space-y-4 pt-2">
            {/* Aviso de falta */}
            <div className="p-4 rounded-xl bg-[rgba(198,126,105,0.10)] border border-[rgba(198,126,105,0.25)] flex gap-3">
              <AlertTriangle className="text-[color:var(--accent-danger)] shrink-0 mt-0.5" size={16} />
              <div>
                <p className="text-xs font-bold text-[color:var(--accent-danger)] mb-0.5">Falta registrada</p>
                <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
                  Esta parcela teve uma falta em <strong>{fmtDatetime(installment.missed_at)}</strong>.
                </p>
              </div>
            </div>

            {/* Juros por falta */}
            <div className="rounded-2xl bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="type-label text-[color:var(--text-faint)] flex items-center gap-1.5">
                  <TrendingUp size={12}/> Houve cobrança de juros?
                </span>
                <div className="flex rounded-lg overflow-hidden border border-[color:var(--border-subtle)] type-label uppercase">
                  <button type="button" onClick={() => { setUseMissedInterest(false); setMissedInterestRate(''); }}
                    className={`px-3 py-1.5 transition-colors ${!useMissedInterest ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]' : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]'}`}>
                    Sem juros
                  </button>
                  <button type="button" onClick={() => setUseMissedInterest(true)}
                    className={`px-3 py-1.5 transition-colors ${useMissedInterest ? 'bg-amber-600 text-white' : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]'}`}>
                    Com juros
                  </button>
                </div>
              </div>
              {useMissedInterest && (
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Percent size={14} className="absolute left-3 top-3 text-amber-400"/>
                    <input type="number" step="0.01" min="0" max="100" value={missedInterestRate}
                      onChange={e => setMissedInterestRate(e.target.value)} placeholder="ex: 2,5"
                      className="w-full bg-[color:var(--bg-base)] border border-amber-700/40 rounded-xl pl-9 pr-4 py-2.5 text-[color:var(--text-primary)] font-mono text-sm outline-none focus:ring-2 focus:ring-amber-500 transition-all"/>
                  </div>
                  <span className="text-xs text-[color:var(--text-muted)] shrink-0">% ao mês</span>
                </div>
              )}
              {useMissedInterest && missedInterestRate && (
                <p className="type-caption text-amber-400 font-bold">
                  + {fmtMoney(Math.round(normalizeNum(installment.amount_total) * parseFloat(missedInterestRate) / 100 * 100) / 100)} de juros
                </p>
              )}
            </div>

            {/* Remover postergação */}
            {deferredInstallment && (
              <div className="rounded-2xl bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] p-4 space-y-3">
                <p className="type-label text-[color:var(--text-faint)]">
                  Valor postergado na Parcela #{deferredInstallment.number}
                </p>
                <p className="text-xs text-[color:var(--text-secondary)]">
                  O valor desta parcela foi acumulado na parcela #{deferredInstallment.number}. Deseja removê-lo?
                </p>
                <div className="flex rounded-lg overflow-hidden border border-[color:var(--border-subtle)] type-label uppercase">
                  <button type="button" onClick={() => setRemoveDeferral(false)}
                    className={`flex-1 px-3 py-1.5 transition-colors ${!removeDeferral ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]' : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]'}`}>
                    Manter
                  </button>
                  <button type="button" onClick={() => setRemoveDeferral(true)}
                    className={`flex-1 px-3 py-1.5 transition-colors ${removeDeferral ? 'bg-[color:var(--accent-danger)] text-white' : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]'}`}>
                    Remover
                  </button>
                </div>
              </div>
            )}

            {errorBlock}
            <div className="flex gap-2">
              <button type="button" onClick={() => setPayStep(1)}
                className="type-label flex-1 rounded-xl bg-[color:var(--bg-soft)] py-3.5 text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] flex items-center justify-center gap-1.5 transition-colors hover:bg-[color:var(--bg-elevated)]">
                <ChevronLeft size={14}/> Voltar
              </button>
              <button type="submit" disabled={loading || (useMissedInterest && !missedInterestRate)}
                className="type-label flex-[2] rounded-xl bg-[rgba(52,211,153,0.12)] py-3.5 text-[color:var(--accent-positive)] ring-1 ring-[rgba(52,211,153,0.2)] active:scale-95 transition-all flex items-center justify-center gap-2">
                {loading || loadingContext ? <Loader2 className="animate-spin" size={16}/> : <ArrowRight size={16}/>}
                {loading || loadingContext ? 'Aguarde...' : isPartialPay ? 'Próximo →' : 'Confirmar Recebimento'}
              </button>
            </div>
          </form>
        )}

        {action.type === 'miss' && (
          <div className="space-y-4 pt-2">
            {missStep === 1 && (
              <>
                <div className="p-4 rounded-xl bg-[rgba(198,126,105,0.10)] border border-[rgba(198,126,105,0.25)] flex gap-3">
                  <AlertTriangle className="text-[color:var(--accent-danger)] shrink-0 mt-0.5" size={16} />
                  <div>
                    <p className="text-xs font-bold text-[color:var(--accent-danger)] mb-0.5">Registrar falta</p>
                    <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
                      Registra que o pagamento <strong>não foi recebido</strong> em {new Date().toLocaleDateString('pt-BR')}.
                      A parcela ficará marcada como "falta".
                    </p>
                  </div>
                </div>
                {errorBlock}
                <button type="button" onClick={() => setMissStep(2)}
                  className="type-label w-full rounded-xl bg-[rgba(198,126,105,0.12)] py-4 text-[color:var(--accent-danger)] ring-1 ring-[rgba(198,126,105,0.3)] active:scale-95 transition-all flex items-center justify-center gap-2">
                  <ArrowRight size={18} /> Continuar
                </button>
              </>
            )}

            {missStep === 2 && (
              <>
                <p className="type-label text-[color:var(--text-faint)] text-center pt-1">O que fazer com esta parcela?</p>
                <div className="space-y-2">
                  {([
                    { id: 'postpone' as const, icon: <Calendar size={15}/>, label: 'Adiar 1 mês', sublabel: 'Vencimento avança 30 dias, parcela continua em aberto' },
                    { id: 'last'     as const, icon: <ArrowDownToLine size={15}/>, label: 'Acumular na última parcela', sublabel: 'Valor vai para a última parcela pendente do contrato' },
                    { id: 'new'      as const, icon: <Plus size={15}/>, label: 'Criar parcela extra', sublabel: 'Nova parcela criada após o último vencimento' },
                  ] as const).map(opt => (
                    <button key={opt.id} type="button" onClick={() => setMissDeferAction(opt.id)}
                      className={`w-full p-3.5 rounded-2xl border text-left transition-all ${missDeferAction === opt.id ? 'border-[rgba(198,126,105,0.5)] bg-[rgba(198,126,105,0.08)] ring-1 ring-[rgba(198,126,105,0.2)]' : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-soft)] hover:border-[color:var(--border-strong)]'}`}>
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${missDeferAction === opt.id ? 'border-[color:var(--accent-danger)]' : 'border-[color:var(--border-strong)]'}`}>
                          {missDeferAction === opt.id && <div className="h-2 w-2 rounded-full bg-[color:var(--accent-danger)]"/>}
                        </div>
                        <span className={`shrink-0 mt-0.5 ${missDeferAction === opt.id ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-muted)]'}`}>{opt.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold leading-tight ${missDeferAction === opt.id ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-secondary)]'}`}>{opt.label}</p>
                          <p className="type-caption text-[color:var(--text-faint)] mt-0.5 leading-tight">{opt.sublabel}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {errorBlock}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMissStep(1)}
                    className="type-label flex-1 rounded-xl bg-[color:var(--bg-soft)] py-3.5 text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] flex items-center justify-center gap-1.5 transition-colors hover:bg-[color:var(--bg-elevated)]">
                    <ChevronLeft size={14}/> Voltar
                  </button>
                  <button type="button" onClick={handleMiss} disabled={loading}
                    className="type-label flex-[2] rounded-xl bg-[rgba(198,126,105,0.12)] py-3.5 text-[color:var(--accent-danger)] ring-1 ring-[rgba(198,126,105,0.3)] active:scale-95 transition-all flex items-center justify-center gap-2">
                    {loading ? <Loader2 className="animate-spin" size={16}/> : <XCircle size={16}/>}
                    {loading ? 'Registrando...' : 'Registrar Falta'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {action.type === 'unpay' && (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-xl bg-[rgba(198,126,105,0.10)] border border-[rgba(198,126,105,0.25)] flex gap-3">
              <AlertTriangle className="text-[color:var(--accent-danger)] shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
                Esta ação irá <strong>reverter o pagamento</strong>, marcando a parcela como <strong>Pendente</strong> e zerando o valor pago.
              </p>
            </div>
            {errorBlock}
            <button onClick={handleUnpay} disabled={loading}
              className="type-label w-full rounded-xl bg-[rgba(198,126,105,0.12)] py-4 text-[color:var(--accent-danger)] ring-1 ring-[rgba(198,126,105,0.3)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <XCircle size={18} />}
              {loading ? 'Revertendo...' : 'Confirmar — Marcar Não Pago'}
            </button>
          </div>
        )}

        {action.type === 'refinance' && (
          <form onSubmit={handleRefinance} className="space-y-4 pt-2">
            <div className="p-3 rounded-xl bg-[rgba(148,180,255,0.08)] border border-[rgba(148,180,255,0.18)] flex gap-3">
              <AlertTriangle className="text-[color:var(--accent-steel)] shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
                Paga o valor de entrada e re-agenda o saldo para a nova data.
              </p>
            </div>
            <div>
              <label className="block type-label text-[color:var(--text-faint)] mb-2">Valor de Entrada (Pago Hoje)</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-[color:var(--accent-steel)]" />
                <input type="number" step="0.01" inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-steel)]`} />
              </div>
            </div>
            <div>
              <label className="block type-label text-[color:var(--text-faint)] mb-2">Nova Data de Vencimento</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-4 top-4 text-[color:var(--text-muted)]" />
                <input type="date" required value={newDate} onChange={e => setNewDate(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-steel)]`} />
              </div>
            </div>
            {errorBlock}
            <button type="submit" disabled={loading}
              className="type-label w-full rounded-xl bg-[rgba(148,180,255,0.10)] py-4 text-[color:var(--accent-steel)] ring-1 ring-[rgba(148,180,255,0.18)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              {loading ? 'Calculando...' : 'Confirmar Renegociação'}
            </button>
          </form>
        )}

        {action.type === 'edit' && (
          <form onSubmit={handleEdit} className="space-y-4 pt-2">
            <div className="p-3 rounded-xl bg-[rgba(148,180,255,0.08)] border border-[rgba(148,180,255,0.18)] flex gap-3">
              <AlertTriangle className="text-[color:var(--accent-steel)] shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
                Altera o valor e vencimento diretamente. Use para corrigir erros de cadastro.
              </p>
            </div>
            <div>
              <label className="block type-label text-[color:var(--text-faint)] mb-2">Nova Data de Vencimento</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-4 top-4 text-[color:var(--text-muted)]" />
                <input type="date" required value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-steel)]`} />
              </div>
            </div>
            <div>
              <label className="block type-label text-[color:var(--text-faint)] mb-2">Novo Valor Total</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-[color:var(--text-muted)]" />
                <input type="number" step="0.01" inputMode="decimal" required value={totalAmount} onChange={e => setTotalAmount(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-steel)]`} />
              </div>
            </div>
            {errorBlock}
            <button type="submit" disabled={loading}
              className="type-label w-full rounded-xl bg-[color:var(--bg-soft)] py-4 text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
              {loading ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </form>
        )}

        {action.type === 'interest' && (
          <form onSubmit={handleInterest} className="space-y-4 pt-2">
            <div className="panel-card rounded-2xl p-4">
              <p className="type-label text-[color:var(--accent-brass)]/80 mb-1">Parcela Original</p>
              <p className="type-metric-xl text-[color:var(--text-primary)]">{fmtMoney(outstanding)}</p>
              <p className="type-label text-[color:var(--accent-brass)]/70 mt-1">Ainda em aberto</p>
            </div>
            <div>
              <label className="block type-label text-[color:var(--text-faint)] mb-2">Valor dos Juros (R$)</label>
              <div className="relative">
                <Percent size={16} className="absolute left-4 top-4 text-[color:var(--accent-brass)]" />
                <input type="number" step="0.01" inputMode="decimal" required autoFocus placeholder="0,00"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-brass)]`} />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[rgba(202,176,122,0.08)] border border-[rgba(202,176,122,0.18)] flex gap-2.5 items-start">
              <AlertTriangle size={14} className="text-[color:var(--accent-brass)] shrink-0 mt-0.5" />
              <p className="type-caption text-[color:var(--text-secondary)] leading-relaxed">
                O valor da parcela <strong>não será descontado</strong>. Ela continua em aberto.
              </p>
            </div>
            {errorBlock}
            <button type="submit" disabled={loading}
              className="type-label w-full rounded-xl bg-[rgba(202,176,122,0.12)] py-4 text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.20)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Percent size={18} />}
              {loading ? 'Registrando...' : 'Registrar Pagamento de Juros'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
