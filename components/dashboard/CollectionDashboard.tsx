import React, { useMemo, useState } from 'react';
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
  ChevronRight,
  Clock3,
  Phone,
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
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);

  const today = new Date().toISOString().split('T')[0];
  const d3    = addDays(today, 3);
  const d7    = addDays(today, 7);
  const d15   = addDays(today, 15);
  const d30   = addDays(today, 30);

  const pendingInstallments = useMemo(
    () => installments.filter((i) => i.status !== 'paid'),
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
                onClick={() => setSelectedBucket(bucketId)}
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
      <div className="panel-card overflow-hidden rounded-[2rem]">
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
          <div className="divide-y divide-white/5">
            {selectedItems.map((installment) => {
              const late         = installment.due_date < today;
              const debtorName   = installment.investment?.payer?.full_name || installment.investment?.payer_name || 'Cliente';
              const contractName = installment.investment?.asset_name || (installment as any).contract_name || 'Contrato';
              const owed         = calcOutstanding(installment);

              return (
                <button
                  key={installment.id}
                  onClick={() => setSelectedInstallment(installment)}
                  className="w-full flex items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-white/[0.025] active:bg-white/[0.04]"
                >
                  {/* Date badge */}
                  <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border ${
                    late
                      ? 'border-[rgba(198,126,105,0.25)] bg-[rgba(198,126,105,0.10)] text-[color:var(--accent-danger)]'
                      : 'border-white/10 bg-white/[0.04] text-[color:var(--text-secondary)]'
                  }`}>
                    <span className="text-lg font-black leading-none">{installment.due_date.split('-')[2]}</span>
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-faint)] mt-0.5">
                      {installment.due_date.split('-')[1]}/{installment.due_date.split('-')[0].slice(2)}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {installmentStatusBadge(installment.status)}
                      <span className="text-[10px] uppercase tracking-widest text-[color:var(--text-faint)]">
                        Parcela {installment.number}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-[color:var(--text-primary)] truncate leading-snug">{debtorName}</p>
                    <p className="text-[11px] uppercase tracking-[0.13em] text-[color:var(--text-faint)] truncate mt-0.5">{contractName}</p>
                  </div>

                  {/* Amount + chevron */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className={`text-sm font-extrabold tabular-nums ${late ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-primary)]'}`}>
                        {fmtMoney(owed)}
                      </p>
                      <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] mt-0.5 ${late ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-faint)]'}`}>
                        {late ? 'Atrasado' : 'Em aberto'}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-[color:var(--text-faint)]" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
