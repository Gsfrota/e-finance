
import React, { useEffect, useState } from 'react';
import { getSupabase, parseSupabaseError } from '../services/supabase';
import { Profile, Investment, LoanInstallment, InvestorBalanceView, Tenant } from '../types';
import ReceiptTemplate from './ReceiptTemplate';
import {
  ArrowLeft,
  User,
  Wallet,
  ChevronDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  Briefcase,
  RefreshCw,
  Pencil,
  Percent,
  FileText,
  DollarSign,
  Calendar,
  Loader2,
  Save
} from 'lucide-react';
import { InstallmentFormScreen, getInstallmentModInfo, ModBadge } from './InstallmentDetailFlow';

// ── Types ──────────────────────────────────────────────────────────────────────

type InstallmentAction =
  | null
  | { type: 'pay';      installment: LoanInstallment }
  | { type: 'refinance'; installment: LoanInstallment }
  | { type: 'edit';      installment: LoanInstallment }
  | { type: 'interest';  installment: LoanInstallment };

// ── Shared helpers ─────────────────────────────────────────────────────────────

const formatCurrencyLocal = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const normalizeNumber = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

const calculateOutstanding = (inst: LoanInstallment): number => {
  const total = normalizeNumber(inst.amount_total);
  const fine  = normalizeNumber(inst.fine_amount);
  const delay = normalizeNumber(inst.interest_delay_amount);
  const paid  = normalizeNumber(inst.amount_paid);
  return Math.max(0, (total + fine + delay) - paid);
};

const fmtDate = (dateStr: string) => {
  if (!dateStr) return '--';
  const base = dateStr.includes('T') || dateStr.includes(':')
    ? new Date(dateStr)
    : new Date(dateStr + 'T00:00:00');
  return base.toLocaleDateString('pt-BR');
};

// ── InstallmentCard ────────────────────────────────────────────────────────────

interface InstallmentCardProps {
  installment: LoanInstallment;
  onPay: () => void;
  onRefinance: () => void;
  onEdit: () => void;
  onInterestOnly?: () => void;
}

const InstallmentCard: React.FC<InstallmentCardProps> = ({
  installment, onPay, onRefinance, onEdit, onInterestOnly
}) => {
  const isPaid    = installment.status === 'paid';
  const isLate    = !isPaid && new Date(installment.due_date + 'T12:00:00') < new Date();
  const isPartial = installment.status === 'partial';
  const hasFine   = (normalizeNumber(installment.fine_amount) + normalizeNumber(installment.interest_delay_amount)) > 0;
  const outstanding = calculateOutstanding(installment);

  const modInfo = getInstallmentModInfo(installment);

  const chipClass = modInfo ? modInfo.chipClass
    : isPaid ? 'chip chip-paid'
    : isLate ? 'chip chip-late'
    : isPartial ? 'chip chip-partial'
    : 'chip chip-pending';

  const chipLabel = modInfo ? modInfo.label
    : isPaid ? 'Pago' : isLate ? 'Atrasado' : isPartial ? 'Parcial' : 'A Vencer';

  return (
    <div className={`panel-card rounded-2xl p-4 ${modInfo?.type === 'surplus_zeroed' ? 'ring-1 ring-[#EF5350]/20' : isLate ? 'ring-1 ring-[color:var(--accent-danger)]/20' : ''}`}
      title={modInfo?.tooltip || undefined}>
      {/* Topo: número + status */}
      <div className="flex items-center justify-between mb-3">
        <span className="type-label text-[color:var(--text-faint)]">
          Parcela {installment.number}
        </span>
        <span className={chipClass}>{chipLabel}</span>
      </div>

      {/* Valores em grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <p className="type-micro text-[color:var(--text-faint)]">Vencimento</p>
          <p className={`text-xs font-bold ${isLate ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-primary)]'}`}>
            {fmtDate(installment.due_date)}
          </p>
        </div>
        <div>
          <p className="type-micro text-[color:var(--text-faint)]">
            {isPaid ? 'Pago' : 'Total'}
          </p>
          <p className="text-xs font-bold text-[color:var(--accent-brass)]">
            {isPaid
              ? formatCurrencyLocal(normalizeNumber(installment.amount_paid))
              : formatCurrencyLocal(outstanding)}
          </p>
        </div>
        {hasFine ? (
          <div>
            <p className="type-micro text-[color:var(--text-faint)]">Multa</p>
            <p className="text-xs font-bold text-[color:var(--accent-danger)]">
              +{formatCurrencyLocal(normalizeNumber(installment.fine_amount) + normalizeNumber(installment.interest_delay_amount))}
            </p>
          </div>
        ) : (
          <div>
            <p className="type-micro text-[color:var(--text-faint)]">Original</p>
            <p className="text-xs font-bold text-[color:var(--text-secondary)]">
              {formatCurrencyLocal(normalizeNumber(installment.amount_total))}
            </p>
          </div>
        )}
      </div>

      {/* Juros já cobrados (se houver) */}
      {normalizeNumber(installment.interest_payments_total) > 0 && (
        <div className="mb-3 flex items-center gap-1.5 rounded-xl bg-[rgba(202,176,122,0.08)] px-3 py-1.5 border border-[rgba(202,176,122,0.14)]">
          <Percent size={10} className="text-[color:var(--accent-brass)]"/>
          <span className="type-micro text-[color:var(--accent-brass)]">
            Juros cobrados: {formatCurrencyLocal(normalizeNumber(installment.interest_payments_total))}
          </span>
        </div>
      )}

      {/* Ações SEMPRE visíveis */}
      {!isPaid ? (
        <div className="flex gap-2">
          <button
            onClick={onPay}
            className="flex-1 rounded-xl bg-[rgba(52,211,153,0.12)] px-2 py-2.5 type-label text-[color:var(--accent-positive)] ring-1 ring-[rgba(52,211,153,0.2)] active:scale-95 transition-all"
          >
            ✓ Baixar
          </button>
          <button
            onClick={onRefinance}
            className="flex-1 rounded-xl bg-[rgba(148,180,255,0.10)] px-2 py-2.5 type-label text-[color:var(--accent-steel)] ring-1 ring-[rgba(148,180,255,0.18)] active:scale-95 transition-all"
          >
            ↗ Reneg.
          </button>
          {onInterestOnly && (
          <button
            onClick={onInterestOnly}
            className="flex-1 rounded-xl bg-[rgba(202,176,122,0.12)] px-2 py-2.5 type-label text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.20)] active:scale-95 transition-all"
          >
            Baixa de Juros
          </button>
          )}
          <button
            onClick={onEdit}
            className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5 text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] active:scale-95 transition-all"
          >
            <Pencil size={13}/>
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={onPay}
            className="flex-1 rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5 type-label text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] active:scale-95 transition-all flex items-center justify-center gap-1.5"
          >
            <FileText size={12}/> Ver Comprovante
          </button>
          <button
            onClick={onEdit}
            className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5 text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] active:scale-95 transition-all"
          >
            <Pencil size={13}/>
          </button>
        </div>
      )}
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────

interface AdminUserDetailsProps {
  userId: string;
  onBack: () => void;
}

const AdminUserDetails: React.FC<AdminUserDetailsProps> = ({ userId, onBack }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [balanceView, setBalanceView] = useState<InvestorBalanceView | null>(null);
  const [contracts, setContracts] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedContractId, setExpandedContractId] = useState<number | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);

  const [stats, setStats] = useState({
    totalLoaned: 0,
    totalPaid: 0,
    balance: 0,
    defaultRate: 0,
    trustScore: 'B'
  });

  const fetchData = async () => {
    setLoading(true);
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select(`
            *,
            tenants!profiles_tenant_id_fkey(*)
        `)
        .eq('id', userId)
        .single();

      setProfile(prof);
      setTenant(prof.tenants as any);

      if (prof.role === 'investor' || prof.role === 'admin') {
        const { data: wealthData } = await supabase
          .from('view_investor_balances')
          .select('*')
          .eq('profile_id', userId)
          .maybeSingle();
        if (wealthData) setBalanceView(wealthData);
      }

      // Filtro explícito de tenant_id para defesa em profundidade
      const userTenantId = prof?.tenant_id;
      const invQuery = supabase
        .from('investments')
        .select(`
          *,
          loan_installments (*)
        `)
        .or(`user_id.eq.${userId},payer_id.eq.${userId}`)
        .order('created_at', { ascending: false });
      if (userTenantId) invQuery.eq('tenant_id', userTenantId);
      const { data: invs, error } = await invQuery;

      if (error) throw error;
      setContracts(invs || []);

      // Stats calculation
      let totalLoaned = 0, totalPaid = 0, lateCount = 0, totalInst = 0;
      (invs || []).forEach(inv => {
        totalLoaned += Number(inv.amount_invested || 0);
        (inv.loan_installments || []).forEach((inst: LoanInstallment) => {
          totalInst++;
          totalPaid += Number(inst.amount_paid || 0);
          if (inst.status !== 'paid' && new Date(inst.due_date + 'T12:00:00') < new Date()) lateCount++;
        });
      });

      const defaultRate = totalInst > 0 ? (lateCount / totalInst) * 100 : 0;
      let score = 'A+';
      if (defaultRate > 50) score = 'D';
      else if (defaultRate > 30) score = 'C';
      else if (defaultRate > 15) score = 'B';
      else if (defaultRate > 5) score = 'A';

      setStats({
        totalLoaned,
        totalPaid,
        balance: totalLoaned - totalPaid,
        defaultRate,
        trustScore: score
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [userId]);

  const toggleContract = (id: number) =>
    setExpandedContractId(prev => prev === id ? null : id);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '--';
    if (dateStr.includes('T') || dateStr.includes(':')) return new Date(dateStr).toLocaleDateString('pt-BR');
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR');
  };

  // ── InstallmentFormScreen sub-view ──
  if (installmentAction !== null) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        tenant={tenant}
        payerName={profile?.full_name}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => { setInstallmentAction(null); fetchData(); }}
      />
    );
  }

  if (loading) return (
    <div className="flex justify-center items-center h-full text-[color:var(--accent-positive)] animate-pulse">
      <Clock size={32}/> <span className="ml-3 type-label">Carregando Auditoria...</span>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <button onClick={onBack} className="flex items-center gap-2 text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors mb-4 group">
        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform"/> Voltar para Usuários
      </button>

      {/* 1. HERO PROFILE */}
      <div className="bg-[color:var(--bg-elevated)] rounded-[2.5rem] border border-[color:var(--border-subtle)] p-5 lg:p-8 shadow-[var(--shadow-panel)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[color:var(--accent-positive)]/5 rounded-full blur-3xl -mr-12 -mt-12 pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 lg:w-20 lg:h-20 bg-[color:var(--bg-soft)] rounded-3xl flex items-center justify-center border-2 border-[color:var(--border-strong)] shadow-lg flex-shrink-0">
              <User size={28} className="text-[color:var(--text-secondary)]"/>
            </div>
            <div>
              <h1 className="type-heading text-[color:var(--text-primary)]">{profile?.full_name}</h1>
              <div className="flex items-center gap-4 mt-2 type-body">
                <span className="text-[color:var(--text-secondary)] font-mono bg-[color:var(--bg-base)] px-2 py-0.5 rounded border border-[color:var(--border-subtle)]">CPF: {profile?.cpf || '---'}</span>
                <span className="text-[color:var(--text-muted)]">{profile?.email}</span>
              </div>
              <div className="mt-3 inline-flex items-center gap-2 bg-[color:var(--bg-base)]/50 border border-[color:var(--border-subtle)] px-3 py-1 rounded-full">
                <span className="type-label text-[color:var(--text-muted)]">Trust Score</span>
                <span className={`text-sm font-semibold ${stats.trustScore === 'A+' || stats.trustScore === 'A' ? 'text-emerald-400' : stats.trustScore === 'B' ? 'text-[color:var(--accent-caution)]' : 'text-red-400'}`}>
                  {stats.trustScore}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full lg:w-auto">
            <div className="bg-[color:var(--bg-base)] p-3 lg:p-4 rounded-2xl border border-[color:var(--border-subtle)] min-w-0 overflow-hidden">
              <p className="type-label text-[color:var(--text-muted)] mb-1">Total Tomado</p>
              <p className="type-metric-md lg:type-metric-lg text-[color:var(--text-primary)] truncate">{formatCurrency(stats.totalLoaned)}</p>
            </div>
            <div className="bg-[color:var(--bg-base)] p-3 lg:p-4 rounded-2xl border border-[color:var(--border-subtle)] min-w-0 overflow-hidden">
              <p className="type-label text-[color:var(--text-muted)] mb-1">Pago</p>
              <p className="type-metric-md lg:type-metric-lg text-[color:var(--accent-positive)] truncate">{formatCurrency(stats.totalPaid)}</p>
            </div>
            <div className="bg-[color:var(--bg-base)] p-3 lg:p-4 rounded-2xl border border-[color:var(--border-subtle)] min-w-0 overflow-hidden">
              <p className="type-label text-[color:var(--text-muted)] mb-1">Em Aberto</p>
              <p className="type-metric-md lg:type-metric-lg text-[color:var(--text-primary)] truncate">{formatCurrency(stats.balance)}</p>
            </div>
            <div className="bg-[color:var(--bg-base)] p-3 lg:p-4 rounded-2xl border border-[color:var(--border-subtle)] min-w-0 overflow-hidden">
              <p className="type-label text-[color:var(--text-muted)] mb-1">Inadimplência</p>
              <p className={`type-metric-md lg:type-metric-lg ${stats.defaultRate > 0 ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--accent-positive)]'}`}>{stats.defaultRate.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. WEALTH SUMMARY (INVESTOR ONLY) */}
      {balanceView && (
        <div className="bg-[color:var(--bg-elevated)] p-6 rounded-[2.5rem] border border-[color:var(--border-subtle)] shadow-[var(--shadow-panel)]">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-emerald-900/30 rounded-xl text-emerald-400">
              <TrendingUp size={20}/>
            </div>
            <div>
              <h3 className="type-subheading text-[color:var(--text-primary)] uppercase">Resumo de Riqueza</h3>
              <p className="type-caption text-[color:var(--text-muted)]">Origem e Destino do Capital</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[color:var(--bg-base)]/60 rounded-2xl p-5 border border-[color:var(--border-subtle)] relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Briefcase size={40} className="text-[color:var(--text-muted)]"/>
              </div>
              <p className="type-label text-[color:var(--text-secondary)] mb-2">Total Aportado (Bolso)</p>
              <p className="type-metric-xl text-[color:var(--text-primary)]">{formatCurrency(balanceView.total_own_capital)}</p>
            </div>

            <div className="bg-[color:var(--bg-base)]/60 rounded-2xl p-5 border border-[color:var(--border-subtle)] relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <TrendingUp size={40} className="text-[color:var(--accent-positive)]"/>
              </div>
              <p className="type-label text-emerald-400/80 mb-2">Lucro Reinvestido</p>
              <p className="type-metric-xl text-emerald-400">{formatCurrency(balanceView.total_profit_reinvested)}</p>
              <p className="type-micro text-[color:var(--text-muted)] mt-1">Dinheiro gerado que voltou para a rua</p>
            </div>

            <div className="bg-emerald-900/10 rounded-2xl p-5 border border-emerald-900/30 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Wallet size={40} className="text-emerald-300"/>
              </div>
              <p className="type-label text-emerald-300 mb-2">Disponível em Caixa</p>
              <p className="type-metric-xl text-[color:var(--text-primary)]">{formatCurrency(balanceView.available_profit_balance)}</p>
              <p className="type-micro text-emerald-500/70 mt-1">Pode ser usado para novos contratos</p>
            </div>
          </div>
        </div>
      )}

      {/* 3. CONTRACTS LIST */}
      <div className="space-y-4">
        <h2 className="type-heading text-[color:var(--text-primary)] uppercase pl-2 flex items-center gap-2">
          <Wallet className="text-teal-500" size={24}/> Contratos Ativos
        </h2>

        {contracts.length === 0 ? (
          <div className="bg-[color:var(--bg-elevated)] p-8 rounded-3xl border border-[color:var(--border-subtle)] text-center text-[color:var(--text-muted)] font-bold">
            Nenhum contrato encontrado para este usuário.
          </div>
        ) : (
          contracts.map(contract => {
            const installments: LoanInstallment[] = contract.loan_installments || [];
            const paidCount = installments.filter(i => i.status === 'paid').length;
            const lateCount = installments.filter(i => i.status !== 'paid' && new Date(i.due_date + 'T12:00:00') < new Date()).length;
            const openCount = installments.filter(i => i.status !== 'paid').length;
            const progressPct = installments.length > 0 ? (paidCount / installments.length) * 100 : 0;
            return (
              <div key={contract.id} className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-3xl overflow-hidden shadow-[var(--shadow-card)]">
                {/* Accordion Header */}
                <div
                  onClick={() => toggleContract(contract.id)}
                  className="p-5 lg:p-6 cursor-pointer hover:bg-[color:var(--bg-soft)]/30 transition-colors"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="type-subheading text-[color:var(--text-primary)]">{contract.asset_name}</h3>
                        <span className="type-label bg-[color:var(--bg-base)] text-[color:var(--text-secondary)] px-2 py-0.5 rounded border border-[color:var(--border-subtle)]">{contract.type}</span>
                        {lateCount > 0 && (
                          <span className="type-micro bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full">
                            {lateCount} atrasada{lateCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="type-caption text-[color:var(--text-muted)] mt-1">
                        Contrato #{contract.id} • Criado em {formatDate(contract.created_at)}
                        <span className="ml-3 text-[color:var(--text-faint)]">
                          {paidCount} paga{paidCount !== 1 ? 's' : ''} · {openCount} em aberto{lateCount > 0 ? ` · ${lateCount} atrasada${lateCount > 1 ? 's' : ''}` : ''}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right hidden sm:block">
                        <p className="type-label text-[color:var(--text-muted)]">Valor do Contrato</p>
                        <p className="type-metric-md text-[color:var(--text-primary)]">{formatCurrency(Number(contract.current_value))}</p>
                      </div>
                      <div className={`p-2 rounded-full bg-[color:var(--bg-base)] text-[color:var(--text-muted)] transition-transform ${expandedContractId === contract.id ? 'rotate-180' : ''}`}>
                        <ChevronDown size={20}/>
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 h-1 bg-[color:var(--bg-soft)] rounded-full overflow-hidden">
                    <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${progressPct}%` }}/>
                  </div>
                </div>

                {/* Installment cards — no horizontal scroll */}
                {expandedContractId === contract.id && (
                  <div className="border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-base)]/30 p-4 space-y-2">
                    {installments.length === 0 ? (
                      <p className="text-center text-[color:var(--text-muted)] text-sm py-4">Nenhuma parcela encontrada.</p>
                    ) : (
                      installments.map(inst => (
                        <InstallmentCard
                          key={inst.id}
                          installment={inst}
                          onPay={() => setInstallmentAction({ type: 'pay', installment: inst })}
                          onRefinance={() => setInstallmentAction({ type: 'refinance', installment: inst })}
                          onEdit={() => setInstallmentAction({ type: 'edit', installment: inst })}
                          onInterestOnly={inst.investment?.calculation_mode === 'interest_only' ? () => setInstallmentAction({ type: 'interest', installment: inst }) : undefined}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AdminUserDetails;
