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
  surplus_applied:  { icon: '▸', label: 'Surplus aplicado',    color: 'var(--accent-caution)' },
  surplus_received: { icon: '◆', label: 'Recebido via surplus', color: 'var(--accent-purple)' },
  deferred:         { icon: '⇢', label: 'Postergado',           color: 'var(--accent-caution)' },
  missed:           { icon: '⚠', label: 'Falta registrada',    color: 'var(--accent-warning)' },
  reversal:         { icon: '✕', label: 'Estorno',              color: 'var(--accent-danger)' },
};

const InstallmentHistory: React.FC<InstallmentHistoryProps> = ({
  investment,
  debtorName,
  onBack,
  onInstallmentClick,
}) => {
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [viewMode, setViewMode] = useState<'receipts' | 'installments'>('receipts');
  const [expandedReceipts, setExpandedReceipts] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchTransactions = async () => {
      const supabase = getSupabase();
      if (!supabase) return;
      const { data } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('investment_id', investment.id)
        .order('created_at', { ascending: false });
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
  const receiptGroups = transactions.reduce<Record<string, PaymentTransaction[]>>((acc, tx) => {
    const key = tx.receipt_id ?? `legacy_${tx.investment_id}_${tx.created_at.slice(0, 16)}`;
    (acc[key] ??= []).push(tx);
    return acc;
  }, {});

  const receipts: PaymentReceipt[] = Object.entries(receiptGroups)
    .map(([key, txs]) => {
      const paymentTx = txs.find(t => t.transaction_type === 'payment');
      const isLegacy = !txs[0].receipt_id;
      // Dados com receipt_id: payment record já tem totalPaid (correto)
      // Dados legados: payment record tem só o outstanding da parcela principal;
      // somamos payment + surplus_received para melhor estimativa do total recebido
      const totalReceived = isLegacy
        ? txs.filter(t => t.transaction_type === 'payment' || t.transaction_type === 'surplus_received')
            .reduce((s, t) => s + normalizeNum(t.amount), 0)
        : txs.filter(t => t.transaction_type === 'payment')
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
    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());

  const toggleReceipt = (key: string) => {
    setExpandedReceipts(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // BR-REL-002: omite parcelas fantasmas geradas por mark_installment_missed
  // (amount_total=0, amount_paid=0, status='paid' — foram deferidas para outra parcela)
  const allInstallments: LoanInstallment[] = (investment.loan_installments || [])
    .filter(i => !(Number(i.amount_total) === 0 && Number(i.amount_paid) === 0 && i.status === 'paid'))
    .slice()
    .sort((a, b) => a.number - b.number);

  const contractId = `CT${String(investment.id).slice(-8)}`;
  const photoUrl = (investment as any).payer?.photo_url;

  const paidItems = allInstallments.filter(i => i.status === 'paid');
  const pendingItems = allInstallments.filter(i => i.status === 'pending');
  const overdueItems = allInstallments.filter(i => i.status === 'late' || i.status === 'partial');

  const paidTotal = paidItems.reduce((s, i) => s + normalizeNum(i.amount_paid), 0);
  const pendingTotal = pendingItems.reduce((s, i) => s + calcOutstanding(i), 0);
  const overdueTotal = overdueItems.reduce((s, i) => s + calcOutstanding(i), 0);

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-base)' }}>

      {/* ── Blue Header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3" style={{ background: 'var(--header-blue)' }}>
        <button onClick={onBack} className="p-1 text-white/90 hover:text-white">
          <ArrowLeft size={22} />
        </button>
        <h1 className="flex-1 text-lg font-bold text-white">Histórico do Contrato</h1>
        <button className="p-1.5 text-white/70 hover:text-white">
          <Share2 size={20} />
        </button>
      </div>

      {/* ── Debtor Info ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full overflow-hidden" style={{ background: 'var(--bg-soft)' }}>
          {photoUrl ? (
            <img src={photoUrl} alt={debtorName} className="h-full w-full object-cover" />
          ) : (
            <User size={20} className="text-[color:var(--text-secondary)]" />
          )}
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{debtorName}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Contrato: {contractId}</p>
        </div>
      </div>

      {/* ── View Toggle ──────────────────────────────────────────────────── */}
      <div className="shrink-0 flex gap-1 px-4 py-2" style={{ background: 'var(--bg-soft)', borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setViewMode('receipts')}
          className="flex-1 rounded-full py-1 text-xs font-semibold transition-colors"
          style={{
            background: viewMode === 'receipts' ? 'var(--accent-blue, #1565C0)' : 'transparent',
            color: viewMode === 'receipts' ? '#fff' : 'var(--text-muted)',
          }}
        >
          Por Recebimento
        </button>
        <button
          onClick={() => setViewMode('installments')}
          className="flex-1 rounded-full py-1 text-xs font-semibold transition-colors"
          style={{
            background: viewMode === 'installments' ? 'var(--accent-blue, #1565C0)' : 'transparent',
            color: viewMode === 'installments' ? '#fff' : 'var(--text-muted)',
          }}
        >
          Por Parcela
        </button>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
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
              receipts.map((receipt) => {
                const isExpanded = expandedReceipts.has(receipt.key);
                const uniqueInstallments = [...new Set(receipt.transactions.map(t => t.installment_id))];
                const txCount = receipt.transactions.length;

                return (
                  <div key={receipt.key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {/* Card header */}
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 active:bg-white/10"
                      onClick={() => toggleReceipt(receipt.key)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                            {fmtDate(receipt.received_at)}
                          </span>
                          <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--accent-positive)' }}>
                            {fmtMoney(receipt.total_received)}
                          </span>
                          {receipt.payment_method && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                              style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)' }}>
                              {receipt.payment_method}
                            </span>
                          )}
                          {receipt.is_legacy && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border font-semibold"
                              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-faint)', borderStyle: 'dashed' }}>
                              histórico
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {uniqueInstallments.length === 1
                            ? `1 parcela afetada`
                            : `${uniqueInstallments.length} parcelas afetadas`}
                        </p>
                      </div>
                      <span style={{ color: 'var(--text-faint)' }}>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>
                    </button>

                    {/* Expanded: por parcela afetada (sem terminologia interna) */}
                    {isExpanded && (
                      <div className="px-4 pb-3 space-y-1.5" style={{ background: 'var(--bg-soft)' }}>
                        {(() => {
                          // Agrupa por installment, ignora surplus_applied (roteamento interno)
                          const byInst = receipt.transactions
                            .filter(t => t.transaction_type !== 'surplus_applied')
                            .reduce<Record<string, PaymentTransaction[]>>((acc, tx) => {
                              (acc[tx.installment_id] ??= []).push(tx);
                              return acc;
                            }, {});

                          return Object.entries(byInst).map(([instId, txs]) => {
                            const inst = allInstallments.find(i => i.id === instId);
                            const applied = txs.reduce((s, t) => s + normalizeNum(t.amount), 0);
                            const status = inst?.status;
                            const statusLabel = status === 'paid' ? 'Quitada' : status === 'partial' ? 'Parcial' : status === 'late' ? 'Atrasada' : 'Pendente';
                            const statusColor = status === 'paid' ? 'var(--accent-positive)' : status === 'partial' ? 'var(--accent-steel)' : 'var(--accent-danger)';

                            return (
                              <div key={instId} className="flex items-center gap-2 text-[11px]">
                                <span style={{ color: statusColor }}>●</span>
                                <div className="flex-1 min-w-0">
                                  <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                    Parcela #{inst?.number ?? '?'}
                                  </span>
                                  {inst?.due_date && (
                                    <span className="ml-1" style={{ color: 'var(--text-faint)' }}>
                                      · venc. {fmtDate(inst.due_date)}
                                    </span>
                                  )}
                                </div>
                                <span className="font-bold tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                                  {fmtMoney(applied)}
                                </span>
                                <span className="text-[10px] font-semibold shrink-0 w-14 text-right" style={{ color: statusColor }}>
                                  {statusLabel}
                                </span>
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
            {/* Table header */}
            <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 type-label"
              style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
              <span className="w-8 shrink-0">N°</span>
              <span className="w-[4.5rem] shrink-0">Venc.</span>
              <span className="flex-1 min-w-0">Valor</span>
              <span className="w-14 shrink-0 text-right">Pago</span>
              <span className="w-16 shrink-0 text-right">Status</span>
            </div>

            {/* Table rows */}
            <div>
              {allInstallments.map((inst) => {
                const isPaid = inst.status === 'paid';
                const isPartial = inst.status === 'partial';
                const amountPaid = normalizeNum(inst.amount_paid);

                const statusMap: Record<string, { label: string; color: string }> = {
                  paid:    { label: 'Liquidada', color: 'var(--accent-positive)' },
                  pending: { label: 'Pendente',  color: 'var(--accent-brass)' },
                  late:    { label: 'Atrasada',  color: 'var(--accent-danger)' },
                  partial: { label: 'Parcial',   color: 'var(--accent-steel)' },
                };
                let st = statusMap[inst.status] ?? statusMap.pending;
                const modInfo = getInstallmentModInfo(inst);
                if (modInfo) {
                  const modColorMap: Record<string, string> = {
                    absorbed: 'var(--text-muted)', surplus_zeroed: 'var(--accent-danger)', surplus_paid: 'var(--accent-purple)',
                    surplus_reduced: 'var(--accent-purple)', deferred_target: 'var(--accent-caution)',
                  };
                  st = { label: modInfo.label, color: modColorMap[modInfo.type] || st.color };
                } else if ((inst as any).missed_at && inst.status !== 'paid') {
                  st = { label: 'Falta', color: 'var(--accent-danger)' };
                }

                return (
                  <React.Fragment key={inst.id}>
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-white/5 active:bg-white/10"
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      onClick={() => onInstallmentClick?.(inst)}
                    >
                      <span className="w-8 shrink-0 text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        {inst.number}
                      </span>
                      <span className="w-[4.5rem] shrink-0 text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {fmtDate(inst.due_date)}
                      </span>
                      <span className="flex-1 min-w-0 text-xs font-semibold tabular-nums truncate" style={{ color: 'var(--text-primary)' }}>
                        {fmtMoney(normalizeNum(inst.amount_total))}
                      </span>
                      <span className="w-14 shrink-0 text-xs font-bold tabular-nums text-right" style={{ color: (isPaid || isPartial) ? 'var(--accent-positive)' : 'var(--text-muted)' }}>
                        {(isPaid || isPartial) ? fmtMoney(amountPaid) : '—'}
                      </span>
                      <span className="w-16 shrink-0 text-xs font-bold text-right" style={{ color: st.color }}>
                        {st.label}
                      </span>
                    </button>

                    {((isPaid || isPartial) && inst.paid_at) || (modInfo && (inst as any).notes) || (txByInstallment[inst.id]?.length > 0) ? (
                      <div className="px-4 py-1.5 space-y-1" style={{ background: 'var(--bg-soft)' }}>
                        {(isPaid || isPartial) && inst.paid_at && (() => {
                          const paidDate = inst.paid_at!.includes('T') ? inst.paid_at!.split('T')[0] : inst.paid_at!;
                          const dueDate = inst.due_date?.includes('T') ? inst.due_date.split('T')[0] : inst.due_date;
                          const paidLate = dueDate && paidDate > dueDate;
                          const daysLate = paidLate ? Math.ceil((new Date(paidDate).getTime() - new Date(dueDate).getTime()) / 86400000) : 0;
                          return (
                            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                              Venc: {fmtDate(inst.due_date)} · Pago em: {fmtDate(inst.paid_at)}
                              {(inst as any).payment_method ? ` · ${(inst as any).payment_method}` : ''}
                              {paidLate && (
                                <span style={{ color: 'var(--accent-brass)', marginLeft: 6, fontWeight: 700 }}>
                                  ⚠ {daysLate}d atraso
                                </span>
                              )}
                            </p>
                          );
                        })()}
                        {(inst as any).notes && (
                          <p className="text-[10px] italic mt-0.5" style={{ color: modInfo ? modInfo.chipClass.includes('anomaly') ? 'var(--accent-danger)' : 'var(--accent-purple)' : 'var(--text-faint)' }}>
                            {(inst as any).notes}
                          </p>
                        )}
                        {/* Transações detalhadas */}
                        {txByInstallment[inst.id]?.map(tx => (
                          <div key={tx.id} className="flex items-start gap-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            <span style={{ color: TX_META[tx.transaction_type]?.color ?? 'var(--text-muted)' }}>
                              {TX_META[tx.transaction_type]?.icon ?? '●'}
                            </span>
                            <span className="flex-1">
                              {fmtDatetime(tx.created_at)} — {tx.notes || `${tx.transaction_type}: ${fmtMoney(tx.amount)}`}
                            </span>
                            <span className="font-bold tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                              {fmtMoney(tx.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {(inst as any).missed_at && (
                      <div className="px-4 py-1" style={{ background: 'rgba(198,126,105,0.07)', borderBottom: '1px solid var(--border-subtle)' }}>
                        <p className="text-[10px] font-semibold" style={{ color: 'var(--accent-danger)' }}>
                          ⚠ Falta registrada em {fmtDate((inst as any).missed_at)}
                        </p>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Footer Summary ──────────────────────────────────────────────── */}
      <div className="shrink-0 grid grid-cols-3 gap-2 px-4 py-3" style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600 shrink-0" />
          <div>
            <p className="type-label text-green-600">Pagas</p>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {paidItems.length} parcelas,
            </p>
            <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {fmtMoney(paidTotal)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-orange-500 shrink-0" />
          <div>
            <p className="type-label text-orange-500">Pendentes</p>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {pendingItems.length} parcelas,
            </p>
            <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {fmtMoney(pendingTotal)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <div>
            <p className="type-label text-red-500">A Receber</p>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {overdueItems.length} parcelas,
            </p>
            <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {fmtMoney(overdueTotal)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstallmentHistory;
