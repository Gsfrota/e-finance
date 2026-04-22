import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Calendar } from 'lucide-react';
import { LoanInstallment, Tenant } from '../../types';
import { InstallmentAction, InstallmentDetailScreen, InstallmentFormScreen } from '../InstallmentDetailFlow';
import { getBrazilToday, addDaysBR, isoToBrazilYMD } from '../../services/dateUtils';
import { calcSalaryPortions } from '../../services/salary';

interface SalaryDashboardProps {
  installments: LoanInstallment[];
  tenant: Tenant | null;
  onUpdate?: () => void;
}

type FilterPeriod = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtPct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(0)}%` : '0%';

const fmtDate = (s?: string) => {
  if (!s) return '—';
  const d = s.split('T')[0];
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const MONTH_NAMES = [
  'janeiro','fevereiro','março','abril','maio','junho',
  'julho','agosto','setembro','outubro','novembro','dezembro',
];

function periodLabel(period: FilterPeriod, from: string, to: string, today: string): string {
  if (period === 'today') return 'hoje';
  if (period === 'week') return 'últimos 7 dias';
  if (period === 'year') return today.slice(0, 4);
  if (period === 'all') return 'todo o período';
  if (period === 'custom') {
    if (!from) return 'período personalizado';
    const [,m,d] = from.split('-');
    const [,m2,d2] = (to || today).split('-');
    return `${d}/${m} – ${d2}/${m2}`;
  }
  // month
  const [year, month] = today.split('-');
  return `${MONTH_NAMES[Number(month) - 1]}/${year} · até hoje`;
}

export const SalaryDashboard: React.FC<SalaryDashboardProps> = ({ installments, tenant, onUpdate }) => {
  const today = useMemo(() => getBrazilToday(), []);
  const [period, setPeriod] = useState<FilterPeriod>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(today);
  const [listExpanded, setListExpanded] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);

  const { from, to } = useMemo(() => {
    if (period === 'today') return { from: today, to: today };
    if (period === 'week') return { from: addDaysBR(today, -6), to: today };
    if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
    if (period === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
    if (period === 'custom') return { from: customFrom, to: customTo };
    return { from: '', to: '' }; // all
  }, [period, today, customFrom, customTo]);

  const filtered = useMemo(() => {
    return installments.filter(i => {
      if (i.status !== 'paid' && i.status !== 'partial') return false;
      const refDate = i.paid_at;
      // BR-TZ-001: usar isoToBrazilYMD para respeitar timezone America/Sao_Paulo
      if (!refDate) return period === 'all'; // sem data: só em "Tudo"
      const paidDate = isoToBrazilYMD(refDate);
      if (from !== '' && paidDate < from) return false;
      if (to !== '' && paidDate > to) return false;
      return true;
    });
  }, [installments, from, to, period]);

  const totals = useMemo(() => {
    let juros = 0, atraso = 0, principal = 0, bruto = 0;
    filtered.forEach(i => {
      // BR-REL-018: fonte única de verdade
      const p = calcSalaryPortions(i);
      juros += p.juros;
      atraso += p.atraso;
      principal += p.principal;
      bruto += p.bruto;
    });
    return { juros, atraso, principal, bruto };
  }, [filtered]);

  // Lucro real = juros + multa/mora (tudo que não é devolução de principal)
  const voceGanhou = totals.juros + totals.atraso;

  const byMethod = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(i => {
      const method = i.payment_method || 'Não informado';
      const p = calcSalaryPortions(i);
      map.set(method, (map.get(method) ?? 0) + p.juros + p.atraso);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([method, value]) => ({ method, value }));
  }, [filtered]);

  const sortedFiltered = useMemo(
    () => [...filtered].sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? '')),
    [filtered]
  );

  // Parcelas sem paid_at (apenas em "Tudo")
  const semData = useMemo(
    () => installments.filter(i =>
      (i.status === 'paid' || i.status === 'partial') && !i.paid_at
    ),
    [installments]
  );

  const periodButtons: { id: FilterPeriod; label: string }[] = [
    { id: 'today', label: 'Hoje' },
    { id: 'week', label: 'Semana' },
    { id: 'month', label: 'Mês' },
    { id: 'year', label: 'Ano' },
    { id: 'all', label: 'Tudo' },
  ];

  const debtorName = (i: LoanInstallment) =>
    (i as any).investment?.payer?.full_name || '—';

  const contractName = (i: LoanInstallment) =>
    i.contract_name || (i as any).investment?.asset_name || '—';

  const hasExtra = (i: LoanInstallment) =>
    (Number(i.fine_amount) || 0) + (Number(i.interest_delay_amount) || 0) > 0;

  const paidCount = filtered.filter(i => i.status === 'paid').length;
  const partialCount = filtered.filter(i => i.status === 'partial').length;
  const totalCount = paidCount + partialCount;

  if (selectedInstallment && !installmentAction) {
    return (
      <InstallmentDetailScreen
        installment={selectedInstallment}
        onBack={() => setSelectedInstallment(null)}
        onAction={(action) => setInstallmentAction(action)}
      />
    );
  }
  if (installmentAction) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        tenant={tenant}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => { onUpdate?.(); setInstallmentAction(null); setSelectedInstallment(null); }}
      />
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="panel-card rounded-[2rem] px-6 py-5">
        <p className="section-kicker mb-1">Visão financeira</p>
        <h2 className="type-title" style={{ color: 'var(--text-primary)' }}>
          Salário
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Seu salário do mês · até hoje
        </p>
      </div>

      {/* Filtros de período */}
      <div className="panel-card rounded-[1.6rem] px-4 py-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <Calendar size={12} aria-hidden="true" /> Período:
          </span>
          {periodButtons.map(btn => (
            <button
              key={btn.id}
              onClick={() => setPeriod(btn.id)}
              aria-pressed={period === btn.id}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={period === btn.id
                ? { background: 'var(--header-blue)', color: 'white' }
                : { background: 'var(--bg-soft)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }
              }
            >
              {btn.label}
            </button>
          ))}
          <button
            onClick={() => setPeriod('custom')}
            aria-pressed={period === 'custom'}
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={period === 'custom'
              ? { background: 'var(--header-blue)', color: 'white' }
              : { background: 'var(--bg-soft)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }
            }
          >
            Período
          </button>
        </div>
        {period === 'custom' && (
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <label className="block type-label mb-1" style={{ color: 'var(--text-faint)' }}>De</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }} />
            </div>
            <div className="flex-1">
              <label className="block type-label mb-1" style={{ color: 'var(--text-faint)' }}>Até</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }} />
            </div>
          </div>
        )}
      </div>

      {/* HERO — "Você ganhou" */}
      <div className="panel-card rounded-[1.6rem] px-5 py-6">
        <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
          {periodLabel(period, from, to, today)}
        </p>

        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              Você ganhou
            </p>
            <p style={{ fontSize: '2.6rem', fontWeight: 800, lineHeight: 1.1, color: 'var(--accent-positive)', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(voceGanhou)}
            </p>
          </div>
          <span className="text-3xl mt-1" aria-hidden="true">💰</span>
        </div>

        {/* Breakdown juros vs atraso */}
        {voceGanhou > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>de juros</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--accent-positive)' }}>
                {fmt(totals.juros)}
              </span>
            </div>
            {totals.atraso > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>de atraso <span style={{ opacity: 0.65 }}>(multa + mora)</span></span>
                <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--accent-danger)' }}>
                  {fmt(totals.atraso)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Caption de contagem */}
        {totalCount > 0 && (
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            {paidCount} parcela{paidCount !== 1 ? 's' : ''} paga{paidCount !== 1 ? 's' : ''}
            {partialCount > 0 && (
              <> + <span style={{ color: 'var(--accent-steel)' }}>{partialCount} pagou parte</span></>
            )}
          </p>
        )}

        {/* Detalhamento por método */}
        {byMethod.length > 0 && (
          <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
            {byMethod.map(({ method, value }) => (
              <div key={method} className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{method}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(value)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-lg font-semibold"
                    style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)' }}>
                    {fmtPct(value, voceGanhou)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state orientativo */}
        {totalCount === 0 && (
          <p className="text-xs mt-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Nada caiu ainda{period === 'month' ? ' este mês' : ' neste período'}.
            Quando um cliente te pagar uma parcela, ela aparece aqui como salário.
          </p>
        )}
      </div>

      {/* Cards secundários: Caiu na mão + Dinheiro que voltou */}
      {totals.bruto > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="panel-card rounded-[1.4rem] px-4 py-4">
            <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
              💵 Caiu na mão
            </p>
            <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent-brass)' }}>
              {fmt(totals.bruto)}
            </p>
            <p className="text-[10px] mt-1 leading-tight" style={{ color: 'var(--text-faint)' }}>
              tudo que você recebeu (ganho + capital de volta)
            </p>
          </div>
          <div className="panel-card rounded-[1.4rem] px-4 py-4">
            <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
              💸 Dinheiro que voltou
            </p>
            <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {fmt(totals.principal)}
            </p>
            <p className="text-[10px] mt-1 leading-tight" style={{ color: 'var(--text-faint)' }}>
              seu capital emprestado retornando
            </p>
          </div>
        </div>
      )}

      {/* Lista de parcelas (expandível, separado do hero) */}
      {sortedFiltered.length > 0 && (
        <div className="panel-card rounded-[1.6rem] px-5 py-4">
          <button
            className="w-full flex items-center justify-between"
            onClick={() => setListExpanded(v => !v)}
            aria-expanded={listExpanded}
          >
            <p className="type-label" style={{ color: 'var(--text-faint)' }}>
              Parcelas pagas ({sortedFiltered.length})
            </p>
            <ChevronDown
              size={16}
              style={{ color: 'var(--text-muted)', transform: listExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
              aria-hidden="true"
            />
          </button>

          {listExpanded && (
            <div className="space-y-1 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              {sortedFiltered.map((i, idx) => {
                const p = calcSalaryPortions(i);
                return (
                  <button
                    key={i.id}
                    onClick={() => setSelectedInstallment(i)}
                    className="w-full flex items-center justify-between py-2.5 px-2 rounded-xl transition-colors text-left hover:bg-[var(--bg-soft)]"
                    style={idx < sortedFiltered.length - 1 ? { borderBottom: '1px solid var(--border-subtle)' } : {}}
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {contractName(i)}
                      </p>
                      <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                        {debtorName(i)} · {fmtDate(i.paid_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs tabular-nums font-bold" style={{ color: 'var(--accent-positive)' }}>
                        {fmt(p.juros + p.atraso)}
                      </span>
                      {i.status === 'partial' && (
                        <span className="text-[10px] px-1 py-0.5 rounded font-semibold"
                          style={{ background: 'rgba(66, 165, 245, 0.12)', color: 'var(--accent-steel)' }}>
                          Pagou parte
                        </span>
                      )}
                      {hasExtra(i) && (
                        <span className="text-[10px] px-1 py-0.5 rounded font-semibold"
                          style={{ background: 'var(--accent-danger)', color: 'white', opacity: 0.85 }}>
                          +atraso
                        </span>
                      )}
                      <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Aviso parcelas sem data (apenas em "Tudo") */}
      {period === 'all' && semData.length > 0 && (
        <div className="panel-card rounded-[1.4rem] px-4 py-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            <span className="font-semibold" style={{ color: 'var(--accent-warning)' }}>⚠ {semData.length} parcela{semData.length !== 1 ? 's' : ''} sem data de pagamento</span>
            {' '}— incluída{semData.length !== 1 ? 's' : ''} no total acima mas sem data registrada.
          </p>
        </div>
      )}
    </div>
  );
};

export default SalaryDashboard;
