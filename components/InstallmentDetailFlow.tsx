/**
 * Telas compartilhadas de detalhe/ação de parcela.
 * Usadas em ContractDetail e CollectionDashboard.
 */
import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Loader2,
  DollarSign, Calendar, Percent, RefreshCw, Save, XCircle,
  Pencil, FileText,
} from 'lucide-react';
import { LoanInstallment, Tenant } from '../types';
import { getSupabase, parseSupabaseError } from '../services/supabase';
import ReceiptTemplate from './ReceiptTemplate';

// ── Types ─────────────────────────────────────────────────────────────────────

export type InstallmentAction =
  | null
  | { type: 'pay';      installment: LoanInstallment }
  | { type: 'unpay';    installment: LoanInstallment }
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
    partial: { label: 'Parcial',  cls: 'chip chip-pending' },
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
  const isPaid    = installment.status === 'paid';
  const isLate    = installment.status === 'late';
  const isPartial = installment.status === 'partial';
  const multa     = normalizeNum(installment.fine_amount) + normalizeNum(installment.interest_delay_amount);
  const outstanding = calcOutstanding(installment);

  const debtorName = (installment as any).investment?.payer?.full_name
    || (installment as any).investment?.payer_name
    || 'Cliente';

  const contractName = (installment as any).investment?.asset_name
    || (installment as any).contract_name
    || 'Contrato';

  return (
    <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-5 py-5 shrink-0">
        <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">
            {contractName} · Parcela {installment.number}
          </p>
          <h3 className="text-xl font-black text-[color:var(--text-primary)] uppercase tracking-tighter leading-none mt-0.5 truncate">
            {debtorName}
          </h3>
        </div>
        {installmentStatusBadge(installment.status)}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-5 space-y-4">

        {/* Resumo */}
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
            {isPaid || isPartial ? fmtMoney(normalizeNum(installment.amount_paid)) : fmtMoney(outstanding)}
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
              <p className="text-sm font-bold tabular-nums text-[color:var(--text-primary)]">{fmtMoney(normalizeNum(installment.amount_total))}</p>
            </div>
            <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-1">Principal</p>
              <p className="text-sm font-bold tabular-nums text-[color:var(--text-secondary)]">{fmtMoney(normalizeNum(installment.amount_principal))}</p>
            </div>
            <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--text-faint)] mb-1">Juros</p>
              <p className="text-sm font-bold tabular-nums text-[color:var(--accent-brass)]">{fmtMoney(normalizeNum(installment.amount_interest))}</p>
            </div>
            {multa > 0 && (
              <div className="col-span-2 rounded-xl bg-[rgba(198,126,105,0.08)] border border-[rgba(198,126,105,0.2)] px-3 py-2.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--accent-danger)] mb-1">Multa / Juros de Atraso</p>
                <p className="text-sm font-bold tabular-nums text-[color:var(--accent-danger)]">+{fmtMoney(multa)}</p>
              </div>
            )}
            {isPaid && installment.paid_at && (
              <div className="col-span-2 rounded-xl bg-[rgba(52,211,153,0.06)] border border-[rgba(52,211,153,0.15)] px-3 py-2.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--accent-positive)] mb-1">Pago em</p>
                <p className="text-sm font-bold tabular-nums text-[color:var(--accent-positive)]">{fmtDatetime(installment.paid_at)}</p>
              </div>
            )}
            {normalizeNum((installment as any).interest_payments_total) > 0 && (
              <div className="col-span-2 rounded-xl bg-[rgba(202,176,122,0.08)] border border-[rgba(202,176,122,0.14)] px-3 py-2.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-[color:var(--accent-brass)] mb-1">Juros já cobrados</p>
                <p className="text-sm font-bold tabular-nums text-[color:var(--accent-brass)]">{fmtMoney(normalizeNum((installment as any).interest_payments_total))}</p>
              </div>
            )}
          </div>
        </div>

        {/* Ações */}
        <div className="space-y-2">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)] px-1 mb-3">Ações</p>

          {!isPaid && (
            <button onClick={() => onAction({ type: 'pay', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[rgba(52,211,153,0.10)] px-4 py-4 text-left ring-1 ring-[rgba(52,211,153,0.2)] active:scale-[0.98] transition-all">
              <CheckCircle2 size={22} className="text-[color:var(--accent-positive)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--accent-positive)] uppercase tracking-wide">Dar Baixa</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Registrar recebimento total ou parcial</p>
              </div>
            </button>
          )}

          {!isPaid && (
            <button onClick={() => onAction({ type: 'refinance', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[rgba(148,180,255,0.08)] px-4 py-4 text-left ring-1 ring-[rgba(148,180,255,0.18)] active:scale-[0.98] transition-all">
              <RefreshCw size={22} className="text-[color:var(--accent-steel)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--accent-steel)] uppercase tracking-wide">Renegociar</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Re-agendar com entrada parcial</p>
              </div>
            </button>
          )}

          {!isPaid && (
            <button onClick={() => onAction({ type: 'interest', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[rgba(202,176,122,0.10)] px-4 py-4 text-left ring-1 ring-[rgba(202,176,122,0.20)] active:scale-[0.98] transition-all">
              <Percent size={22} className="text-[color:var(--accent-brass)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--accent-brass)] uppercase tracking-wide">Pagar Só Juros</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Principal permanece em aberto</p>
              </div>
            </button>
          )}

          {isPaid && (
            <button onClick={() => onAction({ type: 'unpay', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[rgba(198,126,105,0.08)] px-4 py-4 text-left ring-1 ring-[rgba(198,126,105,0.22)] active:scale-[0.98] transition-all">
              <XCircle size={22} className="text-[color:var(--accent-danger)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--accent-danger)] uppercase tracking-wide">Marcar como Não Pago</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Reverter pagamento — volta para Pendente</p>
              </div>
            </button>
          )}

          {isPaid && (
            <button onClick={() => onAction({ type: 'pay', installment })}
              className="w-full flex items-center gap-4 rounded-2xl bg-[color:var(--bg-soft)] px-4 py-4 text-left ring-1 ring-[color:var(--border-subtle)] active:scale-[0.98] transition-all">
              <FileText size={22} className="text-[color:var(--text-muted)] shrink-0" />
              <div>
                <p className="text-sm font-extrabold text-[color:var(--text-secondary)] uppercase tracking-wide">Ver Comprovante</p>
                <p className="text-[10px] text-[color:var(--text-faint)] mt-0.5">Gerar recibo de pagamento</p>
              </div>
            </button>
          )}

          <button onClick={() => onAction({ type: 'edit', installment })}
            className="w-full flex items-center gap-4 rounded-2xl bg-[color:var(--bg-soft)] px-4 py-4 text-left ring-1 ring-[color:var(--border-subtle)] active:scale-[0.98] transition-all">
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

  useEffect(() => {
    setError(null); setIsReceiptMode(false);
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
    pay: 'Dar Baixa', unpay: 'Reverter Pagamento',
    refinance: 'Renegociar Parcela', edit: 'Editar Parcela', interest: 'Pagar Só Juros',
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) { setError('O valor deve ser maior que zero.'); return; }
    setLoading(true); setError(null);
    const supabase = getSupabase(); if (!supabase) return;
    try {
      const { error: err } = await supabase.rpc('pay_installment', { p_installment_id: installment.id, p_amount_paid: val });
      if (err) throw err;
      installment.amount_paid = val;
      installment.paid_at = new Date().toISOString();
      onSuccess(); setIsReceiptMode(true);
    } catch (e: any) { setError(e.message || 'Erro ao processar.'); }
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
          <h2 className="font-display text-lg font-black text-[color:var(--text-primary)]">Comprovante</h2>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ background: "#0a0a0f" }}>
          <ReceiptTemplate installment={installment} tenant={tenant}
            payerName={payerName || (installment as any).investment?.payer?.full_name} onClose={onBack} />
        </div>
      </div>
    );
  }
  if (isReceiptMode) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-4">
          <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors"><ArrowLeft size={20} /></button>
          <h2 className="font-display text-lg font-black text-[color:var(--text-primary)]">Pagamento Confirmado</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <CheckCircle2 size={48} className="text-[color:var(--accent-positive)]" />
          <p className="text-sm text-[color:var(--text-secondary)] text-center">Pagamento registrado com sucesso.</p>
          <button onClick={onBack} className="px-6 py-3 rounded-2xl bg-[color:var(--bg-soft)] text-xs font-bold uppercase text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)]">Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">
      <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-4 shrink-0">
        <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors"><ArrowLeft size={20} /></button>
        <h2 className="font-display text-lg font-black text-[color:var(--text-primary)]">{titles[action.type]}</h2>
      </div>

      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="panel-card rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-widest text-[color:var(--text-faint)]">
            Parcela {installment.number} · Venc. {fmtDate(installment.due_date)}
          </p>
          <p className="text-2xl font-extrabold text-[color:var(--text-primary)] mt-1">{fmtMoney(outstanding)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {action.type === 'pay' && (
          <form onSubmit={handlePay} className="space-y-4 pt-2">
            <div>
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">Valor Recebido (R$)</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-[color:var(--accent-positive)]" />
                <input type="number" step="0.01" inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)}
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
              className="w-full rounded-xl bg-[rgba(198,126,105,0.12)] py-4 text-xs font-extrabold uppercase tracking-widest text-[color:var(--accent-danger)] ring-1 ring-[rgba(198,126,105,0.3)] active:scale-95 transition-all flex items-center justify-center gap-2">
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
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">Valor de Entrada (Pago Hoje)</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-[color:var(--accent-steel)]" />
                <input type="number" step="0.01" inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)}
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

        {action.type === 'edit' && (
          <form onSubmit={handleEdit} className="space-y-4 pt-2">
            <div className="p-3 rounded-xl bg-[rgba(148,180,255,0.08)] border border-[rgba(148,180,255,0.18)] flex gap-3">
              <AlertTriangle className="text-[color:var(--accent-steel)] shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
                Altera o valor e vencimento diretamente. Use para corrigir erros de cadastro.
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
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">Novo Valor Total</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-4 top-4 text-[color:var(--text-muted)]" />
                <input type="number" step="0.01" inputMode="decimal" required value={totalAmount} onChange={e => setTotalAmount(e.target.value)}
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

        {action.type === 'interest' && (
          <form onSubmit={handleInterest} className="space-y-4 pt-2">
            <div className="panel-card rounded-2xl p-4">
              <p className="text-[10px] text-[color:var(--accent-brass)]/80 font-black uppercase tracking-widest mb-1">Parcela Original</p>
              <p className="text-2xl font-black text-[color:var(--text-primary)]">{fmtMoney(outstanding)}</p>
              <p className="text-[10px] text-[color:var(--accent-brass)]/70 mt-1 font-bold uppercase">Ainda em aberto</p>
            </div>
            <div>
              <label className="block text-[10px] font-black text-[color:var(--text-faint)] uppercase tracking-widest mb-2">Valor dos Juros (R$)</label>
              <div className="relative">
                <Percent size={16} className="absolute left-4 top-4 text-[color:var(--accent-brass)]" />
                <input type="number" step="0.01" inputMode="decimal" required autoFocus placeholder="0,00"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  className={`${inputCls} pl-10 focus:ring-[color:var(--accent-brass)]`} />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[rgba(202,176,122,0.08)] border border-[rgba(202,176,122,0.18)] flex gap-2.5 items-start">
              <AlertTriangle size={14} className="text-[color:var(--accent-brass)] shrink-0 mt-0.5" />
              <p className="text-[10px] text-[color:var(--text-secondary)] leading-relaxed">
                O valor da parcela <strong>não será descontado</strong>. Ela continua em aberto.
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
