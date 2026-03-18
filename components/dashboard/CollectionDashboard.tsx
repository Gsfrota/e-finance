import React, { useMemo, useRef, useState } from 'react';
import { LoanInstallment, Tenant } from '../../types';
import {
  InstallmentAction,
  InstallmentDetailScreen,
  InstallmentFormScreen,
  calcOutstanding,
  fmtDate,
  fmtMoney,
  installmentStatusBadge,
} from '../InstallmentDetailFlow';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Phone,
  TrendingUp,
} from 'lucide-react';

interface CollectionDashboardProps {
  installments: LoanInstallment[];
  onUpdate?: () => void;
  tenant?: Tenant | null;
}

const addDays = (base: string, days: number) => {
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};

type BucketId = 'overdue' | 'today' | '3d' | '7d' | '15d' | '30d';

const bucketMeta: Record<BucketId, { title: string; subtitle: string; tone: string; icon: React.ReactNode }> = {
  overdue: {
    title: 'Atrasados',
    subtitle: 'títulos já vencidos',
    tone: 'text-[color:var(--accent-danger)] bg-[rgba(198,126,105,0.08)] border-[rgba(198,126,105,0.16)]',
    icon: <AlertTriangle size={16} />,
  },
  today: {
    title: 'Hoje',
    subtitle: 'vencimento do dia',
    tone: 'text-[color:var(--accent-warning)] bg-[rgba(200,154,85,0.10)] border-[rgba(200,154,85,0.18)]',
    icon: <Clock3 size={16} />,
  },
  '3d': {
    title: '3 dias',
    subtitle: 'curto prazo',
    tone: 'text-[color:var(--accent-brass)] bg-[rgba(202,176,122,0.10)] border-[rgba(202,176,122,0.16)]',
    icon: <CalendarDays size={16} />,
  },
  '7d': {
    title: '7 dias',
    subtitle: 'janela semanal',
    tone: 'text-[color:var(--accent-steel)] bg-[rgba(144,160,189,0.10)] border-[rgba(144,160,189,0.16)]',
    icon: <CalendarDays size={16} />,
  },
  '15d': {
    title: '15 dias',
    subtitle: 'meio mês',
    tone: 'text-[color:var(--accent-positive)] bg-[rgba(143,179,157,0.10)] border-[rgba(143,179,157,0.16)]',
    icon: <CalendarDays size={16} />,
  },
  '30d': {
    title: '30 dias',
    subtitle: 'visão mensal',
    tone: 'text-[color:var(--text-secondary)] bg-white/[0.04] border-white/10',
    icon: <CalendarDays size={16} />,
  },
};

export const CollectionDashboard: React.FC<CollectionDashboardProps> = ({ installments, onUpdate, tenant }) => {
  const [selectedBucket, setSelectedBucket]       = useState<BucketId>('today');
  const [showPaidToday, setShowPaidToday]         = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const today = new Date().toISOString().split('T')[0];
  const d3    = addDays(today, 3);
  const d7    = addDays(today, 7);
  const d15   = addDays(today, 15);
  const d30   = addDays(today, 30);

  const pendingInstallments = useMemo(
    () => installments.filter((i) => i.status !== 'paid' && i.status !== 'partial'),
    [installments],
  );

  const bucketItems = useMemo(
    () => ({
      overdue: pendingInstallments.filter((i) => i.due_date < today),
      today:   pendingInstallments.filter((i) => i.due_date === today),
      '3d':    pendingInstallments.filter((i) => i.due_date > today && i.due_date <= d3),
      '7d':    pendingInstallments.filter((i) => i.due_date > d3   && i.due_date <= d7),
      '15d':   pendingInstallments.filter((i) => i.due_date > d7   && i.due_date <= d15),
      '30d':   pendingInstallments.filter((i) => i.due_date > d15  && i.due_date <= d30),
    }),
    [pendingInstallments, today, d3, d7, d15, d30],
  );

  const totals = useMemo(
    () => Object.fromEntries(
      Object.entries(bucketItems).map(([key, items]) => [
        key,
        items.reduce((sum, i) => sum + calcOutstanding(i), 0),
      ]),
    ) as Record<BucketId, number>,
    [bucketItems],
  );

  const paidToday = useMemo(() => {
    return installments.filter(
      i => (i.status === 'paid' || i.status === 'partial') && i.paid_at?.startsWith(today)
    );
  }, [installments, today]);

  const totalReceivedToday = useMemo(() =>
    paidToday.reduce((sum, i) => sum + (Number(i.amount_paid) || 0), 0),
    [paidToday],
  );

  const selectedItems = bucketItems[selectedBucket]
    .slice()
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.number - b.number);

  // ── Sub-view: Form Screen ───────────────────────────────────────────────────
  if (installmentAction !== null) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        tenant={tenant ?? null}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => {
          setInstallmentAction(null);
          setSelectedInstallment(null);
          onUpdate?.();
        }}
      />
    );
  }

  // ── Sub-view: Detail Screen ─────────────────────────────────────────────────
  if (selectedInstallment !== null) {
    return (
      <InstallmentDetailScreen
        installment={selectedInstallment}
        onBack={() => setSelectedInstallment(null)}
        onAction={(action) => setInstallmentAction(action)}
      />
    );
  }

  // ── Main list ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Card fixo: Recebidos Hoje */}
      <div
        className="panel-card rounded-[2rem] overflow-hidden cursor-pointer select-none"
        onClick={() => setShowPaidToday(v => !v)}
      >
        <div className="px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(143,179,157,0.15)] text-[color:var(--accent-positive)]">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--accent-positive)] mb-0.5">Recebidos Hoje</p>
              <p className="text-3xl font-black text-[color:var(--text-primary)] tabular-nums leading-none">{fmtMoney(totalReceivedToday)}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-lg font-black text-[color:var(--text-secondary)] tabular-nums">{paidToday.length}</p>
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-faint)]">parcela{paidToday.length !== 1 ? 's' : ''}</p>
            </div>
            <ChevronRight size={16} className={`text-[color:var(--text-faint)] transition-transform duration-200 ${showPaidToday ? 'rotate-90' : ''}`} />
          </div>
        </div>

        {showPaidToday && (
          <div className="border-t border-white/[0.06]">
            {paidToday.length === 0 ? (
              <p className="px-6 py-8 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-faint)]">
                Nenhum recebimento hoje.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {paidToday.map((inst) => {
                  const debtorName = inst.investment?.payer?.full_name || (inst as any).payer_name || 'Cliente';
                  const contractName = inst.investment?.asset_name || (inst as any).contract_name || 'Contrato';
                  const initials = debtorName.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase();
                  return (
                    <button
                      key={inst.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedInstallment(inst); }}
                      className="group w-full flex items-center gap-4 px-6 py-3.5 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(143,179,157,0.12)] text-[color:var(--accent-positive)] border border-[rgba(143,179,157,0.2)] text-xs font-black">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-[color:var(--text-primary)] truncate">{debtorName}</p>
                        <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)] truncate">{contractName} · Parcela #{inst.number}</p>
                      </div>
                      <p className="text-sm font-extrabold text-[color:var(--accent-positive)] tabular-nums shrink-0">{fmtMoney(Number(inst.amount_paid) || 0)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Header card */}
      <div className="panel-card rounded-[2rem] px-6 py-6 md:px-8 md:py-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="section-kicker mb-2">Cobrança</p>
            <h3 className="font-display text-5xl leading-none text-[color:var(--text-primary)]">Central de cobrança</h3>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[color:var(--text-secondary)]">
              Separe o que já venceu do que entra nos próximos dias e registre a baixa diretamente na fila de cobrança.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]">
              <Phone size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-[color:var(--text-primary)]">Agenda do dia</div>
              <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">{fmtDate(today)}</div>
            </div>
          </div>
        </div>

        {/* Bucket selector */}
        <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-6">
          {(Object.keys(bucketMeta) as BucketId[]).map((bucketId) => {
            const meta     = bucketMeta[bucketId];
            const isActive = selectedBucket === bucketId;
            const count    = bucketItems[bucketId].length;

            return (
              <button
                key={bucketId}
                onClick={() => { setSelectedBucket(bucketId); setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}
                className={`rounded-[1.4rem] border px-4 py-4 text-left transition-all ${meta.tone} ${isActive ? 'ring-1 ring-white/10' : 'opacity-90 hover:opacity-100'}`}
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>{meta.icon}</div>
                  <div className="text-xs font-semibold tracking-[0.14em]">{count}</div>
                </div>
                <div className="text-sm font-semibold uppercase tracking-[0.16em]">{meta.title}</div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]">{meta.subtitle}</div>
                <div className="mt-4 text-lg font-bold text-[color:var(--text-primary)]">
                  {count > 0 ? fmtMoney(totals[bucketId]) : '—'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active queue */}
      <div ref={listRef} className="panel-card overflow-hidden rounded-[2rem]">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <p className="section-kicker mb-1">Fila ativa</p>
            <h4 className="font-display text-4xl leading-none text-[color:var(--text-primary)]">{bucketMeta[selectedBucket].title}</h4>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-[color:var(--text-primary)]">{fmtMoney(totals[selectedBucket])}</div>
            <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">{selectedItems.length} título(s)</div>
          </div>
        </div>

        {selectedItems.length === 0 ? (
          <div className="px-6 py-16 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-faint)]">
            Nenhum título neste recorte.
          </div>
        ) : (
          <div>
            {selectedItems.map((installment, idx) => {
              const late         = installment.due_date < today;
              const isToday      = installment.due_date === today;
              const debtorName   = installment.investment?.payer?.full_name || installment.investment?.payer_name || 'Cliente';
              const investorName = installment.investment?.investor?.full_name || installment.investment?.investor_name || null;
              const contractName = installment.investment?.asset_name || (installment as any).contract_name || 'Contrato';
              const owed         = calcOutstanding(installment);
              const totalInstallments = installment.investment?.total_installments ?? null;
              const initials     = debtorName.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase();
              const photoUrl     = installment.investment?.payer?.photo_url;

              // Month abbreviations in PT-BR
              const monthNames = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
              const [year, month, day] = installment.due_date.split('-');
              const monthAbbr = monthNames[parseInt(month) - 1];

              return (
                <div key={installment.id}>
                  {idx > 0 && (
                    <div className="mx-5 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
                  )}
                  <button
                  onClick={() => setSelectedInstallment(installment)}
                  className="group w-full flex items-center gap-0 text-left transition-all duration-200 hover:bg-white/[0.03] active:bg-white/[0.05] cursor-pointer"
                >
                  {/* Left accent bar */}
                  <div className={`self-stretch w-0.5 shrink-0 transition-all duration-200 ${
                    late
                      ? 'bg-[color:var(--accent-danger)] opacity-60 group-hover:opacity-100'
                      : isToday
                        ? 'bg-[color:var(--accent-warning)] opacity-50 group-hover:opacity-90'
                        : 'bg-white/10 group-hover:bg-white/20'
                  }`} />

                  <div className="flex flex-1 items-center gap-4 px-5 py-4 min-w-0">
                    {/* Avatar foto ou iniciais */}
                    <div className={`relative h-11 w-11 shrink-0 rounded-2xl overflow-hidden transition-transform duration-200 group-hover:scale-105 ${
                      !photoUrl ? (late
                        ? 'bg-[rgba(198,126,105,0.15)] border border-[rgba(198,126,105,0.25)]'
                        : 'bg-white/[0.06] border border-white/10') : ''
                    }`}>
                      {photoUrl ? (
                        <img
                          src={photoUrl}
                          alt={debtorName}
                          className="h-full w-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className={`flex h-full w-full items-center justify-center text-xs font-black tracking-wide ${
                          late ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-secondary)]'
                        }`}>
                          {initials}
                        </div>
                      )}
                    </div>

                    {/* Info central */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {installmentStatusBadge(installment.status)}
                        <span className="text-[9px] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">
                          Parcela {installment.number}{totalInstallments ? `/${totalInstallments}` : ''}
                        </span>
                      </div>
                      <p className="text-[15px] font-extrabold text-[color:var(--text-primary)] truncate leading-tight group-hover:text-white transition-colors duration-150">
                        {debtorName}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)] truncate">{contractName}</p>
                        {investorName && (
                          <>
                            <span className="text-[color:var(--text-faint)] opacity-40">·</span>
                            <span className="flex items-center gap-1 text-[10px] text-[color:var(--text-faint)] opacity-70 shrink-0">
                              <TrendingUp size={9} />
                              {investorName}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Data + valor + chevron */}
                    <div className="flex items-center gap-4 shrink-0">
                      {/* Date badge */}
                      <div className={`flex flex-col items-center justify-center rounded-xl border px-2.5 py-1.5 text-center min-w-[44px] transition-all duration-200 ${
                        late
                          ? 'border-[rgba(198,126,105,0.30)] bg-[rgba(198,126,105,0.08)] text-[color:var(--accent-danger)]'
                          : isToday
                            ? 'border-[rgba(200,154,85,0.30)] bg-[rgba(200,154,85,0.08)] text-[color:var(--accent-warning)]'
                            : 'border-white/10 bg-white/[0.03] text-[color:var(--text-secondary)]'
                      }`}>
                        <span className="text-[15px] font-black leading-none tabular-nums">{day}</span>
                        <span className="text-[8px] font-bold uppercase tracking-[0.16em] mt-0.5 opacity-80">{monthAbbr}</span>
                      </div>

                      {/* Amount */}
                      <div className="text-right">
                        <p className={`text-sm font-extrabold tabular-nums tracking-tight ${
                          late ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-primary)]'
                        }`}>
                          {fmtMoney(owed)}
                        </p>
                        <p className={`text-[9px] font-semibold uppercase tracking-[0.16em] mt-0.5 ${
                          late ? 'text-[color:var(--accent-danger)] opacity-70' : 'text-[color:var(--text-faint)]'
                        }`}>
                          {late ? 'Atrasado' : isToday ? 'Hoje' : 'Em aberto'}
                        </p>
                      </div>

                      <ChevronRight size={14} className="text-[color:var(--text-faint)] transition-transform duration-200 group-hover:translate-x-0.5" />
                    </div>
                  </div>
                </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
