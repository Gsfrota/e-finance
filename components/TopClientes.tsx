
import React, { useState } from 'react';
import { Tenant, AppView } from '../types';
import { useTopClientes } from '../hooks/useTopClientes';
import { useCompanyContext } from '../services/companyScope';
import { fmtMoney } from './InstallmentDetailFlow';
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronRight,
  Crown,
  Loader2,
  AlertCircle,
  Users,
  Target,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

interface TopClientesProps {
  tenant: Tenant | null | undefined;
  onNavigate: (view: AppView) => void;
  onClientClick: (userId: string) => void;
}

type SortKey = 'score' | 'valor' | 'pontualidade' | 'nome';

const maskCPF = (cpf?: string) => {
  if (!cpf || cpf.length < 11) return cpf || '—';
  return `${cpf.slice(0, 3)}.***.***.${cpf.slice(-2)}`;
};

const scoreBadge = (score: number, hasResolved: boolean) => {
  if (!hasResolved) return { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', label: 'Novo' };
  if (score >= 70) return { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', label: 'Pontual' };
  if (score >= 40) return { bg: 'rgba(234,179,8,0.12)', color: '#eab308', label: 'Regular' };
  return { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', label: 'Risco' };
};

const rankColors: Record<number, { bg: string; color: string }> = {
  1: { bg: 'rgba(255,215,0,0.18)', color: '#FFD700' },
  2: { bg: 'rgba(192,192,192,0.18)', color: '#C0C0C0' },
  3: { bg: 'rgba(205,127,50,0.18)', color: '#CD7F32' },
};

const TopClientes: React.FC<TopClientesProps> = ({ tenant, onNavigate, onClientClick }) => {
  const { activeCompanyId } = useCompanyContext();
  const { clientes, loading, error, kpis } = useTopClientes(tenant?.id, activeCompanyId);
  const [sortBy, setSortBy] = useState<SortKey>('score');

  const sorted = [...clientes].sort((a, b) => {
    switch (sortBy) {
      case 'valor': return b.totalPrincipal - a.totalPrincipal;
      case 'pontualidade': return b.punctualityRate - a.punctualityRate;
      case 'nome': return a.fullName.localeCompare(b.fullName);
      default: return b.score - a.score;
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-[color:var(--accent-brass)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 pb-12 animate-fade-in">
        <div className="panel-card rounded-[2rem] px-6 py-10 text-center border border-white/[0.06]">
          <AlertCircle size={32} className="mx-auto mb-2" style={{ color: '#ef4444' }} />
          <p className="text-sm text-[color:var(--text-secondary)]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 animate-fade-in">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
        <button
          onClick={() => onNavigate(AppView.HOME)}
          className="mb-5 flex items-center gap-2 text-sm font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          Voltar
        </button>
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: 'rgba(202,176,122,0.14)' }}>
          <Crown size={22} style={{ color: 'var(--accent-brass)' }} />
        </div>
        <p className="section-kicker mb-2">Ranking</p>
        <h2 className="type-title text-[color:var(--text-primary)] md:text-5xl">
          Top Clientes
        </h2>
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="panel-card card-hover rounded-[2rem] p-4 md:p-5 flex flex-col">
          <div className="mb-3 w-fit rounded-2xl p-2.5" style={{ background: 'rgba(202,176,122,0.14)' }}>
            <Users size={18} style={{ color: 'var(--accent-brass)' }} />
          </div>
          <p className="type-metric-lg text-[color:var(--text-primary)]">{kpis.totalClientes}</p>
          <p className="type-caption text-[color:var(--text-muted)]">Total Clientes</p>
        </div>
        <div className="panel-card card-hover rounded-[2rem] p-4 md:p-5 flex flex-col">
          <div className="mb-3 w-fit rounded-2xl p-2.5" style={{ background: 'rgba(202,176,122,0.14)' }}>
            <Target size={18} style={{ color: 'var(--accent-brass)' }} />
          </div>
          <p className="type-metric-lg text-[color:var(--text-primary)]">{Math.round(kpis.mediaScore)} <span className="text-xs font-normal text-[color:var(--text-faint)]">/ 100</span></p>
          <p className="type-caption text-[color:var(--text-muted)]">Score Médio</p>
        </div>
        <div className="panel-card card-hover rounded-[2rem] p-4 md:p-5 flex flex-col">
          <div className="mb-3 w-fit rounded-2xl p-2.5" style={{ background: 'rgba(52,211,153,0.12)' }}>
            <ShieldCheck size={18} style={{ color: 'var(--accent-positive)' }} />
          </div>
          <p className="type-metric-lg text-[color:var(--text-primary)]">{kpis.clientesPontuais} {kpis.totalClientes > 0 && <span className="text-xs font-normal text-[color:var(--text-faint)]">({Math.round(kpis.clientesPontuais / kpis.totalClientes * 100)}%)</span>}</p>
          <p className="type-caption text-[color:var(--text-muted)]">Pontuais (≥70)</p>
        </div>
        <div className="panel-card card-hover rounded-[2rem] p-4 md:p-5 flex flex-col">
          <div className="mb-3 w-fit rounded-2xl p-2.5" style={{ background: 'rgba(248,113,113,0.12)' }}>
            <ShieldAlert size={18} style={{ color: 'var(--accent-danger)' }} />
          </div>
          <p className="type-metric-lg text-[color:var(--text-primary)]">{kpis.clientesRisco} {kpis.totalClientes > 0 && <span className="text-xs font-normal text-[color:var(--text-faint)]">({Math.round(kpis.clientesRisco / kpis.totalClientes * 100)}%)</span>}</p>
          <p className="type-caption text-[color:var(--text-muted)]">Em Risco (&lt;40)</p>
        </div>
      </div>

      {/* ── Lista de clientes ───────────────────────────────────────────── */}
      <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-8">
        {/* Controles de ordenação */}
        <div className="flex items-center gap-2 flex-wrap border-b border-white/[0.06] pb-4 mb-5">
          <ArrowUpDown size={16} style={{ color: 'var(--text-faint)' }} />
          <span className="type-caption mr-1 text-[color:var(--text-muted)]">Ordenar:</span>
          {([
            ['score', 'Score'],
            ['valor', 'Valor'],
            ['pontualidade', 'Pontualidade'],
            ['nome', 'Nome'],
          ] as [SortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className="rounded-full px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
              style={{
                background: sortBy === key ? 'rgba(202,176,122,0.14)' : 'transparent',
                color: sortBy === key ? 'var(--accent-brass)' : 'var(--text-muted)',
                border: sortBy === key ? '1px solid rgba(202,176,122,0.25)' : '1px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Contagem */}
        {sorted.length > 0 && (
          <p className="type-caption text-[color:var(--text-faint)] mb-4">
            Exibindo {sorted.length} cliente{sorted.length !== 1 ? 's' : ''}
          </p>
        )}

        {/* Lista */}
        {sorted.length === 0 ? (
          <div className="panel-card rounded-[2rem] px-6 py-10 text-center border border-white/[0.06]">
            <Users size={40} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
            <p className="text-sm text-[color:var(--text-secondary)]">Nenhum cliente com contratos encontrado.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((c, idx) => {
              const badge = scoreBadge(c.score, c.hasResolved);
              const position = idx + 1;
              const rank = rankColors[position];
              const punctPct = Math.round(c.punctualityRate * 100);
              const scoreInt = Math.round(c.score);
              return (
                <button
                  key={c.profileId}
                  onClick={() => onClientClick(c.profileId)}
                  className="w-full panel-card card-hover rounded-[1.6rem] border border-white/[0.06] flex items-center gap-4 px-5 py-4 text-left active:bg-white/[0.05] transition-colors cursor-pointer"
                >
                  {/* Position */}
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                    style={{
                      background: rank?.bg || 'var(--bg-elevated)',
                      color: rank?.color || 'var(--text-muted)',
                    }}
                  >
                    {position <= 3 ? <Crown size={16} /> : position}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate text-[color:var(--text-primary)]">
                      {c.fullName}
                    </p>
                    <p className="type-caption text-[color:var(--text-faint)]">
                      CPF {maskCPF(c.cpf)} · {c.totalContracts} contrato{c.totalContracts !== 1 ? 's' : ''} · {fmtMoney(c.totalPrincipal)}
                    </p>
                    {c.hasResolved && (
                      <p className="type-caption mt-0.5">
                        <span style={{ color: punctPct >= 70 ? '#22c55e' : punctPct >= 40 ? '#eab308' : '#ef4444' }}>
                          {punctPct}% pontual
                        </span>
                        {c.overdue > 0 && (
                          <span style={{ color: '#ef4444' }}> · {c.overdue} em atraso</span>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Score badge + progress bar */}
                  <div className="shrink-0 text-right min-w-[52px]">
                    <span
                      className="inline-block rounded-lg px-2.5 py-1 text-xs font-bold"
                      style={{ background: badge.bg, color: badge.color }}
                    >
                      {c.hasResolved ? scoreInt : '—'}
                    </span>
                    {c.hasResolved && (
                      <div className="mt-1.5 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${scoreInt}%`, background: badge.color }}
                        />
                      </div>
                    )}
                    <p className="type-caption mt-0.5" style={{ color: badge.color }}>{badge.label}</p>
                  </div>

                  <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-faint)' }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TopClientes;
