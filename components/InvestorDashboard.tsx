import React from 'react';
import { useInvestorMetrics } from '../hooks/useInvestorMetrics';
import {
  ArrowUpRight,
  Calendar,
  Landmark,
  MessageCircle,
  ShieldCheck,
  TrendingUp,
  Wallet,
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

const InvestorDashboard: React.FC = () => {
  const { metrics, investments, loading } = useInvestorMetrics();

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const getWhatsappLink = () => 'https://wa.link/22e0gd';

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center space-y-4 animate-pulse text-[color:var(--accent-brass)]">
        <Wallet className="h-12 w-12" />
        <p className="section-kicker text-[color:var(--text-secondary)]">Carregando carteira do investidor</p>
      </div>
    );
  }

  if (investments.length === 0) {
    return (
      <div className="panel-card flex h-full flex-col items-center justify-center rounded-[2rem] p-10 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.16)]">
          <Landmark size={34} />
        </div>
        <p className="section-kicker mt-8">Conta pronta</p>
        <h1 className="font-display mt-2 text-5xl leading-none text-[color:var(--text-primary)]">Olá, {metrics.userName}</h1>
        <p className="mt-5 max-w-xl text-sm leading-7 text-[color:var(--text-secondary)]">
          Sua estrutura já está ativa, mas ainda não há contratos alocados na carteira. Quando o primeiro investimento entrar, este painel passa a mostrar principal, lucro e cronograma de recebimento.
        </p>
        <a
          href={getWhatsappLink()}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[color:var(--accent-brass)] px-6 py-3 text-xs font-extrabold uppercase tracking-[0.18em] text-[#17120b] transition-all hover:bg-[color:var(--accent-brass-strong)]"
        >
          <MessageCircle size={14} />
          Falar com consultor
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12 animate-fade-in">
      <div className="panel-card rounded-[2rem] px-6 py-7 md:px-8 md:py-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-kicker mb-2">Visão do investidor</p>
            <h1 className="font-display text-5xl leading-none text-[color:var(--text-primary)]">Carteira de {metrics.userName}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[color:var(--text-secondary)]">
              Acompanhe o capital alocado, o lucro já realizado e o próximo recebimento previsto sem depender de relatórios externos.
            </p>
          </div>

          <a
            href={getWhatsappLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-xs font-extrabold uppercase tracking-[0.18em] text-[color:var(--text-primary)] transition-all hover:bg-white/[0.06]"
          >
            <MessageCircle size={14} className="text-[color:var(--accent-positive)]" />
            Falar com consultor
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="panel-card rounded-[1.8rem] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Principal</p>
              <h3 className="font-display text-[2rem] leading-none text-[color:var(--text-primary)]">Capital alocado</h3>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.18)]">
              <Wallet size={18} />
            </div>
          </div>
          <div className="mt-8 text-3xl font-extrabold text-[color:var(--text-primary)]">{formatCurrency(metrics.totalAllocated)}</div>
          <p className="mt-3 text-sm leading-7 text-[color:var(--text-secondary)]">Volume principal comprometido na carteira atual.</p>
        </div>

        <div className="panel-card rounded-[1.8rem] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Resultado</p>
              <h3 className="font-display text-[2rem] leading-none text-[color:var(--text-primary)]">Lucro realizado</h3>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(143,179,157,0.14)] text-[color:var(--accent-positive)] ring-1 ring-[rgba(143,179,157,0.16)]">
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="mt-8 text-3xl font-extrabold text-[color:var(--accent-positive)]">{formatCurrency(metrics.totalProfit)}</div>
          <p className="mt-3 text-sm leading-7 text-[color:var(--text-secondary)]">Apurado em regime de caixa, conforme o pagamento efetivo das parcelas.</p>
        </div>

        <div data-testid="next-payment-card" className="panel-card rounded-[1.8rem] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Próximo recebimento</p>
              <h3 className="font-display text-[2rem] leading-none text-[color:var(--text-primary)]">Agenda</h3>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(144,160,189,0.14)] text-[color:var(--accent-steel)] ring-1 ring-[rgba(144,160,189,0.16)]">
              <Calendar size={18} />
            </div>
          </div>
          {metrics.nextPaymentDate ? (
            <>
              <div data-testid="next-payment-value" className="mt-8 text-3xl font-extrabold text-[color:var(--text-primary)]">{formatCurrency(metrics.nextPaymentValue)}</div>
              <p data-testid="next-payment-date" className="mt-3 text-sm leading-7 text-[color:var(--text-secondary)]">Recebimento previsto em {metrics.nextPaymentDate}.</p>
            </>
          ) : (
            <>
              <div className="mt-8 text-3xl font-extrabold text-[color:var(--text-primary)]">—</div>
              <p className="mt-3 text-sm leading-7 text-[color:var(--text-secondary)]">Não há pagamentos futuros cadastrados na carteira atual.</p>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="panel-card rounded-[1.8rem] p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="section-kicker mb-1">Fluxo mensal</p>
              <h3 className="font-display text-[2rem] leading-none text-[color:var(--text-primary)]">Recebimentos projetados</h3>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(144,160,189,0.14)] text-[color:var(--accent-steel)] ring-1 ring-[rgba(144,160,189,0.16)]">
              <ArrowUpRight size={18} />
            </div>
          </div>

          <div className="h-[320px] min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320}>
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

        <div className="panel-card overflow-hidden rounded-[1.8rem]">
          <div className="border-b border-white/10 px-6 py-6">
            <p className="section-kicker mb-1">Carteira</p>
            <h3 className="font-display text-[2rem] leading-none text-[color:var(--text-primary)]">Ativos do investidor</h3>
          </div>
          <div className="custom-scrollbar max-h-[460px] overflow-y-auto p-3">
            {investments.map((investment) => (
              <div data-testid="investment-item" key={investment.id} className="mb-3 rounded-[1.4rem] border border-white/8 bg-black/10 p-4 last:mb-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-semibold text-[color:var(--text-primary)]">{investment.asset_name}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">{investment.type}</div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">
                    <ShieldCheck size={12} className={investment.healthStatus === 'late' ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--accent-positive)]'} />
                    {investment.healthStatus === 'late' ? 'Atenção' : investment.healthStatus === 'ok' ? 'Em dia' : 'Em andamento'}
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Principal</div>
                    <div className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">{formatCurrency(Number(investment.amount_invested))}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Total do contrato</div>
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
