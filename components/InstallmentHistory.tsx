import React, { useState, useEffect } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle, ChevronDown, ChevronRight, Clock, Share2, User } from 'lucide-react';
import { Investment, LoanInstallment, PaymentTransaction } from '../types';
import { fmtMoney, fmtDate, fmtDatetime, calcOutstanding, normalizeNum, getInstallmentModInfo } from './InstallmentDetailFlow';
import { getSupabase } from '../services/supabase';

interface InstallmentHistoryProps {
  investment: Investment;
  debtorName: string;
  onBack: () => void;
  onInstallmentClick?: (inst: LoanInstallment) => void;
}

// ── Tipo local para agrupamento por recebimento ──────────────────────────────
interface PaymentReceipt {
  key: string;
  receipt_id: string | null;
  received_at: string;
  total_received: number;
  payment_method?: string;
  transactions: PaymentTransaction[];
  is_legacy: boolean;
}

// ── Mapeamento de tipos de transação → exibição PT-BR ────────────────────────
const TX_META: Record<string, { icon: string; label: string; color: string }> = {
  payment:          { icon: '●', label: 'Pagamento',           color: 'var(--accent-positive)' },
  avulso:           { icon: '◇', label: 'Pagamento avulso',    color: 'var(--accent-brass)' },
  surplus_applied:  { icon: '▸', label: 'Surplus aplicado',    color: 'var(--accent-caution)' },
  surplus_received: { icon: '◆', label: 'Recebido via surplus', color: 'var(--accent-purple)' },
  deferred:         { icon: '⇢', label: 'Postergado',           color: 'var(--accent-caution)' },
  missed:           { icon: '⚠', label: 'Falta registrada',    color: 'var(--accent-warning)' },
  reversal:         { icon: '✕', label: 'Estorno',              color: 'var(--accent-danger)' },
  late_auto:        { icon: '▲', label: 'Atraso detectado',    color: 'var(--accent-brass)' },
};

// ── Tipos de transação visíveis ao usuário (excluir eventos internos) ────────
const TX_VISIBLE = new Set(['payment', 'avulso', 'reversal', 'missed']);

// ── Badge de status de parcela ───────────────────────────────────────────────
const StatusBadge: React.FC<{ label: string; color: string; bg: string }> = ({ label, color, bg }) => (
  <span
    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0"
    style={{ background: bg, color }}
  >
    {label}
  </span>
);

const InstallmentHistory: React.FC<InstallmentHistoryProps> = ({
  investment,
  debtorName,
  onBack,
  onInstallmentClick,
}) => {
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [viewMode, setViewMode] = useState<'receipts' | 'installments'>('receipts');
  const [expandedReceipts, setExpandedReceipts] = useState<Set<string>>(new Set());
  const [expandedInstallments, setExpandedInstallments] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchTransactions = async () => {
      const supabase = getSupabase();
      if (!supabase) return;
      const { data } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('investment_id', investment.id)
        .order('created_at', { ascending: true });
      if (data) setTransactions(data);
    };
    fetchTransactions();
  }, [investment.id]);

  // ── Agrupamento por installment_id (view "Por Parcela") ─────────────────────
  const txByInstallment = transactions.reduce<Record<string, PaymentTransaction[]>>((acc, tx) => {
    (acc[tx.installment_id] ??= []).push(tx);
    return acc;
  }, {});

  // ── Agrupamento por receipt_id (view "Por Recebimento") ─────────────────────
  // late_auto e missed são eventos administrativos (amount=0), não entram na view "Por Recebimento"
  const receiptGroups = transactions
    .filter(tx => tx.transaction_type !== 'late_auto' && tx.transaction_type !== 'missed')
    .reduce<Record<string, PaymentTransaction[]>>((acc, tx) => {
      const key = tx.receipt_id ?? `legacy_${tx.investment_id}_${tx.created_at.slice(0, 16)}`;
      (acc[key] ??= []).push(tx);
      return acc;
    }, {});

  const receipts: PaymentReceipt[] = (Object.entries(receiptGroups) as [string, PaymentTransaction[]][])
    .map(([key, txs]) => {
      const paymentTx = txs.find(t => t.transaction_type === 'payment');
      const isLegacy = !txs[0].receipt_id;
      const totalReceived = isLegacy
        ? txs.filter(t => t.transaction_type === 'payment' || t.transaction_type === 'surplus_received' || t.transaction_type === 'avulso')
            .reduce((s, t) => s + normalizeNum(t.amount), 0)
        : txs.filter(t => t.transaction_type === 'payment' || t.transaction_type === 'avulso')
            .reduce((s, t) => s + normalizeNum(t.amount), 0);
      return {
        key,
        receipt_id: txs[0].receipt_id ?? null,
        received_at: paymentTx?.created_at ?? txs[0].created_at,
        total_received: totalReceived,
        payment_method: paymentTx?.payment_method,
        transactions: txs,
        is_legacy: isLegacy,
      };
    })
    .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());

  const toggleReceipt = (key: string) => {
    setExpandedReceipts(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleInstallment = (id: string) => {
    setExpandedInstallments(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // BR-REL-002: exibimos todas as parcelas para o histórico operacional
  const allInstallments: LoanInstallment[] = (investment.loan_installments || [])
    .slice()
    .sort((a, b) => a.number - b.number);

  const contractId = `CT${String(investment.id).slice(-8)}`;
  const photoUrl = (investment as any).payer?.photo_url;

  // Parcelas absorvidas por falta (zeradas pelo missed flow) não contam como pagas
  const isMissedAbsorbed = (i: LoanInstallment) =>
    !!(i as any).missed_at && i.status === 'paid' && Number(i.amount_total) === 0;

  const paidItems = allInstallments.filter(i => i.status === 'paid' && !isMissedAbsorbed(i));
  const pendingItems = allInstallments.filter(i => i.status === 'pending');
  const overdueItems = allInstallments.filter(i => i.status === 'late' || i.status === 'partial');
  const missedAbsorbedItems = allInstallments.filter(isMissedAbsorbed);

  const paidTotal = paidItems.reduce((s, i) => s + normalizeNum(i.amount_paid), 0);
  const pendingTotal = pendingItems.reduce((s, i) => s + calcOutstanding(i), 0);
  const overdueTotal = overdueItems.reduce((s, i) => s + calcOutstanding(i), 0);

  const totalInstallments = allInstallments.length;
  const progressPct = totalInstallments > 0 ? Math.round((paidItems.length / totalInstallments) * 100) : 0;

  // ── Badge de status global do contrato ──────────────────────────────────────
  const globalStatusLabel = overdueItems.length > 0
    ? `${overdueItems.length} atrasada${overdueItems.length > 1 ? 's' : ''}`
    : paidItems.length === totalInstallments && totalInstallments > 0
      ? 'Quitado'
      : 'Em dia';
  const globalStatusColor = overdueItems.length > 0 ? '#dc2626' : paidItems.length === totalInstallments && totalInstallments > 0 ? '#16a34a' : '#2563eb';
  const globalStatusBg = overdueItems.length > 0 ? 'rgba(220,38,38,0.1)' : paidItems.length === totalInstallments && totalInstallments > 0 ? 'rgba(22,163,74,0.1)' : 'rgba(37,99,235,0.1)';

  // ── Helper: status badge config por parcela ──────────────────────────────────
  const getStatusBadge = (inst: LoanInstallment): { label: string; color: string; bg: string } => {
    if (isMissedAbsorbed(inst)) return { label: 'Falta', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' };
    const modInfo = getInstallmentModInfo(inst);
    if (modInfo) {
      const modColors: Record<string, { color: string; bg: string }> = {
        absorbed:        { color: 'var(--text-muted)',      bg: 'rgba(0,0,0,0.05)' },
        surplus_zeroed:  { color: '#dc2626',                bg: 'rgba(220,38,38,0.08)' },
        surplus_paid:    { color: '#7c3aed',                bg: 'rgba(124,58,237,0.08)' },
        surplus_reduced: { color: '#7c3aed',                bg: 'rgba(124,58,237,0.08)' },
        deferred_target: { color: '#d97706',                bg: 'rgba(217,119,6,0.1)' },
      };
      const mc = modColors[modInfo.type] ?? { color: 'var(--text-muted)', bg: 'rgba(0,0,0,0.05)' };
      return { label: modInfo.label, ...mc };
    }
    if ((inst as any).missed_at && inst.status !== 'paid') {
      return { label: 'Falta', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' };
    }
    const map: Record<string, { label: string; color: string; bg: string }> = {
      paid:    { label: 'Paga',     color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
      pending: { label: 'Pendente', color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
      late:    { label: 'Atrasada', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
      partial: { label: 'Parcial',  color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
    };
    return map[inst.status] ?? map.pending;
  };

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-base)' }}>

      {/* ── Cabeçalho Azul ─────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3" style={{ background: 'var(--header-blue)' }}>
        <button onClick={onBack} className="p-1 text-white/90 hover:text-white">
          <ArrowLeft size={22} />
        </button>
        <h1 className="flex-1 text-lg font-bold text-white">Histórico do Contrato</h1>
        <button className="p-1.5 text-white/70 hover:text-white">
          <Share2 size={20} />
        </button>
      </div>

      {/* ── Info do Devedor ─────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3"
        style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full overflow-hidden"
          style={{ background: 'var(--bg-soft)' }}>
          {photoUrl ? (
            <img src={photoUrl} alt={debtorName} className="h-full w-full object-cover" />
          ) : (
            <User size={20} className="text-[color:var(--text-secondary)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{debtorName}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Contrato: {contractId}</p>
            <span
              className="text-[11px] font-semibold rounded-full px-2 py-0.5"
              style={{ background: globalStatusBg, color: globalStatusColor }}
            >
              {globalStatusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* ── Hero Card de Progresso ─────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-4"
        style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
        {/* Barra de progresso */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 rounded-full overflow-hidden" style={{ height: 8, background: 'var(--bg-soft)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progressPct}%`, background: overdueItems.length > 0 ? '#f59e0b' : '#16a34a' }}
            />
          </div>
          <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {paidItems.length}/{totalInstallments}
          </span>
          <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>parcelas pagas</span>
        </div>

        {/* 3 métricas */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.15)' }}>
            <div className="flex items-center gap-1 mb-1">
              <CheckCircle size={12} style={{ color: '#16a34a' }} />
              <span className="text-[11px] font-semibold" style={{ color: '#16a34a' }}>Pagas</span>
            </div>
            <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtMoney(paidTotal)}</p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{paidItems.length} parcela{paidItems.length !== 1 ? 's' : ''}</p>
          </div>

          <div className="rounded-lg p-2.5" style={{ background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.15)' }}>
            <div className="flex items-center gap-1 mb-1">
              <Clock size={12} style={{ color: '#d97706' }} />
              <span className="text-[11px] font-semibold" style={{ color: '#d97706' }}>Pendentes</span>
            </div>
            <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtMoney(pendingTotal)}</p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{pendingItems.length} parcela{pendingItems.length !== 1 ? 's' : ''}</p>
          </div>

          <div className="rounded-lg p-2.5" style={{ background: 'rgba(220,38,38,0.06)', border: `1px solid ${overdueItems.length > 0 ? 'rgba(220,38,38,0.3)' : 'rgba(220,38,38,0.15)'}` }}>
            <div className="flex items-center gap-1 mb-1">
              <AlertTriangle size={12} style={{ color: '#dc2626' }} />
              <span className="text-[11px] font-semibold" style={{ color: '#dc2626' }}>Atrasadas</span>
            </div>
            <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {overdueItems.length > 0 ? fmtMoney(overdueTotal) : '—'}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{overdueItems.length} parcela{overdueItems.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* ── Toggle de Visualização ────────────────────────────────────────── */}
      <div className="shrink-0 flex gap-1 px-4 py-2"
        style={{ background: 'var(--bg-soft)', borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setViewMode('receipts')}
          className="flex-1 rounded-full py-1.5 text-xs font-semibold transition-colors"
          style={{
            background: viewMode === 'receipts' ? 'var(--accent-blue, #1565C0)' : 'transparent',
            color: viewMode === 'receipts' ? '#fff' : 'var(--text-muted)',
          }}
        >
          Por Recebimento
        </button>
        <button
          onClick={() => setViewMode('installments')}
          className="flex-1 rounded-full py-1.5 text-xs font-semibold transition-colors"
          style={{
            background: viewMode === 'installments' ? 'var(--accent-blue, #1565C0)' : 'transparent',
            color: viewMode === 'installments' ? '#fff' : 'var(--text-muted)',
          }}
        >
          Por Parcela
        </button>
      </div>

      {/* ── Conteúdo ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* ── VIEW: Por Recebimento ─────────────────────────────────────── */}
        {viewMode === 'receipts' && (
          <div>
            {receipts.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16">
                <Clock size={32} style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Nenhum recebimento registrado</p>
                <p className="text-xs text-center px-8" style={{ color: 'var(--text-faint)' }}>
                  Os pagamentos aparecerão aqui quando forem realizados.
                </p>
              </div>
            ) : (
              receipts.map((receipt, idx) => {
                const isExpanded = expandedReceipts.has(receipt.key);
                const uniqueInstallments = [...new Set(receipt.transactions.map(t => t.installment_id))];

                return (
                  <div key={receipt.key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {/* Cabeçalho do card */}
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/5 active:bg-white/10"
                      onClick={() => toggleReceipt(receipt.key)}
                    >
                      {/* Numeração sequencial */}
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                        style={{ background: 'rgba(21,101,192,0.12)', color: 'var(--accent-blue, #1565C0)' }}
                      >
                        {idx + 1}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                            {fmtDate(receipt.received_at)}
                          </span>
                          <span className="text-sm font-bold tabular-nums" style={{ color: '#16a34a' }}>
                            {fmtMoney(receipt.total_received)}
                          </span>
                          {receipt.payment_method && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded font-semibold"
                              style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)' }}>
                              {receipt.payment_method}
                            </span>
                          )}
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {(() => {
                            const isAvulsoReceipt = receipt.transactions.every(t => t.transaction_type === 'avulso');
                            if (isAvulsoReceipt) return 'Pagamento avulso';
                            const realInsts = uniqueInstallments.filter(id => id != null);
                            const hasContractLevel = uniqueInstallments.some(id => id == null);
                            if (realInsts.length === 0 && hasContractLevel) return 'Pagamento geral';
                            if (realInsts.length === 1) return hasContractLevel ? '1 parcela paga + geral' : '1 parcela paga';
                            return `${realInsts.length} parcelas pagas${hasContractLevel ? ' + geral' : ''}`;
                          })()}
                        </p>
                      </div>
                      <span style={{ color: 'var(--text-faint)' }}>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                    </button>

                    {/* Expandido: parcelas afetadas */}
                    {isExpanded && (
                      <div className="px-4 pb-3 space-y-2" style={{ background: 'var(--bg-soft)' }}>
                        {(() => {
                          const byInst = receipt.transactions
                            .filter(t => t.transaction_type !== 'surplus_applied')
                            .reduce<Record<string, PaymentTransaction[]>>((acc, tx) => {
                              const key = tx.transaction_type === 'avulso' ? 'avulso' : (tx.installment_id ?? 'null');
                              (acc[key] ??= []).push(tx);
                              return acc;
                            }, {});

                          return Object.entries(byInst).map(([instId, txs]) => {
                            const isContractLevel = instId === 'null' || instId === 'undefined' || instId === 'avulso';
                            const inst = isContractLevel ? undefined : allInstallments.find(i => i.id === instId);
                            const applied = txs.reduce((s, t) => s + normalizeNum(t.amount), 0);
                            const status = inst?.status;
                            const hasMissed = !!(inst as any)?.missed_at;
                            const badge = isContractLevel
                              ? { label: 'Avulso',  color: '#d97706', bg: 'rgba(217,119,6,0.1)' }
                              : hasMissed           ? { label: 'Falta',    color: '#dc2626', bg: 'rgba(220,38,38,0.08)' }
                              : status === 'paid'    ? { label: 'Paga',    color: '#16a34a', bg: 'rgba(22,163,74,0.1)' }
                              : status === 'partial' ? { label: 'Parcial', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' }
                              : status === 'late'    ? { label: 'Atrasada',color: '#dc2626', bg: 'rgba(220,38,38,0.1)' }
                              :                        { label: 'Pendente',color: '#d97706', bg: 'rgba(217,119,6,0.1)' };

                            return (
                              <div key={instId} className="flex items-center gap-3 rounded-lg px-3 py-2"
                                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                    {isContractLevel ? 'Pagamento avulso' : `Parcela #${inst?.number ?? '?'}`}
                                  </span>
                                  {!isContractLevel && inst?.due_date && (
                                    <span className="ml-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                                      · venc. {fmtDate(inst.due_date)}
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                                  {fmtMoney(applied)}
                                </span>
                                <StatusBadge label={badge.label} color={badge.color} bg={badge.bg} />
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── VIEW: Por Parcela ─────────────────────────────────────────── */}
        {viewMode === 'installments' && (
          <>
            {/* Contador de avulsos — BR-REL-016 (seletor E2E preservado) */}
            {(() => {
              const avulsoCount = transactions.filter(t => t.transaction_type === 'avulso').length;
              if (avulsoCount === 0) return null;
              return (
                <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold"
                  style={{ background: 'rgba(202,176,122,0.08)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--accent-brass)' }}>
                  ◇ {avulsoCount} pagamento{avulsoCount !== 1 ? 's' : ''} avulso{avulsoCount !== 1 ? 's' : ''} — ver abaixo
                </div>
              );
            })()}

            {/* Cabeçalho da tabela */}
            <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide"
              style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
              <span className="w-8 shrink-0">N°</span>
              <span className="w-[4.5rem] shrink-0">Venc.</span>
              <span className="flex-1 min-w-0">Valor</span>
              <span className="w-14 shrink-0 text-right">Pago</span>
              <span className="w-16 shrink-0 text-right">Status</span>
            </div>

            {/* Linhas da tabela */}
            <div>
              {allInstallments.map((inst) => {
                const isPaid = inst.status === 'paid';
                const isPartial = inst.status === 'partial';
                const isLate = inst.status === 'late';
                const amountPaid = normalizeNum(inst.amount_paid);
                const isAbsorbed = isMissedAbsorbed(inst);
                const isExpanded = expandedInstallments.has(inst.id);

                const targetInst = isAbsorbed
                  ? allInstallments.find(i => (i as any).deferred_from_id === inst.id)
                  : undefined;

                const badge = getStatusBadge(inst);

                // Transações visíveis ao usuário (sem eventos internos)
                const visibleTxs = (txByInstallment[inst.id] ?? []).filter(
                  tx => TX_VISIBLE.has(tx.transaction_type)
                );

                const hasDetails = ((isPaid || isPartial) && inst.paid_at) || visibleTxs.length > 0 || !!(inst as any).missed_at;

                return (
                  <div key={inst.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <button
                      className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-white/5 active:bg-white/10"
                      onClick={() => {
                        if (hasDetails) {
                          toggleInstallment(inst.id);
                        } else {
                          onInstallmentClick?.(inst);
                        }
                      }}
                    >
                      {/* N° */}
                      <span className="w-8 shrink-0 text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        {inst.number}
                      </span>

                      {/* Data vencimento */}
                      <span className="w-[4.5rem] shrink-0 text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {fmtDate(inst.due_date)}
                      </span>

                      {/* Valor */}
                      <span className="flex-1 min-w-0 text-xs font-bold tabular-nums truncate"
                        style={{ color: isAbsorbed ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        {isAbsorbed && targetInst
                          ? `→ #${targetInst.number}`
                          : fmtMoney(normalizeNum(inst.amount_total))}
                      </span>

                      {/* Valor pago */}
                      <span className="w-14 shrink-0 text-xs font-bold tabular-nums text-right"
                        style={{ color: (isPaid || isPartial) ? '#16a34a' : 'var(--text-muted)' }}>
                        {(isPaid || isPartial) ? fmtMoney(amountPaid) : '—'}
                      </span>

                      {/* Badge de status */}
                      <div className="w-16 flex justify-end">
                        <StatusBadge label={badge.label} color={badge.color} bg={badge.bg} />
                      </div>
                    </button>

                    {/* Detalhes expandidos (apenas infos relevantes ao usuário) */}
                    {isExpanded && hasDetails && (
                      <div className="px-4 pb-3 space-y-1.5"
                        style={{ background: 'var(--bg-soft)', borderLeft: `3px solid ${badge.color}` }}>

                        {/* Data e método de pagamento */}
                        {(isPaid || isPartial) && inst.paid_at && (() => {
                          const paidDate = inst.paid_at!.includes('T') ? inst.paid_at!.split('T')[0] : inst.paid_at!;
                          const dueDate = inst.due_date?.includes('T') ? inst.due_date.split('T')[0] : inst.due_date;
                          const paidLate = dueDate && paidDate > dueDate;
                          const daysLate = paidLate ? Math.ceil((new Date(paidDate).getTime() - new Date(dueDate).getTime()) / 86400000) : 0;
                          return (
                            <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: 'var(--text-muted)' }}>
                              <span>Pago em: <strong style={{ color: 'var(--text-secondary)' }}>{fmtDate(inst.paid_at)}</strong></span>
                              {(inst as any).payment_method && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                                  {(inst as any).payment_method}
                                </span>
                              )}
                              {paidLate && (
                                <span className="font-bold" style={{ color: '#d97706' }}>
                                  ⚠ {daysLate} dia{daysLate !== 1 ? 's' : ''} de atraso
                                </span>
                              )}
                            </div>
                          );
                        })()}

                        {/* Nota interna (quando relevante) */}
                        {(inst as any).notes && (
                          <p className="text-[11px] italic" style={{ color: 'var(--text-faint)' }}>
                            {(inst as any).notes}
                          </p>
                        )}

                        {/* Falta registrada */}
                        {(inst as any).missed_at && (
                          <div className="flex items-start gap-1.5 text-[11px] font-semibold" style={{ color: '#dc2626' }}>
                            <span>⚠</span>
                            <span>
                              Falta registrada em {fmtDate((inst as any).missed_at)}
                              {isAbsorbed && targetInst && (
                                <span className="font-normal" style={{ color: 'var(--text-muted)' }}>
                                  {' · '}Valor acumulado na parcela #{targetInst.number}
                                </span>
                              )}
                            </span>
                          </div>
                        )}

                        {/* Transações visíveis (payment, reversal, avulso, missed) */}
                        {visibleTxs.map(tx => (
                          <div key={tx.id} className="flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            <span style={{ color: TX_META[tx.transaction_type]?.color ?? 'var(--text-muted)' }}>
                              {TX_META[tx.transaction_type]?.icon ?? '●'}
                            </span>
                            <span className="flex-1">
                              {fmtDatetime(tx.created_at)} — {TX_META[tx.transaction_type]?.label ?? tx.transaction_type}
                            </span>
                            <span className="font-bold tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                              {fmtMoney(tx.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Indicador de falta (linha compacta, quando não expandido) */}
                    {!isExpanded && (inst as any).missed_at && (
                      <div className="px-4 py-1" style={{ background: 'rgba(220,38,38,0.05)', borderLeft: '3px solid #dc2626' }}>
                        <p className="text-[11px] font-semibold" style={{ color: '#dc2626' }}>
                          ⚠ Falta em {fmtDate((inst as any).missed_at)}
                          {isAbsorbed && targetInst && (
                            <span className="font-normal" style={{ color: 'var(--text-muted)' }}>
                              {' · '}Acumulada na parcela #{targetInst.number}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Pagamentos avulsos (BR-REL-016 — seletor E2E preservado) ── */}
            {(() => {
              const avulsoTxs = transactions.filter(t => t.transaction_type === 'avulso');
              if (avulsoTxs.length === 0) return null;
              const DEST_LABEL: Record<string, string> = {
                principal_reduction: 'Abate de principal',
                general_credit:      'Crédito geral',
                penalty_payment:     'Pagamento de encargos',
              };
              const extractDest = (notes: string | null | undefined): string | null => {
                if (!notes) return null;
                const m = notes.match(/destino:(\w+)/);
                return m ? (DEST_LABEL[m[1]] ?? m[1]) : null;
              };
              return (
                <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8 }}>
                  <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ background: 'var(--bg-soft)', color: 'var(--accent-brass)' }}>
                    ◇ Pagamentos avulsos ({avulsoTxs.length})
                  </div>
                  {avulsoTxs.map(tx => {
                    const dest = extractDest(tx.notes);
                    const userNote = tx.notes?.replace(/\s*\|\s*destino:\w+.*$/, '').trim() || null;
                    return (
                      <div key={tx.id} className="flex items-center gap-3 px-4 py-3"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{ color: 'var(--accent-brass)', fontSize: 16 }}>◇</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                              {fmtDate(tx.created_at)}
                            </span>
                            {dest && (
                              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(202,176,122,0.12)', color: 'var(--accent-brass)' }}>
                                {dest}
                              </span>
                            )}
                          </div>
                          {userNote && (
                            <p className="text-[11px] italic mt-0.5" style={{ color: 'var(--text-faint)' }}>
                              {userNote}
                            </p>
                          )}
                        </div>
                        <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: 'var(--accent-brass)' }}>
                          {fmtMoney(tx.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* ── Rodapé: apenas alerta de faltas ───────────────────────────────── */}
      {missedAbsorbedItems.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5"
          style={{ background: 'rgba(220,38,38,0.06)', borderTop: '1px solid rgba(220,38,38,0.2)' }}>
          <AlertTriangle size={14} style={{ color: '#dc2626', flexShrink: 0 }} />
          <p className="text-xs font-semibold" style={{ color: '#dc2626' }}>
            {missedAbsorbedItems.length} parcela{missedAbsorbedItems.length > 1 ? 's' : ''} com falta registrada
          </p>
        </div>
      )}
    </div>
  );
};

export default InstallmentHistory;
