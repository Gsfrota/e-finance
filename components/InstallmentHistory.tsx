import React from 'react';
import { ArrowLeft, CheckCircle, Share2, User, XCircle, Clock } from 'lucide-react';
import { Investment, LoanInstallment } from '../types';
import { fmtMoney, fmtDate, calcOutstanding, normalizeNum } from './InstallmentDetailFlow';

interface InstallmentHistoryProps {
  investment: Investment;
  debtorName: string;
  onBack: () => void;
}

const InstallmentHistory: React.FC<InstallmentHistoryProps> = ({
  investment,
  debtorName,
  onBack,
}) => {
  const allInstallments: LoanInstallment[] = (investment.loan_installments || [])
    .slice()
    .sort((a, b) => a.number - b.number);

  const contractId = `CT${String(investment.id).slice(-8)}`;
  const photoUrl = (investment as any).payer?.photo_url;

  const paidItems = allInstallments.filter(i => i.status === 'paid');
  const pendingItems = allInstallments.filter(i => i.status === 'pending' || i.status === 'partial');
  const lateItems = allInstallments.filter(i => i.status === 'late');

  const paidTotal = paidItems.reduce((s, i) => s + normalizeNum(i.amount_paid), 0);
  const pendingTotal = pendingItems.reduce((s, i) => s + calcOutstanding(i), 0);
  const lateTotal = lateItems.reduce((s, i) => s + calcOutstanding(i), 0);

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
        <div className="sticky top-0 z-10 grid grid-cols-[3rem_5.5rem_5rem_4.5rem_5rem] gap-1 px-4 py-2 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
          <span>Parcela</span>
          <span>Vencimento</span>
          <span>Valor</span>
          <span>Pago</span>
          <span>Status</span>
        </div>

        {/* Table rows */}
        <div>
          {allInstallments.map((inst, idx) => {
            const isPaid = inst.status === 'paid';
            const isLate = inst.status === 'late';
            const amountPaid = normalizeNum(inst.amount_paid);

            return (
              <React.Fragment key={inst.id}>
                <div className="grid grid-cols-[3rem_5.5rem_5rem_4.5rem_5rem] gap-1 items-center px-4 py-2.5"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {inst.number}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {fmtDate(inst.due_date)}
                  </span>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {fmtMoney(normalizeNum(inst.amount_total))}
                  </span>
                  <span className={`text-xs font-bold ${isPaid ? 'text-green-600' : 'text-red-500'}`}>
                    {isPaid ? 'Efetivado' : 'Faltou'}
                  </span>
                  <span className={`text-xs font-bold ${isPaid ? 'text-green-600' : 'text-red-500'}`}>
                    {isPaid ? 'Liquidada' : 'Pendente'}
                  </span>
                </div>

                {/* Total received for this installment */}
                {isPaid && (
                  <div className="px-4 py-1.5" style={{ background: 'var(--bg-soft)' }}>
                    <p className="text-xs font-semibold" style={{ color: '#26a69a' }}>
                      Total Recebido Parc.: {fmtMoney(amountPaid)}
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
          <XCircle size={16} className="text-red-500 shrink-0" />
          <div>
            <p className="text-[10px] font-bold text-red-500">Falta</p>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {lateItems.length} parcelas,
            </p>
            <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {fmtMoney(lateTotal)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstallmentHistory;
