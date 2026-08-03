import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tenant, LoanInstallment } from '../types';
import { useDashboardData } from '../hooks/useDashboardData';
import { useCompanyContext } from '../services/companyScope';
import { getBrazilToday, isoToBrazilYMD, addDaysBR } from '../services/dateUtils';
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
  Clock,
  Loader2,
  Lock,
  PieChart,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';

interface DailyCollectionViewProps {
  tenant: Tenant | null | undefined;
  onBack?: () => void;
}

type CollectionFilter = 'all' | 'today' | 'overdue' | 'paid' | 'partial';
const COLLECTION_RENDER_BATCH = 75;

// ── Design tokens (escopo local — financial mobile palette) ─────────────────
const T = {
  bg:            '#EAF1FA',
  surface:       '#FFFFFF',
  surfaceSoft:   '#F5F8FC',
  textPrimary:   '#0F1E33',
  textSecondary: '#5D6B82',
  textMuted:     '#98A3B3',
  border:        '#D7E0EC',
  shadow:        '0 8px 20px rgba(15, 30, 51, 0.08)',
  navy:          '#0E1F35',
  red:           '#EF2D2D', redSoft:    '#FDEAEA', redBorder: '#F6B6B6',
  orange:        '#E68600', orangeSoft: '#FFF3DE',
  green:         '#009B63', greenSoft:  '#E5F8F0',
  blue:          '#2563EB', blueSoft:   '#EAF1FF',
};

const DailyCollectionView: React.FC<DailyCollectionViewProps> = ({ tenant, onBack }) => {
  const { activeCompanyId } = useCompanyContext();
  const { installments, loading, hasLoaded, error, refetch, isStale } = useDashboardData(tenant?.id, activeCompanyId);
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CollectionFilter>('all');
  const [showOtherDues, setShowOtherDues] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(COLLECTION_RENDER_BATCH);

  // ── Update otimista da baixa ────────────────────────────────────────────────
  // Após "dar baixa", o refetch recarrega TODO o dataset (todos os investimentos
  // + parcelas, paginado) — leva segundos, e o stale-while-revalidate mantém a
  // lista antiga visível. Para o cliente sumir da lista imediatamente, aplicamos
  // um override local da parcela quitada e o descartamos assim que o dado fresco
  // confirma a quitação (ou a parcela some da lista).
  const [optimisticPaid, setOptimisticPaid] = useState<Map<string, Partial<LoanInstallment>>>(() => new Map());

  const effectiveInstallments = useMemo(() => {
    if (optimisticPaid.size === 0) return installments;
    return installments.map(i => {
      const patch = optimisticPaid.get(i.id);
      return patch ? { ...i, ...patch } : i;
    });
  }, [installments, optimisticPaid]);

  useEffect(() => {
    if (optimisticPaid.size === 0) return;
    setOptimisticPaid(prev => {
      const next = new Map(prev);
      let changed = false;
      for (const id of prev.keys()) {
        const fresh = installments.find(i => i.id === id);
        // Dado fresco já reflete a quitação (ou parcela saiu da lista) → remove override
        if (!fresh || fresh.status === 'paid' || (fresh.status === 'partial' && Number(fresh.amount_paid) > 0)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [installments]);

  const today = useMemo(() => getBrazilToday(), []);

  const overdueItems = useMemo(
    () => effectiveInstallments.filter(i => i.due_date < today && i.status !== 'paid'),
    [effectiveInstallments, today],
  );

  const todayItems = useMemo(
    () => effectiveInstallments.filter(i => i.due_date === today && i.status !== 'paid'),
    [effectiveInstallments, today],
  );

  const paidToday = useMemo(
    () => effectiveInstallments.filter(i => {
      if (i.status !== 'paid' && i.status !== 'partial') return false;
      if (Number(i.amount_paid) === 0) return false;
      if (!i.paid_at) return false;
      return isoToBrazilYMD(i.paid_at) === today;
    }),
    [effectiveInstallments, today],
  );

  const partialItems = useMemo(
    () => effectiveInstallments.filter(i => i.status === 'partial' && Number(i.amount_paid) > 0),
    [effectiveInstallments],
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

  const grandTotalDay = totalOverdue + totalToday + totalPaidToday;

  const d3 = useMemo(() => addDaysBR(today, 3), [today]);
  const d7 = useMemo(() => addDaysBR(today, 7), [today]);
  const d15 = useMemo(() => addDaysBR(today, 15), [today]);
  const d30 = useMemo(() => addDaysBR(today, 30), [today]);

  const futureBuckets = useMemo(() => {
    const pending = effectiveInstallments.filter(i => i.status !== 'paid');
    return {
      '3d':  pending.filter(i => i.due_date > today && i.due_date <= d3),
      '7d':  pending.filter(i => i.due_date > d3 && i.due_date <= d7),
      '15d': pending.filter(i => i.due_date > d7 && i.due_date <= d15),
      '30d': pending.filter(i => i.due_date > d15 && i.due_date <= d30),
    };
  }, [effectiveInstallments, today, d3, d7, d15, d30]);

  const totalFuture = useMemo(() => {
    const all: LoanInstallment[] = [
      ...futureBuckets['3d'],
      ...futureBuckets['7d'],
      ...futureBuckets['15d'],
      ...futureBuckets['30d'],
    ];
    return all.reduce((s, i) => s + calcOutstanding(i), 0);
  }, [futureBuckets]);

  const bucketConfig = [
    { key: '3d'  as const, label: 'Próximos 3 dias' },
    { key: '7d'  as const, label: 'Próximos 7 dias' },
    { key: '15d' as const, label: 'Próximos 15 dias' },
    { key: '30d' as const, label: 'Próximos 30 dias' },
  ];

  const dateLabel = useMemo(() => {
    const [y, m, d] = today.split('-');
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
    return `${weekday.toUpperCase()}, ${d}/${m}/${y}`;
  }, [today]);

  // Footer "Dados atualizados às HH:MM" — registra timestamp quando fetch termina
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(() => Date.now());
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      setLastFetchedAt(Date.now());
    }
    prevLoadingRef.current = loading;
  }, [loading]);
  const lastFetchedLabel = useMemo(() => {
    return new Date(lastFetchedAt).toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    });
  }, [lastFetchedAt]);

  // Lista unificada com base no filtro selecionado
  const visibleItems = useMemo(() => {
    let items: LoanInstallment[] = [];
    switch (filter) {
      case 'overdue':
        items = [...overdueItems].sort(
          (a, b) => a.due_date.localeCompare(b.due_date) || a.number - b.number,
        );
        break;
      case 'today':
        items = [...todayItems].sort((a, b) => a.number - b.number);
        break;
      case 'paid':
        items = [...paidToday].sort((a, b) =>
          (b.paid_at || '').localeCompare(a.paid_at || ''),
        );
        break;
      case 'partial':
        items = [...partialItems].sort((a, b) => a.due_date.localeCompare(b.due_date));
        break;
      case 'all':
      default: {
        const seen = new Set<string>();
        const merge = (arr: LoanInstallment[]) => {
          for (const it of arr) {
            if (!seen.has(it.id)) {
              seen.add(it.id);
              items.push(it);
            }
          }
        };
        // Ordem: atrasadas → hoje → parciais → recebidas
        merge([...overdueItems].sort((a, b) => a.due_date.localeCompare(b.due_date)));
        merge([...todayItems].sort((a, b) => a.number - b.number));
        merge([...partialItems].sort((a, b) => a.due_date.localeCompare(b.due_date)));
        merge([...paidToday].sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || '')));
        break;
      }
    }
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      const fullName = (i as any).investment?.payer?.full_name;
      const name = String(fullName ?? (i as any).payer_name ?? '');
      return name.toLowerCase().includes(q);
    });
  }, [filter, overdueItems, todayItems, paidToday, partialItems, search]);

  useEffect(() => {
    setVisibleLimit(COLLECTION_RENDER_BATCH);
  }, [activeCompanyId, filter, search]);

  const renderedItems = useMemo(
    () => visibleItems.slice(0, visibleLimit),
    [visibleItems, visibleLimit],
  );

  // ── Sub-view: Form Screen ──────────────────────────────────────────────────
  if (installmentAction !== null) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        tenant={tenant ?? null}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => {
          // A parcela já foi mutada (status='paid') pelo InstallmentFormScreen antes
          // do onSuccess. Se foi quitada, esconde-a da lista na hora (update otimista).
          const justPaid = installmentAction?.installment;
          if (justPaid && justPaid.status === 'paid') {
            setOptimisticPaid(prev => {
              const next = new Map(prev);
              next.set(justPaid.id, {
                status: 'paid',
                amount_paid: Number(justPaid.amount_paid) || 0,
                paid_at: justPaid.paid_at,
              });
              return next;
            });
          }
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

  // ── Estados de render (stale-while-revalidate) ─────────────────────────────
  // Evita o "piscar azul": durante um refetch (ex.: após registrar uma baixa)
  // mantém a lista atual visível em vez de trocá-la pelo spinner de tela cheia.
  // O spinner só aparece antes de a primeira consulta terminar.
  const showInitialLoader = loading && !hasLoaded;
  const showError = !!error && !hasLoaded;
  const showContent = !showInitialLoader && !showError;

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div data-testid="daily-collection-root" className="animate-fade-in min-h-screen pb-10"
      style={{ background: T.bg, fontFamily: "'Inter', sans-serif" }}>

      {/* ── Título da área (kicker + h1 + refresh) ───────────────────────── */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {onBack && (
              <button
                onClick={onBack}
                className="mb-2 inline-flex items-center gap-1 transition-colors"
                style={{ color: T.textMuted, fontSize: 12, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' }}
              >
                <ArrowLeft size={14} /> Voltar
              </button>
            )}
            <p
              className="mb-1.5"
              style={{ color: T.textMuted, fontSize: 12, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' }}
            >
              {dateLabel}
            </p>
            <h1
              className="leading-[1.05] tracking-tight"
              style={{ color: T.textPrimary, fontSize: 30, fontWeight: 800 }}
            >
              Cobrança diária
            </h1>
          </div>
          <button
            onClick={refetch}
            disabled={loading}
            className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:opacity-40"
            style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.textSecondary }}
            aria-label="Atualizar"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Banner persistente de atrasados ─────────────────────────────── */}
      {showContent && overdueItems.length > 0 && (
        <button
          onClick={() => setFilter('overdue')}
          className="mx-5 flex w-[calc(100%-2.5rem)] items-center justify-between transition-all hover:opacity-90 active:scale-[0.99]"
          style={{
            background: T.redSoft,
            border: `1px solid ${T.redBorder}`,
            borderRadius: 18,
            padding: '12px 16px',
          }}
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={18} style={{ color: T.red }} />
            <span style={{ color: T.red, fontSize: 15, fontWeight: 700 }}>
              {overdueItems.length} parcela{overdueItems.length !== 1 ? 's' : ''} em atraso — {fmtMoney(totalOverdue)}
            </span>
          </div>
          <ChevronRight size={18} style={{ color: T.red }} />
        </button>
      )}

      {/* ── Loading (apenas antes da primeira consulta concluída) ──────── */}
      {showInitialLoader && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin" style={{ color: T.navy }} />
        </div>
      )}

      {/* ── Error (apenas quando a primeira consulta falha) ─────────────── */}
      {showError && (
        <div className="mx-5 mt-4 p-6 text-center"
          style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, boxShadow: T.shadow }}>
          <AlertCircle size={32} className="mx-auto mb-3" style={{ color: T.red }} />
          <p style={{ color: T.textSecondary, fontSize: 14 }}>{error}</p>
        </div>
      )}

      {error && hasLoaded && (
        <div
          role="alert"
          className="mx-5 mt-3 flex items-center gap-2 px-4 py-3"
          style={{ background: T.redSoft, border: `1px solid ${T.redBorder}`, borderRadius: 16, color: T.red }}
        >
          <AlertCircle size={16} className="shrink-0" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Não foi possível atualizar agora. Os últimos dados continuam visíveis.
          </span>
        </div>
      )}

      {showContent && (
        <div className="px-5 pt-3 space-y-3">

          {/* ── 4 Stat Cards horizontais ───────────────────────────────── */}
          <div className="grid grid-cols-4 gap-1.5">
            <StatCard
              label="ATRASADAS"
              count={overdueItems.length}
              value={totalOverdue}
              tone="danger"
              onClick={() => setFilter('overdue')}
              active={filter === 'overdue'}
            />
            <StatCard
              label="HOJE"
              count={todayItems.length}
              value={totalToday}
              tone="warning"
              onClick={() => setFilter('today')}
              active={filter === 'today'}
            />
            <StatCard
              label="RECEBIDAS"
              count={paidToday.length}
              value={totalPaidToday}
              tone="positive"
              onClick={() => setFilter('paid')}
              active={filter === 'paid'}
            />
            <StatCard
              label="CARTEIRA"
              value={grandTotalDay}
              caption="Total do dia"
              tone="neutral"
            />
          </div>

          {/* ── Filter chips ───────────────────────────────────────────── */}
          <div
            className="-mx-5 px-5 overflow-x-auto"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' as any }}
          >
            <div className="flex items-center gap-1" style={{ minWidth: 'max-content' }}>
              <FilterChip label="Todas"     value="all"     filter={filter} setFilter={setFilter} />
              <FilterChip label="Hoje"      value="today"   filter={filter} setFilter={setFilter} tone="warning"  count={todayItems.length} />
              <FilterChip label="Atrasadas" value="overdue" filter={filter} setFilter={setFilter} tone="danger"   count={overdueItems.length} />
              <FilterChip label="Recebidas" value="paid"    filter={filter} setFilter={setFilter} tone="positive" count={paidToday.length} />
            </div>
          </div>

          {/* ── Search bar + ações ─────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2"
                style={{ color: T.textMuted }} />
              <input
                type="text"
                placeholder="Buscar cliente..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full outline-none transition-shadow focus:ring-2"
                style={{
                  background: T.surface,
                  color: T.textPrimary,
                  border: `1px solid ${T.border}`,
                  borderRadius: 14,
                  padding: '11px 12px 11px 38px',
                  fontSize: 14, fontWeight: 500,
                }}
              />
            </div>
            <button
              type="button"
              className="flex shrink-0 items-center justify-center transition-colors"
              style={{
                background: T.surface, border: `1px solid ${T.border}`,
                color: T.textSecondary, borderRadius: 14, height: 44, width: 44,
              }}
              aria-label="Filtrar por data"
            >
              <Calendar size={17} />
            </button>
            <button
              type="button"
              className="flex shrink-0 items-center justify-center transition-colors"
              style={{
                background: T.surface, border: `1px solid ${T.border}`,
                color: T.textSecondary, borderRadius: 14, height: 44, width: 44,
              }}
              aria-label="Mais filtros"
            >
              <SlidersHorizontal size={17} />
            </button>
          </div>

          {/* ── Outros vencimentos (barra discreta + accordion compacto) */}
          <div className="overflow-hidden"
            style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 14,
            }}>
            <button
              onClick={() => setShowOtherDues(v => !v)}
              className="flex w-full items-center justify-between transition-all hover:opacity-90"
              style={{ color: T.textSecondary, padding: '11px 14px', fontSize: 13, fontWeight: 700 }}
            >
              <span className="flex items-center gap-2 min-w-0">
                <CalendarDays size={16} style={{ color: T.textSecondary }} />
                <span>Outros vencimentos</span>
                {totalFuture > 0 && (
                  <span className="tabular-nums" style={{ color: T.textMuted, fontSize: 13, fontWeight: 600 }}>
                    · {fmtMoney(totalFuture)}
                  </span>
                )}
              </span>
              <ChevronDown
                size={16}
                className={`transition-transform duration-200 ${showOtherDues ? 'rotate-180' : ''}`}
                style={{ color: T.textMuted }}
              />
            </button>

            {showOtherDues && (
              <div className="border-t animate-fade-in" style={{ borderColor: T.border }}>
                {bucketConfig.map(({ key, label }) => {
                  const items = futureBuckets[key];
                  if (items.length === 0) return null;
                  const total = items.reduce((s, i) => s + calcOutstanding(i), 0);
                  return (
                    <BucketRow
                      key={key}
                      label={label}
                      total={total}
                      items={items.slice().sort((a, b) =>
                        a.due_date.localeCompare(b.due_date) || a.number - b.number,
                      )}
                      onSelect={inst => setSelectedInstallment(inst)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Lista unificada ─────────────────────────────────────────── */}
          {visibleItems.length === 0 ? (
            <div className="p-10 text-center"
              style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, boxShadow: T.shadow }}>
              <p style={{ color: T.textSecondary, fontSize: 14, fontWeight: 600 }}>
                {search.trim()
                  ? 'Nenhum cliente encontrado.'
                  : filter === 'all'
                    ? 'Nenhuma cobrança para hoje.'
                    : 'Nenhuma parcela neste filtro.'}
              </p>
            </div>
          ) : (
            <div data-testid="daily-collection-list" className="space-y-2.5">
              {renderedItems.map(inst => (
                <ClientCard
                  key={inst.id}
                  inst={inst}
                  onClick={() => setSelectedInstallment(inst)}
                />
              ))}
            </div>
          )}

          {visibleItems.length > 0 && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <p data-testid="daily-collection-count" style={{ color: T.textMuted, fontSize: 12, fontWeight: 600 }}>
                Exibindo {renderedItems.length} de {visibleItems.length} cobranças
              </p>
              {renderedItems.length < visibleItems.length && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit(limit => Math.min(limit + COLLECTION_RENDER_BATCH, visibleItems.length))}
                  className="transition-colors hover:opacity-80"
                  style={{
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    borderRadius: 12,
                    color: T.textSecondary,
                    fontSize: 13,
                    fontWeight: 700,
                    padding: '9px 16px',
                  }}
                >
                  Carregar mais cobranças
                </button>
              )}
            </div>
          )}

          {/* ── Footer "Dados atualizados às HH:MM" ─────────────────────── */}
          <div className="flex items-center gap-2 pt-4 pb-2">
            <Lock size={13} style={{ color: T.textMuted }} />
            <p style={{ color: T.textMuted, fontSize: 12, fontWeight: 500 }}>
              {(isStale || loading) ? 'Atualizando…' : `Dados atualizados às ${lastFetchedLabel}`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// Formata valor BRL compacto. `tight`=true comprime mais cedo (>= 1k vira "R$ 3,1k").
const compactBRL = (v: number, tight = false): string => {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  const kThreshold = tight ? 1_000 : 10_000;
  if (v >= kThreshold) {
    return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
};

// ── Stat Card (4 horizontais) ─────────────────────────────────────────────────
type StatTone = 'danger' | 'warning' | 'positive' | 'neutral';

const STAT_COLOR: Record<StatTone, string> = {
  danger:   T.red,
  warning:  T.orange,
  positive: T.green,
  neutral:  T.textSecondary,
};
const STAT_TINT: Record<StatTone, string> = {
  danger:   T.redSoft,
  warning:  T.orangeSoft,
  positive: T.greenSoft,
  neutral:  T.surfaceSoft,
};

const StatCard: React.FC<{
  label: string;
  count?: number;
  value: number;
  caption?: string;
  tone: StatTone;
  onClick?: () => void;
  active?: boolean;
}> = ({ label, count, value, caption, tone, onClick, active }) => {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={`flex flex-col items-start text-left transition-all min-w-0 ${onClick ? 'hover:shadow-md active:scale-[0.98]' : ''}`}
      style={{
        background: active ? STAT_TINT[tone] : T.surface,
        border: `1px solid ${active ? STAT_COLOR[tone] : T.border}`,
        borderRadius: 18,
        padding: '10px 7px 9px',
        boxShadow: active ? undefined : T.shadow,
      }}
    >
      <p
        className="w-full mb-1"
        style={{ color: STAT_COLOR[tone], fontSize: 9, fontWeight: 800, letterSpacing: '0px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}
      >
        {label}
      </p>
      {count !== undefined ? (
        <>
          <p className="leading-none mb-1" style={{ color: STAT_COLOR[tone], fontSize: 24, fontWeight: 800 }}>
            {count}
          </p>
          <p className="tabular-nums truncate w-full" style={{ color: STAT_COLOR[tone], fontSize: 11, fontWeight: 700 }}>
            {compactBRL(value)}
          </p>
        </>
      ) : (
        <>
          <p className="tabular-nums w-full leading-none mb-1.5"
            style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800, letterSpacing: '-0.2px' }}>
            {compactBRL(value, true)}
          </p>
          {caption && (
            <p className="truncate w-full" style={{ color: T.textMuted, fontSize: 10, fontWeight: 600 }}>{caption}</p>
          )}
        </>
      )}
    </Comp>
  );
};

// ── Filter Chip ───────────────────────────────────────────────────────────────
const FilterChip: React.FC<{
  label: string;
  value: CollectionFilter;
  filter: CollectionFilter;
  setFilter: (v: CollectionFilter) => void;
  tone?: 'danger' | 'warning' | 'positive' | 'steel';
  count?: number;
}> = ({ label, value, filter, setFilter, tone, count }) => {
  const isActive = filter === value;
  const toneColorMap: Record<NonNullable<typeof tone>, string> = {
    danger:   T.red,
    warning:  T.orange,
    positive: T.green,
    steel:    T.blue,
  };
  const inactiveColor = tone ? toneColorMap[tone] : T.textSecondary;
  return (
    <button
      onClick={() => setFilter(value)}
      className="shrink-0 inline-flex items-center gap-1 transition-all active:scale-95"
      style={{
        background: isActive ? T.navy : T.surface,
        color: isActive ? '#FFFFFF' : inactiveColor,
        border: `1px solid ${isActive ? T.navy : T.border}`,
        borderRadius: 10,
        padding: '6px 8px',
        fontSize: 12, fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      {count !== undefined && count > 0 && !isActive && (
        <span style={{ color: inactiveColor, fontSize: 11, fontWeight: 800 }}>
          · {count}
        </span>
      )}
    </button>
  );
};

// ── Client Card (border esquerda + valor à direita) ─────────────────────────
const ClientCard: React.FC<{
  inst: LoanInstallment;
  onClick: () => void;
}> = ({ inst, onClick }) => {
  const debtorName = (inst as any).investment?.payer?.full_name || (inst as any).payer_name || 'Cliente';
  const photoUrl = (inst as any).investment?.payer?.photo_url;
  const outstanding = calcOutstanding(inst);
  const amountPaid = Number(inst.amount_paid) || 0;
  const isPartial = inst.status === 'partial' && amountPaid > 0;
  const todayYMD = getBrazilToday();
  const isOverdue = inst.due_date < todayYMD && inst.status !== 'paid';
  const isToday = inst.due_date === todayYMD && inst.status !== 'paid' && !isPartial;
  const isPaidToday = (inst.status === 'paid' || (inst.status === 'partial' && amountPaid > 0))
    && inst.paid_at && isoToBrazilYMD(inst.paid_at) === todayYMD;
  const modInfo = getInstallmentModInfo(inst);
  const isAnomaly = modInfo?.type === 'surplus_zeroed';

  type Tone = 'danger' | 'warning' | 'steel' | 'positive' | 'neutral';
  const tone: Tone =
    isAnomaly || isOverdue ? 'danger'
    : isPartial            ? 'steel'
    : isPaidToday          ? 'positive'
    : isToday              ? 'warning'
    :                        'neutral';

  const colorMap: Record<Tone, string> = {
    danger:   T.red,
    warning:  T.orange,
    steel:    T.blue,
    positive: T.green,
    neutral:  T.textSecondary,
  };
  const tintMap: Record<Tone, string> = {
    danger:   T.redSoft,
    warning:  T.orangeSoft,
    steel:    T.blueSoft,
    positive: T.greenSoft,
    neutral:  T.surfaceSoft,
  };

  const StatusIcon = ({ size = 22 }: { size?: number }) => {
    if (tone === 'danger')   return <Clock size={size} style={{ color: colorMap.danger }} />;
    if (tone === 'warning')  return <Calendar size={size} style={{ color: colorMap.warning }} />;
    if (tone === 'steel')    return <PieChart size={size} style={{ color: colorMap.steel }} />;
    if (tone === 'positive') return <CheckCircle2 size={size} style={{ color: colorMap.positive }} />;
    return <Calendar size={size} style={{ color: colorMap.neutral }} />;
  };

  const statusLabel: { text: string; color: Tone } | null =
    isAnomaly || isOverdue ? { text: 'ATRASADA', color: 'danger' }
    : isPartial            ? { text: 'PARCIAL',  color: 'steel' }
    : isPaidToday          ? { text: 'RECEBIDA', color: 'positive' }
    : isToday              ? { text: 'HOJE',     color: 'warning' }
    :                        null;

  const valueColor = tone === 'neutral' ? T.textPrimary : colorMap[tone];
  const valueText = isPaidToday ? fmtMoney(amountPaid) : fmtMoney(outstanding);
  const investment = (inst as any).investment;

  return (
    <button
      data-testid="daily-collection-card"
      onClick={onClick}
      className="group w-full flex items-center gap-2 text-left transition-all hover:shadow-md active:scale-[0.99]"
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `4px solid ${colorMap[tone]}`,
        borderRadius: 18,
        padding: '11px 10px 11px 12px',
        boxShadow: T.shadow,
      }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full overflow-hidden"
        style={{ background: tintMap[tone] }}
      >
        {photoUrl ? (
          <img src={photoUrl} alt={debtorName} className="h-full w-full object-cover" />
        ) : (
          <StatusIcon size={17} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        {(modInfo || statusLabel) && (
          <div className="mb-1">
            {modInfo ? (
              <ModBadge info={modInfo} />
            ) : statusLabel ? (
              <span
                className="inline-block"
                style={{
                  background: tintMap[statusLabel.color],
                  color: colorMap[statusLabel.color],
                  fontSize: 10, fontWeight: 800,
                  letterSpacing: '0.3px', textTransform: 'uppercase',
                  padding: '1.5px 6px', borderRadius: 4,
                }}
              >
                {statusLabel.text}
              </span>
            ) : null}
          </div>
        )}
        <p className="leading-tight truncate" style={{ color: T.textPrimary, fontSize: 15, fontWeight: 800 }}>
          {debtorName}
        </p>
        <p className="truncate mt-0.5" style={{ color: T.textSecondary, fontSize: 12, fontWeight: 500 }}>
          Parcela {inst.number} · Venc. {fmtDate(inst.due_date)}
        </p>
        {(investment?.calculation_mode === 'interest_only' || investment?.remaining_balance != null) && (
          <p className="truncate mt-1" style={{ color: T.textMuted, fontSize: 12, fontWeight: 500 }}>
            {investment?.calculation_mode === 'interest_only' && (
              <span
                className="inline-flex items-center mr-1.5"
                style={{
                  background: T.orangeSoft, color: T.orange,
                  fontSize: 10, fontWeight: 800,
                  letterSpacing: '0.3px', textTransform: 'uppercase',
                  padding: '1px 5px', borderRadius: 4,
                }}
              >
                Bullet
              </span>
            )}
            {investment?.remaining_balance != null && (
              <span style={{ color: T.orange, fontWeight: 600 }}>
                Saldo: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(investment.remaining_balance))}
              </span>
            )}
          </p>
        )}
        {(isPartial || isPaidToday) && amountPaid > 0 && (
          <p className="mt-1" style={{ color: colorMap[tone], fontSize: 12, fontWeight: 700 }}>
            Recebido: {fmtMoney(amountPaid)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <span className="tabular-nums whitespace-nowrap" style={{ color: valueColor, fontSize: 16, fontWeight: 800 }}>
          {valueText}
        </span>
        <ChevronRight size={16} style={{ color: T.textMuted }} />
      </div>
    </button>
  );
};

// ── Bucket Row (sub-accordion compacto dentro de Outros Vencimentos) ────────
const BucketRow: React.FC<{
  label: string;
  total: number;
  items: LoanInstallment[];
  onSelect: (inst: LoanInstallment) => void;
}> = ({ label, total, items, onSelect }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b last:border-b-0" style={{ borderColor: T.border }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between transition-colors hover:bg-black/[0.02]"
        style={{ padding: '10px 14px' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate" style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>{label}</span>
          <span style={{ color: T.textMuted, fontSize: 12, fontWeight: 500 }}>
            · {items.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="tabular-nums" style={{ color: T.textPrimary, fontSize: 13, fontWeight: 800 }}>{fmtMoney(total)}</span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            style={{ color: T.textMuted }}
          />
        </div>
      </button>
      {open && (
        <div className="animate-fade-in" style={{ background: T.surfaceSoft }}>
          {items.map(inst => (
            <MiniInstallmentRow key={inst.id} inst={inst} onClick={() => onSelect(inst)} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Mini Installment Row (1 linha por parcela, denso) ──────────────────────
const MiniInstallmentRow: React.FC<{
  inst: LoanInstallment;
  onClick: () => void;
}> = ({ inst, onClick }) => {
  const name = (inst as any).investment?.payer?.full_name || (inst as any).payer_name || 'Cliente';
  const value = calcOutstanding(inst);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 text-left transition-colors hover:bg-black/[0.02] border-t"
      style={{ padding: '8px 14px 8px 22px', borderColor: T.border }}
    >
      <span className="truncate flex-1" style={{ color: T.textPrimary, fontSize: 13, fontWeight: 600 }}>
        {name}
      </span>
      <span className="tabular-nums shrink-0" style={{ color: T.textMuted, fontSize: 12, fontWeight: 500 }}>
        {fmtDate(inst.due_date)}
      </span>
      <span className="tabular-nums shrink-0" style={{ color: T.textPrimary, fontSize: 13, fontWeight: 700 }}>
        {fmtMoney(value)}
      </span>
      <ChevronRight size={14} className="shrink-0" style={{ color: T.textMuted }} />
    </button>
  );
};

export default DailyCollectionView;
