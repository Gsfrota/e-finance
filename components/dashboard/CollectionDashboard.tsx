import React, { useMemo, useState } from 'react';
import { LoanInstallment, Tenant } from '../../types';
import { PaymentModal } from '../InstallmentModals';
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  DollarSign,
  Phone,
} from 'lucide-react';

interface CollectionDashboardProps {
  installments: LoanInstallment[];
  onUpdate?: () => void;
  tenant?: Tenant | null;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const addDays = (base: string, days: number) => {
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};

const formatDate = (ymd: string) => {
  const [year, month, day] = ymd.split('-');
  return `${day}/${month}/${year}`;
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
  const [selectedBucket, setSelectedBucket] = useState<BucketId>('today');
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const d3 = addDays(today, 3);
  const d7 = addDays(today, 7);
  const d15 = addDays(today, 15);
  const d30 = addDays(today, 30);

  const pendingInstallments = useMemo(
    () => installments.filter((installment) => installment.status !== 'paid'),
    [installments],
  );

  const outstanding = (installment: LoanInstallment) =>
    Math.max(0, Number(installment.amount_total) - Number(installment.amount_paid || 0));

  const bucketItems = useMemo(
    () => ({
      overdue: pendingInstallments.filter((installment) => installment.due_date < today),
      today: pendingInstallments.filter((installment) => installment.due_date === today),
      '3d': pendingInstallments.filter((installment) => installment.due_date > today && installment.due_date <= d3),
      '7d': pendingInstallments.filter((installment) => installment.due_date > d3 && installment.due_date <= d7),
      '15d': pendingInstallments.filter((installment) => installment.due_date > d7 && installment.due_date <= d15),
      '30d': pendingInstallments.filter((installment) => installment.due_date > d15 && installment.due_date <= d30),
    }),
    [pendingInstallments, today, d3, d7, d15, d30],
  );

  const totals = useMemo(
    () => Object.fromEntries(
      Object.entries(bucketItems).map(([key, items]) => [key, items.reduce((sum, installment) => sum + outstanding(installment), 0)]),
    ) as Record<BucketId, number>,
    [bucketItems],
  );

  const selectedItems = bucketItems[selectedBucket]
    .slice()
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.number - b.number);

  return (
    <>
      <div className="space-y-5">
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
                <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">{formatDate(today)}</div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-6">
            {(Object.keys(bucketMeta) as BucketId[]).map((bucketId) => {
              const meta = bucketMeta[bucketId];
              const isActive = selectedBucket === bucketId;
              const count = bucketItems[bucketId].length;

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
                  <div className="mt-4 text-lg font-bold text-[color:var(--text-primary)]">{count > 0 ? formatCurrency(totals[bucketId]) : '—'}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel-card overflow-hidden rounded-[2rem]">
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
            <div>
              <p className="section-kicker mb-1">Fila ativa</p>
              <h4 className="font-display text-4xl leading-none text-[color:var(--text-primary)]">{bucketMeta[selectedBucket].title}</h4>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-[color:var(--text-primary)]">{formatCurrency(totals[selectedBucket])}</div>
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
                const late = installment.due_date < today && installment.status !== 'paid';
                const debtorName = installment.investment?.payer?.full_name || installment.investment?.payer_name || 'Cliente';
                const currentOutstanding = outstanding(installment);

                return (
                  <div key={installment.id} className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`flex h-14 w-14 flex-col items-center justify-center rounded-[1.2rem] border ${late ? 'border-[rgba(198,126,105,0.2)] bg-[rgba(198,126,105,0.08)] text-[color:var(--accent-danger)]' : 'border-white/10 bg-white/[0.03] text-[color:var(--text-primary)]'}`}>
                        <span className="text-sm font-bold leading-none">{installment.due_date.split('-')[2]}</span>
                        <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-faint)]">{installment.due_date.split('-')[1]}/{installment.due_date.split('-')[0].slice(2)}</span>
                      </div>

                      <div>
                        <div className="text-base font-semibold text-[color:var(--text-primary)]">{debtorName}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--text-faint)]">
                          {installment.investment?.asset_name || installment.contract_name || 'Contrato'} · Parcela {installment.number}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 lg:min-w-[18rem] lg:justify-end">
                      <div className="text-right">
                        <div className="text-sm font-semibold text-[color:var(--text-primary)]">{formatCurrency(currentOutstanding)}</div>
                        <div className={`mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${late ? 'text-[color:var(--accent-danger)]' : 'text-[color:var(--text-faint)]'}`}>
                          {late ? 'Atrasado' : 'Em cobrança'}
                        </div>
                      </div>

                      <button
                        onClick={() => setSelectedInstallment(installment)}
                        className="inline-flex items-center gap-2 rounded-full bg-[color:var(--accent-brass)] px-4 py-2.5 text-xs font-extrabold uppercase tracking-[0.16em] text-[#17120b] transition-colors hover:bg-[color:var(--accent-brass-strong)]"
                      >
                        <DollarSign size={14} />
                        Dar baixa
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <PaymentModal
        isOpen={!!selectedInstallment}
        onClose={() => setSelectedInstallment(null)}
        onSuccess={() => {
          setSelectedInstallment(null);
          onUpdate?.();
        }}
        installment={selectedInstallment}
        tenant={tenant}
      />
    </>
  );
};
