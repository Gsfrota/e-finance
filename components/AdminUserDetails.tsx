
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
import { InstallmentFormScreen } from './InstallmentDetailFlow';

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
  onInterestOnly: () => void;
}

const InstallmentCard: React.FC<InstallmentCardProps> = ({
  installment, onPay, onRefinance, onEdit, onInterestOnly
}) => {
  const isPaid    = installment.status === 'paid';
  const isLate    = !isPaid && new Date(installment.due_date + 'T12:00:00') < new Date();
  const isPartial = installment.status === 'partial';
  const hasFine   = (normalizeNumber(installment.fine_amount) + normalizeNumber(installment.interest_delay_amount)) > 0;
  const outstanding = calculateOutstanding(installment);

  const chipClass = isPaid
    ? 'chip chip-paid'
    : isLate
      ? 'chip chip-late'
      : isPartial
        ? 'chip chip-partial'
        : 'chip chip-pending';

  const chipLabel = isPaid ? 'Pago' : isLate ? 'Atrasado' : isPartial ? 'Parcial' : 'A Vencer';

  return (
    <div className={`panel-card rounded-2xl p-4 ${isLate ? 'ring-1 ring-[color:var(--accent-danger)]/20' : ''}`}>
      {/* Topo: número + status */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">
          Parcela {installment.number}
        </span>
        <span className={chipClass}>{chipLabel}</span>
      </div>

      {/* Valores em grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-[color:var(--text-faint)]">Vencimento</p>
          <p className={`text-xs font-bold ${isLate ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-primary)]'}`}>
            {fmtDate(installment.due_date)}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wide text-[color:var(--text-faint)]">
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
            <p className="text-[9px] uppercase tracking-wide text-[color:var(--text-faint)]">Multa</p>
            <p className="text-xs font-bold text-[color:var(--accent-danger)]">
              +{formatCurrencyLocal(normalizeNumber(installment.fine_amount) + normalizeNumber(installment.interest_delay_amount))}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-[9px] uppercase tracking-wide text-[color:var(--text-faint)]">Original</p>
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
          <span className="text-[9px] font-bold text-[color:var(--accent-brass)] uppercase tracking-wide">
            Juros cobrados: {formatCurrencyLocal(normalizeNumber(installment.interest_payments_total))}
          </span>
        </div>
      )}

      {/* Ações SEMPRE visíveis */}
      {!isPaid ? (
        <div className="flex gap-2">
          <button
            onClick={onPay}
            className="flex-1 rounded-xl bg-[rgba(52,211,153,0.12)] px-2 py-2.5 text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--accent-positive)] ring-1 ring-[rgba(52,211,153,0.2)] active:scale-95 transition-all"
          >
            ✓ Baixar
          </button>
          <button
            onClick={onRefinance}
            className="flex-1 rounded-xl bg-[rgba(148,180,255,0.10)] px-2 py-2.5 text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--accent-steel)] ring-1 ring-[rgba(148,180,255,0.18)] active:scale-95 transition-all"
          >
            ↗ Reneg.
          </button>
          <button
            onClick={onInterestOnly}
            className="flex-1 rounded-xl bg-[rgba(202,176,122,0.12)] px-2 py-2.5 text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.20)] active:scale-95 transition-all"
          >
            % Juros
          </button>
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
            className="flex-1 rounded-xl bg-[color:var(--bg-soft)] px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-muted)] ring-1 ring-[color:var(--border-subtle)] active:scale-95 transition-all flex items-center justify-center gap-1.5"
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

      const { data: invs, error } = await supabase
        .from('investments')
        .select(`
          *,
          loan_installments (*)
        `)
        .or(`user_id.eq.${userId},payer_id.eq.${userId}`)
        .order('created_at', { ascending: false });

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
    <div className="flex justify-center items-center h-full text-teal-500 animate-pulse">
      <Clock size={32}/> <span className="ml-3 font-bold uppercase tracking-widest">Carregando Auditoria...</span>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-4 group">
        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform"/> Voltar para Usuários
      </button>

      {/* 1. HERO PROFILE */}
      <div className="bg-slate-800 rounded-[2.5rem] border border-slate-700 p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/5 rounded-full blur-3xl -mr-12 -mt-12 pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 relative z-10">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-slate-700 rounded-3xl flex items-center justify-center border-2 border-slate-600 shadow-lg">
              <User size={32} className="text-slate-300"/>
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">{profile?.full_name}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm">
                <span className="text-slate-400 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-700">CPF: {profile?.cpf || '---'}</span>
                <span className="text-slate-500">{profile?.email}</span>
              </div>
              <div className="mt-3 inline-flex items-center gap-2 bg-slate-900/50 border border-slate-700 px-3 py-1 rounded-full">
                <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Trust Score</span>
                <span className={`text-sm font-black ${stats.trustScore === 'A+' || stats.trustScore === 'A' ? 'text-emerald-400' : stats.trustScore === 'B' ? 'text-[color:var(--accent-caution)]' : 'text-red-400'}`}>
                  {stats.trustScore}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full lg:w-auto">
            <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Total Tomado</p>
              <p className="text-white font-black text-lg">{formatCurrency(stats.totalLoaned)}</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Pago</p>
              <p className="text-teal-400 font-black text-lg">{formatCurrency(stats.totalPaid)}</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Em Aberto</p>
              <p className="text-white font-black text-lg">{formatCurrency(stats.balance)}</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Inadimplência</p>
              <p className={`${stats.defaultRate > 0 ? 'text-red-400' : 'text-green-400'} font-black text-lg`}>{stats.defaultRate.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. WEALTH SUMMARY (INVESTOR ONLY) */}
      {balanceView && (
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-[2.5rem] border border-slate-700 shadow-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-emerald-900/30 rounded-xl text-emerald-400">
              <TrendingUp size={20}/>
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Resumo de Riqueza</h3>
              <p className="text-[10px] text-slate-500 font-bold">Origem e Destino do Capital</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-950/50 rounded-2xl p-5 border border-slate-800 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Briefcase size={40} className="text-slate-400"/>
              </div>
              <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-2">Total Aportado (Bolso)</p>
              <p className="text-2xl font-black text-white">{formatCurrency(balanceView.total_own_capital)}</p>
            </div>

            <div className="bg-slate-950/50 rounded-2xl p-5 border border-slate-800 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <TrendingUp size={40} className="text-emerald-400"/>
              </div>
              <p className="text-[10px] text-emerald-400/80 font-black uppercase tracking-widest mb-2">Lucro Reinvestido</p>
              <p className="text-2xl font-black text-emerald-400">{formatCurrency(balanceView.total_profit_reinvested)}</p>
              <p className="text-[9px] text-slate-500 mt-1">Dinheiro gerado que voltou para a rua</p>
            </div>

            <div className="bg-emerald-900/10 rounded-2xl p-5 border border-emerald-900/30 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Wallet size={40} className="text-emerald-300"/>
              </div>
              <p className="text-[10px] text-emerald-300 font-black uppercase tracking-widest mb-2">Disponível em Caixa</p>
              <p className="text-2xl font-black text-white">{formatCurrency(balanceView.available_profit_balance)}</p>
              <p className="text-[9px] text-emerald-500/70 mt-1 font-bold">Pode ser usado para novos contratos</p>
            </div>
          </div>
        </div>
      )}

      {/* 3. CONTRACTS LIST */}
      <div className="space-y-4">
        <h2 className="text-xl font-black text-white uppercase tracking-tighter pl-2 flex items-center gap-2">
          <Wallet className="text-teal-500" size={24}/> Contratos Ativos
        </h2>

        {contracts.length === 0 ? (
          <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 text-center text-slate-500 font-bold">
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
              <div key={contract.id} className="bg-slate-800 border border-slate-700 rounded-3xl overflow-hidden shadow-lg">
                {/* Accordion Header */}
                <div
                  onClick={() => toggleContract(contract.id)}
                  className="p-6 cursor-pointer hover:bg-slate-700/30 transition-colors"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-black text-white">{contract.asset_name}</h3>
                        <span className="text-[10px] bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-700 font-black uppercase">{contract.type}</span>
                        {lateCount > 0 && (
                          <span className="text-[9px] bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-black uppercase">
                            {lateCount} atrasada{lateCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 font-medium mt-1">
                        Contrato #{contract.id} • Criado em {formatDate(contract.created_at)}
                        <span className="ml-3 text-slate-600">
                          {paidCount} paga{paidCount !== 1 ? 's' : ''} · {openCount} em aberto{lateCount > 0 ? ` · ${lateCount} atrasada${lateCount > 1 ? 's' : ''}` : ''}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Valor do Contrato</p>
                        <p className="text-white font-black">{formatCurrency(Number(contract.current_value))}</p>
                      </div>
                      <div className={`p-2 rounded-full bg-slate-900 text-slate-400 transition-transform ${expandedContractId === contract.id ? 'rotate-180' : ''}`}>
                        <ChevronDown size={20}/>
                      </div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${progressPct}%` }}/>
                  </div>
                </div>

                {/* Installment cards — no horizontal scroll */}
                {expandedContractId === contract.id && (
                  <div className="border-t border-slate-700/50 bg-slate-900/30 p-4 space-y-2">
                    {installments.length === 0 ? (
                      <p className="text-center text-slate-500 text-sm py-4">Nenhuma parcela encontrada.</p>
                    ) : (
                      installments.map(inst => (
                        <InstallmentCard
                          key={inst.id}
                          installment={inst}
                          onPay={() => setInstallmentAction({ type: 'pay', installment: inst })}
                          onRefinance={() => setInstallmentAction({ type: 'refinance', installment: inst })}
                          onEdit={() => setInstallmentAction({ type: 'edit', installment: inst })}
                          onInterestOnly={() => setInstallmentAction({ type: 'interest', installment: inst })}
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
