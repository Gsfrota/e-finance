import React, { useMemo } from 'react';
import {
  X, Loader2, AlertCircle, CheckCircle2, Clock3, AlertTriangle,
  TrendingUp, Wallet, RefreshCw, ChevronRight, ArrowRight,
  Calendar, Percent, DollarSign, FileText, History, GitBranch,
  BadgeCheck, Flame, CircleDollarSign, RotateCcw,
} from 'lucide-react';
import { Investment, LoanInstallment } from '../types';
import { useContractDetail } from '../hooks/useContractDetail';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const fmtDate = (ymd?: string | null) => {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
};

const fmtDatetime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const statusBadge = (status?: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    active:    { label: 'Ativo',      cls: 'bg-teal-500/15 text-teal-400 ring-teal-500/25' },
    completed: { label: 'Quitado',    cls: 'bg-green-500/15 text-green-400 ring-green-500/25' },
    defaulted: { label: 'Inadimplente', cls: 'bg-red-500/15 text-red-400 ring-red-500/25' },
    renewed:   { label: 'Renovado',   cls: 'bg-purple-500/15 text-purple-400 ring-purple-500/25' },
  };
  const s = map[status || 'active'] ?? map['active'];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-widest ring-1 ${s.cls}`}>
      {s.label}
    </span>
  );
};

const installmentStatusBadge = (status: LoanInstallment['status']) => {
  const map = {
    paid:    { label: 'Pago',      cls: 'bg-green-500/15 text-green-400' },
    pending: { label: 'Pendente',  cls: 'bg-white/5 text-[color:var(--text-muted)]' },
    late:    { label: 'Atrasado',  cls: 'bg-red-500/15 text-red-400' },
    partial: { label: 'Parcial',   cls: 'bg-yellow-500/15 text-yellow-400' },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  );
};

const panelCard = 'rounded-[1.6rem] border border-white/[0.06] bg-white/[0.02]';

// ── Sub-components ────────────────────────────────────────────────────────────

interface KpiTileProps {
  label: string;
  value: string;
  color?: string;
  icon: React.ElementType;
  iconBg?: string;
}

const KpiTile: React.FC<KpiTileProps> = ({ label, value, color = 'var(--text-primary)', icon: Icon, iconBg = 'rgba(255,255,255,0.05)' }) => (
  <div className={`${panelCard} flex flex-col gap-3 p-4`}>
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: iconBg }}>
        <Icon size={14} style={{ color }} />
      </div>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[color:var(--text-faint)]">{label}</p>
    </div>
    <p className="text-lg font-extrabold leading-none tracking-tight" style={{ color }}>{value}</p>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

interface ContractDetailProps {
  investmentId: number | null;
  onClose: () => void;
  onRenew?: (investment: Investment) => void;
  onRefreshList?: () => void;
}

const ContractDetail: React.FC<ContractDetailProps> = ({ investmentId, onClose, onRenew }) => {
  const { data, loading, error, refetch } = useContractDetail(investmentId);

  const progressPct = useMemo(() => {
    if (!data) return 0;
    const { parcelasPagas, parcelasTotal } = data.metrics;
    return parcelasTotal > 0 ? Math.round((parcelasPagas / parcelasTotal) * 100) : 0;
  }, [data]);

  const saudeColor = useMemo(() => {
    if (!data) return 'var(--text-muted)';
    const s = data.metrics.saudeContrato;
    if (s >= 80) return 'var(--accent-positive)';
    if (s >= 50) return '#f59e0b';
    return 'var(--accent-danger)';
  }, [data]);

  return (
    // Slide-over overlay
    <div className="fixed inset-0 z-50 flex justify-end" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative z-10 flex h-full w-full max-w-3xl flex-col bg-[color:var(--bg-elevated)] shadow-2xl animate-fade-in overflow-hidden"
        style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Loading */}
        {loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[color:var(--accent-brass)]">
            <Loader2 size={36} className="animate-spin" />
            <p className="text-xs font-bold uppercase tracking-widest text-[color:var(--text-muted)]">Carregando contrato...</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
            <AlertCircle size={36} className="text-[color:var(--accent-danger)]" />
            <p className="text-sm text-[color:var(--text-secondary)]">{error}</p>
            <button onClick={refetch} className="flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs font-bold text-[color:var(--text-primary)] hover:bg-white/10">
              <RefreshCw size={13} /> Tentar novamente
            </button>
          </div>
        )}

        {/* Content */}
        {!loading && !error && data && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* ── Header ── */}
            <div className="shrink-0 border-b border-white/[0.06] bg-[color:var(--bg-base)]/60 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {statusBadge(data.investment.status)}
                    {data.parent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-purple-400 ring-1 ring-purple-500/20">
                        <GitBranch size={10} /> Renovação de #{data.parent.id}
                      </span>
                    )}
                  </div>
                  <h2 className="truncate font-display text-2xl font-black leading-none text-[color:var(--text-primary)]">
                    {data.investment.asset_name}
                  </h2>
                  <p className="mt-1 text-xs text-[color:var(--text-faint)]">
                    ID #{data.investment.id} · Criado em {fmtDate(data.investment.created_at?.split('T')[0])}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="shrink-0 rounded-full p-2.5 text-[color:var(--text-muted)] transition-colors hover:bg-white/10 hover:text-[color:var(--text-primary)]"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Partes */}
              <div className="mt-4 flex items-center gap-3 text-sm">
                <div className="rounded-xl bg-white/5 px-3 py-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">Investidor</p>
                  <p className="font-semibold text-[color:var(--text-primary)]">{data.investment.investor?.full_name ?? '—'}</p>
                </div>
                <ArrowRight size={14} className="text-[color:var(--text-faint)] shrink-0" />
                <div className="rounded-xl bg-white/5 px-3 py-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">Devedor</p>
                  <p className="font-semibold text-[color:var(--text-primary)]">{data.investment.payer?.full_name ?? '—'}</p>
                </div>
              </div>

              {/* Progresso de parcelas */}
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">
                  <span>{data.metrics.parcelasPagas}/{data.metrics.parcelasTotal} parcelas pagas</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[color:var(--accent-teal)] transition-all duration-700"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Ações */}
              <div className="mt-4 flex flex-wrap gap-2">
                {onRenew && (
                  <button
                    onClick={() => onRenew(data.investment)}
                    className="flex items-center gap-2 rounded-full bg-[rgba(202,176,122,0.12)] px-4 py-2 text-[11px] font-extrabold uppercase tracking-widest text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.20)] transition-all hover:bg-[rgba(202,176,122,0.20)]"
                  >
                    <RotateCcw size={13} /> Renovar Contrato
                  </button>
                )}
              </div>
            </div>

            {/* ── Body (scrollável) ── */}
            <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-6 space-y-6">

              {/* Seção: KPIs Financeiros */}
              <section>
                <p className="section-kicker mb-3">Rentabilidade</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <KpiTile
                    label="Juros Recebidos"
                    value={fmt(data.metrics.jurosPagos)}
                    color="var(--accent-positive)"
                    icon={TrendingUp}
                    iconBg="rgba(143,179,157,0.14)"
                  />
                  <KpiTile
                    label="Principal Recuperado"
                    value={fmt(data.metrics.principalRecuperado)}
                    color="var(--accent-teal)"
                    icon={Wallet}
                    iconBg="rgba(74,180,180,0.10)"
                  />
                  <KpiTile
                    label="Rentabilidade Real"
                    value={`${data.metrics.rentabilidadeReal.toFixed(1).replace('.', ',')}%`}
                    color="var(--accent-brass)"
                    icon={Percent}
                    iconBg="rgba(202,176,122,0.14)"
                  />
                  <KpiTile
                    label="Juros a Receber"
                    value={fmt(data.metrics.jurosAReceber)}
                    color="var(--accent-steel)"
                    icon={CircleDollarSign}
                    iconBg="rgba(74,101,133,0.18)"
                  />
                  <KpiTile
                    label="Multas Acumuladas"
                    value={fmt(data.metrics.fineAcumulada)}
                    color={data.metrics.fineAcumulada > 0 ? 'var(--accent-danger)' : 'var(--text-muted)'}
                    icon={Flame}
                    iconBg={data.metrics.fineAcumulada > 0 ? 'rgba(198,126,105,0.14)' : 'rgba(255,255,255,0.04)'}
                  />
                  <KpiTile
                    label="Saúde do Contrato"
                    value={`${data.metrics.saudeContrato}%`}
                    color={saudeColor}
                    icon={BadgeCheck}
                    iconBg="rgba(255,255,255,0.04)"
                  />
                </div>

                {/* Resumo contrato */}
                <div className={`mt-3 grid grid-cols-3 gap-2`}>
                  {[
                    { label: 'Principal', value: fmt(data.investment.amount_invested) },
                    { label: 'Taxa', value: `${data.investment.interest_rate}% a.m.` },
                    { label: 'Parcela', value: fmt(data.investment.installment_value) },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-2xl border border-white/[0.05] bg-white/[0.02] px-3 py-3 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">{label}</p>
                      <p className="mt-1 text-sm font-extrabold text-[color:var(--text-primary)]">{value}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Seção: Parcelas */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <p className="section-kicker">Parcelas</p>
                  <div className="flex gap-2 text-[10px] font-bold">
                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-green-400">{data.metrics.parcelasPagas} pagas</span>
                    {data.metrics.parcelasAtrasadas > 0 && (
                      <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-400">{data.metrics.parcelasAtrasadas} atrasadas</span>
                    )}
                    {data.metrics.parcelasPendentes > 0 && (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[color:var(--text-faint)]">{data.metrics.parcelasPendentes} pendentes</span>
                    )}
                  </div>
                </div>

                <div className={`${panelCard} overflow-hidden`}>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="border-b border-white/[0.06] bg-black/10">
                        <tr className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[color:var(--text-faint)]">
                          <th className="px-4 py-3">Nº</th>
                          <th className="px-4 py-3">Vencimento</th>
                          <th className="px-4 py-3 text-right">Principal</th>
                          <th className="px-4 py-3 text-right">Juros</th>
                          <th className="px-4 py-3 text-right">Multa</th>
                          <th className="px-4 py-3 text-right">Total</th>
                          <th className="px-4 py-3 text-right">Pago</th>
                          <th className="px-4 py-3 text-center">Status</th>
                          <th className="px-4 py-3 text-right">Pago em</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {data.installments.map((i) => {
                          const multa = (Number(i.fine_amount) || 0) + (Number(i.interest_delay_amount) || 0);
                          return (
                            <tr key={i.id} className={`transition-colors hover:bg-white/[0.02] ${i.status === 'late' ? 'bg-red-500/[0.03]' : ''}`}>
                              <td className="px-4 py-3 font-bold text-[color:var(--text-secondary)]">{i.number}</td>
                              <td className="px-4 py-3 tabular-nums text-[color:var(--text-secondary)]">{fmtDate(i.due_date)}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-[color:var(--text-secondary)]">{fmt(i.amount_principal)}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-[color:var(--accent-brass)]">{fmt(i.amount_interest)}</td>
                              <td className={`px-4 py-3 text-right tabular-nums ${multa > 0 ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-faint)]'}`}>
                                {multa > 0 ? fmt(multa) : '—'}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums font-bold text-[color:var(--text-primary)]">{fmt(i.amount_total)}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-[color:var(--accent-positive)]">
                                {i.amount_paid > 0 ? fmt(i.amount_paid) : '—'}
                              </td>
                              <td className="px-4 py-3 text-center">{installmentStatusBadge(i.status)}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-[color:var(--text-faint)]">
                                {i.paid_at ? fmtDatetime(i.paid_at) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {data.installments.length === 0 && (
                      <div className="py-10 text-center text-xs font-bold uppercase tracking-widest text-[color:var(--text-faint)]">
                        Nenhuma parcela encontrada
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Seção: Histórico de Renegociações */}
              <section>
                <p className="section-kicker mb-3 flex items-center gap-2">
                  <History size={13} /> Renegociações ({data.renegotiations.length})
                </p>
                {data.renegotiations.length === 0 ? (
                  <div className={`${panelCard} flex items-center gap-3 px-5 py-4`}>
                    <CheckCircle2 size={16} className="text-[color:var(--accent-positive)] shrink-0" />
                    <p className="text-xs text-[color:var(--text-faint)]">Nenhuma renegociação registrada neste contrato.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.renegotiations.map((r) => (
                      <div key={r.id} className={`${panelCard} px-4 py-3`}>
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-xs font-bold text-[color:var(--text-primary)]">{fmtDatetime(r.renegotiated_at)}</p>
                        </div>
                        <div className="flex flex-wrap gap-3 text-[11px]">
                          {r.old_installment_value != null && r.new_installment_value != null && (
                            <span className="text-[color:var(--text-secondary)]">
                              Parcela: <span className="line-through text-[color:var(--text-faint)]">{fmt(r.old_installment_value)}</span>
                              {' → '}
                              <span className="font-bold text-[color:var(--accent-brass)]">{fmt(r.new_installment_value)}</span>
                            </span>
                          )}
                          {r.old_total_installments != null && r.new_total_installments != null && (
                            <span className="text-[color:var(--text-secondary)]">
                              Prazo: <span className="line-through text-[color:var(--text-faint)]">{r.old_total_installments}x</span>
                              {' → '}
                              <span className="font-bold text-[color:var(--accent-brass)]">{r.new_total_installments}x</span>
                            </span>
                          )}
                          {r.old_due_date != null && r.new_due_date != null && (
                            <span className="text-[color:var(--text-secondary)]">
                              Vencimento: <span className="line-through text-[color:var(--text-faint)]">{fmtDate(r.old_due_date)}</span>
                              {' → '}
                              <span className="font-bold text-[color:var(--accent-brass)]">{fmtDate(r.new_due_date)}</span>
                            </span>
                          )}
                        </div>
                        {r.reason && (
                          <p className="mt-1.5 text-[11px] italic text-[color:var(--text-faint)]">"{r.reason}"</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Seção: Cadeia de Renovações */}
              {(data.renewals.length > 0 || data.parent) && (
                <section>
                  <p className="section-kicker mb-3 flex items-center gap-2">
                    <GitBranch size={13} /> Cadeia de Renovações
                  </p>
                  <div className="space-y-2">
                    {data.parent && (
                      <div className={`${panelCard} flex items-center gap-3 px-4 py-3`}>
                        <ChevronRight size={14} className="shrink-0 text-[color:var(--text-faint)]" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">Contrato original</p>
                          <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                            #{data.parent.id} — {data.parent.asset_name}
                          </p>
                        </div>
                        {statusBadge(data.parent.status)}
                      </div>
                    )}
                    {data.renewals.map((r) => (
                      <div key={r.id} className={`${panelCard} flex items-center gap-3 px-4 py-3`}>
                        <RotateCcw size={14} className="shrink-0 text-[color:var(--accent-brass)]" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-faint)]">Renovação</p>
                          <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                            #{r.id} — {r.asset_name}
                          </p>
                          <p className="text-[10px] text-[color:var(--text-faint)]">Criado em {fmtDate(r.created_at?.split('T')[0])}</p>
                        </div>
                        {statusBadge(r.status)}
                      </div>
                    ))}
                  </div>
                </section>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContractDetail;
