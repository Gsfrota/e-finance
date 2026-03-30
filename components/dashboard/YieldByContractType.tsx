import React, { useState, useRef } from 'react';
import { Investment, LoanInstallment } from '../../types';
import {
  useYieldMetrics,
  buildTypeFilterOptions,
  YieldFilter,
  YieldPeriod,
  YieldTypeFilter,
  ContractTypeMetrics,
} from '../../hooks/useYieldMetrics';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import {
  TrendingUp,
  Wallet,
  Users,
  CalendarRange,
  ChevronDown,
} from 'lucide-react';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

const formatPct = (value: number) =>
  `${value.toFixed(2).replace('.', ',')}%`;

const currencyTick = (v: number) => {
  if (!v) return 'R$ 0';
  if (Math.abs(v) >= 1000) return `R$ ${Math.round(v / 1000)}k`;
  return `R$ ${Math.round(v)}`;
};

const panelClass = 'panel-card rounded-[1.8rem]';

const CHART_STYLE = {
  contentStyle: {
    background: 'var(--bg-elevated)',
    borderRadius: 12,
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)',
  },
  labelStyle: { color: 'var(--text-primary)' },
  itemStyle: { color: 'var(--text-secondary)' },
};

const PERIOD_OPTIONS: { value: YieldPeriod; label: string }[] = [
  { value: 'month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês ant.' },
  { value: 'year', label: 'Este ano' },
  { value: 'all', label: 'Tudo' },
];

interface YieldByContractTypeProps {
  investments: Investment[];
  allPaidInstallments: LoanInstallment[];
  pendingInstallments: LoanInstallment[];
}

// --- MINI SPARKLINE ---
const Sparkline: React.FC<{ data: { month: string; interest: number }[]; color: string }> = ({
  data,
  color,
}) => {
  if (data.length < 2) {
    return <div className="w-20 h-6 opacity-20 text-[10px] text-center leading-6 text-[color:var(--text-faint)]">—</div>;
  }
  return (
    <ResponsiveContainer width={80} height={24}>
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey="interest"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

// --- DONUT CENTER LABEL ---
const DonutCenterLabel: React.FC<{ total: number }> = ({ total }) => (
  <text
    x="50%"
    y="50%"
    textAnchor="middle"
    dominantBaseline="middle"
    style={{ fill: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}
  >
    {total >= 1000 ? `R$ ${Math.round(total / 1000)}k` : formatCurrency(total)}
  </text>
);

// --- MAIN COMPONENT ---

const YieldByContractType: React.FC<YieldByContractTypeProps> = ({
  investments,
  allPaidInstallments,
  pendingInstallments,
}) => {
  const [filter, setFilter] = useState<YieldFilter>({ typeFilter: 'all', period: 'month' });
  const [donutMode, setDonutMode] = useState<'category' | 'detail'>('category');
  const [highlightType, setHighlightType] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const metrics = useYieldMetrics(investments, allPaidInstallments, pendingInstallments, filter);
  const { summaryMetrics, granularMetrics, totals, evolutionData, compositionData } = metrics;

  const typeOptions = buildTypeFilterOptions(summaryMetrics, granularMetrics);

  const setPeriod = (period: YieldPeriod) => setFilter((f) => ({ ...f, period }));
  const setTypeFilter = (typeFilter: YieldTypeFilter) => setFilter((f) => ({ ...f, typeFilter }));

  // Variação % de juros em relação ao mês anterior (só disponível no filtro "month")
  const interestVariation =
    filter.period === 'month' && totals.prevInterestReceived > 0
      ? ((totals.interestReceived - totals.prevInterestReceived) / totals.prevInterestReceived) * 100
      : null;

  const highlightRow = (key: string | null) => {
    setHighlightType(key);
    if (key && tableRef.current) {
      tableRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // Quais métricas mostrar na tabela
  const tableMetrics: ContractTypeMetrics[] =
    filter.typeFilter === 'all' ? granularMetrics : granularMetrics.filter(
      (m) => filter.typeFilter === m.category || filter.typeFilter === m.key
    );

  const hasData = totals.activeContracts > 0 || totals.interestReceived > 0;

  return (
    <div className="space-y-5 animate-fade-in">

      {/* FILTER BAR */}
      <div className={`${panelClass} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
        {/* Dropdown tipo */}
        <div className="relative shrink-0">
          <select
            value={filter.typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as YieldTypeFilter)}
            className="w-full appearance-none rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 pr-8 text-sm font-medium text-[color:var(--text-primary)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-brass)]"
            aria-label="Filtrar por tipo de contrato"
          >
            {typeOptions.map((opt, i) => (
              <React.Fragment key={opt.value}>
                {i > 0 && typeOptions[i - 1].group !== opt.group && (
                  <option disabled>────────────</option>
                )}
                <option value={opt.value}>{opt.label}</option>
              </React.Fragment>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]"
          />
        </div>

        {/* Period pills */}
        <div
          className="flex gap-1 rounded-full border border-white/10 bg-black/10 p-1"
          role="radiogroup"
          aria-label="Período de análise"
        >
          {PERIOD_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              role="radio"
              aria-checked={filter.period === value}
              onClick={() => setPeriod(value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                filter.period === value
                  ? 'bg-[color:var(--accent-brass)] text-[color:var(--text-on-accent)] shadow-[0_2px_8px_rgba(240,180,41,0.28)]'
                  : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {/* Juros Recebidos */}
        <div className={`${panelClass} card-hover flex flex-col gap-3 p-4 md:p-5`}>
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 rounded-xl p-2.5 bg-[rgba(202,176,122,0.14)] ring-1 ring-[rgba(202,176,122,0.20)]">
              <TrendingUp size={14} style={{ color: 'var(--accent-brass)' }} />
            </div>
            <p className="type-label text-[color:var(--text-faint)]">JUROS RECEBIDOS</p>
          </div>
          <div>
            <p className="type-metric-lg" style={{ color: 'var(--accent-brass)' }}>
              {formatCurrency(totals.interestReceived)}
            </p>
            {interestVariation !== null && (
              <p className={`mt-0.5 type-caption font-semibold ${interestVariation >= 0 ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--accent-danger)]'}`}>
                {interestVariation >= 0 ? '+' : ''}{interestVariation.toFixed(1).replace('.', ',')}% vs mês ant.
              </p>
            )}
            {interestVariation === null && (
              <p className="mt-0.5 type-caption text-[color:var(--text-faint)]">Juros efetivamente pagos</p>
            )}
          </div>
        </div>

        {/* Capital Alocado */}
        <div className={`${panelClass} card-hover flex flex-col gap-3 p-4 md:p-5`}>
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 rounded-xl p-2.5 bg-[rgba(144,160,189,0.14)] ring-1 ring-[rgba(144,160,189,0.20)]">
              <Wallet size={14} style={{ color: '#90a0bd' }} />
            </div>
            <p className="type-label text-[color:var(--text-faint)]">CAPITAL ALOCADO</p>
          </div>
          <div>
            <p className="type-metric-lg" style={{ color: '#90a0bd' }}>
              {formatCurrency(totals.capitalAllocated)}
            </p>
            <p className="mt-0.5 type-caption text-[color:var(--text-faint)]">Principal ativo</p>
          </div>
        </div>

        {/* Contratos Ativos */}
        <div className={`${panelClass} card-hover flex flex-col gap-3 p-4 md:p-5`}>
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 rounded-xl p-2.5 bg-[rgba(143,179,157,0.14)] ring-1 ring-[rgba(143,179,157,0.20)]">
              <Users size={14} style={{ color: 'var(--accent-positive)' }} />
            </div>
            <p className="type-label text-[color:var(--text-faint)]">CONTRATOS ATIVOS</p>
          </div>
          <div>
            <p className="type-metric-lg" style={{ color: 'var(--accent-positive)' }}>
              {totals.activeContracts}
            </p>
            <p className="mt-0.5 type-caption text-[color:var(--text-faint)]">
              Bullet: {summaryMetrics.find((m) => m.category === 'bullet')?.activeContracts ?? 0}
              {' | '}
              Parcel.: {summaryMetrics.find((m) => m.category === 'parcelado')?.activeContracts ?? 0}
            </p>
          </div>
        </div>

        {/* Rendimento Projetado */}
        <div className={`${panelClass} card-hover flex flex-col gap-3 p-4 md:p-5`}>
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 rounded-xl p-2.5 bg-[rgba(251,191,36,0.14)] ring-1 ring-[rgba(251,191,36,0.18)]">
              <CalendarRange size={14} style={{ color: 'var(--accent-warning)' }} />
            </div>
            <p className="type-label text-[color:var(--text-faint)]">REND. PROJETADO</p>
          </div>
          <div>
            <p className="type-metric-lg" style={{ color: 'var(--accent-warning)' }}>
              {formatCurrency(totals.projectedYield)}
            </p>
            <p className="mt-0.5 type-caption text-[color:var(--text-faint)]">Juros futuros pendentes</p>
          </div>
        </div>
      </div>

      {/* CHARTS ROW */}
      {!hasData ? (
        <div className={`${panelClass} flex h-64 flex-col items-center justify-center gap-3 p-6`}>
          <TrendingUp size={32} className="text-[color:var(--text-faint)] opacity-30" aria-hidden="true" />
          <p className="type-label text-[color:var(--text-faint)]">Nenhum rendimento registrado</p>
          <p className="type-caption text-[color:var(--text-faint)] text-center max-w-xs">
            Rendimentos aparecerão aqui quando parcelas forem pagas
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">

          {/* DONUT — Composição do portfólio */}
          <div className={`${panelClass} p-4 md:p-6`}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="section-kicker mb-1">Portfólio</p>
                <h3 className="type-title text-[color:var(--text-primary)]">Composição por tipo</h3>
              </div>
              {/* Toggle Por Categoria / Detalhado */}
              <div className="flex rounded-full border border-white/10 bg-black/10 p-0.5 shrink-0">
                <button
                  onClick={() => setDonutMode('category')}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                    donutMode === 'category'
                      ? 'bg-white/10 text-[color:var(--text-primary)]'
                      : 'text-[color:var(--text-muted)]'
                  }`}
                >
                  Categoria
                </button>
                <button
                  onClick={() => setDonutMode('detail')}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                    donutMode === 'detail'
                      ? 'bg-white/10 text-[color:var(--text-primary)]'
                      : 'text-[color:var(--text-muted)]'
                  }`}
                >
                  Detalhe
                </button>
              </div>
            </div>

            {compositionData.length === 0 ? (
              <div className="flex h-48 items-center justify-center">
                <p className="type-caption text-[color:var(--text-faint)]">Sem dados de capital</p>
              </div>
            ) : (
              <>
                <div className="h-48" aria-label="Gráfico de composição do portfólio por tipo de contrato">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutMode === 'category' ? compositionData : granularMetrics.filter((m) => m.capitalAllocated > 0).map((m) => ({ name: m.shortLabel, value: m.capitalAllocated, color: m.color }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={88}
                        paddingAngle={3}
                        dataKey="value"
                        onClick={(d: any) => {
                          const key = donutMode === 'category'
                            ? (d.name === 'Bullet' ? 'bullet' : 'parcelado')
                            : granularMetrics.find((m) => m.shortLabel === d.name)?.key;
                          if (key) {
                            highlightRow(key as string);
                            setTypeFilter(key as YieldTypeFilter);
                          }
                        }}
                      >
                        {(donutMode === 'category' ? compositionData : granularMetrics.filter((m) => m.capitalAllocated > 0).map((m) => ({ name: m.shortLabel, value: m.capitalAllocated, color: m.color }))).map((entry, i) => (
                          <Cell
                            key={`cell-${i}`}
                            fill={entry.color}
                            opacity={highlightType && !entry.name.toLowerCase().includes(highlightType) ? 0.35 : 1}
                            style={{ cursor: 'pointer' }}
                          />
                        ))}
                        <DonutCenterLabel total={totals.capitalAllocated} />
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => [formatCurrency(value), 'Capital']}
                        contentStyle={CHART_STYLE.contentStyle}
                        labelStyle={CHART_STYLE.labelStyle}
                        itemStyle={CHART_STYLE.itemStyle}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend */}
                <div className="mt-3 space-y-1.5">
                  {compositionData.map((d) => {
                    const total = compositionData.reduce((s, c) => s + c.value, 0);
                    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
                    return (
                      <div key={d.name} className="flex items-center justify-between gap-2 type-caption">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 shrink-0 rounded-sm" style={{ background: d.color }} />
                          <span className="text-[color:var(--text-secondary)]">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[color:var(--text-faint)]">
                          <span>{formatCurrency(d.value)}</span>
                          <span className="opacity-60">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* STACKED BAR — Evolução Mensal */}
          <div className={`${panelClass} p-4 md:p-6`}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="section-kicker mb-1">Evolução</p>
                <h3 className="type-title text-[color:var(--text-primary)]">Juros recebidos por mês</h3>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-1.5 type-caption text-[color:var(--text-faint)]">
                  <div className="h-2 w-3 rounded-sm" style={{ background: '#90a0bd' }} />
                  <span>Parcelado</span>
                </div>
                <div className="flex items-center gap-1.5 type-caption text-[color:var(--text-faint)]">
                  <div className="h-2 w-3 rounded-sm" style={{ background: '#cab07a' }} />
                  <span>Bullet</span>
                </div>
              </div>
            </div>

            <div
              className="h-52 min-w-0 md:h-[260px]"
              aria-label="Gráfico de evolução mensal de juros recebidos"
            >
              {evolutionData.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <TrendingUp size={22} className="text-[color:var(--text-faint)]" aria-hidden="true" />
                  <p className="type-label text-[color:var(--text-faint)]">Nenhum juros recebido ainda</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={evolutionData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(245,239,226,0.05)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#8d919a', fontSize: 11, fontWeight: 700 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      tick={{ fill: '#8d919a', fontSize: 11 }}
                      tickFormatter={currencyTick}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatCurrency(value),
                        name === 'bullet' ? 'Bullet' : 'Parcelado',
                      ]}
                      contentStyle={CHART_STYLE.contentStyle}
                      labelStyle={CHART_STYLE.labelStyle}
                      itemStyle={CHART_STYLE.itemStyle}
                    />
                    <Bar
                      dataKey="parcelado"
                      stackId="yield"
                      fill="#90a0bd"
                      radius={[0, 0, 4, 4]}
                      name="parcelado"
                    />
                    <Bar
                      dataKey="bullet"
                      stackId="yield"
                      fill="#cab07a"
                      radius={[4, 4, 0, 0]}
                      name="bullet"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BREAKDOWN TABLE */}
      {tableMetrics.length > 0 && (
        <div ref={tableRef} className={`${panelClass} overflow-hidden`}>
          <div className="p-4 md:p-6 border-b border-white/[0.06]">
            <p className="section-kicker mb-1">Detalhamento</p>
            <h3 className="type-title text-[color:var(--text-primary)]">Rendimento por tipo de contrato</h3>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto" aria-label="Detalhamento de rendimento por tipo">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08] bg-white/[0.02]">
                  <th className="px-5 py-3 text-left type-label text-[color:var(--text-faint)]">Tipo</th>
                  <th className="px-4 py-3 text-right type-label text-[color:var(--text-faint)]">Contratos</th>
                  <th className="px-4 py-3 text-right type-label text-[color:var(--text-faint)]">Capital</th>
                  <th className="px-4 py-3 text-right type-label text-[color:var(--text-faint)]">Juros Receb.</th>
                  <th className="px-4 py-3 text-right type-label text-[color:var(--text-faint)]">Yield %</th>
                  <th className="px-4 py-3 text-right type-label text-[color:var(--text-faint)]">Tendência</th>
                </tr>
              </thead>
              <tbody>
                {tableMetrics.map((m) => (
                  <tr
                    key={m.key}
                    className={`border-b border-white/[0.05] last:border-0 transition-colors cursor-pointer ${
                      highlightType === m.key || highlightType === m.category
                        ? 'bg-white/[0.06] ring-1 ring-inset ring-[rgba(202,176,122,0.25)]'
                        : 'hover:bg-white/[0.04]'
                    }`}
                    onClick={() => setHighlightType(highlightType === m.key ? null : m.key)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: m.color }} />
                        <span className="text-sm font-medium text-[color:var(--text-primary)]">{m.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-sm text-[color:var(--text-secondary)]">
                      {m.activeContracts}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-sm text-[color:var(--text-secondary)]">
                      {formatCurrency(m.capitalAllocated)}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-sm font-semibold" style={{ color: m.color }}>
                      {formatCurrency(m.interestReceived)}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-sm text-[color:var(--text-secondary)]">
                      {formatPct(m.yieldPercent)}
                    </td>
                    <td className="px-4 py-3.5 flex justify-end" aria-hidden="true">
                      <Sparkline data={m.monthlyData} color={m.color} />
                    </td>
                  </tr>
                ))}

                {/* Total row */}
                <tr className="bg-white/[0.02] font-bold">
                  <td className="px-5 py-3.5 text-sm text-[color:var(--text-primary)]">Total</td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-sm text-[color:var(--text-primary)]">
                    {totals.activeContracts}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-sm text-[color:var(--text-primary)]">
                    {formatCurrency(totals.capitalAllocated)}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-sm text-[color:var(--accent-brass)]">
                    {formatCurrency(totals.interestReceived)}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-sm text-[color:var(--text-primary)]">
                    {totals.capitalAllocated > 0
                      ? formatPct((totals.interestReceived / totals.capitalAllocated) * 100)
                      : '—'}
                  </td>
                  <td className="px-4 py-3.5" />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-white/[0.06]">
            {tableMetrics.map((m) => (
              <div key={m.key} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-sm" style={{ background: m.color }} />
                    <span className="text-sm font-semibold text-[color:var(--text-primary)]">{m.label}</span>
                  </div>
                  <span className="text-sm font-bold" style={{ color: m.color }}>
                    {formatCurrency(m.interestReceived)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="type-caption text-[color:var(--text-faint)]">Capital</p>
                    <p className="text-xs font-medium text-[color:var(--text-secondary)] tabular-nums">
                      {formatCurrency(m.capitalAllocated)}
                    </p>
                  </div>
                  <div>
                    <p className="type-caption text-[color:var(--text-faint)]">Contratos</p>
                    <p className="text-xs font-medium text-[color:var(--text-secondary)]">{m.activeContracts}</p>
                  </div>
                  <div>
                    <p className="type-caption text-[color:var(--text-faint)]">Yield</p>
                    <p className="text-xs font-medium text-[color:var(--text-secondary)]">{formatPct(m.yieldPercent)}</p>
                  </div>
                </div>
                <Sparkline data={m.monthlyData} color={m.color} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state when filter returns nothing */}
      {!hasData && filter.typeFilter !== 'all' && (
        <div className={`${panelClass} flex flex-col items-center gap-3 p-8 text-center`}>
          <p className="type-body text-[color:var(--text-faint)]">
            Nenhum rendimento neste período para este tipo de contrato.
          </p>
          <button
            onClick={() => setFilter({ typeFilter: 'all', period: 'all' })}
            className="rounded-full px-4 py-1.5 text-xs font-medium border border-white/10 hover:bg-white/[0.05] text-[color:var(--text-secondary)] transition-colors cursor-pointer"
          >
            Ver todos os tipos
          </button>
        </div>
      )}
    </div>
  );
};

export default YieldByContractType;
