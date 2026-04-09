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
  calcOutstanding,
  installmentStatusBadge,
} from '../InstallmentDetailFlow';
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
  Wallet,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DebtorContract {
  investmentId: number;
  contractName: string;
  interestRate: number;
  frequency: string;
  remainingBalance: number | null;
  capitalizeInterest: boolean;
  installments: LoanInstallment[];
  totalDue: number;
  totalPaid: number;
  outstanding: number;
  hasLate: boolean;
  hasPending: boolean;
}

interface DebtorEntry {
  payerId: string;
  payerName: string;
  payerEmail: string;
  payerPhoto: string | null;
  contracts: DebtorContract[];
  totalDue: number;
  totalPaid: number;
  totalOutstanding: number;
  totalRemainingBalance: number;
  totalInterest: number;
  hasLate: boolean;
  hasPending: boolean;
  allPaid: boolean;
  payPercent: number;
}

export interface CadernetaBulletProps {
  tenant: Tenant | null;
  onBack: () => void;
  onInstallmentClick?: (installmentId: string, investmentId: number) => void;
}

// Props internas usadas pelo componente de visualização
interface CadernetaBulletViewProps {
  investments: Investment[];
  allPaidInstallments: LoanInstallment[];
  pendingInstallments: LoanInstallment[];
  onBack: () => void;
  onInstallmentClick?: (installmentId: string, investmentId: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FREQ_LABEL: Record<string, string> = {
  monthly: 'Mensal',
  weekly: 'Semanal',
  daily: 'Diário',
  freelancer: 'Freelancer',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// Formata valor monetário para KPIs: sem centavos se valor for inteiro (BR-REL-015)
function fmtKpi(v: number): string {
  const hasDecimals = v % 1 !== 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(v || 0);
}

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
  // monthKey = "YYYY-MM"
  return dueDateYMD.startsWith(monthKey);
}

// ── Wrapper: busca dados e renderiza ──────────────────────────────────────────

const CadernetaBullet: React.FC<CadernetaBulletProps> = ({ tenant, onBack }) => {
  const { activeCompanyId } = useCompanyContext();
  const { investments, allPaidInstallments, installments, loading, error, refetch } =
    useDashboardData(tenant?.id, activeCompanyId);

  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);

  // Pool completo deduplicado para busca de parcela + irmãs
  const allInstPool = useMemo(() => {
    const map = new Map<string, LoanInstallment>();
    for (const i of allPaidInstallments) map.set(i.id, i);
    for (const i of installments) map.set(i.id, i);
    return map;
  }, [allPaidInstallments, installments]);

  const handleInstallmentClick = (installmentId: string, investmentId: number) => {
    const inst = allInstPool.get(installmentId);
    if (!inst) return;
    // Anexa irmãs ao investment para o DetailScreen
    const siblings = Array.from(allInstPool.values()).filter(i => i.investment_id === investmentId);
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

  // Tela de formulário de ação (pagamento, estorno, etc.)
  if (selectedInstallment && installmentAction) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => { setInstallmentAction(null); setSelectedInstallment(null); refetch(); }}
      />
    );
  }

  // Tela de detalhe da parcela
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
  type StatusFilter = 'all' | 'late' | 'pending' | 'paid';

  const currentMonthKey = dateToMonthKey(new Date());
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedDebtor, setExpandedDebtor] = useState<string | null>(null);
  const [expandedContract, setExpandedContract] = useState<number | null>(null);

  const isFuture = monthKey > currentMonthKey;

  // Pool de parcelas deduplicado (paid + pending)
  const allInstallments = useMemo(() => {
    const map = new Map<string, LoanInstallment>();
    for (const inst of allPaidInstallments) map.set(inst.id, inst);
    for (const inst of pendingInstallments) map.set(inst.id, inst);
    return Array.from(map.values());
  }, [allPaidInstallments, pendingInstallments]);

  // Contratos bullet ativos
  const bulletInvestmentIds = useMemo(() => {
    return new Set(
      investments
        .filter(
          (inv) =>
            classifyContract(inv.calculation_mode, inv.frequency).category === 'bullet' &&
            (inv.status === 'active' || inv.status === undefined)
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

  // Agrupa devedores do mês
  const debtors = useMemo((): DebtorEntry[] => {
    // Parcelas bullet do mês selecionado
    const monthInstallments = allInstallments.filter((inst) => {
      if (!inst.investment_id) return false;
      if (!bulletInvestmentIds.has(inst.investment_id)) return false;
      return isInMonth(inst.due_date, monthKey);
    });

    // Agrupa por payer
    const payerMap = new Map<string, {
      inv: Investment;
      contractMap: Map<number, LoanInstallment[]>;
    }>();

    for (const inst of monthInstallments) {
      const inv = bulletInvestmentsMap.get(inst.investment_id);
      if (!inv) continue;
      const payerId = inv.payer_id || inv.payer_name || String(inv.id);
      if (!payerMap.has(payerId)) {
        payerMap.set(payerId, { inv, contractMap: new Map() });
      }
      const entry = payerMap.get(payerId)!;
      if (!entry.contractMap.has(inst.investment_id)) {
        entry.contractMap.set(inst.investment_id, []);
      }
      entry.contractMap.get(inst.investment_id)!.push(inst);
    }

    const result: DebtorEntry[] = [];

    for (const [payerId, { inv: firstInv, contractMap }] of payerMap.entries()) {
      const payer = firstInv.payer;
      const payerName = payer?.full_name || firstInv.payer_name || 'Devedor';
      const payerEmail = payer?.email || '';
      const payerPhoto = payer?.photo_url || null;

      const contracts: DebtorContract[] = [];

      for (const [invId, insts] of contractMap.entries()) {
        const inv = bulletInvestmentsMap.get(invId)!;
        let totalDue = 0;
        let totalPaid = 0;
        let outstanding = 0;
        let hasLate = false;
        let hasPending = false;

        for (const inst of insts) {
          totalDue += inst.amount_total + inst.fine_amount + inst.interest_delay_amount;
          totalPaid += inst.amount_paid;
          outstanding += calcOutstanding(inst);
          if (inst.status === 'late') hasLate = true;
          if (inst.status === 'pending' || inst.status === 'partial') hasPending = true;
        }

        contracts.push({
          investmentId: invId,
          contractName: inv.asset_name,
          interestRate: inv.interest_rate,
          frequency: inv.frequency || 'monthly',
          remainingBalance: inv.remaining_balance ?? null,
          capitalizeInterest: inv.capitalize_interest ?? false,
          installments: insts.sort((a, b) => a.number - b.number),
          totalDue,
          totalPaid,
          outstanding,
          hasLate,
          hasPending,
        });
      }

      // Totais do devedor
      let totalDue = 0;
      let totalPaid = 0;
      let totalOutstanding = 0;
      let totalRemainingBalance = 0;
      let totalInterest = 0;
      let hasLate = false;
      let hasPending = false;

      for (const c of contracts) {
        totalDue += c.totalDue;
        totalPaid += c.totalPaid;
        totalOutstanding += c.outstanding;
        totalRemainingBalance += c.remainingBalance ?? 0;
        // interest líquido = soma de amount_interest das parcelas do mês
        for (const inst of c.installments) {
          totalInterest += inst.amount_interest ?? inst.amount_total;
        }
        if (c.hasLate) hasLate = true;
        if (c.hasPending) hasPending = true;
      }

      const allPaid = !hasLate && !hasPending && totalDue > 0;
      const payPercent = totalDue > 0 ? Math.min(100, (totalPaid / totalDue) * 100) : 0;

      result.push({
        payerId,
        payerName,
        payerEmail,
        payerPhoto,
        contracts,
        totalDue,
        totalPaid,
        totalOutstanding,
        totalRemainingBalance,
        totalInterest,
        hasLate,
        hasPending,
        allPaid,
        payPercent,
      });
    }

    // Ordenação: inadimplentes → pendentes → pagos
    result.sort((a, b) => {
      const scoreA = a.hasLate ? 0 : a.hasPending ? 1 : 2;
      const scoreB = b.hasLate ? 0 : b.hasPending ? 1 : 2;
      if (scoreA !== scoreB) return scoreA - scoreB;
      return a.payerName.localeCompare(b.payerName, 'pt-BR');
    });

    return result;
  }, [allInstallments, bulletInvestmentIds, bulletInvestmentsMap, monthKey]);

  // Filtra devedores pelo status selecionado (KPIs sempre mostram o total real)
  const filteredDebtors = useMemo(() => {
    if (statusFilter === 'all') return debtors;
    if (statusFilter === 'late') return debtors.filter((d) => d.hasLate);
    if (statusFilter === 'pending') return debtors.filter((d) => !d.hasLate && d.hasPending);
    if (statusFilter === 'paid') return debtors.filter((d) => d.allPaid);
    return debtors;
  }, [debtors, statusFilter]);

  // KPIs (sempre baseados no total do mês, sem filtro de status — BR-REL-013)
  const kpis = useMemo(() => {
    const totalDebtors = debtors.length;
    const totalExpected = debtors.reduce((s, d) => s + d.totalDue, 0);
    const totalCapital = debtors.reduce((s, d) => s + d.totalRemainingBalance, 0);
    const totalReceived = debtors.reduce((s, d) => s + d.totalPaid, 0);
    const totalOverdue = debtors.reduce((s, d) => s + (d.hasLate ? d.totalOutstanding : 0), 0);
    const collectionRate = totalExpected > 0 ? (totalReceived / totalExpected) * 100 : 0;
    return { totalDebtors, totalExpected, totalCapital, totalReceived, totalOverdue, collectionRate };
  }, [debtors]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Header: Voltar + Título + Navegação de Mês */}
      <div className="panel-card rounded-[1.8rem] p-4 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] p-2 transition-colors hover:bg-white/[0.08] cursor-pointer"
              title="Voltar"
            >
              <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
            </button>
            <div>
              <p className="section-kicker">Bullet</p>
              <div className="flex items-center gap-2">
                <BookOpen size={16} style={{ color: 'var(--accent-caution)' }} />
                <h2 className="type-title" style={{ color: 'var(--text-primary)' }}>
                  Caderneta Bullet
                </h2>
              </div>
            </div>
          </div>

          {/* Navegação de mês */}
          <div className="panel-card rounded-xl flex items-center gap-3 px-4 py-2.5 self-start md:self-auto">
            <button
              onClick={() => setMonthKey(prevMonth(monthKey))}
              className="flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-1.5 transition-colors hover:bg-white/[0.08] cursor-pointer"
            >
              <ChevronLeft size={14} style={{ color: 'var(--text-secondary)' }} />
            </button>
            <span
              className="type-subheading font-semibold tabular-nums capitalize"
              style={{ color: 'var(--text-primary)', minWidth: 160, textAlign: 'center' }}
            >
              {monthLabel(monthKey)}
            </span>
            <button
              onClick={() => setMonthKey(nextMonth(monthKey))}
              disabled={isFuture}
              className="flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-1.5 transition-colors hover:bg-white/[0.08] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          icon={<Users size={16} />}
          label="Devedores"
          value={String(kpis.totalDebtors)}
          color="var(--accent-caution)"
          items={debtors.map((d) => ({
            label: d.payerName,
            value: `${d.contracts.length} contrato${d.contracts.length !== 1 ? 's' : ''}`,
            statusColor: d.hasLate ? 'var(--accent-danger)' : d.hasPending ? 'var(--accent-warning)' : 'var(--accent-positive)',
            sublabel: d.hasLate ? '· atrasado' : d.hasPending ? '· pendente' : '· pago',
            onClick: () => { setStatusFilter('all'); setExpandedDebtor(d.payerId); setExpandedContract(null); },
          }))}
        />
        <KpiCard
          icon={<TrendingUp size={16} />}
          label="Esperado bruto"
          value={fmtKpi(kpis.totalExpected)}
          color="var(--accent-brass)"
          items={debtors.filter(d => d.totalDue > 0).sort((a,b) => b.totalDue - a.totalDue).map((d) => ({
            label: d.payerName,
            value: fmtKpi(d.totalDue),
            statusColor: d.hasLate ? 'var(--accent-danger)' : d.hasPending ? 'var(--accent-warning)' : 'var(--accent-positive)',
            onClick: () => { setStatusFilter('all'); setExpandedDebtor(d.payerId); setExpandedContract(null); },
          }))}
        />
        <KpiCard
          icon={<Wallet size={16} />}
          label="Capital ativo"
          value={fmtKpi(kpis.totalCapital)}
          color="var(--accent-purple)"
          items={debtors.filter(d => d.totalRemainingBalance > 0).sort((a,b) => b.totalRemainingBalance - a.totalRemainingBalance).map((d) => ({
            label: d.payerName,
            value: fmtKpi(d.totalRemainingBalance),
            statusColor: 'var(--accent-purple)',
            onClick: () => { setStatusFilter('all'); setExpandedDebtor(d.payerId); setExpandedContract(null); },
          }))}
        />
        <KpiCard
          icon={<CheckCircle2 size={16} />}
          label="Recebido"
          value={fmtKpi(kpis.totalReceived)}
          color="var(--accent-positive)"
          items={debtors.filter(d => d.totalPaid > 0).sort((a,b) => b.totalPaid - a.totalPaid).map((d) => ({
            label: d.payerName,
            value: fmtKpi(d.totalPaid),
            sublabel: `· ${d.payPercent.toFixed(0)}%`,
            statusColor: 'var(--accent-positive)',
            onClick: () => { setStatusFilter('all'); setExpandedDebtor(d.payerId); setExpandedContract(null); },
          }))}
        />
        <KpiCard
          icon={<AlertTriangle size={16} />}
          label="Em atraso"
          value={fmtKpi(kpis.totalOverdue)}
          color="var(--accent-danger)"
          items={debtors.filter(d => d.hasLate).sort((a,b) => b.totalOutstanding - a.totalOutstanding).map((d) => ({
            label: d.payerName,
            value: fmtKpi(d.totalOutstanding),
            statusColor: 'var(--accent-danger)',
            onClick: () => { setStatusFilter('late'); setExpandedDebtor(d.payerId); setExpandedContract(null); },
          }))}
        />
        <KpiCard
          icon={<Clock size={16} />}
          label="Taxa cobrança"
          value={`${kpis.collectionRate.toFixed(1).replace('.', ',')}%`}
          color={kpis.collectionRate >= 80 ? 'var(--accent-positive)' : kpis.collectionRate >= 50 ? 'var(--accent-warning)' : 'var(--accent-danger)'}
          items={debtors.filter(d => d.totalDue > 0).sort((a,b) => b.payPercent - a.payPercent).map((d) => ({
            label: d.payerName,
            value: `${d.payPercent.toFixed(1).replace('.', ',')}%`,
            sublabel: `${fmtKpi(d.totalPaid)} / ${fmtKpi(d.totalDue)}`,
            statusColor: d.payPercent >= 100 ? 'var(--accent-positive)' : d.payPercent > 0 ? 'var(--accent-warning)' : 'var(--accent-danger)',
            onClick: () => { setStatusFilter('all'); setExpandedDebtor(d.payerId); setExpandedContract(null); },
          }))}
        />
      </div>

      {/* Lista de devedores */}
      {debtors.length === 0 ? (
        <div className="panel-card rounded-[1.8rem] flex flex-col items-center justify-center py-16 gap-3">
          <BookOpen size={36} style={{ color: 'var(--text-faint)' }} />
          <p className="type-subheading" style={{ color: 'var(--text-muted)' }}>
            Nenhum contrato bullet com vencimento neste mês
          </p>
        </div>
      ) : (
        <div className="panel-card rounded-[1.8rem] overflow-hidden">
          {/* Header + Filtro de status */}
          <div className="p-4 md:p-6 border-b border-white/[0.06] space-y-4">
            <div>
              <p className="section-kicker mb-1">Cobrança Mensal</p>
              <h3 className="type-title" style={{ color: 'var(--text-primary)' }}>
                Clientes Bullet — {monthLabel(monthKey)}
              </h3>
            </div>

            {/* Filtro pill */}
            <div className="flex gap-2 flex-wrap">
              {([
                { key: 'all',     label: 'Todos',       count: debtors.length,                                       color: 'var(--accent-caution)' },
                { key: 'late',    label: 'Em atraso',   count: debtors.filter(d => d.hasLate).length,                color: 'var(--accent-danger)'  },
                { key: 'pending', label: 'Pendentes',   count: debtors.filter(d => !d.hasLate && d.hasPending).length, color: 'var(--accent-warning)' },
                { key: 'paid',    label: 'Pagos',       count: debtors.filter(d => d.allPaid).length,                color: 'var(--accent-positive)' },
              ] as { key: StatusFilter; label: string; count: number; color: string }[]).map(({ key, label, count, color }) => {
                const isActive = statusFilter === key;
                return (
                  <button
                    key={key}
                    onClick={() => { setStatusFilter(key); setExpandedDebtor(null); setExpandedContract(null); }}
                    className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer"
                    style={isActive
                      ? { background: color, color: '#0f1d33', boxShadow: `0 2px 12px ${color}55` }
                      : { background: `${color}14`, color, border: `1px solid ${color}30` }
                    }
                  >
                    {label}
                    <span
                      className="inline-flex items-center justify-center rounded-full text-[0.6rem] font-bold tabular-nums"
                      style={{
                        minWidth: 18, height: 18, padding: '0 4px',
                        background: isActive ? 'rgba(0,0,0,0.2)' : `${color}25`,
                        color: isActive ? '#0f1d33' : color,
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {filteredDebtors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <CheckCircle2 size={28} style={{ color: 'var(--text-faint)' }} />
              <p className="type-caption" style={{ color: 'var(--text-muted)' }}>
                Nenhum devedor nesta categoria
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {filteredDebtors.map((debtor) => {
                const isOpen = expandedDebtor === debtor.payerId;
                return (
                  <DebtorRow
                    key={debtor.payerId}
                    debtor={debtor}
                    isOpen={isOpen}
                    onToggle={() => {
                      setExpandedDebtor(isOpen ? null : debtor.payerId);
                      setExpandedContract(null);
                    }}
                    expandedContract={expandedContract}
                    onToggleContract={(id) =>
                      setExpandedContract(expandedContract === id ? null : id)
                    }
                    onInstallmentClick={onInstallmentClick}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── KpiCard ───────────────────────────────────────────────────────────────────

interface KpiItem {
  label: string;
  value: string;
  sublabel?: string;
  statusColor?: string;
  onClick?: () => void;
}

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  colSpanFull?: boolean;
  items?: KpiItem[];
}

const KpiCard: React.FC<KpiCardProps> = ({ icon, label, value, color, colSpanFull, items }) => {
  const [open, setOpen] = useState(false);
  const hasItems = items && items.length > 0;

  return (
    <div className={`panel-card rounded-[1.4rem] overflow-hidden${colSpanFull ? ' col-span-2 md:col-span-1' : ''}`}>
      <button
        onClick={() => hasItems && setOpen((v) => !v)}
        className={`w-full p-3 flex items-start gap-2.5 text-left transition-colors${hasItems ? ' cursor-pointer hover:bg-white/[0.03]' : ''}`}
      >
        <div
          className="flex items-center justify-center rounded-xl p-2 shrink-0 mt-0.5"
          style={{ background: `${color}18`, boxShadow: `0 0 0 1px ${color}30` }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="type-label" style={{ color: 'var(--text-muted)' }}>{label}</p>
          <p className="tabular-nums font-bold leading-tight break-all" style={{ color: 'var(--text-primary)', fontSize: 'clamp(0.8rem, 2vw, 1.05rem)' }}>
            {value}
          </p>
        </div>
        {hasItems && (
          <ChevronDown
            size={13}
            style={{
              color: 'var(--text-faint)',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              flexShrink: 0,
              marginTop: 4,
            }}
          />
        )}
      </button>

      {hasItems && open && (
        <div
          className="animate-fade-in-down border-t"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          {items!.map((item, i) => (
            <div key={i}>
              {i > 0 && <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '0 16px' }} />}
              <div
                onClick={item.onClick}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-colors${item.onClick ? ' cursor-pointer hover:bg-white/[0.04]' : ''}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {item.statusColor && (
                    <span
                      className="shrink-0 rounded-full"
                      style={{ width: 6, height: 6, background: item.statusColor }}
                    />
                  )}
                  <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {item.label}
                  </span>
                  {item.sublabel && (
                    <span className="text-[0.65rem] shrink-0" style={{ color: 'var(--text-faint)' }}>
                      {item.sublabel}
                    </span>
                  )}
                </div>
                <span className="text-xs tabular-nums font-semibold shrink-0" style={{ color }}>
                  {item.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── DebtorRow ─────────────────────────────────────────────────────────────────

interface DebtorRowProps {
  debtor: DebtorEntry;
  isOpen: boolean;
  onToggle: () => void;
  expandedContract: number | null;
  onToggleContract: (id: number) => void;
  onInstallmentClick?: (installmentId: string, investmentId: number) => void;
}

const DebtorRow: React.FC<DebtorRowProps> = ({
  debtor,
  isOpen,
  onToggle,
  expandedContract,
  onToggleContract,
  onInstallmentClick,
}) => {
  const statusColor = debtor.hasLate
    ? 'var(--accent-danger)'
    : debtor.hasPending
    ? 'var(--accent-warning)'
    : 'var(--accent-positive)';

  const statusLabel = debtor.hasLate
    ? 'Em atraso'
    : debtor.hasPending
    ? 'Pendente'
    : 'Pago';

  const statusChip = debtor.hasLate
    ? 'chip chip-late'
    : debtor.hasPending
    ? 'chip chip-pending'
    : 'chip chip-paid';

  return (
    <div className="overflow-hidden">
      {/* Linha principal do devedor */}
      <button
        onClick={onToggle}
        className="w-full p-4 md:p-5 text-left cursor-pointer hover:bg-white/[0.03] transition-colors"
      >
        {/* Indicador lateral de status */}
        <div className="flex items-start gap-3">
          <div
            className="w-1 self-stretch rounded-full shrink-0"
            style={{ background: statusColor, minHeight: 44 }}
          />

          {/* Avatar */}
          <div
            className="flex items-center justify-center rounded-full shrink-0 text-xs font-bold"
            style={{
              width: 40,
              height: 40,
              background: `${statusColor}20`,
              color: statusColor,
              border: `1px solid ${statusColor}40`,
            }}
          >
            {debtor.payerPhoto ? (
              <img
                src={debtor.payerPhoto}
                alt={debtor.payerName}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              getInitials(debtor.payerName)
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="text-sm font-semibold truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {debtor.payerName}
                </span>
                <span
                  className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide"
                  style={{ background: 'rgba(245, 158, 11, 0.12)', color: 'var(--accent-caution)' }}
                >
                  Bullet
                </span>
              </div>
              <span className={`${statusChip} shrink-0`}>{statusLabel}</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-2.5">
              <span style={{ color: 'var(--text-muted)' }}>
                {debtor.contracts.length} contrato{debtor.contracts.length !== 1 ? 's' : ''}
              </span>
              {debtor.payerEmail && (
                <a
                  href={`mailto:${debtor.payerEmail}`}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate hover:underline"
                  style={{ color: 'var(--accent-steel)' }}
                >
                  {debtor.payerEmail}
                </a>
              )}
              {debtor.totalRemainingBalance > 0 && (
                <span style={{ color: 'var(--text-secondary)' }}>
                  Saldo: <span className="tabular-nums font-semibold">{fmtMoney(debtor.totalRemainingBalance)}</span>
                </span>
              )}
            </div>

            {/* Valores */}
            <div className="flex items-center justify-between gap-4 mb-2">
              <div>
                <p className="type-micro mb-0.5" style={{ color: 'var(--text-faint)' }}>Esperado</p>
                <p className="type-metric-sm tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {fmtMoney(debtor.totalDue)}
                </p>
              </div>
              <div>
                <p className="type-micro mb-0.5" style={{ color: 'var(--text-faint)' }}>Pago</p>
                <p className="type-metric-sm tabular-nums" style={{ color: 'var(--accent-positive)' }}>
                  {fmtMoney(debtor.totalPaid)}
                </p>
              </div>
              {debtor.totalOutstanding > 0.01 && (
                <div>
                  <p className="type-micro mb-0.5" style={{ color: 'var(--text-faint)' }}>Em aberto</p>
                  <p className="type-metric-sm tabular-nums" style={{ color: 'var(--accent-danger)' }}>
                    {fmtMoney(debtor.totalOutstanding)}
                  </p>
                </div>
              )}
              <ChevronDown
                size={16}
                style={{
                  color: 'var(--text-faint)',
                  transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                  marginLeft: 'auto',
                  flexShrink: 0,
                }}
              />
            </div>

            {/* Barra de progresso */}
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ background: 'var(--bg-strong)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${debtor.payPercent}%`,
                  background: debtor.hasLate
                    ? 'var(--accent-danger)'
                    : debtor.payPercent >= 100
                    ? 'var(--accent-positive)'
                    : 'var(--accent-caution)',
                }}
              />
            </div>
          </div>
        </div>
      </button>

      {/* Contratos expandidos */}
      {isOpen && (
        <div
          className="border-t animate-fade-in-down"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          {debtor.contracts.map((contract) => {
            const contractOpen = expandedContract === contract.investmentId;
            return (
              <ContractRow
                key={contract.investmentId}
                contract={contract}
                isOpen={contractOpen}
                onToggle={() => onToggleContract(contract.investmentId)}
                onInstallmentClick={onInstallmentClick}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── ContractRow ───────────────────────────────────────────────────────────────

interface ContractRowProps {
  contract: DebtorContract;
  isOpen: boolean;
  onToggle: () => void;
  onInstallmentClick?: (installmentId: string, investmentId: number) => void;
}

const ContractRow: React.FC<ContractRowProps> = ({
  contract,
  isOpen,
  onToggle,
  onInstallmentClick,
}) => {
  const statusChip = contract.hasLate
    ? 'chip chip-late'
    : contract.hasPending
    ? 'chip chip-pending'
    : 'chip chip-paid';

  const statusLabel = contract.hasLate ? 'Atrasado' : contract.hasPending ? 'Pendente' : 'Pago';

  return (
    <div
      className="border-b last:border-b-0"
      style={{ borderColor: 'rgba(255,255,255,0.04)' }}
    >
      <button
        onClick={onToggle}
        className="w-full px-6 py-3 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                {contract.contractName}
              </span>
              <span className={`${statusChip} text-[0.55rem]`}>{statusLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.7rem]" style={{ color: 'var(--text-muted)' }}>
              <span>{contract.interestRate}% {FREQ_LABEL[contract.frequency] || contract.frequency}</span>
              {contract.remainingBalance != null && (
                <span>
                  Saldo:{' '}
                  <span className="tabular-nums font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {fmtMoney(contract.remainingBalance)}
                  </span>
                </span>
              )}
              {contract.capitalizeInterest && (
                <span style={{ color: 'var(--accent-caution)' }}>Capitaliza juros</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <p className="type-micro" style={{ color: 'var(--text-faint)' }}>Esperado</p>
              <p className="text-xs tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                {fmtMoney(contract.totalDue)}
              </p>
            </div>
            {contract.outstanding > 0.01 && (
              <div className="text-right">
                <p className="type-micro" style={{ color: 'var(--text-faint)' }}>Em aberto</p>
                <p className="text-xs tabular-nums font-semibold" style={{ color: 'var(--accent-danger)' }}>
                  {fmtMoney(contract.outstanding)}
                </p>
              </div>
            )}
            <ChevronDown
              size={14}
              style={{
                color: 'var(--text-faint)',
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            />
          </div>
        </div>
      </button>

      {isOpen && (
        <div
          className="px-6 pb-4 animate-fade-in-down overflow-x-auto"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
        >
          <table className="w-full text-xs mt-3" style={{ minWidth: 480 }}>
            <thead>
              <tr style={{ color: 'var(--text-faint)' }}>
                <th className="text-left py-1.5 pr-3 font-medium uppercase tracking-wide text-[0.6rem]">#</th>
                <th className="text-left py-1.5 pr-3 font-medium uppercase tracking-wide text-[0.6rem]">Vencimento</th>
                <th className="text-right py-1.5 pr-3 font-medium uppercase tracking-wide text-[0.6rem]">Total</th>
                <th className="text-right py-1.5 pr-3 font-medium uppercase tracking-wide text-[0.6rem]">Multa</th>
                <th className="text-right py-1.5 pr-3 font-medium uppercase tracking-wide text-[0.6rem]">J. Atraso</th>
                <th className="text-right py-1.5 pr-3 font-medium uppercase tracking-wide text-[0.6rem]">Pago</th>
                <th className="text-right py-1.5 font-medium uppercase tracking-wide text-[0.6rem]">Status</th>
              </tr>
            </thead>
            <tbody>
              {contract.installments.map((inst) => (
                <tr
                  key={inst.id}
                  onClick={() => onInstallmentClick?.(inst.id, inst.investment_id)}
                  className={`border-t transition-colors${onInstallmentClick ? ' cursor-pointer hover:bg-white/[0.04]' : ''}`}
                  style={{ borderColor: 'rgba(255,255,255,0.04)' }}
                >
                  <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {inst.number}
                  </td>
                  <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {fmtDate(inst.due_date)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {fmtMoney(inst.amount_total)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums" style={{ color: inst.fine_amount > 0 ? 'var(--accent-danger)' : 'var(--text-faint)' }}>
                    {inst.fine_amount > 0 ? fmtMoney(inst.fine_amount) : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums" style={{ color: inst.interest_delay_amount > 0 ? 'var(--accent-danger)' : 'var(--text-faint)' }}>
                    {inst.interest_delay_amount > 0 ? fmtMoney(inst.interest_delay_amount) : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums" style={{ color: inst.amount_paid > 0 ? 'var(--accent-positive)' : 'var(--text-faint)' }}>
                    {inst.amount_paid > 0 ? fmtMoney(inst.amount_paid) : '—'}
                  </td>
                  <td className="py-2 text-right">
                    {installmentStatusBadge(inst.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CadernetaBullet;
