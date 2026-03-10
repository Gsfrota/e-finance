import React, { useMemo, useState, useEffect } from 'react';
import {
  Loader2, AlertCircle, CheckCircle2, AlertTriangle,
  TrendingUp, Wallet, RefreshCw, ChevronRight, ArrowRight, ArrowLeft,
  Calendar, Percent, DollarSign, FileText, History, GitBranch,
  BadgeCheck, Flame, CircleDollarSign, RotateCcw,
  Pencil, Save, XCircle,
} from 'lucide-react';
import { Investment, LoanInstallment, Tenant } from '../types';
import { useContractDetail } from '../hooks/useContractDetail';
import { getSupabase, parseSupabaseError } from '../services/supabase';
import ReceiptTemplate from './ReceiptTemplate';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const fmtDate = (ymd?: string | null) => {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
};

const fmtDatetime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const normalizeNumber = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

const calculateOutstanding = (inst: LoanInstallment): number => {
  const total = normalizeNumber(inst.amount_total);
  const fine  = normalizeNumber(inst.fine_amount);
  const delay = normalizeNumber(inst.interest_delay_amount);
  const paid  = normalizeNumber(inst.amount_paid);
  return Math.max(0, (total + fine + delay) - paid);
};

const statusBadge = (status?: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    active:    { label: 'Ativo',        cls: 'chip chip-active' },
    completed: { label: 'Quitado',      cls: 'chip chip-paid' },
    defaulted: { label: 'Inadimplente', cls: 'chip chip-late' },
    renewed:   { label: 'Renovado',     cls: 'chip chip-pending' },
  };
  const s = map[status || 'active'] ?? map['active'];
  return <span className={s.cls}>{s.label}</span>;
};

const installmentStatusBadge = (status: LoanInstallment['status']) => {
  const map = {
    paid:    { label: 'Pago',     cls: 'chip chip-paid' },
    pending: { label: 'Pendente', cls: 'chip chip-pending' },
    late:    { label: 'Atrasado', cls: 'chip chip-late' },
    partial: { label: 'Parcial',  cls: 'chip chip-pending' },
  };
  const s = map[status];
  return <span className={s.cls}>{s.label}</span>;
};

const panelCard = 'panel-card rounded-[1.6rem]';

// ── Types ─────────────────────────────────────────────────────────────────────

type InstallmentAction =
  | null
  | { type: 'pay';      installment: LoanInstallment }
  | { type: 'unpay';    installment: LoanInstallment }
  | { type: 'refinance'; installment: LoanInstallment }
  | { type: 'edit';     installment: LoanInstallment }
  | { type: 'interest'; installment: LoanInstallment };

// ── KpiTile ───────────────────────────────────────────────────────────────────

interface KpiTileProps {
  label: string; value: string; color?: string;
  icon: React.ElementType; iconBg?: string;
}
const KpiTile: React.FC<KpiTileProps> = ({ label, value, color = 'var(--text-primary)', icon: Icon, iconBg = 'var(--bg-soft)' }) => (
  <div className={`${panelCard} flex flex-col gap-3 p-4`}>
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: iconBg }}>
        <Icon size={14} style={{ color }} />
      </div>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[color:var(--text-faint)]">{label}</p>
    </div>
    <p className="text-lg font-extrabold leading-none tracking-tight" style={{ color }}>{value}</p>
  </div>
);

// ── InstallmentDetailScreen ───────────────────────────────────────────────────

interface InstallmentDetailScreenProps {
  installment: LoanInstallment;
  onBack: () => void;
  onAction: (action: NonNullable<InstallmentAction>) => void;
}

const InstallmentDetailScreen: React.FC<InstallmentDetailScreenProps> = ({ installment, onBack, onAction }) => {
  const isPaid    = installment.status === 'paid';
  const isLate    = installment.status === 'late';
  const isPartial = installment.status === 'partial';
  const multa     = normalizeNumber(installment.fine_amount) + normalizeNumber(installment.interest_delay_amount);
  const outstanding = calculateOutstanding(installment);

  return (
    <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-5 py-5 shrink-0">
        <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">
            Parcela {installment.number}
          </p>
          <h3 className="text-xl font-black text-[color:var(--text-primary)] uppercase tracking-tighter leading-none mt-0.5">
            Detalhes
          </h3>
        </div>
        {installmentStatusBadge(installment.status)}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-5 space-y-4">

        {/* Resumo financeiro */}
        <div className="panel-card rounded-2xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--text-faint)] mb-1">
            {isPaid ? 'Valor Pago' : isPartial ? 'Pago Parcialmente' : 'Total Devido'}
          </p>
          <p className={`text-3xl font-black tabular-nums leading-none mb-5 ${
            isPaid    ? 'text-[color:var(--accent-positive)]' :
            isPartial ? 'text-[color:var(--accent-brass)]' :
            isLate    ? 'text-[color:var(--accent-danger)]' :
                        'text-[color:var(--text-primary)]'
          }`}>
            {isPaid || isPartial ? fmt(normalizeNumber(installment.amount_paid)) : fmt(outstanding)}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-1">Vencimento</p>
              <p className={`text-sm font-bold tabular-nums ${isLate ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-primary)]'}`}>
                {fmtDate(installment.due_date)}
              </p>
            </div>
            <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-1">Valor Original</p>
              <p className="text-sm font-bold tabular-nums text-[color:var(--text-primary)]">{fmt(normalizeNumber(installment.amount_total))}</p>
            </div>
            <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-1">Principal</p>
              <p className="text-sm font-bold tabular-nums text-[color:var(--text-secondary)]">{fmt(normalizeNumber(installment.amount_principal))}</p>
            </div>
            <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-1">Juros</p>
              <p className="text-sm font-bold tabular-nums text-[color:var(--accent-brass)]">{fmt(normalizeNumber(installment.amount_interest))}</p>
            </div>

            {multa > 0 && (
              <div className="col-span-2 rounded-xl bg-[rgba(198,126,105,0.08)] border border-[rgba(198,126,105,0.2)] px-3 py-2.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--accent-danger)] mb-1">Multa / Juros de Atraso</p>
                <p className="text-sm font-bold tabular-nums text-[color:var(--accent-danger)]">+{fmt(multa)}</p>
              </div>
            )}
            {isPaid && installment.paid_at && (
              <div className="col-span-2 rounded-xl bg-[rgba(52,211,153,0.06)] border border-[rgba(52,211,153,0.15)] px-3 py-2.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--accent-positive)] mb-1">Pago em</p>
                <p className="text-sm font-bold tabular-nums text-[color:var(--accent-positive)]">{fmtDatetime(installment.paid_at)}</p>
              </div>
            )}
            {normalizeNumber((installment as any).interest_payments_total) > 0 && (
              <div className="col-span-2 rounded-xl bg-[rgba(202,176,122,0.08)] border border-[rgba(202,176,122,0.14)] px-3 py-2.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--accent-brass)] mb-1">Juros já cobrados</p>
                <p className="text-sm font-bold tabular-nums text-[color:var(--accent-brass)]">{fmt(normalizeNumber((installment as any).interest_payments_total))}</p>
              </div>
            )}
          </div>
        </div>

        {/* Ações */}
        <div className="space-y-2">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)] px-1 mb-3">Ações</p>

          {!isPaid && (
            <button
              onClick={() => onAction({ type: 'pay', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[rgba(52,211,153,0.10)] px-4 py-4 text-left ring-1 ring-[rgba(52,211,153,0.2)] active:scale-[0.98] transition-all"
            >
              <CheckCircle2 size={22} className="text-[color:var(--accent-positive)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--accent-positive)] uppercase tracking-wide">Dar Baixa</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Registrar recebimento total ou parcial</p>
              </div>
            </button>
          )}

          {!isPaid && (
            <button
              onClick={() => onAction({ type: 'refinance', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[rgba(148,180,255,0.08)] px-4 py-4 text-left ring-1 ring-[rgba(148,180,255,0.18)] active:scale-[0.98] transition-all"
            >
              <RefreshCw size={22} className="text-[color:var(--accent-steel)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--accent-steel)] uppercase tracking-wide">Renegociar</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Re-agendar com entrada parcial</p>
              </div>
            </button>
          )}

          {!isPaid && (
            <button
              onClick={() => onAction({ type: 'interest', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[rgba(202,176,122,0.10)] px-4 py-4 text-left ring-1 ring-[rgba(202,176,122,0.20)] active:scale-[0.98] transition-all"
            >
              <Percent size={22} className="text-[color:var(--accent-brass)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--accent-brass)] uppercase tracking-wide">Pagar Só Juros</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Principal permanece em aberto</p>
              </div>
            </button>
          )}

          {isPaid && (
            <button
              onClick={() => onAction({ type: 'unpay', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[rgba(198,126,105,0.08)] px-4 py-4 text-left ring-1 ring-[rgba(198,126,105,0.22)] active:scale-[0.98] transition-all"
            >
              <XCircle size={22} className="text-[color:var(--accent-danger)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--accent-danger)] uppercase tracking-wide">Marcar como Não Pago</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Reverter pagamento — volta para Pendente</p>
              </div>
            </button>
          )}

          {isPaid && (
            <button
              onClick={() => onAction({ type: 'pay', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[color:var(--bg-soft)] px-4 py-4 text-left ring-1 ring-[color:var(--border-subtle)] active:scale-[0.98] transition-all"
            >
              <FileText size={22} className="text-[color:var(--text-muted)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--text-secondary)] uppercase tracking-wide">Ver Comprovante</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Gerar recibo de pagamento</p>
              </div>
            </button>
          )}

          <button
            onClick={() => onAction({ type: 'edit', installment })}
            className="w-full flex items-center gap-4 rounded-2xl bg-[color:var(--bg-soft)] px-4 py-4 text-left ring-1 ring-[color:var(--border-subtle)] active:scale-[0.98] transition-all"
          >
            <Pencil size={22} className="text-[color:var(--text-muted)] shrink-0" />
            <div>
              <p className="text-sm font-extrabold text-[color:var(--text-secondary)] uppercase tracking-wide">Editar Parcela</p>
              <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Alterar valor e data de vencimento</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

// ── InstallmentFormScreen ─────────────────────────────────────────────────────

interface InstallmentFormScreenProps {
  action: NonNullable<InstallmentAction>;
  tenant: Tenant | null;
  payerName?: string;
  onBack: () => void;
  onSuccess: () => void;
}

const InstallmentFormScreen: React.FC<InstallmentFormScreenProps> = ({ action, tenant, payerName, onBack, onSuccess }) => {
  const { installment } = action;
  const outstanding = calculateOutstanding(installment);

  const [amount, setAmount]           = useState('');
  const [newDate, setNewDate]         = useState('');
  const [dueDate, setDueDate]         = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [isReceiptMode, setIsReceiptMode] = useState(false);

  useEffect(() => {
    setError(null);
    setIsReceiptMode(false);
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
    } else {
      setAmount('');
    }
  }, [action]);

  const titles: Record<string, string> = {
    pay: 'Dar Baixa', unpay: 'Reverter Pagamento',
    refinance: 'Renegociar Parcela', edit: 'Editar Parcela', interest: 'Pagar Só Juros',
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) { setError('O valor deve ser maior que zero.'); return; }
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: rpcError } = await supabase.rpc('pay_installment', {
        p_installment_id: installment.id, p_amount_paid: val,
      });
      if (rpcError) throw rpcError;
      installment.amount_paid = val;
      installment.paid_at = new Date().toISOString();
      onSuccess();
      setIsReceiptMode(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao processar pagamento.');
    } finally { setLoading(false); }
  };

  const handleUnpaySubmit = async () => {
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: dbError } = await supabase
        .from('loan_installments')
        .update({ status: 'pending', amount_paid: 0, paid_at: null })
        .eq('id', installment.id);
      if (dbError) throw dbError;
      onSuccess(); onBack();
    } catch (err: any) {
      setError(parseSupabaseError(err));
    } finally { setLoading(false); }
  };

  const handleRefinanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val < 0) { setError('O valor de entrada não pode ser negativo.'); return; }
    if (!newDate) { setError('Selecione uma nova data de vencimento.'); return; }
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: rpcError } = await supabase.rpc('refinance_installment', {
        p_installment_id: installment.id, p_payment_amount: val, p_new_due_date: newDate,
      });
      if (rpcError) throw rpcError;
      onSuccess(); onBack();
    } catch (err: any) {
      setError(err.message || 'Erro no refinanciamento.');
    } finally { setLoading(false); }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(totalAmount);
    if (isNaN(val) || val <= 0) { setError('O valor total deve ser positivo.'); return; }
    if (!dueDate) { setError('Data de vencimento inválida.'); return; }
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: rpcError } = await supabase.rpc('admin_update_installment', {
        p_installment_id: installment.id, p_new_amount_total: val, p_new_due_date: dueDate,
      });
      if (rpcError) throw rpcError;
      onSuccess(); onBack();
    } catch (err: any) {
      setError(err.message || 'Erro na edição.');
    } finally { setLoading(false); }
  };

  const handleInterestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val <= 0) { setError('Informe um valor válido.'); return; }
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: rpcError } = await supabase.rpc('pay_interest_only', {
        p_installment_id: installment.id, p_interest_amount: val,
      });
      if (rpcError) throw rpcError;
      onSuccess(); onBack();
    } catch (err: any) {
      setError(parseSupabaseError(err));
    } finally { setLoading(false); }
  };

  const errorBlock = error && (
    <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl text-red-400 text-xs flex items-center gap-2">
      <AlertTriangle size={14} /> {error}
    </div>
  );

  const inputCls = "w-full bg-[color:var(--bg-soft)] border border-[color:var(--border-strong)] rounded-xl pr-4 py-3.5 text-[color:var(--text-primary)] font-mono text-lg outline-none focus:ring-2 transition-all";

  // Receipt mode
  if (isReceiptMode && tenant) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-4">
          <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="font-display text-lg font-black text-[color:var(--text-primary)]">Comprovante</h2>
        </div>
        <div className="flex-1 overflow-y-auto bg-white">
          <ReceiptTemplate
            installment={installment} tenant={tenant}
            payerName={payerName || (installment as any).investment?.payer?.full_name}
            onClose={onBack}
          />
        </div>
      </div>
    );
  }
  if (isReceiptMode && !tenant) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-4">
          <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="font-display text-lg font-black text-[color:var(--text-primary)]">Pagamento Confirmado</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <CheckCircle2 size={48} className="text-[color:var(--accent-positive)]" />
          <p className="text-sm text-[color:var(--text-secondary)] text-center">Pagamento registrado com sucesso.</p>
          <button onClick={onBack} className="px-6 py-3 rounded-2xl bg-[color:var(--bg-soft)] text-xs font-bold uppercase text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)]">
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-4 shrink-0">
        <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h2 className="font-display text-lg font-black text-[color:var(--text-primary)]">
          {titles[action.type]}
        </h2>
      </div>

      {/* Resumo */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="panel-card rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-[color:var(--text-faint)]">
            Parcela {installment.number} · Venc. {fmtDate(installment.due_date)}
          </p>
          <p className="text-2xl font-extrabold text-[color:var(--text-primary)] mt-1">{fmt(outstanding)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">

        {/* PAY */}
        {action.type === 'pay' && (
          <form onSubmit={handlePaySubmit} className="space-y-4 pt-2">
            <div>
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">
                Valor Recebido (R$)
              </label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-[color:var(--accent-positive)]" />
                <input type="number" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-positive)]`} />
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-xl bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] text-xs">
              <Calendar size={14} className="shrink-0" />
              <span>Data da baixa: <strong>Hoje ({new Date().toLocaleDateString('pt-BR')})</strong></span>
            </div>
            {errorBlock}
            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-[rgba(52,211,153,0.12)] py-4 text-xs font-extrabold uppercase tracking-widest text-[color:var(--accent-positive)] ring-1 ring-[rgba(52,211,153,0.2)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
              {loading ? 'Processando...' : 'Confirmar Recebimento'}
            </button>
          </form>
        )}

        {/* UNPAY */}
        {action.type === 'unpay' && (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-xl bg-[rgba(198,126,105,0.10)] border border-[rgba(198,126,105,0.25)] flex gap-3">
              <AlertTriangle className="text-[color:var(--accent-danger)] shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
                Esta ação irá <strong>reverter o pagamento</strong>, marcando a parcela como <strong>Pendente</strong> e zerando o valor pago. Use apenas para corrigir lançamentos errados.
              </p>
            </div>
            {errorBlock}
            <button onClick={handleUnpaySubmit} disabled={loading}
              className="w-full rounded-xl bg-[rgba(198,126,105,0.12)] py-4 text-xs font-extrabold uppercase tracking-widest text-[color:var(--accent-danger)] ring-1 ring-[rgba(198,126,105,0.3)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <XCircle size={18} />}
              {loading ? 'Revertendo...' : 'Confirmar — Marcar Não Pago'}
            </button>
          </div>
        )}

        {/* REFINANCE */}
        {action.type === 'refinance' && (
          <form onSubmit={handleRefinanceSubmit} className="space-y-4 pt-2">
            <div className="p-3 rounded-xl bg-[rgba(148,180,255,0.08)] border border-[rgba(148,180,255,0.18)] flex gap-3">
              <AlertTriangle className="text-[color:var(--accent-steel)] shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
                Paga o valor de entrada e re-agenda o saldo restante para a nova data, mantendo o status "Pendente".
              </p>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">Valor de Entrada (Pago Hoje)</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-[color:var(--accent-steel)]" />
                <input type="number" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-steel)]`} />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">Nova Data de Vencimento</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-4 top-4 text-[color:var(--text-muted)]" />
                <input type="date" required value={newDate} onChange={e => setNewDate(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-steel)]`} />
              </div>
            </div>
            {errorBlock}
            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-[rgba(148,180,255,0.10)] py-4 text-xs font-extrabold uppercase tracking-widest text-[color:var(--accent-steel)] ring-1 ring-[rgba(148,180,255,0.18)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              {loading ? 'Calculando...' : 'Confirmar Renegociação'}
            </button>
          </form>
        )}

        {/* EDIT */}
        {action.type === 'edit' && (
          <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
            <div className="p-3 rounded-xl bg-[rgba(148,180,255,0.08)] border border-[rgba(148,180,255,0.18)] flex gap-3">
              <AlertTriangle className="text-[color:var(--accent-steel)] shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
                Altera o valor total e o vencimento diretamente. Use apenas para corrigir erros de cadastro.
              </p>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">Nova Data de Vencimento</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-4 top-4 text-[color:var(--text-muted)]" />
                <input type="date" required value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-steel)]`} />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">Novo Valor Total (Principal + Juros)</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-[color:var(--text-muted)]" />
                <input type="number" step="0.01" required value={totalAmount} onChange={e => setTotalAmount(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-steel)]`} />
              </div>
            </div>
            {errorBlock}
            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-[color:var(--bg-soft)] py-4 text-xs font-extrabold uppercase tracking-widest text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
              {loading ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </form>
        )}

        {/* INTEREST */}
        {action.type === 'interest' && (
          <form onSubmit={handleInterestSubmit} className="space-y-4 pt-2">
            <div className="panel-card rounded-2xl p-4">
              <p className="text-[10px] text-[color:var(--accent-brass)]/80 font-black uppercase tracking-widest mb-1">Parcela Original</p>
              <p className="text-2xl font-black text-[color:var(--text-primary)]">{fmt(outstanding)}</p>
              <p className="text-[10px] text-[color:var(--accent-brass)]/70 mt-1 font-bold uppercase">Ainda em aberto</p>
            </div>
            {normalizeNumber((installment as any).interest_payments_total) > 0 && (
              <div className="bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)] p-3 rounded-xl flex justify-between items-center">
                <span className="text-[10px] text-[color:var(--text-faint)] font-black uppercase tracking-widest">Juros já cobrados</span>
                <span className="text-[color:var(--accent-brass)] font-black text-sm">{fmt(normalizeNumber((installment as any).interest_payments_total))}</span>
              </div>
            )}
            <div>
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">Valor dos Juros (R$)</label>
              <div className="relative">
                <Percent size={16} className="absolute left-4 top-4 text-[color:var(--accent-brass)]" />
                <input type="number" step="0.01" required autoFocus placeholder="0,00"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-brass)]`} />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[rgba(202,176,122,0.08)] border border-[rgba(202,176,122,0.18)] flex gap-2.5 items-start">
              <AlertTriangle size={14} className="text-[color:var(--accent-brass)] shrink-0 mt-0.5" />
              <p className="text-[10px] text-[color:var(--text-secondary)] leading-relaxed">
                O valor da parcela <strong>não será descontado</strong>. A parcela continua em aberto após este registro.
              </p>
            </div>
            {errorBlock}
            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-[rgba(202,176,122,0.12)] py-4 text-xs font-extrabold uppercase tracking-widest text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.20)] active:scale-95 transition-all flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Percent size={18} />}
              {loading ? 'Registrando...' : 'Registrar Pagamento de Juros'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

interface ContractDetailProps {
  investmentId: number | null;
  onBack: () => void;
  onRenew?: (investment: Investment) => void;
  onRefreshList?: () => void;
  tenant?: Tenant | null;
}

const ContractDetail: React.FC<ContractDetailProps> = ({ investmentId, onBack, onRenew, tenant }) => {
  const { data, loading, error, refetch } = useContractDetail(investmentId);
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction]     = useState<InstallmentAction>(null);

  const progressPct = useMemo(() => {
    if (!data) return 0;
    const { parcelasPagas, parcelasTotal } = data.metrics;
    return parcelasTotal > 0 ? Math.round((parcelasPagas / parcelasTotal) * 100) : 0;
  }, [data]);

  const saudeColor = useMemo(() => {
    if (!data) return 'var(--text-muted)';
    const s = data.metrics.saudeContrato;
    if (s >= 80) return 'var(--accent-positive)';
    if (s >= 50) return '#f59e0b';
    return 'var(--accent-danger)';
  }, [data]);

  const { totalPago, totalRestante } = useMemo(() => {
    if (!data) return { totalPago: 0, totalRestante: 0 };
    let totalPago = 0, totalRestante = 0;
    for (const i of data.installments) {
      totalPago += normalizeNumber(i.amount_paid);
      if (i.status !== 'paid') totalRestante += calculateOutstanding(i);
    }
    return { totalPago, totalRestante };
  }, [data]);

  // ── Sub-view: form de ação ──
  if (installmentAction !== null) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        tenant={tenant ?? null}
        payerName={data?.investment?.payer?.full_name}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => { setInstallmentAction(null); setSelectedInstallment(null); refetch(); }}
      />
    );
  }

  // ── Sub-view: detalhe da parcela ──
  if (selectedInstallment !== null) {
    return (
      <InstallmentDetailScreen
        installment={selectedInstallment}
        onBack={() => setSelectedInstallment(null)}
        onAction={(action) => setInstallmentAction(action)}
      />
    );
  }

  // ── Main view ──
  return (
    <div className="flex h-full flex-col bg-[color:var(--bg-elevated)] overflow-hidden">

      {loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[color:var(--accent-brass)]">
          <Loader2 size={36} className="animate-spin" />
          <p className="text-xs font-bold uppercase tracking-widest text-[color:var(--text-muted)]">Carregando contrato...</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <AlertCircle size={36} className="text-[color:var(--accent-danger)]" />
          <p className="text-sm text-[color:var(--text-secondary)]">{error}</p>
          <button onClick={refetch} className="flex items-center gap-2 rounded-full bg-[color:var(--bg-soft)] px-4 py-2 text-xs font-bold text-[color:var(--text-primary)] hover:bg-[color:var(--bg-strong)] transition-colors">
            <RefreshCw size={13} /> Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* ── Header ── */}
          <div className="shrink-0 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-base)] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {statusBadge(data.investment.status)}
                  {data.parent && (
                    <span className="chip chip-pending">
                      <GitBranch size={10} /> Renovação de #{data.parent.id}
                    </span>
                  )}
                </div>
                <h2 className="truncate font-display text-2xl font-black leading-none text-[color:var(--text-primary)]">
                  {data.investment.asset_name}
                </h2>
                <p className="mt-1 text-xs text-[color:var(--text-faint)]">
                  ID #{data.investment.id} · Criado em {fmtDate(data.investment.created_at?.split('T')[0])}
                </p>
              </div>
              <button onClick={onBack} className="shrink-0 rounded-full p-2.5 text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--bg-soft)] hover:text-[color:var(--text-primary)]">
                <ArrowLeft size={20} />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 text-sm">
              <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">Investidor</p>
                <p className="font-semibold text-[color:var(--text-primary)]">{data.investment.investor?.full_name ?? '—'}</p>
              </div>
              <ArrowRight size={14} className="text-[color:var(--text-faint)] shrink-0" />
              <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">Devedor</p>
                <p className="font-semibold text-[color:var(--text-primary)]">{data.investment.payer?.full_name ?? '—'}</p>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex justify-between text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">
                <span>{data.metrics.parcelasPagas}/{data.metrics.parcelasTotal} parcelas pagas</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--bg-strong)]">
                <div className="h-full rounded-full bg-[color:var(--accent-positive)] transition-all duration-700" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {onRenew && (
                <button onClick={() => onRenew(data.investment)}
                  className="flex items-center gap-2 rounded-full bg-[rgba(202,176,122,0.12)] px-4 py-2 text-[11px] font-extrabold uppercase tracking-widest text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.20)] transition-all hover:bg-[rgba(202,176,122,0.20)]">
                  <RotateCcw size={13} /> Renovar Contrato
                </button>
              )}
            </div>
          </div>

          {/* ── Body ── */}
          <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-6 space-y-6">

            {/* Resumo Financeiro */}
            <section>
              <p className="section-kicker mb-3">Resumo Financeiro</p>

              {/* 4 métricas principais */}
              <div className="grid grid-cols-2 gap-3">

                {/* Já Recebido */}
                <div className="panel-card rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[rgba(52,211,153,0.14)]">
                      <Wallet size={13} className="text-[color:var(--accent-positive)]" />
                    </div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[color:var(--text-faint)]">Já Recebido</p>
                  </div>
                  <p className="text-xl font-black tabular-nums leading-none text-[color:var(--accent-positive)]">{fmt(totalPago)}</p>
                  <p className="mt-1.5 text-[10px] text-[color:var(--text-faint)]">
                    {data.metrics.parcelasPagas} parcela{data.metrics.parcelasPagas !== 1 ? 's' : ''} quitada{data.metrics.parcelasPagas !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* Ainda Falta */}
                <div className="panel-card rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[rgba(148,180,255,0.14)]">
                      <CircleDollarSign size={13} className="text-[color:var(--accent-steel)]" />
                    </div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[color:var(--text-faint)]">Ainda Falta</p>
                  </div>
                  <p className={`text-xl font-black tabular-nums leading-none ${totalRestante > 0 ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--accent-positive)]'}`}>
                    {fmt(totalRestante)}
                  </p>
                  <p className="mt-1.5 text-[10px] text-[color:var(--text-faint)]">
                    {data.metrics.parcelasPendentes + data.metrics.parcelasAtrasadas} em aberto
                  </p>
                </div>

                {/* Lucro (juros) */}
                <div className="panel-card rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[rgba(202,176,122,0.14)]">
                      <TrendingUp size={13} className="text-[color:var(--accent-brass)]" />
                    </div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[color:var(--text-faint)]">Lucro Realizado</p>
                  </div>
                  <p className="text-xl font-black tabular-nums leading-none text-[color:var(--accent-brass)]">{fmt(data.metrics.jurosPagos)}</p>
                  <p className="mt-1.5 text-[10px] text-[color:var(--text-faint)]">
                    + {fmt(data.metrics.jurosAReceber)} projetado
                  </p>
                </div>

                {/* Atraso */}
                <div className={`panel-card rounded-2xl p-4 ${
                  data.metrics.parcelasAtrasadas > 0
                    ? 'ring-1 ring-[color:var(--accent-danger)]/30 bg-[rgba(198,126,105,0.04)]'
                    : ''
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${
                      data.metrics.parcelasAtrasadas > 0 ? 'bg-[rgba(198,126,105,0.18)]' : 'bg-[rgba(52,211,153,0.12)]'
                    }`}>
                      {data.metrics.parcelasAtrasadas > 0
                        ? <Flame size={13} className="text-[color:var(--accent-danger)]" />
                        : <BadgeCheck size={13} className="text-[color:var(--accent-positive)]" />
                      }
                    </div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[color:var(--text-faint)]">Atraso</p>
                  </div>
                  {data.metrics.parcelasAtrasadas > 0 ? (
                    <>
                      <p className="text-xl font-black tabular-nums leading-none text-[color:var(--accent-danger)]">
                        {data.metrics.parcelasAtrasadas} parc.
                      </p>
                      <p className="mt-1.5 text-[10px] font-semibold text-[color:var(--accent-danger)]">
                        {data.metrics.fineAcumulada > 0 ? `${fmt(data.metrics.fineAcumulada)} em multas` : 'sem multas ainda'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xl font-black leading-none text-[color:var(--accent-positive)]">Sem atraso</p>
                      <p className="mt-1.5 text-[10px] text-[color:var(--text-faint)]">Contrato em dia ✓</p>
                    </>
                  )}
                </div>
              </div>

              {/* Linha secundária: condições do contrato */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: 'Principal',  value: fmt(data.investment.amount_invested) },
                  { label: 'Taxa',       value: `${data.investment.interest_rate}% a.m.` },
                  { label: 'Parcela',    value: fmt(data.investment.installment_value) },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-3 py-3 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">{label}</p>
                    <p className="mt-1 text-sm font-extrabold text-[color:var(--text-primary)]">{value}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Parcelas */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="section-kicker">Parcelas</p>
                <div className="flex gap-2 text-[10px] font-bold">
                  <span className="chip chip-paid">{data.metrics.parcelasPagas} pagas</span>
                  {data.metrics.parcelasAtrasadas > 0 && <span className="chip chip-late">{data.metrics.parcelasAtrasadas} atrasadas</span>}
                  {data.metrics.parcelasPendentes > 0 && <span className="chip chip-pending">{data.metrics.parcelasPendentes} pendentes</span>}
                </div>
              </div>
              <p className="text-[10px] text-[color:var(--text-faint)] mb-3">Toque em uma parcela para ver detalhes e ações</p>

              {data.installments.length === 0 ? (
                <div className={`${panelCard} flex items-center justify-center py-10`}>
                  <p className="text-xs font-bold uppercase tracking-widest text-[color:var(--text-faint)]">Nenhuma parcela encontrada</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.installments.map((i) => {
                    const multa     = (Number(i.fine_amount) || 0) + (Number(i.interest_delay_amount) || 0);
                    const isLate    = i.status === 'late';
                    const isPaid    = i.status === 'paid';
                    const isPartial = i.status === 'partial';
                    return (
                      <button
                        key={i.id}
                        onClick={() => setSelectedInstallment(i)}
                        className={`w-full panel-card rounded-2xl p-4 text-left transition-all active:scale-[0.98] hover:ring-1 hover:ring-[color:var(--border-strong)] ${
                          isLate ? 'ring-1 ring-[color:var(--accent-danger)]/30 bg-[rgba(198,126,105,0.04)]' :
                          isPaid ? 'opacity-70' : ''
                        }`}
                      >
                        {/* Número + status + seta */}
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">
                            Parcela {i.number}
                          </span>
                          <div className="flex items-center gap-2">
                            {installmentStatusBadge(i.status)}
                            <ChevronRight size={14} className="text-[color:var(--text-faint)]" />
                          </div>
                        </div>

                        {/* Vencimento ↔ Valor */}
                        <div className="flex items-end justify-between mb-3">
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-1">Vencimento</p>
                            <p className={`text-lg font-black leading-none tabular-nums ${isLate ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-primary)]'}`}>
                              {fmtDate(i.due_date)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-1">
                              {isPaid ? 'Pago' : isPartial ? 'Pago Parcial' : 'Total Devido'}
                            </p>
                            <p className={`text-lg font-black leading-none tabular-nums ${
                              isPaid ? 'text-[color:var(--accent-positive)]' :
                              isPartial ? 'text-[color:var(--accent-brass)]' :
                              isLate ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-primary)]'
                            }`}>
                              {isPaid || isPartial ? fmt(i.amount_paid) : fmt(i.amount_total)}
                            </p>
                          </div>
                        </div>

                        {/* Detalhes: Principal / Juros / Multa ou Pago em */}
                        <div className="grid grid-cols-3 gap-2 border-t border-[color:var(--border-subtle)] pt-3">
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-0.5">Principal</p>
                            <p className="text-xs font-semibold text-[color:var(--text-secondary)] tabular-nums">{fmt(i.amount_principal)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-0.5">Juros</p>
                            <p className="text-xs font-semibold text-[color:var(--accent-brass)] tabular-nums">{fmt(i.amount_interest)}</p>
                          </div>
                          {multa > 0 ? (
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-0.5">Multa</p>
                              <p className="text-xs font-bold text-[color:var(--accent-danger)] tabular-nums">+{fmt(multa)}</p>
                            </div>
                          ) : isPaid && i.paid_at ? (
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-0.5">Pago em</p>
                              <p className="text-xs font-semibold text-[color:var(--text-faint)] tabular-nums">{fmtDate(i.paid_at.split('T')[0])}</p>
                            </div>
                          ) : (
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-0.5">Original</p>
                              <p className="text-xs font-semibold text-[color:var(--text-muted)] tabular-nums">{fmt(i.amount_total)}</p>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Renegociações */}
            <section>
              <p className="section-kicker mb-3 flex items-center gap-2">
                <History size={13} /> Renegociações ({data.renegotiations.length})
              </p>
              {data.renegotiations.length === 0 ? (
                <div className={`${panelCard} flex items-center gap-3 px-5 py-4`}>
                  <CheckCircle2 size={16} className="text-[color:var(--accent-positive)] shrink-0" />
                  <p className="text-xs text-[color:var(--text-faint)]">Nenhuma renegociação registrada neste contrato.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.renegotiations.map((r) => (
                    <div key={r.id} className={`${panelCard} px-4 py-3`}>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-xs font-bold text-[color:var(--text-primary)]">{fmtDatetime(r.renegotiated_at)}</p>
                      </div>
                      <div className="flex flex-wrap gap-3 text-[11px]">
                        {r.old_installment_value != null && r.new_installment_value != null && (
                          <span className="text-[color:var(--text-secondary)]">
                            Parcela: <span className="line-through text-[color:var(--text-faint)]">{fmt(r.old_installment_value)}</span>
                            {' → '}<span className="font-bold text-[color:var(--accent-brass)]">{fmt(r.new_installment_value)}</span>
                          </span>
                        )}
                        {r.old_total_installments != null && r.new_total_installments != null && (
                          <span className="text-[color:var(--text-secondary)]">
                            Prazo: <span className="line-through text-[color:var(--text-faint)]">{r.old_total_installments}x</span>
                            {' → '}<span className="font-bold text-[color:var(--accent-brass)]">{r.new_total_installments}x</span>
                          </span>
                        )}
                        {r.old_due_date != null && r.new_due_date != null && (
                          <span className="text-[color:var(--text-secondary)]">
                            Vencimento: <span className="line-through text-[color:var(--text-faint)]">{fmtDate(r.old_due_date)}</span>
                            {' → '}<span className="font-bold text-[color:var(--accent-brass)]">{fmtDate(r.new_due_date)}</span>
                          </span>
                        )}
                      </div>
                      {r.reason && <p className="mt-1.5 text-[11px] italic text-[color:var(--text-faint)]">"{r.reason}"</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Cadeia de renovações */}
            {(data.renewals.length > 0 || data.parent) && (
              <section>
                <p className="section-kicker mb-3 flex items-center gap-2">
                  <GitBranch size={13} /> Cadeia de Renovações
                </p>
                <div className="space-y-2">
                  {data.parent && (
                    <div className={`${panelCard} flex items-center gap-3 px-4 py-3`}>
                      <ChevronRight size={14} className="shrink-0 text-[color:var(--text-faint)]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">Contrato original</p>
                        <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">#{data.parent.id} — {data.parent.asset_name}</p>
                      </div>
                      {statusBadge(data.parent.status)}
                    </div>
                  )}
                  {data.renewals.map((r) => (
                    <div key={r.id} className={`${panelCard} flex items-center gap-3 px-4 py-3`}>
                      <RotateCcw size={14} className="shrink-0 text-[color:var(--accent-brass)]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">Renovação</p>
                        <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">#{r.id} — {r.asset_name}</p>
                        <p className="text-[10px] text-[color:var(--text-faint)]">Criado em {fmtDate(r.created_at?.split('T')[0])}</p>
                      </div>
                      {statusBadge(r.status)}
                    </div>
                  ))}
                </div>
              </section>
            )}

          </div>
        </div>
      )}
    </div>
  );
};

export default ContractDetail;
