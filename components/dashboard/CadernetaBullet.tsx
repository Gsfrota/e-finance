import React, { useState, useMemo } from 'react';
import { Investment, LoanInstallment, Tenant } from '../../types';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useCompanyContext } from '../../services/companyScope';
import { classifyContract } from '../../hooks/useYieldMetrics';
import {
  InstallmentDetailScreen,
  InstallmentFormScreen,
  type InstallmentAction,
} from '../InstallmentDetailFlow';
import { monthKeyToDate, dateToMonthKey } from '../../hooks/useInvestorMetrics';
import {
  fmtMoney,
  fmtDate,
  installmentStatusBadge,
  normalizeNum,
} from '../InstallmentDetailFlow';
import { getBrazilToday } from '../../services/dateUtils';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Users,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FlatInstallment {
  inst: LoanInstallment;
  investmentId: number;
  payerName: string;
  payerPhoto: string | null;
  contractName: string;
  operationalStatus: OperationalInstallmentStatus;
  daysLate: number;
  statusColor: string;
  cycleAmountDue: number;
  outstanding: number;
  payPercent: number;
}

export interface CadernetaBulletProps {
  tenant: Tenant | null;
  onBack: () => void;
  onInstallmentClick?: (installmentId: string, investmentId: number) => void;
}

interface CadernetaBulletViewProps {
  investments: Investment[];
  allPaidInstallments: LoanInstallment[];
  pendingInstallments: LoanInstallment[];
  onBack: () => void;
  onInstallmentClick?: (installmentId: string, investmentId: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthLabel(key: string): string {
  const d = monthKeyToDate(key);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function prevMonth(key: string): string {
  const d = monthKeyToDate(key);
  d.setMonth(d.getMonth() - 1);
  return dateToMonthKey(d);
}

function nextMonth(key: string): string {
  const d = monthKeyToDate(key);
  d.setMonth(d.getMonth() + 1);
  return dateToMonthKey(d);
}

function isInMonth(dueDateYMD: string, monthKey: string): boolean {
  return dueDateYMD.startsWith(monthKey);
}

function fmtKpi(v: number): string {
  const hasDecimals = v % 1 !== 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(v || 0);
}

type OperationalInstallmentStatus = 'paid' | 'pending' | 'partial' | 'late' | 'defaulted';

const DEFAULTED_AFTER_DAYS = 20;
const MONEY_EPSILON = 0.01;
const MS_PER_DAY = 86_400_000;
const PERCENT_MAX = 100;
const COLLECTION_RATE_GOOD = 80;
const COLLECTION_RATE_WARNING = 50;

function daysBetweenYMD(startYMD: string, endYMD: string): number {
  const [sy, sm, sd] = startYMD.split('-').map(Number);
  const [ey, em, ed] = endYMD.split('-').map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return 0;
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.floor((end - start) / MS_PER_DAY);
}

function getDaysLate(inst: LoanInstallment, todayYMD: string): number {
  if (!inst.due_date || inst.due_date >= todayYMD) return 0;
  return Math.max(0, daysBetweenYMD(inst.due_date, todayYMD));
}

function getCycleAmountDue(inst: LoanInstallment, investment?: Investment): number {
  if (investment?.calculation_mode === 'interest_only') {
    return normalizeNum(inst.amount_interest);
  }
  return normalizeNum(inst.amount_total);
}

function getOperationalTotalDue(inst: LoanInstallment, investment?: Investment): number {
  return getCycleAmountDue(inst, investment)
    + normalizeNum(inst.fine_amount)
    + normalizeNum(inst.interest_delay_amount);
}

function getOperationalOutstanding(inst: LoanInstallment, investment?: Investment): number {
  return Math.max(0, getOperationalTotalDue(inst, investment) - normalizeNum(inst.amount_paid));
}

function getPayPercent(inst: LoanInstallment, investment?: Investment): number {
  const totalDue = getOperationalTotalDue(inst, investment);
  if (totalDue <= MONEY_EPSILON) return 0;
  return Math.min(PERCENT_MAX, (normalizeNum(inst.amount_paid) / totalDue) * PERCENT_MAX);
}

function isPaymentPartial(inst: LoanInstallment, investment?: Investment): boolean {
  const paid = normalizeNum(inst.amount_paid);
  return paid > 0 && getOperationalOutstanding(inst, investment) > MONEY_EPSILON;
}

function getOperationalStatus(inst: LoanInstallment, todayYMD: string, investment?: Investment): OperationalInstallmentStatus {
  const outstanding = getOperationalOutstanding(inst, investment);
  const hasOutstanding = outstanding > MONEY_EPSILON;
  const daysLate = getDaysLate(inst, todayYMD);

  if (hasOutstanding && daysLate >= DEFAULTED_AFTER_DAYS) return 'defaulted';
  if (hasOutstanding && daysLate > 0) return 'late';
  if (inst.status === 'partial' || isPaymentPartial(inst, investment)) return 'partial';
  if (inst.status === 'paid' && !hasOutstanding) return 'paid';
  return 'pending';
}

function isOperationallyOpen(status: OperationalInstallmentStatus): boolean {
  return status !== 'paid';
}

function statusColorForInst(status: OperationalInstallmentStatus): string {
  if (status === 'late' || status === 'defaulted') return 'var(--accent-danger)';
  if (status === 'partial') return 'var(--accent-warning)';
  if (status === 'pending') return 'var(--accent-warning)';
  return 'var(--accent-positive)';
}

function operationalStatusBadge(status: OperationalInstallmentStatus) {
  if (status === 'defaulted') return <span className="chip chip-late">Inadimplente</span>;
  return installmentStatusBadge(status);
}

// ── Wrapper ───────────────────────────────────────────────────────────────────

const CadernetaBullet: React.FC<CadernetaBulletProps> = ({ tenant, onBack, onInstallmentClick }) => {
  const { activeCompanyId } = useCompanyContext();
  const { investments, allPaidInstallments, installments, loading, error, refetch } =
    useDashboardData(tenant?.id, activeCompanyId);

  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);

  const allInstPool = useMemo(() => {
    const map = new Map<string, LoanInstallment>();
    for (const i of allPaidInstallments) map.set(i.id, i);
    for (const i of installments) map.set(i.id, i);
    return map;
  }, [allPaidInstallments, installments]);

  const handleInstallmentClick = (installmentId: string, investmentId: number) => {
    if (onInstallmentClick) {
      onInstallmentClick(installmentId, investmentId);
      return;
    }
    const inst = allInstPool.get(installmentId);
    if (!inst) return;
    const siblings = Array.from<LoanInstallment>(allInstPool.values()).filter(i => i.investment_id === investmentId);
    const enriched = { ...inst, investment: inst.investment ? { ...inst.investment, loan_installments: siblings } : inst.investment };
    setSelectedInstallment(enriched as LoanInstallment);
    setInstallmentAction(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent-caution)' }} />
        <p className="type-caption" style={{ color: 'var(--text-muted)' }}>Carregando caderneta…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-card rounded-[1.8rem] flex flex-col items-center justify-center py-16 gap-3">
        <AlertTriangle size={28} style={{ color: 'var(--accent-danger)' }} />
        <p className="type-body" style={{ color: 'var(--text-muted)' }}>{error}</p>
        <button onClick={onBack} className="type-caption underline cursor-pointer" style={{ color: 'var(--accent-steel)' }}>Voltar</button>
      </div>
    );
  }

  if (selectedInstallment && installmentAction) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => { setInstallmentAction(null); setSelectedInstallment(null); refetch(); }}
      />
    );
  }

  if (selectedInstallment) {
    return (
      <InstallmentDetailScreen
        installment={selectedInstallment}
        onBack={() => setSelectedInstallment(null)}
        onAction={(action) => setInstallmentAction(action)}
      />
    );
  }

  return (
    <CadernetaBulletView
      investments={investments}
      allPaidInstallments={allPaidInstallments}
      pendingInstallments={installments}
      onBack={onBack}
      onInstallmentClick={handleInstallmentClick}
    />
  );
};

// ── Main View ─────────────────────────────────────────────────────────────────

export const CadernetaBulletView: React.FC<CadernetaBulletViewProps> = ({
  investments,
  allPaidInstallments,
  pendingInstallments,
  onBack,
  onInstallmentClick,
}) => {
  type StatusFilter = 'open' | 'late' | 'pending' | 'paid';

  const todayYMD = getBrazilToday();
  const currentMonthKey = todayYMD.slice(0, 7);
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');

  const isCurrentOrFuture = monthKey >= currentMonthKey;
  const goToNextMonth = () => {
    const next = nextMonth(monthKey);
    if (next <= currentMonthKey) setMonthKey(next);
  };

  // Pool deduplicado de parcelas (paid + pending)
  const allInstallments = useMemo(() => {
    const map = new Map<string, LoanInstallment>();
    for (const inst of allPaidInstallments) map.set(inst.id, inst);
    for (const inst of pendingInstallments) map.set(inst.id, inst);
    return Array.from(map.values());
  }, [allPaidInstallments, pendingInstallments]);

  // IDs de contratos bullet ativos
  const bulletInvestmentIds = useMemo(() => {
    return new Set(
      investments
        .filter(
          (inv) =>
            classifyContract(inv.calculation_mode, inv.frequency).category === 'bullet' &&
            inv.status !== 'renewed'  // renewed = substituído por novo contrato; todos os demais são relevantes
        )
        .map((inv) => inv.id)
    );
  }, [investments]);

  const bulletInvestmentsMap = useMemo(() => {
    const m = new Map<number, Investment>();
    for (const inv of investments) {
      if (bulletInvestmentIds.has(inv.id)) m.set(inv.id, inv);
    }
    return m;
  }, [investments, bulletInvestmentIds]);

  // Lista flat de parcelas bullet do mês, ordenadas: inadimplente/atraso → parcial/pendente → pago
  const flatInstallments = useMemo((): FlatInstallment[] => {
    const monthInsts = allInstallments.filter((inst) => {
      if (!inst.investment_id) return false;
      if (!bulletInvestmentIds.has(inst.investment_id)) return false;
      return isInMonth(inst.due_date, monthKey);
    });

    const withOperationalStatus = monthInsts.map((inst) => {
      const investment = bulletInvestmentsMap.get(inst.investment_id);
      const operationalStatus = getOperationalStatus(inst, todayYMD, investment);
      return {
        inst,
        operationalStatus,
        daysLate: getDaysLate(inst, todayYMD),
        investment,
      };
    });

    return withOperationalStatus
      .sort((a, b) => {
        const score = (status: OperationalInstallmentStatus) => {
          if (status === 'defaulted') return 0;
          if (status === 'late') return 1;
          if (status === 'partial') return 2;
          if (status === 'pending') return 3;
          return 4;
        };
        const scoreA = score(a.operationalStatus);
        const scoreB = score(b.operationalStatus);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.inst.due_date.localeCompare(b.inst.due_date);
      })
      .map(({ inst, operationalStatus, daysLate, investment }) => {
        const inv = investment;
        const payer = inv?.payer;
        const outstanding = getOperationalOutstanding(inst, inv);
        return {
          inst,
          investmentId: inst.investment_id,
          payerName: payer?.full_name || inv?.payer_name || 'Devedor',
          payerPhoto: payer?.photo_url || null,
          contractName: inv?.asset_name || '',
          operationalStatus,
          daysLate,
          statusColor: statusColorForInst(operationalStatus),
          cycleAmountDue: getCycleAmountDue(inst, inv),
          outstanding,
          payPercent: getPayPercent(inst, inv),
        };
      });
  }, [allInstallments, bulletInvestmentIds, bulletInvestmentsMap, monthKey, todayYMD]);

  // KPIs (sempre do total do mês, sem filtro — BR-REL-013)
  const kpis = useMemo(() => {
    // Devedores únicos por payer_id (fallback: nome)
    const totalDebtors = new Set(flatInstallments.map(f => {
      const inv = bulletInvestmentsMap.get(f.investmentId);
      return inv?.payer_id || f.payerName;
    })).size;
    // Esperado bruto operacional = valor cobrável do ciclo exibido (juros em contratos bullet interest_only)
    const totalBruto = flatInstallments.reduce((s, f) => s + f.cycleAmountDue, 0);
    // Líquido = só os juros de cada parcela
    const totalInterest = flatInstallments.reduce((s, f) => s + (f.inst.amount_interest ?? f.inst.amount_total), 0);
    const totalReceived = flatInstallments.reduce((s, f) => s + f.inst.amount_paid, 0);
    const totalOverdue = flatInstallments
      .filter(f => f.operationalStatus === 'late' || f.operationalStatus === 'defaulted')
      .reduce((s, f) => s + f.outstanding, 0);
    const collectionRate = totalBruto > 0 ? Math.min(PERCENT_MAX, (totalReceived / totalBruto) * PERCENT_MAX) : 0;
    const progressBruto = totalBruto > 0 ? Math.min(PERCENT_MAX, (totalReceived / totalBruto) * PERCENT_MAX) : 0;
    const progressLiquido = totalInterest > 0 ? Math.min(PERCENT_MAX, (totalReceived / totalInterest) * PERCENT_MAX) : 0;
    return { totalDebtors, totalBruto, totalInterest, totalReceived, totalOverdue, collectionRate, progressBruto, progressLiquido };
  }, [flatInstallments, bulletInvestmentsMap]);

  // Filtra parcelas pelo status operacional selecionado (BR-REL-012)
  const filteredInstallments = useMemo(() => {
    if (statusFilter === 'open') return flatInstallments.filter(f => isOperationallyOpen(f.operationalStatus));
    if (statusFilter === 'late') return flatInstallments.filter(f => f.operationalStatus === 'late' || f.operationalStatus === 'defaulted');
    if (statusFilter === 'pending') return flatInstallments.filter(f => f.operationalStatus === 'pending' || f.operationalStatus === 'partial');
    if (statusFilter === 'paid') return flatInstallments.filter(f => f.operationalStatus === 'paid');
    return flatInstallments;
  }, [flatInstallments, statusFilter]);

  // Contadores para os pills
  const counts = useMemo(() => ({
    open: flatInstallments.filter(f => isOperationallyOpen(f.operationalStatus)).length,
    late: flatInstallments.filter(f => f.operationalStatus === 'late' || f.operationalStatus === 'defaulted').length,
    pending: flatInstallments.filter(f => f.operationalStatus === 'pending' || f.operationalStatus === 'partial').length,
    paid: flatInstallments.filter(f => f.operationalStatus === 'paid').length,
  }), [flatInstallments]);

  return (
    <div className="space-y-2.5 animate-fade-in-up" data-testid="caderneta-bullet-root">
      {/* Header compacto */}
      <div className="panel-card rounded-2xl px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onBack}
              className="flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-white/[0.08] cursor-pointer"
              title="Voltar"
            >
              <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
            </button>
            <BookOpen size={16} style={{ color: 'var(--accent-caution)' }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Caderneta Bullet
            </h2>
          </div>

          {/* Navegação de mês inline */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMonthKey(prevMonth(monthKey))}
              className="flex items-center justify-center rounded-lg p-1 transition-colors hover:bg-white/[0.08] cursor-pointer"
              data-testid="caderneta-month-prev"
              aria-label="Mês anterior"
            >
              <ChevronLeft size={16} style={{ color: 'var(--text-secondary)' }} />
            </button>
            <span
              className="text-sm font-semibold tabular-nums capitalize"
              style={{ color: 'var(--text-primary)', minWidth: 120, textAlign: 'center' }}
              data-testid="caderneta-month-label"
            >
              {monthLabel(monthKey)}
            </span>
            <button
              onClick={goToNextMonth}
              disabled={isCurrentOrFuture}
              className="flex items-center justify-center rounded-lg p-1 transition-colors hover:bg-white/[0.08] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="caderneta-month-next"
              aria-label="Próximo mês"
            >
              <ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
        </div>
      </div>

      {/* KPIs — 6 cards sem drill-down */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          icon={<Users size={16} />}
          label="Devedores"
          value={String(kpis.totalDebtors)}
          color="var(--accent-caution)"
          onClick={() => setStatusFilter('open')}
        />
        <KpiCard
          icon={<TrendingUp size={16} />}
          label="Esperado bruto"
          value={fmtKpi(kpis.totalBruto)}
          color="var(--accent-brass)"
          progress={kpis.progressBruto}
          progressLabel={`${fmtKpi(kpis.totalReceived)} recebido · ${kpis.progressBruto.toFixed(0)}%`}
          onClick={() => setStatusFilter('open')}
        />
        <KpiCard
          icon={<TrendingUp size={16} />}
          label="Esperado líquido"
          value={fmtKpi(kpis.totalInterest)}
          color="var(--accent-purple)"
          progress={kpis.progressLiquido}
          progressLabel={`${fmtKpi(kpis.totalReceived)} recebido · ${kpis.progressLiquido.toFixed(0)}%`}
          onClick={() => setStatusFilter('open')}
        />
        <KpiCard
          icon={<CheckCircle2 size={16} />}
          label="Recebido"
          value={fmtKpi(kpis.totalReceived)}
          color="var(--accent-positive)"
          onClick={() => setStatusFilter('paid')}
        />
        <KpiCard
          icon={<AlertTriangle size={16} />}
          label="Em atraso"
          value={fmtKpi(kpis.totalOverdue)}
          color="var(--accent-danger)"
          onClick={() => setStatusFilter('late')}
        />
        <KpiCard
          icon={<Clock size={16} />}
          label="Taxa cobrança"
          value={`${kpis.collectionRate.toFixed(1).replace('.', ',')}%`}
          color={kpis.collectionRate >= COLLECTION_RATE_GOOD ? 'var(--accent-positive)' : kpis.collectionRate >= COLLECTION_RATE_WARNING ? 'var(--accent-warning)' : 'var(--accent-danger)'}
          onClick={() => setStatusFilter('open')}
        />
      </div>

      {/* Lista flat de parcelas */}
      {flatInstallments.length === 0 ? (
        <div className="panel-card rounded-2xl flex flex-col items-center justify-center py-16 gap-3">
          <BookOpen size={36} style={{ color: 'var(--text-faint)' }} />
          <p className="type-subheading" style={{ color: 'var(--text-muted)' }}>
            Nenhum contrato bullet com vencimento neste mês
          </p>
        </div>
      ) : (
        <div className="panel-card rounded-2xl overflow-hidden">
          {/* Filtros */}
          <div className="px-3 py-2">
            <div className="grid grid-cols-4 gap-1.5 p-1 rounded-2xl" style={{ background: 'rgba(0,0,0,0.12)' }}>
              {([
                { key: 'open',    label: 'Em aberto', count: counts.open,    color: 'var(--accent-caution)'  },
                { key: 'late',    label: 'Atraso',    count: counts.late,    color: 'var(--accent-danger)'   },
                { key: 'pending', label: 'Pendentes', count: counts.pending, color: 'var(--accent-warning)'  },
                { key: 'paid',    label: 'Pagas',     count: counts.paid,    color: 'var(--accent-positive)' },
              ] as { key: StatusFilter; label: string; count: number; color: string }[]).map(({ key, label, count, color }) => {
                const isActive = statusFilter === key;
                return (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(key)}
                    className="flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl text-center transition-all cursor-pointer"
                    data-testid={`caderneta-filter-${key}`}
                    aria-pressed={isActive}
                    style={isActive
                      ? { background: 'var(--bg-elevated)', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }
                      : { background: 'transparent' }
                    }
                  >
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{ color: isActive ? color : 'var(--text-muted)' }}
                    >
                      {count}
                    </span>
                    <span
                      className="text-[0.6rem] font-semibold uppercase tracking-wide leading-none"
                      style={{ color: isActive ? color : 'var(--text-faint)' }}
                    >
                      {label}
                    </span>
                    {isActive && (
                      <span
                        className="mt-0.5 rounded-full"
                        style={{ width: 16, height: 2, background: color }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {filteredInstallments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <CheckCircle2 size={28} style={{ color: 'var(--text-faint)' }} />
              <p className="type-caption" style={{ color: 'var(--text-muted)' }}>
                Nenhuma parcela nesta categoria
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 px-3 pb-3">
              {filteredInstallments.map((f) => (
                <InstallmentCard
                  key={f.inst.id}
                  flat={f}
                  onClick={onInstallmentClick}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── KpiCard (sem drill-down) ──────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  progress?: number;
  progressLabel?: string;
  onClick?: () => void;
}

const KpiCard: React.FC<KpiCardProps> = ({ icon, label, value, color, progress, progressLabel, onClick }) => {
  const testId = `caderneta-kpi-${label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

  return (
    <div className="panel-card rounded-xl overflow-hidden">
      <button
        onClick={onClick}
        data-testid={testId}
        className="w-full p-3 flex flex-col gap-1.5 text-left transition-colors cursor-pointer hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-1.5">
          <span style={{ color, opacity: 0.8 }}>{icon}</span>
          <p className="text-xs font-medium flex-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
        </div>
        <p className="tabular-nums font-bold leading-none break-all" style={{ color: 'var(--text-primary)', fontSize: 'clamp(1rem, 3.5vw, 1.25rem)' }}>
          {value}
        </p>
        {progress !== undefined && (
          <div className="space-y-1">
            <div className="rounded-full overflow-hidden" style={{ height: 3, background: 'var(--bg-strong)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, progress)}%`, background: color }}
              />
            </div>
            {progressLabel && (
              <p className="text-[0.65rem] tabular-nums" style={{ color: 'var(--text-faint)' }}>{progressLabel}</p>
            )}
          </div>
        )}
      </button>
    </div>
  );
};

// ── InstallmentCard ───────────────────────────────────────────────────────────

interface InstallmentCardProps {
  flat: FlatInstallment;
  onClick?: (installmentId: string, investmentId: number) => void;
}

const InstallmentCard: React.FC<InstallmentCardProps> = ({ flat, onClick }) => {
  const { inst, investmentId, payerName, payerPhoto, contractName, statusColor, operationalStatus, daysLate, cycleAmountDue, payPercent } = flat;
  const hasFine = inst.fine_amount > 0;
  const hasDelay = inst.interest_delay_amount > 0;
  const hasAmountPaid = normalizeNum(inst.amount_paid) > 0;

  return (
    <button
      onClick={() => onClick?.(inst.id, investmentId)}
      className="panel-card w-full rounded-xl overflow-hidden text-left transition-colors cursor-pointer hover:bg-white/[0.03] flex"
      data-testid="caderneta-installment-card"
      data-installment-id={inst.id}
      data-operational-status={operationalStatus}
      data-days-late={daysLate}
    >
      {/* Barra lateral de status */}
      <div
        className="w-1 shrink-0 self-stretch"
        style={{ background: statusColor }}
      />

      {/* Conteúdo */}
      <div className="flex-1 min-w-0 px-3 py-2.5 space-y-1.5">
        {/* Linha 1: foto + nome | data · #N */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {payerPhoto ? (
              <img
                src={payerPhoto}
                alt={payerName}
                className="rounded-full object-cover shrink-0"
                style={{ width: 26, height: 26 }}
              />
            ) : (
              <div
                className="rounded-full shrink-0 flex items-center justify-center"
                style={{
                  width: 26, height: 26,
                  background: `${statusColor}20`,
                  border: `1px solid ${statusColor}40`,
                }}
              >
                <span className="text-[0.6rem] font-bold" style={{ color: statusColor }}>
                  {payerName.trim().charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className="min-w-0">
              <span
                className="text-sm font-semibold truncate block"
                style={{ color: 'var(--text-primary)' }}
              >
                {payerName}
              </span>
              {contractName && (
                <span
                  className="text-[0.65rem] truncate block leading-none mt-0.5"
                  style={{ color: 'var(--text-faint)' }}
                >
                  {contractName}
                </span>
              )}
            </div>
          </div>
          <span
            className="text-[0.68rem] tabular-nums shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            {fmtDate(inst.due_date)} · #{inst.number}
          </span>
        </div>

        {/* Linha 2: valor + pago parcial */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-base tabular-nums font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {fmtMoney(cycleAmountDue)}
          </span>
          {hasAmountPaid && (
            <span
              className="text-xs tabular-nums"
              style={{ color: 'var(--accent-positive)' }}
            >
              Pago {fmtMoney(inst.amount_paid)}
            </span>
          )}
        </div>

        {/* Linha 4: progresso + badge status */}
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: 'var(--bg-strong)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${payPercent}%`, background: statusColor }}
            />
          </div>
          {payPercent > 0 && payPercent < 100 && (
            <span className="text-[0.65rem] tabular-nums shrink-0" style={{ color: 'var(--text-faint)' }}>
              {payPercent.toFixed(0)}%
            </span>
          )}
          <div className="shrink-0">
            {operationalStatusBadge(operationalStatus)}
          </div>
        </div>

        {/* Linha 5 condicional: multa / juros de atraso */}
        {(hasFine || hasDelay) && (
          <p className="text-[0.7rem] tabular-nums" style={{ color: 'var(--accent-danger)' }}>
            {hasFine && `Multa ${fmtMoney(inst.fine_amount)}`}
            {hasFine && hasDelay && ' · '}
            {hasDelay && `Juros ${fmtMoney(inst.interest_delay_amount)}`}
          </p>
        )}
      </div>
    </button>
  );
};

export default CadernetaBullet;
