import React, { useMemo, useState } from 'react';
import { AdminDashboardStats, AppView, DashboardKPIs, Investment, LoanInstallment, Tenant } from '../../types';
import { PaymentModal, RefinanceModal, EditModal, InterestOnlyModal } from '../InstallmentModals';
import {
  AlertTriangle,
  Bot,
  BriefcaseBusiness,
  Calendar,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Coins,
  DollarSign,
  FileText,
  Pencil,
  Percent,
  Phone,
  PieChart,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart as RechartsPieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

const normalizeNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
};

const calculateOutstanding = (installment: LoanInstallment): number => {
  const total = normalizeNumber(installment.amount_total);
  const fine = normalizeNumber(installment.fine_amount);
  const delay = normalizeNumber(installment.interest_delay_amount);
  const paid = normalizeNumber(installment.amount_paid);
  return Math.max(0, total + fine + delay - paid);
};

const isInstallmentOverdue = (installment: LoanInstallment): boolean => {
  if (installment.status === 'paid') return false;
  const today = new Date().toISOString().split('T')[0];
  return installment.due_date < today && calculateOutstanding(installment) > 0.01;
};

const formatDate = (ymd: string) => {
  const [year, month, day] = ymd.split('-');
  return `${day}/${month}/${year}`;
};

const computeAgingBuckets = (installments: LoanInstallment[]) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets = [
    { name: '≤7d',   label: 'Até 7 dias',  value: 0, color: '#fbbf24' },
    { name: '8–15d', label: '8 a 15 dias', value: 0, color: '#f97316' },
    { name: '16–30d',label: '16 a 30d',    value: 0, color: '#ef4444' },
    { name: '1–2m',  label: '1 a 2 meses', value: 0, color: '#dc2626' },
    { name: '>60d',  label: 'Mais de 60d', value: 0, color: '#991b1b' },
  ];

  installments.forEach((installment) => {
    if (!isInstallmentOverdue(installment)) return;

    const dueDate = new Date(`${installment.due_date}T00:00:00`);
    const days = Math.ceil(Math.abs(today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    const value = calculateOutstanding(installment);

    if (days <= 7) buckets[0].value += value;
    else if (days <= 15) buckets[1].value += value;
    else if (days <= 30) buckets[2].value += value;
    else if (days <= 60) buckets[3].value += value;
    else buckets[4].value += value;
  });

  return buckets;
};

const currencyTick = (value: number) => {
  if (!value) return 'R$ 0';
  if (Math.abs(value) >= 1000) return `R$ ${Math.round(value / 1000)}k`;
  return `R$ ${Math.round(value)}`;
};

const panelClass = 'panel-card rounded-[1.8rem]';

interface ResumoGeralProps {
  kpis: DashboardKPIs;
}

export const ResumoGeral: React.FC<ResumoGeralProps> = ({ kpis }) => {
  const lucroAReceber = Math.max(0, kpis.totalProfitPotential - kpis.totalProfitReceived);
  const roi = kpis.totalInvestedHistorical > 0
    ? ((kpis.totalProfitReceived / kpis.totalInvestedHistorical) * 100).toFixed(1)
    : '0,0';

  const items: Array<{
    label: string;
    desc: string;
    value: string;
    color: string;
    bg: string;
    ring: string;
    Icon: React.ElementType;
  }> = [
    {
      label: 'CAPITAL EM RUA',
      desc: 'Dinheiro atualmente emprestado',
      value: formatCurrency(kpis.activeStreetMoney),
      color: 'var(--accent-brass)',
      bg: 'rgba(202,176,122,0.12)',
      ring: 'rgba(202,176,122,0.20)',
      Icon: Wallet,
    },
    {
      label: 'LUCRO RECEBIDO',
      desc: 'Já entrou no seu bolso',
      value: formatCurrency(kpis.totalProfitReceived),
      color: 'var(--accent-positive)',
      bg: 'rgba(143,179,157,0.12)',
      ring: 'rgba(143,179,157,0.20)',
      Icon: TrendingUp,
    },
    {
      label: 'LUCRO A RECEBER',
      desc: 'Juros futuros contratados',
      value: formatCurrency(lucroAReceber),
      color: 'var(--accent-steel)',
      bg: 'rgba(74,101,133,0.18)',
      ring: 'rgba(74,101,133,0.28)',
      Icon: Percent,
    },
    {
      label: 'RETORNO (ROI)',
      desc: 'Lucro recebido ÷ capital total',
      value: `${roi.replace('.', ',')}%`,
      color: '#a78bfa',
      bg: 'rgba(167,139,250,0.10)',
      ring: 'rgba(167,139,250,0.20)',
      Icon: CircleDollarSign,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-5 lg:grid-cols-4">
      {items.map(({ label, desc, value, color, bg, ring, Icon }) => (
        <div key={label} className={`${panelClass} flex flex-col gap-3 p-4 md:p-6`}>
          <div className="flex items-center gap-2.5">
            <div className="shrink-0 rounded-xl p-2.5" style={{ background: bg, boxShadow: `0 0 0 1px ${ring}` }}>
              <Icon size={15} style={{ color }} />
            </div>
            <p className="text-[10px] font-extrabold uppercase leading-tight tracking-[0.13em] text-[color:var(--text-faint)]">{label}</p>
          </div>
          <div>
            <p className="text-xl font-extrabold tracking-tight md:text-2xl" style={{ color }}>
              {value}
            </p>
            <p className="mt-0.5 text-xs text-[color:var(--text-faint)]">{desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

interface KPICardsProps {
  stats: AdminDashboardStats;
  kpis: DashboardKPIs;
  installments: LoanInstallment[];
  onGoToCollection?: () => void;
}

type CobraDias = 0 | 3 | 6 | 15 | 30;

export const KPICards: React.FC<KPICardsProps> = ({ kpis, installments, onGoToCollection }) => {
  const [cobraDias, setCobraDias] = useState<CobraDias>(15);

  const aCobraValor = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    if (cobraDias === 0) {
      const todayStr = hoje.toISOString().split('T')[0];
      return installments
        .filter((i) => {
          if (!['pending', 'late', 'partial'].includes(i.status)) return false;
          return i.due_date === todayStr;
        })
        .reduce((sum, i) => sum + calculateOutstanding(i), 0);
    }

    const limite = new Date(hoje);
    limite.setDate(limite.getDate() + cobraDias);
    return installments
      .filter((i) => {
        if (!['pending', 'late', 'partial'].includes(i.status)) return false;
        const due = new Date(i.due_date + 'T00:00:00');
        return due <= limite;
      })
      .reduce((sum, i) => sum + calculateOutstanding(i), 0);
  }, [installments, cobraDias]);

  const pct = kpis.expectedMonth > 0 ? Math.round((kpis.receivedByPaymentMonth / kpis.expectedMonth) * 100) : 0;
  const progressColor = pct >= 80 ? 'bg-[color:var(--accent-positive)]' : pct >= 50 ? 'bg-[color:var(--accent-warning)]' : 'bg-[color:var(--accent-danger)]';

  return (
    <div className="grid grid-cols-1 gap-3 md:gap-5 lg:grid-cols-3">
      {/* Recebimentos do Mês */}
      <div className={`${panelClass} flex flex-col gap-4 p-4 md:p-7`}>
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-[color:var(--accent-brass)]" />
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[color:var(--text-faint)]">RECEBIMENTOS DO MÊS</p>
        </div>
        <div>
          <p className="mb-0.5 text-xs text-[color:var(--text-faint)]">Total esperado</p>
          <p className="text-sm font-semibold text-[color:var(--text-secondary)]">{formatCurrency(kpis.expectedMonth)}</p>
        </div>
        <div className="text-xl font-extrabold tracking-tight text-[color:var(--accent-positive)] md:text-[2.4rem]">
          {formatCurrency(kpis.receivedByPaymentMonth)}
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-[color:var(--text-faint)]">
            <span>{Math.min(100, pct)}% recebido{pct > 100 ? ` (real: ${pct}%)` : ''}</span>
            <span>{formatCurrency(Math.max(0, kpis.expectedMonth - kpis.receivedByPaymentMonth))} restante</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full transition-all duration-500 ${progressColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
      </div>

      {/* Em Atraso */}
      <div className={`${panelClass} flex flex-col gap-4 p-4 md:p-7`}>
        <div className="flex items-center gap-3">
          <AlertTriangle size={18} className="text-[color:var(--accent-danger)]" />
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[color:var(--text-faint)]">EM ATRASO</p>
        </div>
        <div className="text-xl font-extrabold tracking-tight text-[color:var(--accent-danger)] md:text-[2.4rem]">
          {formatCurrency(kpis.totalOverdue)}
        </div>
      </div>

      {/* A Cobrar com filtro de dias */}
      <div className={`${panelClass} flex flex-col gap-4 p-4 md:p-7`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Zap size={18} className="text-[color:var(--accent-brass)]" />
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[color:var(--text-faint)]">
              A COBRAR{cobraDias === 0 ? ' — HOJE' : ` — PRÓX. ${cobraDias}D`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {([0, 3, 6, 15, 30] as CobraDias[]).map((d) => (
              <button
                key={d}
                onClick={() => setCobraDias(d)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide transition-all ${
                  cobraDias === d
                    ? 'bg-[color:var(--accent-brass)] text-[#17120b]'
                    : 'bg-white/[0.05] text-[color:var(--text-faint)] hover:bg-white/[0.1]'
                }`}
              >
                {d === 0 ? 'HOJE' : `${d}d`}
              </button>
            ))}
          </div>
        </div>
        <div>
          <button
            onClick={onGoToCollection}
            disabled={!onGoToCollection}
            className="text-left text-xl font-extrabold tracking-tight text-[color:var(--accent-brass)] transition-opacity hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100 md:text-[2.4rem]"
          >
            {formatCurrency(aCobraValor)}
          </button>
          <p className="text-xs text-[color:var(--text-faint)] mt-1">Clique para ver a fila de cobrança</p>
        </div>
      </div>
    </div>
  );
};

interface FiltersBarProps {
  onSearch: (value: string) => void;
}

export const FiltersBar: React.FC<FiltersBarProps> = ({ onSearch }) => (
  <div className={`${panelClass} flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between`}>
    <div>
      <p className="section-kicker mb-1">Carteira</p>
      <h3 className="font-display text-base sm:text-[2rem] leading-none text-[color:var(--text-primary)]">Base de contratos</h3>
    </div>

    <div className="relative w-full md:max-w-sm">
      <Search size={16} className="absolute left-4 top-4 text-[color:var(--text-faint)]" />
      <input
        type="text"
        placeholder="Buscar contrato, investidor ou devedor"
        onChange={(event) => onSearch(event.target.value)}
        className="w-full rounded-full border border-white/10 bg-white/[0.03] py-3 pl-11 pr-4 text-sm text-[color:var(--text-primary)] outline-none transition-all placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent-brass)]"
      />
    </div>
  </div>
);

interface OverviewChartsProps {
  kpis: DashboardKPIs;
  installments: LoanInstallment[];
}

export const OverviewCharts: React.FC<OverviewChartsProps> = ({ kpis, installments }) => {
  const agingData = useMemo(() => computeAgingBuckets(installments), [installments]);
  const compositionData = useMemo(
    () => [
      { name: 'Seu dinheiro', value: kpis.activeOwnCapital, color: '#cab07a' },
      { name: 'Juros reinvestidos', value: kpis.activeReinvestedCapital, color: '#90a0bd' },
      { name: 'Já devolvido', value: kpis.totalPrincipalRepaid, color: '#8fb39d' },
    ].filter((item) => item.value > 0),
    [kpis.activeOwnCapital, kpis.activeReinvestedCapital, kpis.totalPrincipalRepaid],
  );

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <div className={`${panelClass} p-6`}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="section-kicker mb-1">Exposição</p>
            <h3 className="font-display text-base sm:text-[2rem] leading-none text-[color:var(--text-primary)]">Composição do capital</h3>
          </div>
          <div className="rounded-2xl bg-[rgba(202,176,122,0.14)] p-3 text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.18)]">
            <Coins size={18} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1.1fr]">
          <div className="grid gap-3">
            <div className="rounded-[1.4rem] border border-white/10 bg-black/10 p-4">
              <p className="section-kicker mb-1">Emprestado no total</p>
              <p className="text-2xl font-bold text-[color:var(--text-primary)]">{formatCurrency(kpis.totalInvestedHistorical)}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-black/10 p-4">
              <p className="section-kicker mb-1">Em rua agora</p>
              <p className="text-2xl font-bold text-[color:var(--text-primary)]">{formatCurrency(kpis.activeStreetMoney)}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-black/10 p-4">
              <p className="section-kicker mb-1">Já te devolveram</p>
              <p className="text-2xl font-bold text-[color:var(--accent-positive)]">{formatCurrency(kpis.totalPrincipalRepaid)}</p>
            </div>
          </div>

          <div className="flex flex-col">
            <div className="h-[230px] md:h-[220px]">
              {compositionData.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-[color:var(--text-faint)]">
                  <PieChart size={32} className="opacity-30" />
                  <p className="text-xs font-bold uppercase tracking-widest">Sem dados ainda</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <RechartsPieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCurrency(value), name]}
                      contentStyle={{
                        background: '#151922',
                        borderRadius: 16,
                        border: '1px solid rgba(245,239,226,0.08)',
                        color: '#f5efe2',
                      }}
                      labelStyle={{ color: '#f5efe2' }}
                      itemStyle={{ color: '#f5efe2' }}
                    />
                    <Pie
                      data={compositionData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={68}
                      outerRadius={106}
                      paddingAngle={3}
                    >
                      {compositionData.map((item) => (
                        <Cell key={item.name} fill={item.color} stroke="transparent" />
                      ))}
                      <Label
                        content={({ viewBox }: { viewBox?: { cx?: number; cy?: number } }) => {
                          const cx = viewBox?.cx ?? 0;
                          const cy = viewBox?.cy ?? 0;
                          const activeTotal = kpis.activeOwnCapital + kpis.activeReinvestedCapital;
                          return (
                            <>
                              <text
                                x={cx}
                                y={cy - 10}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                style={{ fill: 'var(--text-primary)', fontSize: 16, fontWeight: 800, fontFamily: 'inherit' }}
                              >
                                {formatCurrency(activeTotal)}
                              </text>
                              <text
                                x={cx}
                                y={cy + 12}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                style={{ fill: 'var(--text-muted)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', fontFamily: 'inherit' }}
                              >
                                CAPITAL ATIVO
                              </text>
                            </>
                          );
                        }}
                      />
                    </Pie>
                  </RechartsPieChart>
                </ResponsiveContainer>
              )}
            </div>

            {compositionData.length > 0 && (() => {
              const totalAll = compositionData.reduce((acc, item) => acc + item.value, 0);
              return (
                <div className="mt-3 space-y-1.5 px-1">
                  {compositionData.map((item) => {
                    const pct = totalAll > 0 ? ((item.value / totalAll) * 100).toFixed(1) : '0';
                    return (
                      <div key={item.name} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                          <span className="text-xs text-[color:var(--text-secondary)] truncate">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-bold text-[color:var(--text-primary)]">{formatCurrency(item.value)}</span>
                          <span className="text-[10px] font-black text-[color:var(--text-faint)] w-10 text-right">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <div className={`${panelClass} p-6`}>
        {(() => {
          const temAtraso = agingData.some((b) => b.value > 0);
          return (
            <>
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="section-kicker mb-1">Cobrança</p>
                  <h3 className="font-display text-base sm:text-[2rem] leading-none text-[color:var(--text-primary)]">Inadimplência por prazo</h3>
                </div>
                <div className={`rounded-2xl p-3 ring-1 ${temAtraso ? 'bg-[rgba(198,126,105,0.14)] text-[color:var(--accent-danger)] ring-[rgba(198,126,105,0.18)]' : 'bg-[rgba(143,179,157,0.12)] text-[color:var(--accent-positive)] ring-[rgba(143,179,157,0.20)]'}`}>
                  {temAtraso ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                </div>
              </div>

              {temAtraso ? (
                <div className="h-52 min-w-0 md:h-[300px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <BarChart data={agingData} barSize={34}>
                      <CartesianGrid stroke="rgba(245,239,226,0.05)" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8d919a', fontSize: 12, fontWeight: 700 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8d919a', fontSize: 11 }} tickFormatter={currencyTick} />
                      <Tooltip
                        formatter={(value: number) => [formatCurrency(value), 'Em atraso']}
                        contentStyle={{
                          background: '#151922',
                          borderRadius: 16,
                          border: '1px solid rgba(245,239,226,0.08)',
                          color: '#f5efe2',
                        }}
                        labelStyle={{ color: '#f5efe2' }}
                        itemStyle={{ color: '#f5efe2' }}
                      />
                      <Bar dataKey="value" radius={[12, 12, 0, 0]}>
                        {agingData.map((entry) => (
                          <Cell key={entry.name} fill={(entry as any).color ?? '#c67e69'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-52 flex-col items-center justify-center gap-3 md:h-[300px]">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(143,179,157,0.12)] ring-1 ring-[rgba(143,179,157,0.20)]">
                    <CheckCircle2 size={28} className="text-[color:var(--accent-positive)]" />
                  </div>
                  <p className="text-base font-extrabold text-[color:var(--accent-positive)]">Carteira 100% saudável</p>
                  <p className="text-xs text-[color:var(--text-faint)]">Nenhuma parcela em atraso</p>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
};

export const InvestmentsTable: React.FC<{ data: Investment[] }> = ({ data }) => (
  <div className={`${panelClass} overflow-hidden`}>
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm whitespace-nowrap">
        <thead className="border-b border-white/10 bg-black/10">
          <tr className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">
            <th className="px-6 py-4">Contrato</th>
            <th className="px-6 py-4">Investidor</th>
            <th className="px-6 py-4">Cliente</th>
            <th className="px-6 py-4 text-right">Principal</th>
            <th className="px-6 py-4 text-right">Total</th>
            <th className="px-6 py-4 text-right">Taxa</th>
            <th className="px-6 py-4 text-right">Origem</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-[color:var(--text-secondary)]">
          {data.map((investment) => {
            const reinvested = normalizeNumber(investment.source_profit);
            const sourceLabel = reinvested > 0
              ? `${((reinvested / Math.max(1, normalizeNumber(investment.amount_invested))) * 100).toFixed(0)}% reinvestido`
              : 'Aporte próprio';

            return (
              <tr key={investment.id} className="transition-colors hover:bg-white/[0.02]">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.14)]">
                      <BriefcaseBusiness size={16} />
                    </div>
                    <div>
                      <div className="font-semibold text-[color:var(--text-primary)]">{investment.asset_name}</div>
                      <div className="text-xs text-[color:var(--text-faint)]">#{investment.id}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">{investment.investor_name || '—'}</td>
                <td className="px-6 py-4">{investment.payer_name || '—'}</td>
                <td className="px-6 py-4 text-right font-semibold text-[color:var(--text-primary)]">{formatCurrency(normalizeNumber(investment.amount_invested))}</td>
                <td className="px-6 py-4 text-right font-semibold text-[color:var(--text-primary)]">{formatCurrency(normalizeNumber(investment.current_value))}</td>
                <td className="px-6 py-4 text-right">{normalizeNumber(investment.interest_rate).toFixed(2)}%</td>
                <td className="px-6 py-4 text-right text-xs uppercase tracking-[0.14em] text-[color:var(--text-faint)]">{sourceLabel}</td>
              </tr>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={7} className="px-6 py-12 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-faint)]">
                Nenhum contrato encontrado
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

interface InstallmentsTableProps {
  data: LoanInstallment[];
  onUpdate?: () => void;
  tenant?: Tenant | null;
}

type StatusFilter = 'all' | 'pending' | 'overdue' | 'paid';
type DateMode = 'month' | 'range';

const statusOptions: Array<{ id: StatusFilter; label: string; icon: React.ReactNode }> = [
  { id: 'all', label: 'Todos', icon: <CalendarRange size={14} /> },
  { id: 'pending', label: 'A vencer', icon: <Clock3 size={14} /> },
  { id: 'overdue', label: 'Atrasados', icon: <AlertTriangle size={14} /> },
  { id: 'paid', label: 'Pagos', icon: <CheckCircle2 size={14} /> },
];

export const InstallmentsTable: React.FC<InstallmentsTableProps> = ({ data, onUpdate, tenant }) => {
  const [dateMode, setDateMode] = useState<DateMode>('month');
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('all');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [modalType, setModalType] = useState<'pay' | 'refinance' | 'edit' | 'interest_only' | null>(null);

  const targetMonth = currentDate.getMonth();
  const targetYear = currentDate.getFullYear();
  const currentMonthLabel = currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const filteredData = useMemo(() => {
    return data
      .filter((installment) => {
        if (dateMode === 'month') {
          const [year, month] = installment.due_date.split('-').map(Number);
          if (year !== targetYear || month !== targetMonth + 1) return false;
        } else {
          if (rangeStart && installment.due_date < rangeStart) return false;
          if (rangeEnd && installment.due_date > rangeEnd) return false;
        }

        const isPaid = installment.status === 'paid';
        const isOverdue = isInstallmentOverdue(installment);

        if (activeStatus === 'pending' && (isPaid || isOverdue)) return false;
        if (activeStatus === 'overdue' && !isOverdue) return false;
        if (activeStatus === 'paid' && !isPaid) return false;

        return true;
      })
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [activeStatus, currentDate, data, dateMode, rangeEnd, rangeStart, targetMonth, targetYear]);

  const stats = useMemo(() => {
    return filteredData.reduce(
      (acc, installment) => {
        acc.total += normalizeNumber(installment.amount_total);
        acc.outstanding += calculateOutstanding(installment);
        acc.received += normalizeNumber(installment.amount_paid);
        return acc;
      },
      { total: 0, outstanding: 0, received: 0 },
    );
  }, [filteredData]);

  const dateFilteredData = useMemo(() => {
    return data.filter((installment) => {
      if (dateMode === 'month') {
        const [year, month] = installment.due_date.split('-').map(Number);
        return year === targetYear && month === targetMonth + 1;
      }

      if (rangeStart && installment.due_date < rangeStart) return false;
      if (rangeEnd && installment.due_date > rangeEnd) return false;
      return true;
    });
  }, [currentDate, data, dateMode, rangeEnd, rangeStart, targetMonth, targetYear]);

  const counts = useMemo(
    () => ({
      all: dateFilteredData.length,
      pending: dateFilteredData.filter((item) => item.status !== 'paid' && !isInstallmentOverdue(item)).length,
      overdue: dateFilteredData.filter((item) => isInstallmentOverdue(item)).length,
      paid: dateFilteredData.filter((item) => item.status === 'paid').length,
    }),
    [dateFilteredData],
  );

  const closeModal = () => {
    setModalType(null);
    setSelectedInstallment(null);
  };

  const openAction = (type: 'pay' | 'refinance' | 'edit' | 'interest_only', installment: LoanInstallment) => {
    setSelectedInstallment(installment);
    setModalType(type);
  };

  return (
    <>
      <div className="space-y-5">
        <div className={`${panelClass} p-5 md:p-6`}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="section-kicker mb-1">Títulos</p>
              <h3 className="font-display text-base sm:text-[2rem] leading-none text-[color:var(--text-primary)]">Gestão de parcelas</h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[color:var(--text-secondary)]">
                Filtre por mês ou período livre, acompanhe o status da parcela e registre baixa, refinanciamento ou edição sem sair da grade.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
                <button
                  onClick={() => setDateMode('month')}
                  className={`rounded-full px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em] transition-all ${
                    dateMode === 'month'
                      ? 'bg-[color:var(--accent-brass)] text-[#17120b]'
                      : 'text-[color:var(--text-muted)]'
                  }`}
                >
                  Mensal
                </button>
                <button
                  onClick={() => setDateMode('range')}
                  className={`rounded-full px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em] transition-all ${
                    dateMode === 'range'
                      ? 'bg-[color:var(--accent-brass)] text-[#17120b]'
                      : 'text-[color:var(--text-muted)]'
                  }`}
                >
                  Período
                </button>
              </div>

              {dateMode === 'month' ? (
                <div className="flex items-center justify-between gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2">
                  <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="rounded-full p-2 text-[color:var(--text-muted)] transition-colors hover:bg-white/[0.04] hover:text-white">
                    <ChevronLeft size={16} />
                  </button>
                  <div className="min-w-[10rem] text-center text-sm font-semibold capitalize text-[color:var(--text-primary)]">{currentMonthLabel}</div>
                  <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="rounded-full p-2 text-[color:var(--text-muted)] transition-colors hover:bg-white/[0.04] hover:text-white">
                    <ChevronRight size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 md:flex-row">
                  <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} className="hidden rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)] md:block" />
                  <input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} className="hidden rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)] md:block" />
                  <div className="flex flex-wrap gap-1 md:hidden">
                    {[
                      { label: 'Este mês', action: () => { setDateMode('month'); setCurrentDate(new Date()); } },
                      { label: 'Mês ant.', action: () => { const d = new Date(); setDateMode('month'); setCurrentDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)); } },
                      { label: '30 dias', action: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 30); setRangeStart(s.toISOString().split('T')[0]); setRangeEnd(e.toISOString().split('T')[0]); } },
                      { label: '90 dias', action: () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 90); setRangeStart(s.toISOString().split('T')[0]); setRangeEnd(e.toISOString().split('T')[0]); } },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        onClick={preset.action}
                        className="rounded-full px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide bg-white/[0.05] text-[color:var(--text-faint)] hover:bg-white/[0.1] transition-all"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
              <p className="section-kicker mb-2">Total do período</p>
              <p className="text-xl font-bold text-[color:var(--text-primary)]">{formatCurrency(stats.total)}</p>
            </div>
            <div className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
              <p className="section-kicker mb-2">Recebido</p>
              <p className="text-xl font-bold text-[color:var(--accent-positive)]">{formatCurrency(stats.received)}</p>
            </div>
            <div className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
              <p className="section-kicker mb-2">Em aberto</p>
              <p className="text-xl font-bold text-[color:var(--text-primary)]">{formatCurrency(stats.outstanding)}</p>
            </div>
            <div className="rounded-[1.35rem] border border-white/10 bg-black/10 p-4">
              <p className="section-kicker mb-2">Parcelas</p>
              <p className="text-xl font-bold text-[color:var(--text-primary)]">{filteredData.length}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {statusOptions.map((status) => {
            const count = counts[status.id];
            const isActive = activeStatus === status.id;

            return (
              <button
                key={status.id}
                onClick={() => setActiveStatus(status.id)}
                className={`${panelClass} flex items-center justify-between px-5 py-4 text-left transition-all ${
                  isActive ? 'ring-1 ring-[rgba(202,176,122,0.2)]' : 'opacity-90 hover:opacity-100'
                }`}
              >
                <div>
                  <div className={`mb-2 flex h-10 w-10 items-center justify-center rounded-2xl ${isActive ? 'bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]' : 'bg-white/[0.04] text-[color:var(--text-faint)]'}`}>
                    {status.icon}
                  </div>
                  <div className="text-sm font-semibold text-[color:var(--text-primary)]">{status.label}</div>
                </div>
                <div className="text-2xl font-bold text-[color:var(--text-primary)]">{count}</div>
              </button>
            );
          })}
        </div>

        <div className={`${panelClass} overflow-hidden`}>
          <div className="hidden md:block -mx-0 overflow-x-auto">
            <table className="min-w-full text-left text-xs whitespace-nowrap md:text-sm">
              <thead className="border-b border-white/10 bg-black/10 text-[11px] font-extrabold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">
                <tr>
                  <th className="px-6 py-4">Vencimento</th>
                  <th className="px-6 py-4">Contrato</th>
                  <th className="px-6 py-4">Devedor</th>
                  <th className="px-6 py-4 text-right">Valor</th>
                  <th className="px-6 py-4 text-right">Pago</th>
                  <th className="px-6 py-4 text-right">Saldo</th>
                  <th className="px-6 py-4 text-right">Status</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-[color:var(--text-secondary)]">
                {filteredData.map((installment) => {
                  const overdue = isInstallmentOverdue(installment);
                  const outstanding = calculateOutstanding(installment);
                  const statusLabel = overdue ? 'Atrasado' : installment.status === 'paid' ? 'Pago' : installment.status === 'partial' ? 'Parcial' : 'A vencer';
                  const statusTone = overdue
                    ? 'text-[color:var(--accent-danger)] bg-[rgba(198,126,105,0.08)]'
                    : installment.status === 'paid'
                      ? 'text-[color:var(--accent-positive)] bg-[rgba(143,179,157,0.08)]'
                      : installment.status === 'partial'
                        ? 'text-[color:var(--accent-warning)] bg-[rgba(200,154,85,0.1)]'
                        : 'text-[color:var(--text-secondary)] bg-white/[0.04]';

                  return (
                    <tr key={installment.id} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-6 py-4 font-semibold text-[color:var(--text-primary)]">
                        {formatDate(installment.due_date)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-[color:var(--text-primary)]">{installment.investment?.asset_name || installment.contract_name || '—'}</div>
                        <div className="text-xs text-[color:var(--text-faint)]">#{installment.investment_id}</div>
                      </td>
                      <td className="px-6 py-4">{installment.investment?.payer?.full_name || 'Cliente'}</td>
                      <td className="px-6 py-4 text-right font-semibold text-[color:var(--text-primary)]">{formatCurrency(normalizeNumber(installment.amount_total))}</td>
                      <td className="px-6 py-4 text-right font-semibold text-[color:var(--accent-positive)]">{formatCurrency(normalizeNumber(installment.amount_paid))}</td>
                      <td className="px-6 py-4 text-right font-semibold text-[color:var(--text-primary)]">{formatCurrency(outstanding)}</td>
                      <td className="px-6 py-4 text-right">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusTone}`}>{statusLabel}</span>
                        {Number(installment.interest_payments_total) > 0 && (
                          <div className="mt-1 text-[10px] font-bold text-[color:var(--accent-warning)]">
                            Juros: {formatCurrency(Number(installment.interest_payments_total))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-1.5 flex-wrap">
                          {installment.status !== 'paid' ? (
                            <>
                              <button
                                onClick={() => openAction('pay', installment)}
                                className="rounded-lg border border-[rgba(143,179,157,0.3)] bg-[rgba(143,179,157,0.12)] px-4 py-2.5 text-sm font-bold text-[color:var(--accent-positive)] transition-colors hover:bg-[rgba(143,179,157,0.25)]"
                              >
                                ✓ RECEBIDO
                              </button>
                              <button
                                onClick={() => openAction('refinance', installment)}
                                className="rounded-lg border border-[rgba(144,160,189,0.3)] bg-[rgba(144,160,189,0.12)] px-4 py-2.5 text-sm font-bold text-[color:var(--accent-steel)] transition-colors hover:bg-[rgba(144,160,189,0.25)]"
                              >
                                ↺ RENEGOCIAR
                              </button>
                              <button
                                onClick={() => openAction('interest_only', installment)}
                                className="rounded-lg border border-[rgba(200,154,85,0.3)] bg-[rgba(200,154,85,0.1)] px-4 py-2.5 text-sm font-bold text-[color:var(--accent-warning)] transition-colors hover:bg-[rgba(200,154,85,0.2)]"
                              >
                                % JUROS
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => openAction('pay', installment)}
                              className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-bold text-[color:var(--text-faint)] transition-colors hover:bg-white/[0.08]"
                            >
                              ↗ RECIBO
                            </button>
                          )}
                          <button
                            onClick={() => openAction('edit', installment)}
                            title="Editar"
                            className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-[color:var(--text-faint)] transition-colors hover:text-[color:var(--accent-steel)] hover:bg-white/[0.07]"
                          >
                            <Pencil size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredData.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-14 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-faint)]">
                      {dateMode === 'range' && (!rangeStart || !rangeEnd)
                        ? 'Selecione início e fim para carregar o período.'
                        : 'Nenhuma parcela encontrada para o filtro atual.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards View */}
          <div className="block md:hidden divide-y divide-white/5">
            {filteredData.map((installment) => {
              const overdue = isInstallmentOverdue(installment);
              const outstanding = calculateOutstanding(installment);
              const statusLabel = overdue ? 'Atrasado' : installment.status === 'paid' ? 'Pago' : installment.status === 'partial' ? 'Parcial' : 'A vencer';
              const statusTone = overdue
                ? 'text-[color:var(--accent-danger)] bg-[rgba(198,126,105,0.08)]'
                : installment.status === 'paid'
                  ? 'text-[color:var(--accent-positive)] bg-[rgba(143,179,157,0.08)]'
                  : installment.status === 'partial'
                    ? 'text-[color:var(--accent-warning)] bg-[rgba(200,154,85,0.1)]'
                    : 'text-[color:var(--text-secondary)] bg-white/[0.04]';

              return (
                <div key={installment.id} className="p-4">
                  <div className="mb-1 flex items-start justify-between">
                    <span className="font-bold text-[color:var(--text-primary)]">{installment.investment?.payer?.full_name || 'Cliente'}</span>
                    <span className="text-xs text-[color:var(--text-faint)]">{formatDate(installment.due_date)}</span>
                  </div>
                  <div className="mb-3 text-xs text-[color:var(--text-faint)]">{installment.investment?.asset_name || installment.contract_name || '—'}</div>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xl font-extrabold text-[color:var(--text-primary)]">{formatCurrency(outstanding)}</span>
                    <div className="text-right">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusTone}`}>{statusLabel}</span>
                      {Number(installment.interest_payments_total) > 0 && (
                        <div className="mt-1 text-[10px] font-bold text-[color:var(--accent-warning)]">
                          Juros: {formatCurrency(Number(installment.interest_payments_total))}
                        </div>
                      )}
                    </div>
                  </div>
                  {installment.status !== 'paid' ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => openAction('pay', installment)}
                          className="min-h-[48px] rounded-xl border border-[rgba(143,179,157,0.3)] bg-[rgba(143,179,157,0.12)] py-3 text-sm font-bold text-[color:var(--accent-positive)] transition-colors hover:bg-[rgba(143,179,157,0.25)]"
                        >
                          ✓ BAIXA
                        </button>
                        <button
                          onClick={() => openAction('refinance', installment)}
                          className="min-h-[48px] rounded-xl border border-[rgba(144,160,189,0.3)] bg-[rgba(144,160,189,0.12)] py-3 text-sm font-bold text-[color:var(--accent-steel)] transition-colors hover:bg-[rgba(144,160,189,0.25)]"
                        >
                          ↺ RENEG.
                        </button>
                        <button
                          onClick={() => openAction('interest_only', installment)}
                          className="min-h-[48px] rounded-xl border border-[rgba(200,154,85,0.3)] bg-[rgba(200,154,85,0.1)] py-3 text-sm font-bold text-[color:var(--accent-warning)] transition-colors hover:bg-[rgba(200,154,85,0.2)]"
                        >
                          % JUROS
                        </button>
                      </div>
                      <button
                        onClick={() => openAction('edit', installment)}
                        className="flex w-full items-center justify-center gap-2 min-h-[40px] rounded-xl border border-white/10 bg-white/[0.03] py-2 text-xs font-bold text-[color:var(--text-faint)] transition-colors hover:bg-white/[0.07]"
                      >
                        <Pencil size={12} /> Editar
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openAction('pay', installment)}
                        className="min-h-[48px] rounded-xl border border-white/10 bg-white/[0.04] py-3 text-sm font-bold text-[color:var(--text-faint)] transition-colors hover:bg-white/[0.08]"
                      >
                        ↗ RECIBO
                      </button>
                      <button
                        onClick={() => openAction('edit', installment)}
                        className="flex items-center justify-center gap-2 min-h-[48px] rounded-xl border border-white/10 bg-white/[0.03] py-3 text-sm font-bold text-[color:var(--text-faint)] transition-colors hover:bg-white/[0.07]"
                      >
                        <Pencil size={14} /> Editar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredData.length === 0 && (
              <div className="px-6 py-14 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-faint)]">
                {dateMode === 'range' && (!rangeStart || !rangeEnd)
                  ? 'Selecione início e fim para carregar o período.'
                  : 'Nenhuma parcela encontrada para o filtro atual.'}
              </div>
            )}
          </div>
        </div>
      </div>

      <PaymentModal isOpen={modalType === 'pay'} onClose={closeModal} onSuccess={() => onUpdate?.()} installment={selectedInstallment} tenant={tenant} />
      <RefinanceModal isOpen={modalType === 'refinance'} onClose={closeModal} onSuccess={() => onUpdate?.()} installment={selectedInstallment} />
      <EditModal isOpen={modalType === 'edit'} onClose={closeModal} onSuccess={() => onUpdate?.()} installment={selectedInstallment} />
      <InterestOnlyModal isOpen={modalType === 'interest_only'} onClose={closeModal} onSuccess={() => onUpdate?.()} installment={selectedInstallment} />
    </>
  );
};

// ── QuickActionsGrid ──────────────────────────────────────────────────────────

interface QuickActionsGridProps {
  onNavigate: (view: AppView) => void;
  onSwitchTab: (tab: 'receivables' | 'collection') => void;
}

export const QuickActionsGrid: React.FC<QuickActionsGridProps> = ({ onNavigate, onSwitchTab }) => {
  const actions = [
    { icon: Users,           label: 'Usuários',     onClick: () => onNavigate(AppView.USERS) },
    { icon: BriefcaseBusiness, label: 'Contratos',  onClick: () => onNavigate(AppView.CONTRACTS) },
    { icon: FileText,        label: 'Parcelas',     onClick: () => onSwitchTab('receivables') },
    { icon: Phone,           label: 'Cobranças',    onClick: () => onSwitchTab('collection') },
    { icon: AlertTriangle,   label: 'Inadimplentes',onClick: () => onSwitchTab('collection') },
    { icon: Bot,             label: 'Assistente',   onClick: () => onNavigate(AppView.ASSISTANT) },
  ];

  return (
    <div className={`${panelClass} px-4 py-5 md:px-6`}>
      <p className="section-kicker mb-4">Acesso rápido</p>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {actions.map(({ icon: Icon, label, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className="group flex flex-col items-center gap-2.5 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] px-2 py-4 transition-all hover:border-[color:var(--accent-brass)]/30 hover:bg-[rgba(202,176,122,0.07)]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-[color:var(--text-muted)] transition-colors group-hover:bg-[rgba(202,176,122,0.14)] group-hover:text-[color:var(--accent-brass)]">
              <Icon size={18} />
            </div>
            <span className="w-full truncate text-center text-[0.68rem] font-extrabold uppercase tracking-[0.06em] text-[color:var(--text-faint)] transition-colors group-hover:text-[color:var(--text-primary)]">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ── DailyAlerts ───────────────────────────────────────────────────────────────

interface DailyAlertsProps {
  kpis: DashboardKPIs | null;
  installments: LoanInstallment[];
}

export const DailyAlerts: React.FC<DailyAlertsProps> = ({ kpis, installments }) => {
  const today = new Date().toISOString().split('T')[0];
  const todayFormatted = today.split('-').reverse().join('/');

  const vigentes = kpis?.activeContractsCount ?? 0;
  const contratosMorosos = kpis?.overdueContractsCount ?? 0;
  const vencendoHoje = installments.filter(
    (i) => i.due_date === today && i.status !== 'paid'
  ).length;
  const atrasadas = installments.filter((i) => i.status === 'late').length;

  const metrics = [
    {
      label: 'Contratos Vigentes',
      value: vigentes,
      color: vigentes > 0 ? 'var(--accent-teal)' : 'var(--text-muted)',
    },
    {
      label: 'Contratos Atrasados',
      value: contratosMorosos,
      color: contratosMorosos > 0 ? 'var(--accent-danger)' : 'var(--text-muted)',
    },
    {
      label: 'Parcelas Vencendo',
      value: vencendoHoje,
      color: vencendoHoje > 0 ? '#f59e0b' : 'var(--text-muted)',
    },
    {
      label: 'Parcelas Atrasadas',
      value: atrasadas,
      color: atrasadas > 0 ? 'var(--accent-danger)' : 'var(--text-muted)',
    },
  ];

  return (
    <div className={`${panelClass} px-4 py-5 md:px-6`}>
      <div className="mb-4 flex items-center justify-between">
        <p className="section-kicker">Avisos do dia!</p>
        <span className="text-xs font-semibold tabular-nums text-[color:var(--text-faint)]">{todayFormatted}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {metrics.map(({ label, value, color }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-1 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-4"
          >
            <span className="text-3xl font-black tabular-nums leading-none" style={{ color }}>
              {value}
            </span>
            <span className="mt-1 text-center text-[0.65rem] font-extrabold uppercase tracking-[0.14em] text-[color:var(--text-faint)]">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
