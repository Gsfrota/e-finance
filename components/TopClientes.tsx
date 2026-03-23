
import React, { useState } from 'react';
import { Tenant, AppView } from '../types';
import { useTopClientes } from '../hooks/useTopClientes';
import { useCompanyContext } from '../services/companyScope';
import { fmtMoney } from './InstallmentDetailFlow';
import {
  ArrowLeft,
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

const scoreConfig = (score: number) => {
  if (score >= 70) return {
    bg: 'rgba(52,211,153,0.12)',
    color: 'var(--accent-positive)',
    ring: 'rgba(52,211,153,0.30)',
    label: 'Pontual',
  };
  if (score >= 40) return {
    bg: 'rgba(251,191,36,0.12)',
    color: 'var(--accent-warning)',
    ring: 'rgba(251,191,36,0.30)',
    label: 'Regular',
  };
  return {
    bg: 'rgba(248,113,113,0.12)',
    color: 'var(--accent-danger)',
    ring: 'rgba(248,113,113,0.30)',
    label: 'Risco',
  };
};

const SORT_OPTIONS: [SortKey, string][] = [
  ['score', 'Score'],
  ['valor', 'Valor'],
  ['pontualidade', 'Pontualidade'],
  ['nome', 'Nome'],
];

const KPI_CARDS = (kpis: { totalClientes: number; mediaScore: number; clientesPontuais: number; clientesRisco: number }) => [
  {
    icon: <Users size={17} style={{ color: 'var(--accent-brass)' }} />,
    iconBg: 'rgba(202,176,122,0.14)',
    value: kpis.totalClientes,
    label: 'Total Clientes',
  },
  {
    icon: <Target size={17} style={{ color: 'var(--accent-brass)' }} />,
    iconBg: 'rgba(202,176,122,0.14)',
    value: kpis.mediaScore,
    label: 'Score Médio',
  },
  {
    icon: <ShieldCheck size={17} style={{ color: 'var(--accent-positive)' }} />,
    iconBg: 'rgba(52,211,153,0.12)',
    value: kpis.clientesPontuais,
    label: 'Pontuais ≥70',
  },
  {
    icon: <ShieldAlert size={17} style={{ color: 'var(--accent-danger)' }} />,
    iconBg: 'rgba(248,113,113,0.12)',
    value: kpis.clientesRisco,
    label: 'Em Risco <40',
  },
];

const TopClientes: React.FC<TopClientesProps> = ({ tenant, onNavigate, onClientClick }) => {
  const { activeCompanyId } = useCompanyContext();
  const { clientes, loading, error, kpis } = useTopClientes(tenant?.id, activeCompanyId);
  const [sortBy, setSortBy] = useState<SortKey>('score');

  const sorted = [...clientes].sort((a, b) => {
    switch (sortBy) {
      case 'valor':       return b.totalPrincipal - a.totalPrincipal;
      case 'pontualidade': return b.punctualityRate - a.punctualityRate;
      case 'nome':        return a.fullName.localeCompare(b.fullName);
      default:            return b.score - a.score;
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent-brass)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 pb-12 animate-fade-in">
        <div className="panel-card rounded-[2rem] px-6 py-10 text-center">
          <AlertCircle size={32} className="mx-auto mb-2" style={{ color: 'var(--accent-danger)' }} />
          <p className="text-sm text-[color:var(--text-secondary)]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="panel-card rounded-[2rem] px-5 py-5 md:px-8 md:py-7">
        <button
          onClick={() => onNavigate(AppView.HOME)}
          className="mb-4 flex items-center gap-1.5 text-sm font-medium transition-colors cursor-pointer"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <ArrowLeft size={15} />
          Voltar
        </button>
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(202,176,122,0.14)' }}
          >
            <Crown size={22} style={{ color: 'var(--accent-brass)' }} />
          </div>
          <div>
            <p className="section-kicker mb-0.5">Ranking</p>
            <h2 className="type-title leading-tight text-[color:var(--text-primary)]">
              Top Clientes
            </h2>
          </div>
        </div>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {KPI_CARDS(kpis).map(({ icon, iconBg, value, label }) => (
          <div
            key={label}
            className="panel-card card-hover rounded-[1.8rem] p-4 flex flex-col gap-3"
          >
            <div className="w-fit rounded-xl p-2" style={{ background: iconBg }}>
              {icon}
            </div>
            <div>
              <p
                className="font-bold leading-none tracking-tight text-[color:var(--text-primary)]"
                style={{ fontSize: '1.65rem' }}
              >
                {value}
              </p>
              <p className="type-caption mt-1 text-[color:var(--text-muted)]">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Lista de clientes ───────────────────────────────────────────── */}
      <div className="panel-card rounded-[2rem] overflow-hidden">

        {/* Cabeçalho + sort (nunca quebra linha) */}
        <div className="px-5 pt-5 pb-3 md:px-7 md:pt-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-[color:var(--text-primary)]">
              Clientes{' '}
              {sorted.length > 0 && (
                <span className="font-normal text-[color:var(--text-muted)]">
                  ({sorted.length})
                </span>
              )}
            </p>
          </div>

          {/* Sort strip — scroll horizontal, nunca quebra */}
          <div
            className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
            style={{ scrollbarWidth: 'none' }}
          >
            {SORT_OPTIONS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer"
                style={{
                  background: sortBy === key
                    ? 'rgba(202,176,122,0.16)'
                    : 'rgba(255,255,255,0.04)',
                  color: sortBy === key ? 'var(--accent-brass)' : 'var(--text-muted)',
                  border: sortBy === key
                    ? '1px solid rgba(202,176,122,0.30)'
                    : '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-white/[0.06]" />

        {/* Empty state */}
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <div
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <Users size={26} style={{ color: 'var(--text-faint)' }} />
            </div>
            <p className="text-sm font-medium text-[color:var(--text-secondary)]">
              Nenhum cliente encontrado
            </p>
            <p className="type-caption mt-1 text-[color:var(--text-faint)]">
              Contratos ativos aparecerão aqui
            </p>
          </div>
        ) : (
          <div>
            {sorted.map((c, idx) => {
              const cfg = scoreConfig(c.score);
              const position = idx + 1;
              const isTop3 = position <= 3;
              const punctPct = Math.round(c.punctualityRate * 100);

              return (
                <button
                  key={c.profileId}
                  onClick={() => onClientClick(c.profileId)}
                  className="w-full flex items-center gap-3.5 px-5 py-4 md:px-7 text-left transition-colors cursor-pointer hover:bg-white/[0.025] active:bg-white/[0.04]"
                  style={{
                    borderBottom: idx < sorted.length - 1
                      ? '1px solid rgba(255,255,255,0.05)'
                      : 'none',
                  }}
                >
                  {/* Posição */}
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background: isTop3
                        ? 'rgba(202,176,122,0.15)'
                        : 'rgba(255,255,255,0.05)',
                      color: isTop3 ? 'var(--accent-brass)' : 'var(--text-muted)',
                    }}
                  >
                    {isTop3 ? <Crown size={15} /> : position}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate text-[color:var(--text-primary)]">
                      {c.fullName}
                    </p>
                    <p className="type-caption mt-0.5 truncate text-[color:var(--text-faint)]">
                      CPF {maskCPF(c.cpf)} · {c.totalContracts}{' '}
                      contrato{c.totalContracts !== 1 ? 's' : ''} · {fmtMoney(c.totalPrincipal)}
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

                  {/* Score circular */}
                  <div className="shrink-0 flex flex-col items-center gap-0.5">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
                      style={{
                        background: cfg.bg,
                        color: cfg.color,
                        border: `2px solid ${cfg.ring}`,
                      }}
                    >
                      {c.score}
                    </div>
                    <p
                      className="text-[10px] font-semibold leading-none"
                      style={{ color: cfg.color }}
                    >
                      {cfg.label}
                    </p>
                  </div>

                  <ChevronRight
                    size={15}
                    className="shrink-0"
                    style={{ color: 'var(--text-faint)' }}
                  />
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
