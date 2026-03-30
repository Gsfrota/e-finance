import React, { useState, useRef, useMemo } from 'react';
import { Investment, LoanInstallment } from '../../types';
import {
  useYieldMetrics,
  buildTypeFilterOptions,
  classifyContract,
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
  AlertTriangle,
  CheckCircle,
  Clock,
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

// --- TYPES: CLIENT LIST ---

interface ClientContract {
  investmentId: number;
  contractName: string;
  typeKey: string;
  typeLabel: string;
  typeColor: string;
  paidCount: number;
  lateCount: number;
  pendingCount: number;
  totalDue: number;
  totalPaid: number;
  installments: LoanInstallment[];
}

interface ClientByType {
  payerName: string;
  payerId?: string;
  contracts: ClientContract[];
  totalLate: number;
  totalPaid: number;
  totalPending: number;
}

// --- CLIENT STATUS BADGE ---
const StatusBadge: React.FC<{ lateCount: number; pendingCount: number; paidCount: number; total: number }> = ({
  lateCount, pendingCount, paidCount, total,
}) => {
  if (total === 0) return null;
  if (lateCount > 0)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(220,80,80,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--accent-danger)]">
        <AlertTriangle size={9} /> {lateCount} atrasada{lateCount > 1 ? 's' : ''}
      </span>
    );
  if (paidCount === total)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(143,179,157,0.14)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--accent-positive)]">
        <CheckCircle size={9} /> Em dia
      </span>
    );
  if (pendingCount > 0)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(144,160,189,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--text-secondary)]">
        <Clock size={9} /> {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
      </span>
    );
  return null;
};

// Status label para parcela individual
const INST_STATUS_LABEL: Record<string, string> = {
  paid: 'Pago', partial: 'Parcial', late: 'Atrasado', pending: 'Pendente',
};
const INST_STATUS_CLASS: Record<string, string> = {
  paid: 'text-[color:var(--accent-positive)]',
  partial: 'text-[color:var(--accent-warning,#d4a017)]',
  late: 'text-[color:var(--accent-danger)]',
  pending: 'text-[color:var(--text-secondary)]',
};

const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// --- MAIN COMPONENT ---

const YieldByContractType: React.FC<YieldByContractTypeProps> = ({
  investments,
  allPaidInstallments,
  pendingInstallments,
}) => {
  const [filter, setFilter] = useState<YieldFilter>({ typeFilter: 'all', period: 'month' });
  const [donutMode, setDonutMode] = useState<'category' | 'detail'>('category');
  const [highlightType, setHighlightType] = useState<string | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [expandedClientContract, setExpandedClientContract] = useState<number | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const clientsRef = useRef<HTMLDivElement>(null);

  const metrics = useYieldMetrics(investments, allPaidInstallments, pendingInstallments, filter);
  const { summaryMetrics, granularMetrics, totals, evolutionData, compositionData } = metrics;

  // --- Clientes por tipo ---
  const clientsByType = useMemo<ClientByType[]>(() => {
    const allInsts = [...allPaidInstallments, ...pendingInstallments];
    const instMap = new Map<number, LoanInstallment[]>();
    allInsts.forEach((i) => {
      const arr = instMap.get(i.investment_id) ?? [];
      arr.push(i);
      instMap.set(i.investment_id, arr);
    });

    const activeInvs = investments.filter(
      (inv) => !inv.status || inv.status === 'active',
    );

    const filtered = activeInvs.filter((inv) => {
      if (filter.typeFilter === 'all') return true;
      const cls = classifyContract(inv.calculation_mode, inv.frequency);
      return filter.typeFilter === cls.category || filter.typeFilter === cls.key;
    });

    const byPayer = new Map<string, ClientByType>();
    filtered.forEach((inv) => {
      const payerKey = inv.payer_id || inv.payer_name || `inv_${inv.id}`;
      const payerName = inv.payer_name || 'Devedor desconhecido';
      const cls = classifyContract(inv.calculation_mode, inv.frequency);
      const insts = (instMap.get(inv.id) ?? []).sort((a, b) => a.number - b.number);

      const paidCount = insts.filter((i) => i.status === 'paid' || i.status === 'partial').length;
      const lateCount = insts.filter((i) => i.status === 'late').length;
      const pendingCount = insts.filter((i) => i.status === 'pending').length;
      const totalDue = insts.reduce((s, i) => s + i.amount_total, 0);
      const totalPaid = insts.reduce((s, i) => s + i.amount_paid, 0);

      const entry = byPayer.get(payerKey) ?? { payerName, payerId: inv.payer_id, contracts: [], totalLate: 0, totalPaid: 0, totalPending: 0 };
      entry.contracts.push({
        investmentId: inv.id,
        contractName: inv.asset_name,
        typeKey: cls.key,
        typeLabel: cls.label,
        typeColor: cls.color,
        paidCount,
        lateCount,
        pendingCount,
        totalDue,
        totalPaid,
        installments: insts,
      });
      entry.totalLate += lateCount;
      entry.totalPaid += paidCount;
      entry.totalPending += pendingCount;
      byPayer.set(payerKey, entry);
    });

    return Array.from(byPayer.values()).sort((a, b) => b.totalLate - a.totalLate || b.totalPending - a.totalPending);
  }, [investments, allPaidInstallments, pendingInstallments, filter.typeFilter]);

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

      {/* FILTER BAR — 2 linhas no mobile, 1 linha no desktop */}
      <div className={`${panelClass} flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4`}>
        {/* Linha 1 (mobile) / Esquerda (desktop): Dropdown tipo */}
        <div className="relative w-full sm:w-auto sm:shrink-0 sm:min-w-[200px]">
          <select
            value={filter.typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as YieldTypeFilter)}
            className="w-full appearance-none rounded-xl border border-white/10 bg-white/[0.06] pl-3 pr-8 text-base sm:text-sm font-medium text-[color:var(--text-primary)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-brass)] transition-colors hover:bg-white/[0.09]"
            style={{ minHeight: '44px' }}
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

        {/* Linha 2 (mobile) / Direita (desktop): Period pills — ocupam toda a largura mobile */}
        <div
          className="flex gap-1 rounded-xl border border-white/10 bg-black/10 p-1"
          role="radiogroup"
          aria-label="Período de análise"
        >
          {PERIOD_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              role="radio"
              aria-checked={filter.period === value}
              onClick={() => setPeriod(value)}
              className={`flex-1 sm:flex-none rounded-lg px-3 text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                filter.period === value
                  ? 'bg-[color:var(--accent-brass)] text-[color:var(--text-on-accent)] shadow-[0_2px_8px_rgba(240,180,41,0.28)]'
                  : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-white/[0.05]'
              }`}
              style={{ minHeight: '40px' }}
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
              {/* Toggle Por Categoria / Detalhado — min 36px touch target */}
              <div className="flex rounded-xl border border-white/10 bg-black/10 p-0.5 shrink-0">
                {(['category', 'detail'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setDonutMode(mode)}
                    className={`rounded-lg px-3 text-xs font-medium transition-all cursor-pointer ${
                      donutMode === mode
                        ? 'bg-white/10 text-[color:var(--text-primary)]'
                        : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'
                    }`}
                    style={{ minHeight: '32px' }}
                    aria-pressed={donutMode === mode}
                  >
                    {mode === 'category' ? 'Categoria' : 'Detalhe'}
                  </button>
                ))}
              </div>
            </div>

            {compositionData.length === 0 ? (
              <div className="flex h-48 items-center justify-center">
                <p className="type-caption text-[color:var(--text-faint)]">Sem dados de capital</p>
              </div>
            ) : (
              <>
                {/* Donut — altura maior no mobile para toque confortável */}
                <div className="h-52 sm:h-48" aria-label="Gráfico de composição do portfólio por tipo de contrato">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutMode === 'category' ? compositionData : granularMetrics.filter((m) => m.capitalAllocated > 0).map((m) => ({ name: m.shortLabel, value: m.capitalAllocated, color: m.color }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={58}
                        outerRadius={92}
                        paddingAngle={3}
                        dataKey="value"
                        isAnimationActive={false}
                      >
                        {(donutMode === 'category' ? compositionData : granularMetrics.filter((m) => m.capitalAllocated > 0).map((m) => ({ name: m.shortLabel, value: m.capitalAllocated, color: m.color }))).map((entry, i) => (
                          <Cell
                            key={`cell-${i}`}
                            fill={entry.color}
                            opacity={highlightType && !entry.name.toLowerCase().includes(highlightType) ? 0.3 : 1}
                          />
                        ))}
                        <DonutCenterLabel total={totals.capitalAllocated} />
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name: string, props: any) => {
                          const total = compositionData.reduce((s, c) => s + c.value, 0);
                          const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                          return [`${formatCurrency(value)} (${pct}%)`, props.name || 'Capital'];
                        }}
                        contentStyle={CHART_STYLE.contentStyle}
                        labelStyle={CHART_STYLE.labelStyle}
                        itemStyle={CHART_STYLE.itemStyle}
                        wrapperStyle={{ zIndex: 50 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend — clicável para filtrar */}
                <div className="mt-3 space-y-1">
                  {compositionData.map((d) => {
                    const total = compositionData.reduce((s, c) => s + c.value, 0);
                    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
                    const isActive = filter.typeFilter === 'all' || filter.typeFilter === (d.name === 'Bullet' ? 'bullet' : 'parcelado');
                    return (
                      <button
                        key={d.name}
                        onClick={() => setTypeFilter(d.name === 'Bullet' ? 'bullet' : 'parcelado')}
                        className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer ${isActive ? 'hover:bg-white/[0.04]' : 'opacity-50 hover:opacity-75 hover:bg-white/[0.02]'}`}
                        style={{ minHeight: '36px' }}
                        aria-label={`Filtrar por ${d.name}`}
                      >
                        <div className="flex items-center gap-2 type-caption">
                          <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
                          <span className="text-[color:var(--text-secondary)]">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-2 type-caption text-[color:var(--text-faint)]">
                          <span className="tabular-nums">{formatCurrency(d.value)}</span>
                          <span className="opacity-60 tabular-nums">{pct}%</span>
                        </div>
                      </button>
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
              className="h-56 min-w-0 sm:h-52 md:h-[268px]"
              aria-label="Gráfico de evolução mensal de juros recebidos"
            >
              {evolutionData.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <TrendingUp size={22} className="text-[color:var(--text-faint)]" aria-hidden="true" />
                  <p className="type-label text-[color:var(--text-faint)]">Nenhum juros recebido ainda</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={evolutionData} margin={{ top: 20, right: 4, left: -4, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(245,239,226,0.05)" vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#8d919a', fontSize: 12, fontWeight: 600 }}
                      dy={4}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      tick={{ fill: '#8d919a', fontSize: 11 }}
                      tickFormatter={(v) => {
                        if (!v) return '';
                        if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}k`;
                        return `${Math.round(v)}`;
                      }}
                      tickCount={4}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                      formatter={(value: number, name: string) => [
                        formatCurrency(value),
                        name === 'bullet' ? 'Bullet' : 'Parcelado',
                      ]}
                      labelFormatter={(label) => `Mês: ${label}`}
                      contentStyle={CHART_STYLE.contentStyle}
                      labelStyle={{ ...CHART_STYLE.labelStyle, marginBottom: 4, fontWeight: 600 }}
                      itemStyle={CHART_STYLE.itemStyle}
                      wrapperStyle={{ zIndex: 50 }}
                    />
                    <Bar
                      dataKey="parcelado"
                      stackId="yield"
                      fill="#90a0bd"
                      radius={[0, 0, 4, 4]}
                      name="parcelado"
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="bullet"
                      stackId="yield"
                      fill="#cab07a"
                      radius={[4, 4, 0, 0]}
                      name="bullet"
                      isAnimationActive={false}
                      label={{
                        position: 'top',
                        content: ({ x, y, width, index }: any) => {
                          if (index == null || !evolutionData[index]) return null;
                          const total = (evolutionData[index].bullet ?? 0) + (evolutionData[index].parcelado ?? 0);
                          if (!total) return null;
                          const label = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${Math.round(total)}`;
                          return (
                            <text
                              x={(x ?? 0) + (width ?? 0) / 2}
                              y={(y ?? 0) - 4}
                              textAnchor="middle"
                              fill="#8d919a"
                              fontSize={10}
                              fontWeight={600}
                            >
                              {label}
                            </text>
                          );
                        },
                      }}
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

      {/* CLIENTES POR TIPO */}
      {clientsByType.length > 0 && (
        <div ref={clientsRef} className={`${panelClass} overflow-hidden`}>
          <div className="p-4 md:p-6 border-b border-white/[0.06]">
            <p className="section-kicker mb-1">Carteira</p>
            <h3 className="type-title text-[color:var(--text-primary)]">
              Clientes por Tipo
              {filter.typeFilter !== 'all' && (
                <span className="ml-2 text-sm font-normal text-[color:var(--text-faint)]">
                  — {typeOptions.find(o => o.value === filter.typeFilter)?.label ?? filter.typeFilter}
                </span>
              )}
            </h3>
          </div>

          <div className="divide-y divide-white/[0.05]">
            {clientsByType.map((client) => {
              const clientKey = client.payerId || client.payerName;
              const isOpen = expandedClient === clientKey;
              const totalContracts = client.contracts.length;
              const allInstCount = client.contracts.reduce((s, c) => s + c.installments.length, 0);
              const totalDueAll = client.contracts.reduce((s, c) => s + c.totalDue, 0);
              const totalPaidAll = client.contracts.reduce((s, c) => s + c.totalPaid, 0);
              const payPct = totalDueAll > 0 ? Math.min(100, (totalPaidAll / totalDueAll) * 100) : 0;

              return (
                <div key={clientKey} className="overflow-hidden">
                  {/* Header — clicável */}
                  <button
                    onClick={() => setExpandedClient(isOpen ? null : clientKey)}
                    className="w-full p-4 text-left cursor-pointer hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[color:var(--text-primary)] truncate">{client.payerName}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {/* Type badges (um por contrato) */}
                          {client.contracts.slice(0, 3).map((c) => (
                            <span
                              key={c.investmentId}
                              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                              style={{ background: `${c.typeColor}22`, color: c.typeColor }}
                            >
                              {c.typeLabel}
                            </span>
                          ))}
                          {client.contracts.length > 3 && (
                            <span className="text-[10px] text-[color:var(--text-faint)]">+{client.contracts.length - 3}</span>
                          )}
                          <span className="text-[10px] text-[color:var(--text-faint)]">
                            · {totalContracts} contrato{totalContracts > 1 ? 's' : ''} · {allInstCount} parcela{allInstCount > 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge
                          lateCount={client.totalLate}
                          pendingCount={client.totalPending}
                          paidCount={client.totalPaid}
                          total={client.totalLate + client.totalPaid + client.totalPending}
                        />
                        <ChevronDown
                          size={14}
                          className={`text-[color:var(--text-faint)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          client.totalLate > 0
                            ? 'bg-[color:var(--accent-danger)]'
                            : payPct >= 80
                            ? 'bg-[color:var(--accent-positive)]'
                            : 'bg-[color:var(--accent-warning,#d4a017)]'
                        }`}
                        style={{ width: `${payPct}%` }}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[color:var(--text-faint)]">Previsto </span>
                        <span className="font-semibold text-[color:var(--text-primary)]">{formatCurrency(totalDueAll)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[color:var(--text-faint)]">Pago </span>
                        <span className={`font-semibold ${payPct >= 100 ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--text-primary)]'}`}>
                          {formatCurrency(totalPaidAll)}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Expanded: contratos deste cliente */}
                  {isOpen && (
                    <div className="border-t border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.04]">
                      {client.contracts.map((contract) => {
                        const cKey = contract.investmentId;
                        const cOpen = expandedClientContract === cKey;
                        return (
                          <div key={cKey}>
                            <button
                              onClick={() => setExpandedClientContract(cOpen ? null : cKey)}
                              className="w-full px-5 py-3 text-left cursor-pointer hover:bg-white/[0.03] transition-colors"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="h-2 w-2 shrink-0 rounded-sm" style={{ background: contract.typeColor }} />
                                  <span className="text-xs font-medium text-[color:var(--text-primary)] truncate">{contract.contractName}</span>
                                  <span className="text-[10px] text-[color:var(--text-faint)] shrink-0">{contract.typeLabel}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {contract.lateCount > 0 && (
                                    <span className="text-[10px] font-semibold text-[color:var(--accent-danger)]">
                                      {contract.lateCount} atrasada{contract.lateCount > 1 ? 's' : ''}
                                    </span>
                                  )}
                                  {contract.lateCount === 0 && contract.pendingCount > 0 && (
                                    <span className="text-[10px] text-[color:var(--text-secondary)]">
                                      {contract.pendingCount} pendente{contract.pendingCount > 1 ? 's' : ''}
                                    </span>
                                  )}
                                  {contract.lateCount === 0 && contract.pendingCount === 0 && (
                                    <span className="text-[10px] font-semibold text-[color:var(--accent-positive)]">Em dia</span>
                                  )}
                                  <ChevronDown
                                    size={12}
                                    className={`text-[color:var(--text-faint)] transition-transform duration-200 ${cOpen ? 'rotate-180' : ''}`}
                                  />
                                </div>
                              </div>
                            </button>

                            {/* Installments table */}
                            {cOpen && contract.installments.length > 0 && (
                              <div className="px-5 pb-4">
                                <div className="overflow-hidden rounded-lg border border-white/[0.08]">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-white/[0.08] bg-white/[0.03]">
                                        <th className="px-3 py-2 text-left font-medium text-[color:var(--text-faint)]">#</th>
                                        <th className="px-3 py-2 text-left font-medium text-[color:var(--text-faint)]">Venc.</th>
                                        <th className="px-3 py-2 text-right font-medium text-[color:var(--text-faint)]">Total</th>
                                        <th className="px-3 py-2 text-right font-medium text-[color:var(--text-faint)]">Pago</th>
                                        <th className="px-3 py-2 text-right font-medium text-[color:var(--text-faint)]">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {contract.installments.map((inst) => (
                                        <tr key={inst.id} className="border-b border-white/[0.05] last:border-0">
                                          <td className="px-3 py-2 text-[color:var(--text-secondary)]">#{inst.number}</td>
                                          <td className="px-3 py-2 text-[color:var(--text-secondary)]">{fmtDate(inst.due_date)}</td>
                                          <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">
                                            {formatCurrency(inst.amount_total)}
                                            {(inst.fine_amount > 0 || inst.interest_delay_amount > 0) && (
                                              <div className="text-[10px] text-[color:var(--accent-danger)]">
                                                +{formatCurrency(inst.fine_amount + inst.interest_delay_amount)}
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">
                                            {inst.amount_paid > 0 ? formatCurrency(inst.amount_paid) : '—'}
                                          </td>
                                          <td className={`px-3 py-2 text-right font-semibold ${INST_STATUS_CLASS[inst.status] ?? 'text-[color:var(--text-secondary)]'}`}>
                                            {INST_STATUS_LABEL[inst.status] ?? inst.status}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default YieldByContractType;
