import React from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Users, TrendingUp, Landmark, CheckCircle } from 'lucide-react';
import { MonthlyViewData } from '../../types';
import { monthKeyToDate } from '../../hooks/useInvestorMetrics';

interface MonthlyInvestorViewProps {
  monthlyView: MonthlyViewData;
  selectedMonthKey: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

const fmtMoney = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const progressColor = (pct: number) =>
  pct >= 80
    ? 'bg-[color:var(--accent-positive)]'
    : pct >= 50
    ? 'bg-[color:var(--accent-warning,#d4a017)]'
    : 'bg-[color:var(--accent-danger)]';

const progressTextColor = (pct: number) =>
  pct >= 80
    ? 'text-[color:var(--accent-positive)]'
    : pct >= 50
    ? 'text-[color:var(--accent-warning,#d4a017)]'
    : 'text-[color:var(--accent-danger)]';

const MonthlyInvestorView: React.FC<MonthlyInvestorViewProps> = ({
  monthlyView,
  selectedMonthKey,
  onPrevMonth,
  onNextMonth,
}) => {
  const now = new Date();
  const selectedMonth = monthKeyToDate(selectedMonthKey);
  const isFutureMonth =
    selectedMonth.getFullYear() > now.getFullYear() ||
    (selectedMonth.getFullYear() === now.getFullYear() && selectedMonth.getMonth() > now.getMonth());

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12 animate-fade-in md:space-y-6">

      {/* Navegação de mês */}
      <div className="panel-card rounded-[1.8rem] px-6 py-5 md:px-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="section-kicker mb-1">Visão Mensal</p>
            <h2 className="type-title font-display text-[color:var(--text-primary)]">
              {monthlyView.monthLabel}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onPrevMonth}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-[color:var(--text-secondary)] transition-all hover:bg-white/[0.08]"
              aria-label="Mês anterior"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={onNextMonth}
              disabled={isFutureMonth}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-[color:var(--text-secondary)] transition-all hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Próximo mês"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* 3 KPI cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-5">
        {/* Capital Investido */}
        <div className="panel-card rounded-[1.8rem] p-4 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Principal</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">Capital Investido</h3>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-[color:var(--text-secondary)] ring-1 ring-white/10">
              <Landmark size={18} />
            </div>
          </div>
          <div className="mt-6 type-metric-lg text-[color:var(--text-primary)]">
            {fmtMoney(monthlyView.capitalAllocated)}
          </div>
          <p className="mt-2 type-body text-[color:var(--text-secondary)]">
            Capital comprometido em contratos ativos no mês.
          </p>
        </div>

        {/* Juros Recebidos */}
        <div className="panel-card rounded-[1.8rem] p-4 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Rendimento</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">Juros Recebidos</h3>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[rgba(143,179,157,0.14)] text-[color:var(--accent-positive)] ring-1 ring-[rgba(143,179,157,0.16)]">
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="mt-6 type-metric-lg text-[color:var(--accent-positive)]">
            {fmtMoney(monthlyView.interestReceived)}
          </div>
          <p className="mt-2 type-body text-[color:var(--text-secondary)]">
            Juros efetivamente recebidos em {monthlyView.monthLabel}.
          </p>
        </div>

        {/* Juros Previstos */}
        <div className="panel-card rounded-[1.8rem] p-4 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">A receber</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">Juros Previstos</h3>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[rgba(144,160,189,0.14)] text-[color:var(--accent-steel)] ring-1 ring-[rgba(144,160,189,0.16)]">
              <CheckCircle size={18} />
            </div>
          </div>
          <div className="mt-6 type-metric-lg text-[color:var(--accent-steel)]">
            {fmtMoney(monthlyView.interestExpected)}
          </div>
          <p className="mt-2 type-body text-[color:var(--text-secondary)]">
            Juros de parcelas ainda pendentes ou em atraso no mês.
          </p>
        </div>
      </div>

      {/* Barra de % Pagamento */}
      <div className="panel-card rounded-[1.8rem] p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="section-kicker mb-1">Realização</p>
            <h3 className="type-title font-display text-[color:var(--text-primary)]">% Pagamento do Mês</h3>
          </div>
          <div className={`text-2xl font-bold tabular-nums ${progressTextColor(monthlyView.paymentPercent)}`}>
            {monthlyView.paymentPercent.toFixed(0)}%
          </div>
        </div>

        <div className="h-3 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${progressColor(monthlyView.paymentPercent)}`}
            style={{ width: `${Math.min(100, monthlyView.paymentPercent)}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="type-body text-[color:var(--text-secondary)]">
            Recebido: <span className="font-semibold text-[color:var(--text-primary)]">{fmtMoney(monthlyView.totalPaid)}</span>
          </span>
          <span className="type-body text-[color:var(--text-secondary)]">
            Esperado: <span className="font-semibold text-[color:var(--text-primary)]">{fmtMoney(monthlyView.totalExpected)}</span>
          </span>
        </div>
      </div>

      {/* Atrasados do Mês */}
      {monthlyView.overdueCount > 0 && (
        <div className="panel-card rounded-[1.8rem] border border-[rgba(220,80,80,0.2)] bg-[rgba(220,80,80,0.04)] p-4 md:p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(220,80,80,0.14)] text-[color:var(--accent-danger)] ring-1 ring-[rgba(220,80,80,0.2)]">
              <AlertTriangle size={16} />
            </div>
            <div>
              <p className="section-kicker text-[color:var(--accent-danger)]">Atenção</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">
                Atrasados em {monthlyView.monthLabel}
              </h3>
            </div>
            <div className="ml-auto text-right">
              <div className="type-metric-md text-[color:var(--accent-danger)]">
                {fmtMoney(monthlyView.overdueAmount)}
              </div>
              <div className="type-caption text-[color:var(--text-secondary)]">
                {monthlyView.overdueCount} {monthlyView.overdueCount === 1 ? 'parcela' : 'parcelas'}
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t border-white/10 pt-4">
            {monthlyView.overdueByDebtor.map((entry) => (
              <div
                key={entry.debtorName}
                className="flex items-center justify-between gap-4 rounded-[1rem] bg-white/[0.03] px-4 py-3"
              >
                <div>
                  <div className="text-sm font-semibold text-[color:var(--text-primary)]">{entry.debtorName}</div>
                  <div className="type-caption text-[color:var(--text-secondary)]">
                    {entry.daysLate > 0 ? `${entry.daysLate} dia${entry.daysLate > 1 ? 's' : ''} de atraso` : 'Vence hoje'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-[color:var(--accent-danger)]">
                    {fmtMoney(entry.amount)}
                  </div>
                  <div className="chip chip-late mt-1">Atrasado</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Devedores do Mês */}
      {monthlyView.debtors.length > 0 ? (
        <div className="panel-card rounded-[1.8rem] p-4 md:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.18)]">
              <Users size={16} />
            </div>
            <div>
              <p className="section-kicker mb-0.5">Carteira</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">Devedores do Mês</h3>
            </div>
          </div>

          <div className="space-y-3">
            {monthlyView.debtors.map((debtor) => {
              const pct = debtor.totalDue > 0 ? (debtor.totalPaid / debtor.totalDue) * 100 : 0;
              return (
                <div
                  key={debtor.debtorName}
                  className="rounded-[1.4rem] border border-white/8 bg-black/10 p-4"
                >
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-base font-semibold text-[color:var(--text-primary)]">
                        {debtor.debtorName}
                      </div>
                      <div className="type-caption text-[color:var(--text-secondary)]">
                        {debtor.installmentCount} {debtor.installmentCount === 1 ? 'parcela' : 'parcelas'} no mês
                        {debtor.overdueCount > 0 && (
                          <span className="ml-2 text-[color:var(--accent-danger)]">
                            · {debtor.overdueCount} atrasada{debtor.overdueCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={`text-sm font-bold tabular-nums ${progressTextColor(pct)}`}>
                      {pct.toFixed(0)}%
                    </div>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${progressColor(pct)}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <div className="type-label text-[color:var(--text-faint)]">Devido no mês</div>
                      <div className="mt-0.5 text-sm font-semibold text-[color:var(--text-primary)]">
                        {fmtMoney(debtor.totalDue)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="type-label text-[color:var(--text-faint)]">Pago</div>
                      <div className={`mt-0.5 text-sm font-semibold ${pct >= 100 ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--text-primary)]'}`}>
                        {fmtMoney(debtor.totalPaid)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="panel-card rounded-[1.8rem] p-8 text-center">
          <p className="type-body text-[color:var(--text-secondary)]">
            Nenhum devedor com parcelas em {monthlyView.monthLabel}.
          </p>
        </div>
      )}
    </div>
  );
};

export default MonthlyInvestorView;
