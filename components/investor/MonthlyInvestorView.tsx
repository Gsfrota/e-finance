import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Users, TrendingUp, Landmark, CheckCircle, ChevronDown } from 'lucide-react';
import { MonthlyViewData, MonthlyInstallmentRow } from '../../types';
import { monthKeyToDate } from '../../hooks/useInvestorMetrics';

interface MonthlyInvestorViewProps {
  monthlyView: MonthlyViewData;
  selectedMonthKey: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onInstallmentClick?: (installmentId: string, investmentId: number) => void;
}

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

const progressColor = (pct: number) =>
  pct >= 80 ? 'bg-[color:var(--accent-positive)]'
  : pct >= 50 ? 'bg-[color:var(--accent-warning,#d4a017)]'
  : 'bg-[color:var(--accent-danger)]';

const progressTextColor = (pct: number) =>
  pct >= 80 ? 'text-[color:var(--accent-positive)]'
  : pct >= 50 ? 'text-[color:var(--accent-warning,#d4a017)]'
  : 'text-[color:var(--accent-danger)]';

const statusLabel: Record<string, string> = {
  paid: 'Pago', partial: 'Parcial', late: 'Atrasado', pending: 'Pendente',
};
const statusClass: Record<string, string> = {
  paid: 'text-[color:var(--accent-positive)]',
  partial: 'text-[color:var(--accent-warning,#d4a017)]',
  late: 'text-[color:var(--accent-danger)]',
  pending: 'text-[color:var(--text-secondary)]',
};

const InstallmentTable: React.FC<{
  installments: MonthlyInstallmentRow[];
  onInstallmentClick?: (installmentId: string, investmentId: number) => void;
}> = ({ installments, onInstallmentClick }) => (
  <div className="mt-3 overflow-hidden rounded-lg border border-white/8">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-white/8 bg-white/[0.03]">
          <th className="px-3 py-2 text-left font-medium text-[color:var(--text-faint)]">Parcela</th>
          <th className="px-3 py-2 text-left font-medium text-[color:var(--text-faint)]">Venc.</th>
          <th className="px-3 py-2 text-right font-medium text-[color:var(--text-faint)]">Total</th>
          <th className="px-3 py-2 text-right font-medium text-[color:var(--text-faint)]">Pago</th>
          <th className="px-3 py-2 text-right font-medium text-[color:var(--text-faint)]">Status</th>
        </tr>
      </thead>
      <tbody>
        {installments.map((inst, i) => {
          const hasExtra = inst.fine_amount > 0 || inst.interest_delay_amount > 0;
          const isClickable = !!onInstallmentClick && !!inst.id;
          return (
            <tr
              key={inst.id || i}
              className={`border-b border-white/5 last:border-0 ${isClickable ? 'cursor-pointer hover:bg-white/[0.04] transition-colors' : ''}`}
              onClick={isClickable ? () => onInstallmentClick!(inst.id, inst.investment_id) : undefined}
            >
              <td className="px-3 py-2 text-[color:var(--text-secondary)]">
                #{inst.number}
                {inst.contractName && (
                  <span className="ml-1 text-[10px] text-[color:var(--text-faint)]">· {inst.contractName}</span>
                )}
              </td>
              <td className="px-3 py-2 text-[color:var(--text-secondary)]">{fmtDate(inst.due_date)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">
                {fmtMoney(inst.amount_total)}
                {hasExtra && (
                  <div className="text-[10px] text-[color:var(--accent-danger)]">
                    +{fmtMoney(inst.fine_amount + inst.interest_delay_amount)}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">
                {inst.amount_paid > 0 ? fmtMoney(inst.amount_paid) : '—'}
              </td>
              <td className={`px-3 py-2 text-right font-semibold ${statusClass[inst.status] ?? 'text-[color:var(--text-secondary)]'}`}>
                {statusLabel[inst.status] ?? inst.status}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const MonthlyInvestorView: React.FC<MonthlyInvestorViewProps> = ({
  monthlyView, selectedMonthKey, onPrevMonth, onNextMonth, onInstallmentClick,
}) => {
  const [expandedDebtor, setExpandedDebtor] = useState<string | null>(null);

  const now = new Date();
  const selectedMonth = monthKeyToDate(selectedMonthKey);
  const isFutureMonth =
    selectedMonth.getFullYear() > now.getFullYear() ||
    (selectedMonth.getFullYear() === now.getFullYear() && selectedMonth.getMonth() > now.getMonth());

  return (
    <div className="mx-auto max-w-7xl space-y-3 pb-12 animate-fade-in md:space-y-4">

      {/* Navegação de mês */}
      <div className="panel-card rounded-xl px-5 py-4 md:px-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="section-kicker mb-0.5">Análise Mensal</p>
            <h2 className="text-xl font-bold font-display text-[color:var(--text-primary)]">
              {monthlyView.monthLabel}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onPrevMonth} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[color:var(--text-secondary)] transition-all hover:bg-white/[0.08]" aria-label="Mês anterior">
              <ChevronLeft size={16} />
            </button>
            <button onClick={onNextMonth} disabled={isFutureMonth} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-[color:var(--text-secondary)] transition-all hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Próximo mês">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 3 KPI cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="panel-card rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[color:var(--text-secondary)] ring-1 ring-white/10">
              <Landmark size={16} />
            </div>
            <span className="section-kicker">Principal</span>
          </div>
          <div className="text-2xl font-bold tabular-nums text-[color:var(--text-primary)]">
            {fmtMoney(monthlyView.capitalAllocated)}
          </div>
          <p className="mt-1 text-xs text-[color:var(--text-faint)]">Capital em contratos ativos</p>
        </div>

        <div className="panel-card rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(143,179,157,0.14)] text-[color:var(--accent-positive)] ring-1 ring-[rgba(143,179,157,0.16)]">
              <TrendingUp size={16} />
            </div>
            <span className="section-kicker">Recebido</span>
          </div>
          <div className="text-2xl font-bold tabular-nums text-[color:var(--accent-positive)]">
            {fmtMoney(monthlyView.interestReceived)}
          </div>
          <p className="mt-1 text-xs text-[color:var(--text-faint)]">Juros efetivamente recebidos</p>
        </div>

        <div className="panel-card rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(144,160,189,0.14)] text-[color:var(--accent-steel)] ring-1 ring-[rgba(144,160,189,0.16)]">
              <CheckCircle size={16} />
            </div>
            <span className="section-kicker">A receber</span>
          </div>
          <div className="text-2xl font-bold tabular-nums text-[color:var(--accent-steel)]">
            {fmtMoney(monthlyView.interestExpected)}
          </div>
          <p className="mt-1 text-xs text-[color:var(--text-faint)]">Juros de parcelas pendentes</p>
        </div>
      </div>

      {/* Barra de % Pagamento */}
      <div className="panel-card rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker mb-0.5">Realização</p>
            <h3 className="text-base font-semibold text-[color:var(--text-primary)]">% Pagamento do Mês</h3>
          </div>
          <div className={`text-2xl font-bold tabular-nums ${progressTextColor(monthlyView.paymentPercent)}`}>
            {monthlyView.paymentPercent.toFixed(0)}%
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
          <div className={`h-full rounded-full transition-all duration-700 ease-out ${progressColor(monthlyView.paymentPercent)}`} style={{ width: `${Math.min(100, monthlyView.paymentPercent)}%` }} />
        </div>
        <div className="mt-2.5 flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
          <span>Recebido: <span className="font-semibold text-[color:var(--text-primary)]">{fmtMoney(monthlyView.totalPaid)}</span></span>
          <span>Esperado: <span className="font-semibold text-[color:var(--text-primary)]">{fmtMoney(monthlyView.totalExpected)}</span></span>
        </div>
      </div>

      {/* Atrasados */}
      {monthlyView.overdueCount > 0 && (
        <div className="rounded-xl border border-[rgba(220,80,80,0.2)] bg-[rgba(220,80,80,0.04)] p-5">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(220,80,80,0.14)] text-[color:var(--accent-danger)] ring-1 ring-[rgba(220,80,80,0.2)]">
              <AlertTriangle size={15} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-danger)]">Atenção</p>
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">Atrasados em {monthlyView.monthLabel}</h3>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold tabular-nums text-[color:var(--accent-danger)]">{fmtMoney(monthlyView.overdueAmount)}</div>
              <div className="text-xs text-[color:var(--text-secondary)]">{monthlyView.overdueCount} {monthlyView.overdueCount === 1 ? 'parcela' : 'parcelas'}</div>
            </div>
          </div>
          <div className="space-y-1.5 border-t border-white/10 pt-3">
            {monthlyView.overdueByDebtor.map((entry) => (
              <div key={entry.debtorName} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
                <div>
                  <div className="text-sm font-semibold text-[color:var(--text-primary)]">{entry.debtorName}</div>
                  <div className="text-xs text-[color:var(--text-secondary)]">
                    {entry.daysLate > 0 ? `${entry.daysLate} dia${entry.daysLate > 1 ? 's' : ''} de atraso` : 'Vence hoje'}
                  </div>
                </div>
                <div className="text-sm font-bold text-[color:var(--accent-danger)]">{fmtMoney(entry.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Devedores — clicáveis */}
      {monthlyView.debtors.length > 0 ? (
        <div className="panel-card rounded-xl p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.18)]">
              <Users size={15} />
            </div>
            <div>
              <p className="section-kicker mb-0">Carteira</p>
              <h3 className="text-base font-semibold text-[color:var(--text-primary)]">Devedores do Mês</h3>
            </div>
          </div>

          <div className="space-y-2">
            {monthlyView.debtors.map((debtor) => {
              const pct = debtor.totalDue > 0 ? (debtor.totalPaid / debtor.totalDue) * 100 : 0;
              const isOpen = expandedDebtor === debtor.debtorName;
              return (
                <div key={debtor.debtorName} className="rounded-lg border border-white/8 bg-black/10 overflow-hidden">
                  <button
                    onClick={() => setExpandedDebtor(isOpen ? null : debtor.debtorName)}
                    className="w-full p-4 text-left cursor-pointer hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4 mb-2.5">
                      <div>
                        <div className="text-sm font-semibold text-[color:var(--text-primary)]">{debtor.debtorName}</div>
                        <div className="text-xs text-[color:var(--text-secondary)] mt-0.5">
                          {debtor.installmentCount} {debtor.installmentCount === 1 ? 'parcela' : 'parcelas'} no mês
                          {debtor.overdueCount > 0 && (
                            <span className="ml-2 text-[color:var(--accent-danger)]">· {debtor.overdueCount} atrasada{debtor.overdueCount > 1 ? 's' : ''}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-bold tabular-nums ${progressTextColor(pct)}`}>{pct.toFixed(0)}%</span>
                        <ChevronDown size={14} className={`text-[color:var(--text-faint)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                      <div className={`h-full rounded-full transition-all duration-500 ${progressColor(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[color:var(--text-faint)]">Devido </span>
                        <span className="font-semibold text-[color:var(--text-primary)]">{fmtMoney(debtor.totalDue)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[color:var(--text-faint)]">Pago </span>
                        <span className={`font-semibold ${pct >= 100 ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--text-primary)]'}`}>{fmtMoney(debtor.totalPaid)}</span>
                      </div>
                    </div>
                  </button>

                  {isOpen && debtor.installments.length > 0 && (
                    <div className="border-t border-white/8 px-4 pb-4">
                      <InstallmentTable installments={debtor.installments} onInstallmentClick={onInstallmentClick} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="panel-card rounded-xl p-8 text-center">
          <p className="text-sm text-[color:var(--text-secondary)]">Nenhum devedor com parcelas em {monthlyView.monthLabel}.</p>
        </div>
      )}
    </div>
  );
};

export default MonthlyInvestorView;
