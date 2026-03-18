import React, { useMemo, useState } from 'react';
import { Tenant, LoanInstallment } from '../types';
import { useDashboardData } from '../hooks/useDashboardData';
import {
  InstallmentAction,
  InstallmentDetailScreen,
  InstallmentFormScreen,
  calcOutstanding,
  fmtDate,
  fmtMoney,
} from './InstallmentDetailFlow';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Calendar,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  User,
} from 'lucide-react';

interface DailyCollectionViewProps {
  tenant: Tenant | null | undefined;
  onBack?: () => void;
}

const DailyCollectionView: React.FC<DailyCollectionViewProps> = ({ tenant, onBack }) => {
  const { installments, loading, error, refetch } = useDashboardData(tenant?.id);
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);
  const [search, setSearch] = useState('');

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const overdueItems = useMemo(
    () => installments.filter(i => i.due_date < today && i.status !== 'paid'),
    [installments, today],
  );

  const todayItems = useMemo(
    () => installments.filter(i => i.due_date === today && i.status !== 'paid'),
    [installments, today],
  );

  const paidToday = useMemo(
    () => installments.filter(
      i => (i.status === 'paid' || i.status === 'partial') && i.paid_at?.startsWith(today),
    ),
    [installments, today],
  );

  const totalOverdue = useMemo(
    () => overdueItems.reduce((s, i) => s + calcOutstanding(i), 0),
    [overdueItems],
  );

  const totalToday = useMemo(
    () => todayItems.reduce((s, i) => s + calcOutstanding(i), 0),
    [todayItems],
  );

  const grandTotal = totalOverdue + totalToday;

  const todayLabel = useMemo(() => {
    const [y, m, d] = today.split('-');
    return `${d}/${m}/${y}`;
  }, [today]);

  // Somente as cobranças de HOJE, filtradas por busca
  const allPending = useMemo(() => {
    const items = [...todayItems].sort((a, b) => a.due_date.localeCompare(b.due_date));
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(i => {
      const name = (i as any).investment?.payer?.full_name || '';
      return name.toLowerCase().includes(q);
    });
  }, [todayItems, search]);

  // ── Sub-view: Form Screen ──────────────────────────────────────────────────
  if (installmentAction !== null) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        tenant={tenant ?? null}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => {
          setInstallmentAction(null);
          setSelectedInstallment(null);
          refetch();
        }}
      />
    );
  }

  // ── Sub-view: Detail Screen ────────────────────────────────────────────────
  if (selectedInstallment !== null) {
    return (
      <InstallmentDetailScreen
        installment={selectedInstallment}
        onBack={() => setSelectedInstallment(null)}
        onAction={(action) => setInstallmentAction(action)}
      />
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in min-h-screen" style={{ background: 'var(--bg-base)' }}>

      {/* ── Blue Header ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-3" style={{ background: 'var(--header-blue)' }}>
        {onBack && (
          <button onClick={onBack} className="p-1 text-white/90 hover:text-white">
            <ArrowLeft size={22} />
          </button>
        )}
        <h1 className="text-lg font-bold text-white flex-1 text-center">Cobranca Diaria</h1>
        <div className="flex items-center gap-2">
          <button className="p-1.5 text-white/80 hover:text-white"><Bot size={20} /></button>
          <button
            onClick={refetch}
            disabled={loading}
            className="p-1.5 text-white/80 hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className="p-1.5 text-white/80 hover:text-white"><SlidersHorizontal size={20} /></button>
        </div>
      </div>

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin" style={{ color: 'var(--header-blue)' }} />
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <div className="mx-4 mt-4 rounded-2xl bg-[var(--bg-elevated)] p-6 text-center shadow-sm">
          <AlertCircle size={32} className="mx-auto mb-3" style={{ color: 'var(--accent-danger)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="px-4 py-4 space-y-4">

          {/* ── Summary Card ──────────────────────────────────────────────── */}
          <div className="rounded-2xl bg-[var(--bg-elevated)] p-5 shadow-sm" style={{ border: '1px solid var(--border-subtle)' }}>
            {/* Top row */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                  Receber - Hoje {todayLabel}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Carteira</p>
                <p className="text-sm font-extrabold" style={{ color: 'var(--header-blue)' }}>{tenant?.name || 'RCRN'}</p>
              </div>
            </div>

            {/* Total amount */}
            <p className="text-3xl font-black tabular-nums mb-3" style={{ color: 'var(--accent-positive)' }}>
              {fmtMoney(grandTotal)}
            </p>

            {/* Outros vencimentos button */}
            <button className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors hover:opacity-80 mb-4"
              style={{ borderColor: 'var(--header-blue)', color: 'var(--header-blue)' }}
            >
              <Calendar size={16} />
              Outros vencimentos
            </button>

            {/* Stat boxes */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'rgba(33, 150, 243, 0.08)' }}>
                <Calendar size={22} style={{ color: 'var(--header-blue)' }} />
                <div>
                  <p className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{todayItems.length}</p>
                  <p className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>Recebimento Hoje</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'rgba(244, 67, 54, 0.08)' }}>
                <AlertCircle size={22} style={{ color: 'var(--accent-danger)' }} />
                <div>
                  <p className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{overdueItems.length}</p>
                  <p className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>Recebimentos em Atraso</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Search Bar ────────────────────────────────────────────────── */}
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-xl py-3 pl-4 pr-20 text-sm outline-none transition-shadow focus:ring-2"
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <Search size={18} style={{ color: 'var(--text-muted)' }} />
              <Calendar size={18} style={{ color: 'var(--text-muted)' }} />
            </div>
          </div>

          {/* ── Client List ───────────────────────────────────────────────── */}
          {allPending.length === 0 && paidToday.length === 0 && (
            <div className="rounded-2xl bg-[var(--bg-elevated)] p-10 text-center shadow-sm">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Nenhuma cobranca pendente para hoje.</p>
            </div>
          )}

          <div className="space-y-3">
            {allPending.map(inst => (
              <ClientCard
                key={inst.id}
                inst={inst}
                onClick={() => setSelectedInstallment(inst)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Client Card (BossCash style) ──────────────────────────────────────────────
const ClientCard: React.FC<{
  inst: LoanInstallment;
  onClick: () => void;
}> = ({ inst, onClick }) => {
  const debtorName = (inst as any).investment?.payer?.full_name || (inst as any).payer_name || 'Cliente';
  const contractId = (inst as any).investment?.id
    ? `#CT${String((inst as any).investment.id).slice(-8)}`
    : '';
  const photoUrl = (inst as any).investment?.payer?.photo_url;
  const initials = debtorName.split(' ').slice(0, 2).map((n: string) => n[0] || '').join('').toUpperCase();
  const outstanding = calcOutstanding(inst);

  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
      style={{
        background: 'var(--bg-elevated)',
        border: '1.5px solid #26a69a',
      }}
    >
      {/* Avatar */}
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-200 overflow-hidden">
        {photoUrl ? (
          <img src={photoUrl} alt={debtorName} className="h-full w-full object-cover" />
        ) : (
          <User size={24} className="text-gray-400" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>{debtorName}</p>
        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          Contrato: {contractId}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Parcela: {inst.number}   Venc.: {fmtDate(inst.due_date)}
        </p>
      </div>

      {/* Amount badge + chevron */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="rounded-lg px-3 py-1.5 text-sm font-bold text-white tabular-nums" style={{ background: '#4CAF50' }}>
          {fmtMoney(outstanding)}
        </span>
        <ChevronRight size={18} style={{ color: 'var(--text-faint)' }} />
      </div>
    </button>
  );
};

export default DailyCollectionView;
