import React from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle, Clock, Share2, User } from 'lucide-react';
import { Investment, LoanInstallment } from '../types';
import { fmtMoney, fmtDate, calcOutstanding, normalizeNum } from './InstallmentDetailFlow';

interface InstallmentHistoryProps {
  investment: Investment;
  debtorName: string;
  onBack: () => void;
  onInstallmentClick?: (inst: LoanInstallment) => void;
}

const InstallmentHistory: React.FC<InstallmentHistoryProps> = ({
  investment,
  debtorName,
  onBack,
  onInstallmentClick,
}) => {
  const allInstallments: LoanInstallment[] = (investment.loan_installments || [])
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
        <h1 className="flex-1 text-lg font-bold text-white">Historico de parcelas</h1>
        <button className="p-1.5 text-white/70 hover:text-white">
          <Share2 size={20} />
        </button>
      </div>

      {/* ── Debtor Info ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-200 overflow-hidden">
          {photoUrl ? (
            <img src={photoUrl} alt={debtorName} className="h-full w-full object-cover" />
          ) : (
            <User size={20} className="text-gray-400" />
          )}
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{debtorName}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Contrato: {contractId}</p>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Table header */}
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider"
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
              partial: { label: 'Parcial',   color: '#42A5F5' },
            };
            let st = statusMap[inst.status] ?? statusMap.pending;
            if ((inst as any).missed_at && inst.status !== 'paid') {
              st = { label: 'Falta', color: 'var(--accent-danger)' };
            } else if ((inst as any).missed_at && inst.status === 'paid' && normalizeNum(inst.amount_total) === 0) {
              st = { label: 'Absorvida', color: '#757575' };
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

                {(isPaid || isPartial) && inst.paid_at && (
                  <div className="px-4 py-1" style={{ background: 'var(--bg-soft)' }}>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      Recebido em {fmtDate(inst.paid_at)}
                      {(inst as any).payment_method ? ` · ${(inst as any).payment_method}` : ''}
                    </p>
                  </div>
                )}
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
      </div>

      {/* ── Footer Summary ──────────────────────────────────────────────── */}
      <div className="shrink-0 grid grid-cols-3 gap-2 px-4 py-3" style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600 shrink-0" />
          <div>
            <p className="text-[10px] font-bold text-green-600">Pagas</p>
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
            <p className="text-[10px] font-bold text-orange-500">Pendentes</p>
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
            <p className="text-[10px] font-bold text-red-500">A Receber</p>
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
