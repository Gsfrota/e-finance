import React, { useMemo, useState, useEffect } from 'react';
import {
  Loader2, AlertCircle, CheckCircle2, AlertTriangle,
  TrendingUp, Wallet, RefreshCw, ChevronRight, ArrowRight, ArrowLeft,
  Calendar, Percent, DollarSign, FileText, History, GitBranch,
  BadgeCheck, Flame, CircleDollarSign, RotateCcw,
  Pencil, Save, XCircle, Banknote,
} from 'lucide-react';
import { Investment, LoanInstallment, Tenant, AvulsoPayment } from '../types';
import { useContractDetail, ContractDetailData } from '../hooks/useContractDetail';
import { getSupabase, parseSupabaseError } from '../services/supabase';
import ReceiptTemplate from './ReceiptTemplate';
import {
  InstallmentDetailScreen as SharedInstallmentDetailScreen,
  InstallmentFormScreen,
  InstallmentAction as SharedInstallmentAction,
} from './InstallmentDetailFlow';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const fmtDate = (ymd?: string | null) => {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
};

const fmtWeekday = (ymd?: string | null) => {
  if (!ymd) return '';
  return new Date(ymd + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long' });
};

const fmtDatetime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

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

const statusBadge = (status?: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    active:    { label: 'Ativo',        cls: 'chip chip-active' },
    completed: { label: 'Quitado',      cls: 'chip chip-paid' },
    defaulted: { label: 'Inadimplente', cls: 'chip chip-late' },
    renewed:   { label: 'Renovado',     cls: 'chip chip-pending' },
  };
  const s = map[status || 'active'] ?? map['active'];
  return <span className={s.cls}>{s.label}</span>;
};

const installmentStatusBadge = (status: LoanInstallment['status']) => {
  const map = {
    paid:    { label: 'Pago',     cls: 'chip chip-paid' },
    pending: { label: 'Pendente', cls: 'chip chip-pending' },
    late:    { label: 'Atrasado', cls: 'chip chip-late' },
    partial: { label: 'Parcial',  cls: 'chip chip-partial' },
  };
  const s = map[status];
  return <span className={s.cls}>{s.label}</span>;
};

const panelCard = 'panel-card rounded-[1.6rem]';

// ── Helpers de falta ──────────────────────────────────────────────────────────

const getMissedEvents = (inst: LoanInstallment, siblings: LoanInstallment[]): string[] => {
  const fmtDt = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
  const events: string[] = [];

  // Evento 1: pagamento parcial (se houver)
  if (normalizeNumber(inst.amount_paid) > 0 && inst.status !== 'paid') {
    events.push(`Pagamento parcial de ${fmt(normalizeNumber(inst.amount_paid))} registrado`);
  }

  // Evento 2: falta/absorção
  if ((inst as any).missed_at) {
    const missDate = fmtDt((inst as any).missed_at);
    if (inst.status === 'paid' && normalizeNumber(inst.amount_total) === 0) {
      const target = siblings.find(s => (s as any).deferred_from_id === inst.id);
      if (target) {
        events.push(`Nao paga em ${missDate} — valor acumulado na parcela #${target.number}`);
      } else {
        events.push(`Nao paga em ${missDate} — valor redistribuido`);
      }
    } else {
      events.push(`Falta registrada em ${missDate} — parcela adiada`);
    }
  }

  return events;
};

// ── KpiTile ───────────────────────────────────────────────────────────────────

interface KpiTileProps {
  label: string; value: string; color?: string;
  icon: React.ElementType; iconBg?: string;
}
const KpiTile: React.FC<KpiTileProps> = ({ label, value, color = 'var(--text-primary)', icon: Icon, iconBg = 'var(--bg-soft)' }) => (
  <div className={`${panelCard} flex flex-col gap-3 p-4`}>
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background: iconBg }}>
        <Icon size={14} style={{ color }} />
      </div>
      <p className="type-label text-[color:var(--text-faint)]">{label}</p>
    </div>
    <p className="type-subheading leading-none" style={{ color }}>{value}</p>
  </div>
);


// ── AvulsoPaymentScreen ───────────────────────────────────────────────────────

interface AvulsoPaymentScreenProps {
  investmentId: number;
  installments: LoanInstallment[];
  onBack: () => void;
  onSuccess: () => void;
}

const AvulsoPaymentScreen: React.FC<AvulsoPaymentScreenProps> = ({
  investmentId, installments, onBack, onSuccess,
}) => {
  const today = new Date().toISOString().split('T')[0];
  const [amount, setAmount]     = useState('');
  const [dateInput, setDate]    = useState(today);
  const [notes, setNotes]       = useState('');
  // BR-PAG-014: destino obrigatório do pagamento avulso
  const [destination, setDestination] = useState<'principal_reduction' | 'penalty_payment' | 'general_credit'>('general_credit');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const amountNum = parseFloat(amount.replace(',', '.')) || 0;

  // Preview: aplica do ÚLTIMO para o PRIMEIRO (quita do fim do contrato)
  const preview = useMemo(() => {
    if (amountNum <= 0) return { items: [] as { inst: LoanInstallment; applied: number; newStatus: 'paid' | 'partial' }[], surplus: 0 };
    const result: { inst: LoanInstallment; applied: number; newStatus: 'paid' | 'partial' }[] = [];
    let remaining = amountNum;
    const unpaid = [...installments]
      .filter(i => i.status !== 'paid')
      .sort((a, b) => b.due_date.localeCompare(a.due_date) || b.number - a.number);
    for (const inst of unpaid) {
      if (remaining <= 0) break;
      const outstanding = calculateOutstanding(inst);
      if (outstanding <= 0) continue;
      if (remaining >= outstanding) {
        result.push({ inst, applied: outstanding, newStatus: 'paid' });
        remaining -= outstanding;
      } else {
        result.push({ inst, applied: remaining, newStatus: 'partial' });
        remaining = 0;
      }
    }
    return { items: result, surplus: remaining };
  }, [amountNum, installments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountNum <= 0) { setError('Informe um valor válido.'); return; }
    setLoading(true); setError(null);
    try {
      const destLabel = { principal_reduction: 'Redução de principal', penalty_payment: 'Quitação de encargos', general_credit: 'Crédito geral' }[destination];
      const fullNotes = `[${destLabel}]${notes.trim() ? ' ' + notes.trim() : ''}`;
      const { error: rpcErr } = await getSupabase().rpc('pay_avulso', {
        p_investment_id: investmentId,
        p_amount: amountNum,
        p_paid_at: new Date(dateInput + 'T12:00:00').toISOString(),
        p_notes: fullNotes,
      });
      if (rpcErr) throw rpcErr;
      onSuccess();
    } catch (err: any) {
      setError(parseSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full bg-[color:var(--bg-soft)] border border-[color:var(--border-strong)] rounded-xl px-4 py-3.5 text-[color:var(--text-primary)] font-mono text-lg outline-none focus:ring-2 focus:ring-[color:var(--accent-brass)] transition-all";

  return (
    <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-5 py-5 shrink-0">
        <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="type-label text-[color:var(--text-faint)]">Contrato</p>
          <h3 className="type-heading uppercase text-[color:var(--text-primary)] leading-none mt-0.5">
            Pagamento Avulso
          </h3>
        </div>
        <Banknote size={20} className="text-[color:var(--accent-brass)] shrink-0" />
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-5 space-y-5">
        {/* Info */}
        <div className="flex gap-3 rounded-2xl bg-[rgba(202,176,122,0.08)] border border-[rgba(202,176,122,0.16)] p-4">
          <AlertCircle size={16} className="text-[color:var(--accent-brass)] shrink-0 mt-0.5" />
          <p className="text-xs text-[color:var(--text-secondary)] leading-relaxed">
            O valor informado será abatido das <strong>últimas parcelas</strong> do contrato, do fim para o início. As parcelas mais próximas do vencimento permanecem inalteradas.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Valor */}
          <div>
            <label className="block type-label text-[color:var(--text-faint)] mb-2">
              Valor do Pagamento (R$)
            </label>
            <div className="relative">
              <DollarSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--accent-brass)]" />
              <input
                type="number" step="0.01" inputMode="decimal" min="0.01" required
                value={amount}
                onChange={e => { setAmount(e.target.value); setError(null); }}
                placeholder="0,00"
                className={`${inputCls} pl-10`}
              />
            </div>
          </div>

          {/* Data */}
          <div>
            <label className="block type-label text-[color:var(--text-faint)] mb-2">
              Data do Pagamento
            </label>
            <input
              type="date" required
              value={dateInput}
              onChange={e => setDate(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Destino BR-PAG-014 */}
          <div>
            <label className="block type-label text-[color:var(--text-faint)] mb-2">Destino do pagamento</label>
            <select value={destination} onChange={e => setDestination(e.target.value as any)}
              className="w-full bg-[color:var(--bg-soft)] border border-[color:var(--border-strong)] rounded-xl px-4 py-3.5 text-sm text-[color:var(--text-primary)] outline-none focus:ring-2 focus:ring-[color:var(--accent-brass)] transition-all">
              <option value="general_credit">Crédito geral</option>
              <option value="principal_reduction">Redução de principal</option>
              <option value="penalty_payment">Quitação de encargos</option>
            </select>
          </div>

          {/* Observação */}
          <div>
            <label className="block type-label text-[color:var(--text-faint)] mb-2">
              Observação (opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ex: PIX recebido, TED, etc."
              className="w-full bg-[color:var(--bg-soft)] border border-[color:var(--border-strong)] rounded-xl px-4 py-3.5 text-sm text-[color:var(--text-primary)] outline-none focus:ring-2 focus:ring-[color:var(--accent-brass)] transition-all placeholder:text-[color:var(--text-faint)]"
            />
          </div>

          {/* Preview */}
          {amountNum > 0 && (
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-soft)] p-4">
              <p className="type-label text-[color:var(--text-faint)] mb-3">
                Parcelas quitadas (do fim do contrato)
              </p>
              {preview.items.length === 0 ? (
                <p className="text-xs text-[color:var(--text-faint)] italic">Nenhuma parcela pendente para abater.</p>
              ) : (
                <div className="space-y-2">
                  {preview.items.map(({ inst, applied, newStatus }) => (
                    <div key={inst.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`shrink-0 inline-block h-2 w-2 rounded-full ${newStatus === 'paid' ? 'bg-[color:var(--accent-positive)]' : 'bg-[color:var(--accent-brass)]'}`} />
                        <span className="text-xs font-semibold text-[color:var(--text-primary)]">
                          Parcela {inst.number}
                        </span>
                        <span className="type-caption text-[color:var(--text-faint)] truncate">
                          {new Date(inst.due_date + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })}, {fmtDate(inst.due_date)}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`type-metric-sm ${newStatus === 'paid' ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--accent-brass)]'}`}>
                          {fmt(applied)}
                        </span>
                        <span className={`ml-1 type-micro ${newStatus === 'paid' ? 'text-[color:var(--accent-positive)]' : 'text-[color:var(--accent-brass)]'}`}>
                          {newStatus === 'paid' ? '● quitada' : '◑ parcial'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {preview.surplus > 0 && (
                    <div className="mt-2 pt-2 border-t border-[color:var(--border-subtle)] flex items-center gap-2 text-[color:var(--accent-steel)]">
                      <AlertCircle size={12} className="shrink-0" />
                      <p className="type-caption font-bold">
                        Saldo excedente {fmt(preview.surplus)} — sem parcelas para abater
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-900/20 border border-red-900/50 p-3 text-xs text-red-400">
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || amountNum <= 0}
            className="type-label w-full rounded-xl bg-[rgba(202,176,122,0.12)] py-4 text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.20)] active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Banknote size={18} />}
            {loading ? 'Processando...' : 'Confirmar Pagamento Avulso'}
          </button>
        </form>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

interface ContractDetailProps {
  investmentId: number | null;
  onBack: () => void;
  onRenew?: (investment: Investment) => void;
  onRefreshList?: () => void;
  tenant?: Tenant | null;
  readOnly?: boolean;
  externalData?: ContractDetailData | null;
  externalLoading?: boolean;
  externalError?: string | null;
}

const ContractDetail: React.FC<ContractDetailProps> = ({ investmentId, onBack, onRenew, tenant, readOnly = false, externalData, externalLoading, externalError }) => {
  const internal = useContractDetail(externalData !== undefined ? null : investmentId);
  const data = externalData !== undefined ? externalData : internal.data;
  const loading = externalData !== undefined ? (externalLoading ?? false) : internal.loading;
  const error = externalData !== undefined ? (externalError ?? null) : internal.error;
  const refetch = externalData !== undefined ? () => {} : internal.refetch;
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction]     = useState<SharedInstallmentAction>(null);
  const [avulsoOpen, setAvulsoOpen]                   = useState(false);
  const [avulsoPayments, setAvulsoPayments]           = useState<AvulsoPayment[]>([]);

  const refreshAvulso = async () => {
    if (!investmentId || readOnly) return;
    const { data: ap } = await getSupabase()
      .from('avulso_payments')
      .select('*')
      .eq('investment_id', investmentId)
      .order('paid_at', { ascending: false });
    setAvulsoPayments(ap ?? []);
  };

  useEffect(() => { refreshAvulso(); }, [investmentId]);

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

  const { totalPago, totalRestante } = useMemo(() => {
    if (!data) return { totalPago: 0, totalRestante: 0 };
    let totalPago = 0, totalRestante = 0;
    for (const i of data.installments) {
      totalPago += normalizeNumber(i.amount_paid);
      if (i.status !== 'paid') totalRestante += calculateOutstanding(i);
    }
    return { totalPago, totalRestante };
  }, [data]);

  // ── Sub-view: pagamento avulso ──
  if (!readOnly && avulsoOpen && data) {
    return (
      <AvulsoPaymentScreen
        investmentId={data.investment.id}
        installments={data.installments}
        onBack={() => setAvulsoOpen(false)}
        onSuccess={() => {
          setAvulsoOpen(false);
          refetch();
          refreshAvulso();
        }}
      />
    );
  }

  // ── Sub-view: form de ação ──
  if (!readOnly && installmentAction !== null) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        tenant={tenant ?? null}
        payerName={data?.investment?.payer?.full_name}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => { setInstallmentAction(null); setSelectedInstallment(null); refetch(); }}
      />
    );
  }

  // ── Sub-view: detalhe da parcela ──
  if (selectedInstallment !== null) {
    return (
      <SharedInstallmentDetailScreen
        installment={selectedInstallment}
        onBack={() => setSelectedInstallment(null)}
        onAction={(action) => setInstallmentAction(action)}
        readOnly={readOnly}
      />
    );
  }

  // ── Main view ──
  return (
    <div className="flex h-full flex-col bg-[color:var(--bg-elevated)] overflow-hidden">

      {loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[color:var(--accent-brass)]">
          <Loader2 size={36} className="animate-spin" />
          <p className="type-label text-[color:var(--text-muted)]">Carregando contrato...</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <AlertCircle size={36} className="text-[color:var(--accent-danger)]" />
          <p className="text-sm text-[color:var(--text-secondary)]">{error}</p>
          <button onClick={refetch} className="flex items-center gap-2 rounded-full bg-[color:var(--bg-soft)] px-4 py-2 text-xs font-bold text-[color:var(--text-primary)] hover:bg-[color:var(--bg-strong)] transition-colors">
            <RefreshCw size={13} /> Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* ── Header ── */}
          <div className="shrink-0 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-base)] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {statusBadge(data.investment.status)}
                  {data.investment.calculation_mode === 'interest_only' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                      Juros Simples
                    </span>
                  )}
                  {data.parent && (
                    <span className="chip chip-pending">
                      <GitBranch size={10} /> Renovação de #{data.parent.id}
                    </span>
                  )}
                </div>
                <h2 className="type-heading truncate leading-none text-[color:var(--text-primary)]">
                  {data.investment.asset_name}
                </h2>
                <p className="mt-1 text-xs text-[color:var(--text-faint)]">
                  ID #{data.investment.id} · Criado em {fmtDate(data.investment.created_at?.split('T')[0])}
                </p>
              </div>
              <button onClick={onBack} className="shrink-0 rounded-full p-2.5 text-[color:var(--text-muted)] transition-colors hover:bg-[color:var(--bg-soft)] hover:text-[color:var(--text-primary)]">
                <ArrowLeft size={20} />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 text-sm">
              <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-1.5">
                <p className="type-label text-[color:var(--text-faint)]">Investidor</p>
                <p className="font-semibold text-[color:var(--text-primary)]">{data.investment.investor?.full_name ?? '—'}</p>
              </div>
              <ArrowRight size={14} className="text-[color:var(--text-faint)] shrink-0" />
              <div className="rounded-xl bg-[color:var(--bg-soft)] px-3 py-1.5">
                <p className="type-label text-[color:var(--text-faint)]">Devedor</p>
                <p className="font-semibold text-[color:var(--text-primary)]">{data.investment.payer?.full_name ?? '—'}</p>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex justify-between type-label text-[color:var(--text-faint)]">
                <span>{data.metrics.parcelasPagas}/{data.metrics.parcelasTotal} parcelas pagas</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--bg-strong)]">
                <div className="h-full rounded-full bg-[color:var(--accent-positive)] transition-all duration-700" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {!readOnly && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setAvulsoOpen(true)}
                className="type-label flex items-center gap-2 rounded-full bg-[rgba(202,176,122,0.14)] px-4 py-2 text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.22)] transition-all hover:bg-[rgba(202,176,122,0.24)]"
              >
                <Banknote size={13} /> Pagamento Avulso
              </button>
              {onRenew && (
                <button onClick={() => onRenew(data.investment)}
                  className="type-label flex items-center gap-2 rounded-full bg-[rgba(202,176,122,0.12)] px-4 py-2 text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.20)] transition-all hover:bg-[rgba(202,176,122,0.20)]">
                  <RotateCcw size={13} /> Renovar Contrato
                </button>
              )}
            </div>
            )}
          </div>

          {/* ── Body ── */}
          <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-6 space-y-6">

            {/* Resumo Financeiro */}
            <section>
              <p className="section-kicker mb-3">Resumo Financeiro</p>

              {/* 4 métricas principais */}
              <div className="grid grid-cols-2 gap-3">

                {/* Já Recebido */}
                <div className="panel-card rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[rgba(52,211,153,0.14)]">
                      <Wallet size={13} className="text-[color:var(--accent-positive)]" />
                    </div>
                    <p className="type-label text-[color:var(--text-faint)]">Já Recebido</p>
                  </div>
                  <p className="type-metric-lg leading-none text-[color:var(--accent-positive)]">{fmt(totalPago)}</p>
                  <p className="mt-1.5 type-caption text-[color:var(--text-faint)]">
                    {data.metrics.parcelasPagas} parcela{data.metrics.parcelasPagas !== 1 ? 's' : ''} quitada{data.metrics.parcelasPagas !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* Ainda Falta */}
                <div className="panel-card rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[rgba(148,180,255,0.14)]">
                      <CircleDollarSign size={13} className="text-[color:var(--accent-steel)]" />
                    </div>
                    <p className="type-label text-[color:var(--text-faint)]">Ainda Falta</p>
                  </div>
                  <p className={`type-metric-lg leading-none ${totalRestante > 0 ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--accent-positive)]'}`}>
                    {fmt(totalRestante)}
                  </p>
                  <p className="mt-1.5 type-caption text-[color:var(--text-faint)]">
                    {data.metrics.parcelasPendentes + data.metrics.parcelasAtrasadas} em aberto
                  </p>
                </div>

                {/* Lucro (juros) */}
                <div className="panel-card rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[rgba(202,176,122,0.14)]">
                      <TrendingUp size={13} className="text-[color:var(--accent-brass)]" />
                    </div>
                    <p className="type-label text-[color:var(--text-faint)]">Lucro Realizado</p>
                  </div>
                  <p className="type-metric-lg leading-none text-[color:var(--accent-brass)]">{fmt(data.metrics.jurosPagos)}</p>
                  <p className="mt-1.5 type-caption text-[color:var(--text-faint)]">
                    + {fmt(data.metrics.jurosAReceber)} projetado
                  </p>
                </div>

                {/* Atraso */}
                <div className={`panel-card rounded-2xl p-4 ${
                  data.metrics.parcelasAtrasadas > 0
                    ? 'ring-1 ring-[color:var(--accent-danger)]/30 bg-[rgba(198,126,105,0.04)]'
                    : ''
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${
                      data.metrics.parcelasAtrasadas > 0 ? 'bg-[rgba(198,126,105,0.18)]' : 'bg-[rgba(52,211,153,0.12)]'
                    }`}>
                      {data.metrics.parcelasAtrasadas > 0
                        ? <Flame size={13} className="text-[color:var(--accent-danger)]" />
                        : <BadgeCheck size={13} className="text-[color:var(--accent-positive)]" />
                      }
                    </div>
                    <p className="type-label text-[color:var(--text-faint)]">Atraso</p>
                  </div>
                  {data.metrics.parcelasAtrasadas > 0 ? (
                    <>
                      <p className="type-metric-lg leading-none text-[color:var(--accent-danger)]">
                        {data.metrics.parcelasAtrasadas} parc.
                      </p>
                      <p className="mt-1.5 type-caption font-semibold text-[color:var(--accent-danger)]">
                        {data.metrics.fineAcumulada > 0 ? `${fmt(data.metrics.fineAcumulada)} em multas` : 'sem multas ainda'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="type-metric-lg leading-none text-[color:var(--accent-positive)]">Sem atraso</p>
                      <p className="mt-1.5 type-caption text-[color:var(--text-faint)]">Contrato em dia ✓</p>
                    </>
                  )}
                </div>
              </div>

              {/* Linha secundária: condições do contrato */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: 'Principal',  value: fmt(data.investment.amount_invested) },
                  { label: 'Taxa',       value: `${Number(data.investment.interest_rate).toFixed(2)}% a.m.` },
                  { label: data.investment.calculation_mode === 'interest_only' ? 'Juros/mês' : 'Parcela', value: fmt(data.investment.installment_value) },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-3 py-3 text-center">
                    <p className="type-label text-[color:var(--text-faint)]">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">{value}</p>
                  </div>
                ))}
              </div>

              {data.investment.calculation_mode === 'interest_only' && (
                <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-900/10 px-4 py-3">
                  <p className="type-label text-amber-400 mb-1">Contrato Bullet — Juros Apenas</p>
                  <p className="type-caption text-[color:var(--text-secondary)]">
                    Principal de {fmt(data.investment.amount_invested)} devolvido {data.investment.bullet_principal_mode === 'separate' ? 'em parcela separada ao final' : 'junto na última parcela'}.
                  </p>
                </div>
              )}
            </section>

            {/* Parcelas */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="section-kicker">Parcelas</p>
                <div className="flex gap-2 type-caption font-bold">
                  <span className="chip chip-paid">{data.metrics.parcelasPagas} pagas</span>
                  {data.metrics.parcelasPartiais > 0 && <span className="chip chip-partial">{data.metrics.parcelasPartiais} parciais</span>}
                  {data.metrics.parcelasAtrasadas > 0 && <span className="chip chip-late">{data.metrics.parcelasAtrasadas} atrasadas</span>}
                  {data.metrics.parcelasPendentes > 0 && <span className="chip chip-pending">{data.metrics.parcelasPendentes} pendentes</span>}
                </div>
              </div>
              <p className="type-caption text-[color:var(--text-faint)] mb-3">Toque em uma parcela para ver detalhes e ações</p>

              {data.installments.length === 0 ? (
                <div className={`${panelCard} flex items-center justify-center py-10`}>
                  <p className="type-label text-[color:var(--text-faint)]">Nenhuma parcela encontrada</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.installments.map((i) => {
                    const multa     = (Number(i.fine_amount) || 0) + (Number(i.interest_delay_amount) || 0);
                    const isLate    = i.status === 'late';
                    const isPaid    = i.status === 'paid';
                    const isPartial = i.status === 'partial';
                    const isMissed  = !!(i as any).missed_at && i.status !== 'paid';
                    const isAbsorbed = !!(i as any).missed_at && i.status === 'paid' && normalizeNumber(i.amount_total) === 0;
                    return (
                      <button
                        key={i.id}
                        onClick={() => {
                          const enriched = {
                            ...i,
                            investment: { ...data.investment, loan_installments: data.installments },
                          };
                          setSelectedInstallment(enriched as any);
                        }}
                        className={`w-full panel-card rounded-2xl p-4 text-left transition-all active:scale-[0.98] hover:ring-1 hover:ring-[color:var(--border-strong)] ${
                          isLate ? 'ring-1 ring-[color:var(--accent-danger)]/30 bg-[rgba(198,126,105,0.04)]' :
                          isPaid ? 'opacity-70' : ''
                        }`}
                      >
                        {/* Número + status + seta */}
                        <div className="flex items-center justify-between mb-3">
                          <span className="type-label text-[color:var(--text-faint)]">
                            Parcela {i.number}
                          </span>
                          <div className="flex items-center gap-2">
                            {isMissed
                              ? <span className="chip chip-late">Falta</span>
                              : isAbsorbed
                              ? <span className="chip" style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)' }}>Absorvida</span>
                              : installmentStatusBadge(i.status)}
                            <ChevronRight size={14} className="text-[color:var(--text-faint)]" />
                          </div>
                        </div>

                        {/* Vencimento ↔ Valor */}
                        <div className="flex items-end justify-between mb-3">
                          <div>
                            <p className="type-micro text-[color:var(--text-faint)] mb-1">Vencimento</p>
                            <p className="type-caption text-[color:var(--text-faint)] capitalize mb-0.5">{fmtWeekday(i.due_date)}</p>
                            <p className={`type-metric-md leading-none ${isLate ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-primary)]'}`}>
                              {fmtDate(i.due_date)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="type-micro text-[color:var(--text-faint)] mb-1">
                              {isPaid ? 'Pago' : isPartial ? 'Pago Parcial' : 'Total Devido'}
                            </p>
                            <p className={`type-metric-md leading-none ${
                              isPaid ? 'text-[color:var(--accent-positive)]' :
                              isPartial ? 'text-[color:var(--accent-brass)]' :
                              isLate ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-primary)]'
                            }`}>
                              {isPaid || isPartial ? fmt(i.amount_paid) : fmt(i.amount_total)}
                            </p>
                          </div>
                        </div>

                        {/* Detalhes: Principal / Juros / Multa ou Pago em */}
                        <div className="grid grid-cols-3 gap-2 border-t border-[color:var(--border-subtle)] pt-3">
                          <div>
                            <p className="type-micro text-[color:var(--text-faint)] mb-0.5">Principal</p>
                            <p className="text-xs font-semibold text-[color:var(--text-secondary)] tabular-nums">{fmt(i.amount_principal)}</p>
                          </div>
                          <div>
                            <p className="type-micro text-[color:var(--text-faint)] mb-0.5">Juros</p>
                            <p className="text-xs font-semibold text-[color:var(--accent-brass)] tabular-nums">{fmt(i.amount_interest)}</p>
                          </div>
                          {multa > 0 ? (
                            <div>
                              <p className="type-micro text-[color:var(--text-faint)] mb-0.5">Multa</p>
                              <p className="text-xs font-bold text-[color:var(--accent-danger)] tabular-nums">+{fmt(multa)}</p>
                            </div>
                          ) : isPaid && i.paid_at ? (
                            <div>
                              <p className="type-micro text-[color:var(--text-faint)] mb-0.5">Pago em</p>
                              <p className="text-xs font-semibold text-[color:var(--text-faint)] tabular-nums">{fmtDate(i.paid_at.split('T')[0])}</p>
                            </div>
                          ) : (
                            <div>
                              <p className="type-micro text-[color:var(--text-faint)] mb-0.5">Original</p>
                              <p className="text-xs font-semibold text-[color:var(--text-muted)] tabular-nums">{fmt(i.amount_total)}</p>
                            </div>
                          )}
                        </div>

                        {(() => {
                          const events = getMissedEvents(i, data.installments);
                          if (events.length === 0) return null;
                          return (
                            <div className="mt-2 pt-2 border-t border-[color:var(--border-subtle)] space-y-1">
                              {events.map((ev, idx) => (
                                <div key={idx} className="flex items-start gap-2">
                                  <AlertTriangle size={11} className="text-[color:var(--accent-danger)] shrink-0 mt-0.5" />
                                  <p className="type-caption text-[color:var(--accent-danger)] font-semibold leading-tight">{ev}</p>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Pagamentos Avulsos */}
            {avulsoPayments.length > 0 && (
              <section>
                <p className="section-kicker mb-3 flex items-center gap-2">
                  <Banknote size={13} /> Pagamentos Avulsos ({avulsoPayments.length})
                </p>
                <div className="space-y-2">
                  {avulsoPayments.map((ap) => (
                    <div key={ap.id} className={`${panelCard} px-4 py-3`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="type-metric-sm text-[color:var(--accent-brass)]">{fmt(ap.amount)}</p>
                          {ap.notes && (
                            <p className="mt-0.5 truncate type-caption italic text-[color:var(--text-faint)]">"{ap.notes}"</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="type-caption text-[color:var(--text-faint)]">
                            {fmtDate(ap.paid_at.split('T')[0])}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Renegociações */}
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
                      <div className="flex flex-wrap gap-3 type-caption">
                        {r.old_installment_value != null && r.new_installment_value != null && (
                          <span className="text-[color:var(--text-secondary)]">
                            Parcela: <span className="line-through text-[color:var(--text-faint)]">{fmt(r.old_installment_value)}</span>
                            {' → '}<span className="font-bold text-[color:var(--accent-brass)]">{fmt(r.new_installment_value)}</span>
                          </span>
                        )}
                        {r.old_total_installments != null && r.new_total_installments != null && (
                          <span className="text-[color:var(--text-secondary)]">
                            Prazo: <span className="line-through text-[color:var(--text-faint)]">{r.old_total_installments}x</span>
                            {' → '}<span className="font-bold text-[color:var(--accent-brass)]">{r.new_total_installments}x</span>
                          </span>
                        )}
                        {r.old_due_date != null && r.new_due_date != null && (
                          <span className="text-[color:var(--text-secondary)]">
                            Vencimento: <span className="line-through text-[color:var(--text-faint)]">{new Date(r.old_due_date + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })}., {fmtDate(r.old_due_date)}</span>
                            {' → '}<span className="font-bold text-[color:var(--accent-brass)]">{new Date(r.new_due_date + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })}., {fmtDate(r.new_due_date)}</span>
                          </span>
                        )}
                      </div>
                      {r.reason && <p className="mt-1.5 type-caption italic text-[color:var(--text-faint)]">"{r.reason}"</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Cadeia de renovações */}
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
                        <p className="type-label text-[color:var(--text-faint)]">Contrato original</p>
                        <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">#{data.parent.id} — {data.parent.asset_name}</p>
                      </div>
                      {statusBadge(data.parent.status)}
                    </div>
                  )}
                  {data.renewals.map((r) => (
                    <div key={r.id} className={`${panelCard} flex items-center gap-3 px-4 py-3`}>
                      <RotateCcw size={14} className="shrink-0 text-[color:var(--accent-brass)]" />
                      <div className="min-w-0 flex-1">
                        <p className="type-label text-[color:var(--text-faint)]">Renovação</p>
                        <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">#{r.id} — {r.asset_name}</p>
                        <p className="type-caption text-[color:var(--text-faint)]">Criado em {fmtDate(r.created_at?.split('T')[0])}</p>
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
  );
};

export default ContractDetail;
