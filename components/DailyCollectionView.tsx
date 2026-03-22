import React, { useMemo, useState } from 'react';
import { Tenant, LoanInstallment } from '../types';
import { useDashboardData } from '../hooks/useDashboardData';
import { useCompanyContext } from '../services/companyScope';
import {
  InstallmentAction,
  InstallmentDetailScreen,
  InstallmentFormScreen,
  calcOutstanding,
  fmtDate,
  fmtMoney,
  getInstallmentModInfo,
  ModBadge,
} from './InstallmentDetailFlow';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  User,
} from 'lucide-react';

interface DailyCollectionViewProps {
  tenant: Tenant | null | undefined;
  onBack?: () => void;
}

const DailyCollectionView: React.FC<DailyCollectionViewProps> = ({ tenant, onBack }) => {
  const { activeCompanyId } = useCompanyContext();
  const { installments, loading, error, refetch } = useDashboardData(tenant?.id, activeCompanyId);
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);
  const [search, setSearch] = useState('');
  const [showOtherDues, setShowOtherDues] = useState(false);
  const [showPaidToday, setShowPaidToday] = useState(false);
  const [showOverdue, setShowOverdue] = useState(false);

  const today = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const overdueItems = useMemo(
    () => installments.filter(i => i.due_date < today && i.status !== 'paid'),
    [installments, today],
  );

  const todayItems = useMemo(
    () => installments.filter(i => i.due_date === today && i.status !== 'paid'),
    [installments, today],
  );

  const paidToday = useMemo(
    () => installments.filter(i => {
      if (i.status !== 'paid' && i.status !== 'partial') return false;
      if (Number(i.amount_paid) === 0) return false;  // Exclui parcelas absorvidas
      if (!i.paid_at) return false;
      const p = new Date(i.paid_at);
      const paidYMD = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
      return paidYMD === today;
    }),
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

  const totalPaidToday = useMemo(
    () => paidToday.reduce((s, i) => s + (Number(i.amount_paid) || 0), 0),
    [paidToday],
  );

  const grandTotal = totalToday;

  const addDays = (base: string, days: number) => {
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  };

  const d3 = useMemo(() => addDays(today, 3), [today]);
  const d7 = useMemo(() => addDays(today, 7), [today]);
  const d15 = useMemo(() => addDays(today, 15), [today]);
  const d30 = useMemo(() => addDays(today, 30), [today]);

  const futureBuckets = useMemo(() => {
    const pending = installments.filter(i => i.status !== 'paid');
    return {
      '3d':  pending.filter(i => i.due_date > today && i.due_date <= d3),
      '7d':  pending.filter(i => i.due_date > d3 && i.due_date <= d7),
      '15d': pending.filter(i => i.due_date > d7 && i.due_date <= d15),
      '30d': pending.filter(i => i.due_date > d15 && i.due_date <= d30),
    };
  }, [installments, today, d3, d7, d15, d30]);

  const bucketConfig = [
    { key: '3d' as const, label: '3 dias', color: 'var(--accent-brass, #CAB07A)' },
    { key: '7d' as const, label: '7 dias', color: 'var(--accent-steel, #90A0BD)' },
    { key: '15d' as const, label: '15 dias', color: 'var(--accent-positive, #4CAF50)' },
    { key: '30d' as const, label: '30 dias', color: 'var(--text-secondary)' },
  ];

  const todayLabel = useMemo(() => {
    const [y, m, d] = today.split('-');
    return `${d}/${m}/${y}`;
  }, [today]);

  // Cobranças de HOJE filtradas por busca
  const filteredToday = useMemo(() => {
    const items = [...todayItems].sort((a, b) => a.number - b.number);
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(i => {
      const name = (i as any).investment?.payer?.full_name || '';
      return name.toLowerCase().includes(q);
    });
  }, [todayItems, search]);

  // Atrasados filtrados por busca
  const filteredOverdue = useMemo(() => {
    const items = [...overdueItems].sort(
      (a, b) => a.due_date.localeCompare(b.due_date) || a.number - b.number,
    );
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(i => {
      const name = (i as any).investment?.payer?.full_name || '';
      return name.toLowerCase().includes(q);
    });
  }, [overdueItems, search]);

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

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-base)]">
        {onBack ? (
          <button onClick={onBack} className="p-1.5 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors">
            <ArrowLeft size={20} />
          </button>
        ) : <div className="w-8" />}
        <div className="flex-1 text-center">
          <p className="section-kicker">Agenda</p>
          <h1 className="type-subheading uppercase text-[color:var(--text-primary)]">Cobrança Diária</h1>
        </div>
        <button
          onClick={refetch}
          disabled={loading}
          className="p-1.5 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-[color:var(--accent-brass)]" />
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
          <div className="panel-card rounded-[2rem] p-5">
            {/* Top row */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="section-kicker mb-1">Receber hoje</p>
                <p className="text-base font-bold text-[color:var(--text-primary)]">{todayLabel}</p>
              </div>
              <div className="text-right">
                <p className="section-kicker mb-1">Carteira</p>
                <p className="text-sm font-semibold text-[color:var(--accent-brass)]">{tenant?.name || 'RCRN'}</p>
              </div>
            </div>

            {/* Total amount */}
            <p className="type-metric-xl mb-3 text-[color:var(--accent-positive)]">
              {fmtMoney(grandTotal)}
            </p>

            {/* Outros vencimentos button */}
            <button
              onClick={() => setShowOtherDues(v => !v)}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all hover:opacity-80 mb-4 ring-1 ring-[color:var(--accent-brass-border)] text-[color:var(--accent-brass)] bg-[color:var(--accent-brass-subtle)]"
            >
              <Calendar size={16} />
              Outros vencimentos
              <ChevronDown size={14} className={`transition-transform duration-200 ${showOtherDues ? 'rotate-180' : ''}`} />
            </button>

            {/* Stat boxes */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 rounded-xl p-3 bg-[color:var(--bg-soft)]">
                <Calendar size={22} className="text-[color:var(--accent-brass)]" />
                <div>
                  <p className="type-heading text-[color:var(--text-primary)]">{todayItems.length}</p>
                  <p className="text-[11px] font-medium text-[color:var(--text-secondary)]">Recebimento Hoje</p>
                </div>
              </div>
              <button
                onClick={() => setShowOverdue(v => !v)}
                className="flex items-center gap-3 rounded-xl p-3 text-left transition-all hover:opacity-80"
                style={{ background: showOverdue ? 'rgba(244, 67, 54, 0.16)' : 'rgba(244, 67, 54, 0.08)', border: showOverdue ? '1px solid rgba(244, 67, 54, 0.3)' : '1px solid transparent' }}
              >
                <AlertCircle size={22} className="text-[color:var(--accent-danger)]" />
                <div>
                  <p className="type-heading text-[color:var(--text-primary)]">{overdueItems.length}</p>
                  <p className="text-[11px] font-medium text-[color:var(--text-secondary)]">Recebimentos em Atraso</p>
                </div>
              </button>
            </div>
          </div>

          {/* ── Outros Vencimentos (future buckets) ─────────────────────── */}
          {showOtherDues && (
            <div className="space-y-3 animate-fade-in">
              {bucketConfig.map(({ key, label, color }) => {
                const items = futureBuckets[key];
                const total = items.reduce((s, i) => s + calcOutstanding(i), 0);
                return (
                  <div key={key} className="rounded-2xl bg-[var(--bg-elevated)] shadow-sm overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <CalendarDays size={18} style={{ color }} />
                        <div>
                          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Próximos {label}</p>
                          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{items.length} parcela{items.length !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <p className="type-metric-sm" style={{ color }}>
                        {items.length > 0 ? fmtMoney(total) : '—'}
                      </p>
                    </div>
                    {items.length > 0 && (
                      <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        {items
                          .slice()
                          .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.number - b.number)
                          .map(inst => (
                            <ClientCard key={inst.id} inst={inst} onClick={() => setSelectedInstallment(inst)} />
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

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

          {/* ── Seção Atrasados (colapsável) ──────────────────────────── */}
          {showOverdue && filteredOverdue.length > 0 && (
            <div className="rounded-2xl bg-[var(--bg-elevated)] overflow-hidden shadow-sm animate-fade-in" style={{ border: '1px solid rgba(244, 67, 54, 0.25)' }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ background: 'rgba(244, 67, 54, 0.06)' }}>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(244, 67, 54, 0.12)' }}>
                    <AlertCircle size={20} style={{ color: 'var(--accent-danger, #f44336)' }} />
                  </div>
                  <div>
                    <p className="type-label" style={{ color: 'var(--accent-danger, #f44336)' }}>Em Atraso</p>
                    <p className="type-metric-md" style={{ color: 'var(--text-primary)' }}>{fmtMoney(totalOverdue)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="type-metric-md" style={{ color: 'var(--text-secondary)' }}>{filteredOverdue.length}</p>
                  <p className="type-micro" style={{ color: 'var(--text-muted)' }}>parcela{filteredOverdue.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="border-t divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {filteredOverdue.map(inst => (
                  <ClientCard
                    key={inst.id}
                    inst={inst}
                    isOverdue
                    onClick={() => setSelectedInstallment(inst)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Client List (apenas hoje) ──────────────────────────────── */}
          {filteredToday.length === 0 && paidToday.length === 0 && !showOverdue && (
            <div className="rounded-2xl bg-[var(--bg-elevated)] p-10 text-center shadow-sm">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Nenhuma cobranca pendente para hoje.</p>
            </div>
          )}

          {filteredToday.length > 0 && (
            <div className="space-y-3">
              {filteredToday.map(inst => (
                <ClientCard
                  key={inst.id}
                  inst={inst}
                  onClick={() => setSelectedInstallment(inst)}
                />
              ))}
            </div>
          )}

          {/* ── Recebidos Hoje ────────────────────────────────────────────── */}
          {paidToday.length > 0 && (
            <div className="rounded-2xl bg-[var(--bg-elevated)] overflow-hidden shadow-sm" style={{ border: '1px solid var(--border-subtle)' }}>
              <button
                onClick={() => setShowPaidToday(v => !v)}
                className="w-full flex items-center justify-between px-4 py-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(76, 175, 80, 0.12)' }}>
                    <CheckCircle2 size={20} style={{ color: 'var(--accent-positive, #4CAF50)' }} />
                  </div>
                  <div className="text-left">
                    <p className="type-label" style={{ color: 'var(--accent-positive, #4CAF50)' }}>Recebidos Hoje</p>
                    <p className="type-metric-lg" style={{ color: 'var(--text-primary)' }}>{fmtMoney(totalPaidToday)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="type-metric-md" style={{ color: 'var(--text-secondary)' }}>{paidToday.length}</p>
                    <p className="type-micro" style={{ color: 'var(--text-muted)' }}>parcela{paidToday.length !== 1 ? 's' : ''}</p>
                  </div>
                  <ChevronDown size={16} className={`transition-transform duration-200 ${showPaidToday ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }} />
                </div>
              </button>

              {showPaidToday && (
                <div className="border-t divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {paidToday.map(inst => {
                    const name = (inst as any).investment?.payer?.full_name || (inst as any).payer_name || 'Cliente';
                    const contractName = (inst as any).investment?.asset_name || (inst as any).contract_name || 'Contrato';
                    const initials = name.split(' ').slice(0, 2).map((n: string) => n[0] || '').join('').toUpperCase();
                    return (
                      <button
                        key={inst.id}
                        onClick={() => setSelectedInstallment(inst)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-80 transition-opacity"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold" style={{ background: 'rgba(76, 175, 80, 0.12)', color: 'var(--accent-positive, #4CAF50)', border: '1px solid rgba(76, 175, 80, 0.2)' }}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>{name}</p>
                          <p className="type-caption uppercase truncate" style={{ color: 'var(--text-muted)' }}>{contractName} · Parcela #{inst.number}</p>
                        </div>
                        <p className="type-metric-sm shrink-0" style={{ color: 'var(--accent-positive, #4CAF50)' }}>
                          {fmtMoney(Number(inst.amount_paid) || 0)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Client Card (BossCash style) ──────────────────────────────────────────────
const ClientCard: React.FC<{
  inst: LoanInstallment;
  isOverdue?: boolean;
  onClick: () => void;
}> = ({ inst, isOverdue = false, onClick }) => {
  const debtorName = (inst as any).investment?.payer?.full_name || (inst as any).payer_name || 'Cliente';
  const contractId = (inst as any).investment?.id
    ? `#CT${String((inst as any).investment.id).slice(-8)}`
    : '';
  const photoUrl = (inst as any).investment?.payer?.photo_url;
  const initials = debtorName.split(' ').slice(0, 2).map((n: string) => n[0] || '').join('').toUpperCase();
  const outstanding = calcOutstanding(inst);
  const isPartial = inst.status === 'partial';
  const modInfo = getInstallmentModInfo(inst);
  const isAnomaly = modInfo?.type === 'surplus_zeroed';

  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
      style={{
        background: 'var(--bg-elevated)',
        border: isAnomaly ? '1.5px solid #EF5350'
              : isPartial ? '1.5px solid #42A5F5'
              : isOverdue ? '1.5px solid var(--accent-danger, #f44336)'
              : '1.5px solid #26a69a',
      }}
    >
      {/* Avatar */}
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full overflow-hidden"
        style={{ background: isAnomaly ? 'rgba(244, 67, 54, 0.1)' : isPartial ? 'rgba(66, 165, 245, 0.1)' : isOverdue ? 'rgba(244, 67, 54, 0.1)' : 'rgba(38, 166, 154, 0.1)' }}>
        {photoUrl ? (
          <img src={photoUrl} alt={debtorName} className="h-full w-full object-cover" />
        ) : (
          <User size={24} style={{ color: isAnomaly ? '#EF5350' : isPartial ? '#42A5F5' : isOverdue ? 'var(--accent-danger, #f44336)' : '#26a69a' }} />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {modInfo && <ModBadge info={modInfo} />}
          {!modInfo && isOverdue && !isPartial && (
            <span className="type-micro px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(244, 67, 54, 0.12)', color: 'var(--accent-danger, #f44336)' }}>
              Atrasado
            </span>
          )}
          {!modInfo && isPartial && (
            <span className="type-micro px-1.5 py-0.5 rounded-md"
              style={{ background: 'rgba(66, 165, 245, 0.12)', color: '#42A5F5' }}>
              Parcial
            </span>
          )}
        </div>
        <p className="text-[15px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>{debtorName}</p>
        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          Contrato: {contractId}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Parcela: {inst.number}   Venc.: {fmtDate(inst.due_date)}
        </p>
        {isPartial && (
          <p className="text-xs font-semibold" style={{ color: '#42A5F5' }}>
            Recebido: {fmtMoney(Number(inst.amount_paid) || 0)}
          </p>
        )}
      </div>

      {/* Amount badge + chevron */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="rounded-lg px-3 py-1.5 text-sm font-bold text-white tabular-nums"
          style={{ background: isPartial ? '#42A5F5' : isOverdue ? 'var(--accent-danger, #f44336)' : '#4CAF50' }}>
          {fmtMoney(outstanding)}
        </span>
        <ChevronRight size={18} style={{ color: 'var(--text-faint)' }} />
      </div>
    </button>
  );
};

export default DailyCollectionView;
