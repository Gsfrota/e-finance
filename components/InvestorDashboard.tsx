import React, { useState } from 'react';
import { useInvestorMetrics, InvestorFilter, InvestorPeriod } from '../hooks/useInvestorMetrics';
import {
  ArrowUpRight,
  Landmark,
  MessageCircle,
  ShieldCheck,
  TrendingUp,
  Wallet,
  WifiOff,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

const PERIOD_LABELS: { key: InvestorPeriod; label: string }[] = [
  { key: 'month', label: 'Este mês' },
  { key: 'last_month', label: 'Mês anterior' },
  { key: 'year', label: 'Este ano' },
  { key: 'all', label: 'Tudo' },
];

const InvestorDashboard: React.FC = () => {
  const [filter, setFilter] = useState<InvestorFilter>({ period: 'month' });
  const { metrics, investments, loading, isStale } = useInvestorMetrics(filter);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const getWhatsappLink = () => 'https://wa.link/22e0gd';

  if (loading) {
    return (
      <div aria-live="polite" aria-label="Carregando métricas do investidor" className="flex h-full flex-col items-center justify-center space-y-4 animate-pulse text-[color:var(--accent-brass)]">
        <Wallet className="h-12 w-12" />
        <p className="section-kicker text-[color:var(--text-secondary)]">Carregando carteira do investidor</p>
      </div>
    );
  }

  if (investments.length === 0) {
    return (
      <div className="panel-card flex h-full flex-col items-center justify-center rounded-[2rem] p-6 sm:p-10 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.16)]">
          <Landmark size={34} />
        </div>
        <p className="section-kicker mt-8">Conta pronta</p>
        <h1 className="type-display mt-2 text-[color:var(--text-primary)]">Olá, {metrics.userName}</h1>
        <p className="mt-5 max-w-xl type-body text-[color:var(--text-secondary)]">
          Sua estrutura já está ativa, mas ainda não há contratos alocados na carteira. Quando o primeiro investimento entrar, este painel passa a mostrar principal, lucro e cronograma de recebimento.
        </p>
        <a
          href={getWhatsappLink()}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[color:var(--accent-brass)] px-6 py-3 type-label text-[color:var(--text-on-accent)] transition-all hover:bg-[color:var(--accent-brass-strong)]"
        >
          <MessageCircle size={14} />
          Falar com consultor
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12 animate-fade-in md:space-y-6">
      {isStale && (
        <div className="flex items-center gap-1.5 px-4 py-1 text-xs text-amber-400">
          <WifiOff size={12} /> Exibindo dados da última sessão
        </div>
      )}

      {/* Header */}
      <div className="panel-card rounded-[2rem] px-6 py-7 md:px-8 md:py-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-kicker mb-2">Visão do investidor</p>
            <h1 className="type-display text-[color:var(--text-primary)]">Carteira de {metrics.userName}</h1>
            <p className="mt-4 max-w-2xl type-body text-[color:var(--text-secondary)]">
              Acompanhe o que entrou em caixa, o lucro de juros e o que está previsto para este mês.
            </p>
          </div>

          <a
            href={getWhatsappLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 type-label text-[color:var(--text-primary)] transition-all hover:bg-white/[0.06]"
          >
            <MessageCircle size={14} className="text-[color:var(--accent-positive)]" />
            Falar com consultor
          </a>
        </div>
      </div>

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        {/* Botões de período */}
        {PERIOD_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter((f) => ({ ...f, period: key }))}
            className={`rounded-full px-4 py-2 type-label transition-all ${
              filter.period === key
                ? 'bg-[color:var(--accent-brass)] text-[color:var(--text-on-accent)]'
                : 'border border-white/10 bg-white/[0.03] text-[color:var(--text-secondary)] hover:bg-white/[0.06]'
            }`}
          >
            {label}
          </button>
        ))}

        {/* Dropdown de contratos */}
        <select
          value={filter.investmentId ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, investmentId: e.target.value || undefined }))}
          className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 type-label text-[color:var(--text-secondary)] outline-none transition-all hover:bg-white/[0.06] cursor-pointer"
        >
          <option value="">Todos os contratos</option>
          {investments.map((inv) => (
            <option key={inv.id} value={String(inv.id)}>
              {inv.asset_name}
            </option>
          ))}
        </select>
      </div>

      {/* Grid de 4 cards */}
      <div className="grid grid-cols-2 gap-3 md:gap-5 xl:grid-cols-4">
        {/* Card 1 — Lucro Bruto (destaque) */}
        <div className="panel-card col-span-2 rounded-[1.8rem] p-4 md:p-6 xl:col-span-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Recebido</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">Lucro Bruto</h3>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.18)]">
              <Wallet size={18} />
            </div>
          </div>
          <div className="mt-8 type-metric-lg text-[color:var(--accent-brass)]">{formatCurrency(metrics.grossReceived)}</div>
          <p className="mt-3 type-body text-[color:var(--text-secondary)]">Total recebido em caixa no período selecionado.</p>
        </div>

        {/* Card 2 — Lucro de Juros */}
        <div className="panel-card col-span-2 rounded-[1.8rem] p-4 md:p-6 xl:col-span-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Rendimento</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">Lucro de Juros</h3>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(143,179,157,0.14)] text-[color:var(--accent-positive)] ring-1 ring-[rgba(143,179,157,0.16)]">
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="mt-8 type-metric-lg text-[color:var(--accent-positive)]">{formatCurrency(metrics.interestProfit)}</div>
          <p className="mt-3 type-body text-[color:var(--text-secondary)]">Parcela dos juros já realizada sobre o capital emprestado.</p>
        </div>

        {/* Card 3 — Previsto no Mês */}
        <div className="panel-card col-span-2 rounded-[1.8rem] p-4 md:p-6 xl:col-span-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">A receber</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">Previsto no Mês</h3>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(144,160,189,0.14)] text-[color:var(--accent-steel)] ring-1 ring-[rgba(144,160,189,0.16)]">
              <ArrowUpRight size={18} />
            </div>
          </div>
          <div className="mt-8 type-metric-lg text-[color:var(--accent-steel)]">{formatCurrency(metrics.expectedThisMonth)}</div>
          <p className="mt-3 type-body text-[color:var(--text-secondary)]">Parcelas pendentes e atrasadas com vencimento neste mês.</p>
        </div>

        {/* Card 4 — Capital em Giro */}
        <div className="panel-card col-span-2 rounded-[1.8rem] p-4 md:p-6 xl:col-span-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Principal</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">Capital em Giro</h3>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] text-[color:var(--text-secondary)] ring-1 ring-white/10">
              <Landmark size={18} />
            </div>
          </div>
          <div className="mt-8 type-metric-lg text-[color:var(--text-primary)]">{formatCurrency(metrics.totalAllocated)}</div>
          <p className="mt-3 type-body text-[color:var(--text-secondary)]">Volume principal comprometido na carteira atual.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        {/* Gráfico — não filtrado, mostra fluxo completo */}
        <div className="panel-card rounded-[1.8rem] p-4 md:p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Fluxo mensal</p>
              <h3 className="type-title font-display text-[color:var(--text-primary)]">Recebimentos projetados</h3>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(144,160,189,0.14)] text-[color:var(--accent-steel)] ring-1 ring-[rgba(144,160,189,0.16)]">
              <ArrowUpRight size={18} />
            </div>
          </div>

          <div className="h-52 min-w-0 md:h-[320px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={metrics.chartData} barSize={28}>
                <CartesianGrid stroke="rgba(245,239,226,0.05)" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8d919a', fontSize: 11, fontWeight: 700 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8d919a', fontSize: 11 }} tickFormatter={(value) => value >= 1000 ? `R$ ${Math.round(value / 1000)}k` : `R$ ${value}`} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  formatter={(value: number, name: string) => [formatCurrency(value), name === 'projected' ? 'Projetado' : 'Recebido']}
                  contentStyle={{
                    background: '#151922',
                    borderRadius: 16,
                    border: '1px solid rgba(245,239,226,0.08)',
                    color: '#f5efe2',
                  }}
                  labelStyle={{ color: '#f5efe2' }}
                  itemStyle={{ color: '#f5efe2' }}
                />
                <Bar dataKey="projected" name="Projetado" fill="#4a6585" radius={[10, 10, 0, 0]} />
                <Bar dataKey="received" name="Recebido" fill="#8fb39d" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Lista de ativos */}
        <div className="panel-card overflow-hidden rounded-[1.8rem]">
          <div className="border-b border-white/10 px-6 py-6">
            <p className="section-kicker mb-1">Carteira</p>
            <h3 className="font-display text-base sm:text-[2rem] leading-none text-[color:var(--text-primary)]">Ativos do investidor</h3>
          </div>
          <div className="custom-scrollbar max-h-[460px] overflow-y-auto p-3">
            {investments.map((investment) => (
              <div data-testid="investment-item" key={investment.id} className="mb-3 rounded-[1.4rem] border border-white/8 bg-black/10 p-4 last:mb-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-semibold text-[color:var(--text-primary)]">{investment.asset_name}</div>
                    <div className="mt-1 type-label text-[color:var(--text-faint)]">{investment.type}</div>
                  </div>
                  <div
                    title={investment.healthStatus === 'late' ? 'Contrato com parcela(s) em atraso' : investment.healthStatus === 'ok' ? 'Todos os pagamentos em dia' : 'Contrato em andamento'}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]"
                  >
                    <ShieldCheck size={12} className={investment.healthStatus === 'late' ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--accent-positive)]'} />
                    {investment.healthStatus === 'late' ? 'Atenção' : investment.healthStatus === 'ok' ? 'Em dia' : 'Em andamento'}
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4">
                  <div>
                    <div className="type-label text-[color:var(--text-faint)]">Principal</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">{formatCurrency(Number(investment.amount_invested))}</div>
                  </div>
                  <div className="text-right">
                    <div className="type-label text-[color:var(--text-faint)]">Total do contrato</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">{formatCurrency(Number(investment.current_value))}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvestorDashboard;
