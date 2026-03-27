import React, { useState, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { LoanInstallment, Tenant } from '../../types';
import { InstallmentAction, InstallmentDetailScreen, InstallmentFormScreen } from '../InstallmentDetailFlow';

interface SalaryDashboardProps {
  installments: LoanInstallment[];
  tenant: Tenant | null;
  onUpdate?: () => void;
}

type FilterPeriod = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtPct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(0)}%` : '0%';

const fmtDate = (s?: string) => {
  if (!s) return '—';
  const d = s.split('T')[0];
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

export const SalaryDashboard: React.FC<SalaryDashboardProps> = ({ installments, tenant, onUpdate }) => {
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [period, setPeriod] = useState<FilterPeriod>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(today);
  const [expanded, setExpanded] = useState<'juros' | 'bruto' | null>(null);
  const [selectedInstallment, setSelectedInstallment] = useState<LoanInstallment | null>(null);
  const [installmentAction, setInstallmentAction] = useState<InstallmentAction>(null);

  const { from, to } = useMemo(() => {
    const d = new Date();
    if (period === 'today') return { from: today, to: today };
    if (period === 'week') {
      const w = new Date(d); w.setDate(d.getDate() - 6);
      return { from: w.toISOString().split('T')[0], to: today };
    }
    if (period === 'month') {
      return { from: `${today.slice(0, 7)}-01`, to: today };
    }
    if (period === 'year') {
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    }
    if (period === 'custom') {
      return { from: customFrom, to: customTo };
    }
    return { from: '', to: '' }; // all
  }, [period, today, customFrom, customTo]);

  const filtered = useMemo(() => {
    // Fix #2: parcelas parciais sem paid_at são excluídas do filtro de período
    // (não usar due_date como substituto — introduziria data errada)
    return installments.filter(i => {
      if (i.status !== 'paid' && i.status !== 'partial') return false;
      const refDate = i.paid_at;
      if (!refDate) return false; // sem data de pagamento real, não incluir no período
      const paidDate = refDate.split('T')[0];
      // Fix #5: period === 'all' → from e to são '', comparações são ignoradas corretamente
      if (from !== '' && paidDate < from) return false;
      if (to !== '' && paidDate > to) return false;
      return true;
    });
  }, [installments, from, to]);

  // Calcula as porções proporcionais de cada parcela ao que foi realmente pago.
  // Para 'paid': usa valores integrais (pagamento completo).
  // Para 'partial': distribui amount_paid proporcionalmente entre principal, juros e acréscimos.
  const calcPortions = (i: LoanInstallment) => {
    const principal = Number(i.amount_principal) || 0;
    const interest = Number(i.amount_interest) || 0;
    const fine = Number(i.fine_amount) || 0;
    const delay = Number(i.interest_delay_amount) || 0;
    const paid = Number(i.amount_paid) || 0;

    // Parcela quitada por excedente: status=paid mas amount_paid=0
    // Usar principal+interest como valor implícito pago
    if (i.status === 'paid' && paid === 0) {
      const impliedPaid = principal + interest + fine + delay;
      if (impliedPaid > 0) {
        return { principal, interest, extras: fine + delay, paid: impliedPaid };
      }
      return { principal: 0, interest: 0, extras: 0, paid: 0 };
    }

    if (i.status === 'paid') {
      // Se componentes divergem muito do pago (bug de acúmulo), distribuir proporcionalmente
      const obligation = principal + interest + fine + delay;
      if (obligation > 0 && Math.abs(obligation - paid) > 1) {
        return {
          principal: paid * (principal / obligation),
          interest: paid * (interest / obligation),
          extras: paid * ((fine + delay) / obligation),
          paid,
        };
      }
      return { principal, interest, extras: fine + delay, paid };
    }

    // Parcial: distribuir proporcionalmente
    const obligation = principal + interest + fine + delay;
    if (obligation <= 0 || paid <= 0) return { principal: 0, interest: 0, extras: 0, paid: 0 };
    return {
      principal: paid * (principal / obligation),
      interest: paid * (interest / obligation),
      extras: paid * ((fine + delay) / obligation),
      paid,
    };
  };

  const totals = useMemo(() => {
    let juros = 0, principal = 0, extras = 0, bruto = 0;
    filtered.forEach(i => {
      const p = calcPortions(i);
      juros += p.interest;
      principal += p.principal;
      extras += p.extras;
      bruto += p.paid;
    });
    return { juros, principal, extras, bruto };
  }, [filtered]);

  // Lucro real = juros + multas/mora (tudo que não é devolução de principal)
  const lucroReal = totals.juros + totals.extras;

  const byMethod = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(i => {
      const method = i.payment_method || 'Não informado';
      const p = calcPortions(i);
      map.set(method, (map.get(method) ?? 0) + p.interest + p.extras);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([method, value]) => ({ method, value }));
  }, [filtered]);

  // Sorted by reference date desc for detail lists
  const sortedFiltered = useMemo(
    () => [...filtered].sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? '')),
    [filtered]
  );

  const periodButtons: { id: FilterPeriod; label: string }[] = [
    { id: 'today', label: 'Hoje' },
    { id: 'week', label: 'Semana' },
    { id: 'month', label: 'Mês' },
    { id: 'year', label: 'Ano' },
    { id: 'all', label: 'Tudo' },
  ];

  const debtorName = (i: LoanInstallment) =>
    (i as any).investment?.payer?.full_name || '—';

  const contractName = (i: LoanInstallment) =>
    i.contract_name || (i as any).investment?.asset_name || '—';

  const hasExtra = (i: LoanInstallment) =>
    (Number(i.fine_amount) || 0) + (Number(i.interest_delay_amount) || 0) > 0;

  if (selectedInstallment && !installmentAction) {
    return (
      <InstallmentDetailScreen
        installment={selectedInstallment}
        onBack={() => setSelectedInstallment(null)}
        onAction={(action) => setInstallmentAction(action)}
      />
    );
  }
  if (installmentAction) {
    return (
      <InstallmentFormScreen
        action={installmentAction}
        tenant={tenant}
        onBack={() => setInstallmentAction(null)}
        onSuccess={() => { onUpdate?.(); setInstallmentAction(null); setSelectedInstallment(null); }}
      />
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="panel-card rounded-[2rem] px-6 py-5">
        <p className="section-kicker mb-1">Visão financeira</p>
        <h2 className="type-title" style={{ color: 'var(--text-primary)' }}>
          Salário
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Quanto você está ganhando e de onde vem esse dinheiro
        </p>
      </div>

      {/* Filtros de período */}
      <div className="panel-card rounded-[1.6rem] px-4 py-4 space-y-3">
        <div className="flex gap-2 flex-wrap">
          {periodButtons.map(btn => (
            <button
              key={btn.id}
              onClick={() => setPeriod(btn.id)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={period === btn.id
                ? { background: 'var(--header-blue)', color: 'white' }
                : { background: 'var(--bg-soft)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }
              }
            >
              {btn.label}
            </button>
          ))}
          <button
            onClick={() => setPeriod('custom')}
            className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={period === 'custom'
              ? { background: 'var(--header-blue)', color: 'white' }
              : { background: 'var(--bg-soft)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }
            }
          >
            Período
          </button>
        </div>
        {period === 'custom' && (
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <label className="block type-label mb-1" style={{ color: 'var(--text-faint)' }}>De</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }} />
            </div>
            <div className="flex-1">
              <label className="block type-label mb-1" style={{ color: 'var(--text-faint)' }}>Até</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }} />
            </div>
          </div>
        )}
      </div>

      {/* Lucro de Juros */}
      <div
        className="panel-card rounded-[1.6rem] px-5 py-5 space-y-3 cursor-pointer select-none"
        onClick={() => setExpanded(v => v === 'juros' ? null : 'juros')}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="type-label" style={{ color: 'var(--text-faint)' }}>Seu Lucro</p>
            <p className="type-metric-xl mt-0.5" style={{ color: 'var(--accent-positive)' }}>
              {fmt(lucroReal)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">💰</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {expanded === 'juros' ? '▲' : '▼'}
            </span>
          </div>
        </div>

        {expanded !== 'juros' && byMethod.length > 0 && (
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            {byMethod.map(({ method, value }) => (
              <div key={method} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{method}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs tabular-nums font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(value)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-lg font-semibold"
                    style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)' }}>
                    {fmtPct(value, lucroReal)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {expanded !== 'juros' && byMethod.length === 0 && (
          <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
            Nenhum pagamento no período selecionado
          </p>
        )}

        {/* Lista de parcelas — Juros */}
        {expanded === 'juros' && (
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            {sortedFiltered.length === 0 && (
              <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
                Nenhuma parcela no período
              </p>
            )}
            {sortedFiltered.map((i, idx) => (
              <button
                key={i.id}
                onClick={(e) => { e.stopPropagation(); setSelectedInstallment(i); }}
                className="w-full flex items-center justify-between py-2.5 px-2 rounded-xl transition-colors text-left hover:bg-[var(--bg-soft)]"
                style={idx < sortedFiltered.length - 1 ? { borderBottom: '1px solid var(--border-subtle)' } : {}}
              >
                <div className="flex-1 min-w-0 mr-2">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {contractName(i)}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {debtorName(i)} · {fmtDate(i.paid_at)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs tabular-nums font-bold" style={{ color: 'var(--accent-positive)' }}>
                    {fmt(calcPortions(i).interest + calcPortions(i).extras)}
                  </span>
                  {i.status === 'partial' && (
                    <span className="text-[10px] px-1 py-0.5 rounded font-semibold"
                      style={{ background: 'rgba(66, 165, 245, 0.12)', color: 'var(--accent-steel)' }}>
                      Parcial
                    </span>
                  )}
                  {hasExtra(i) && (
                    <span className="text-[10px] px-1 py-0.5 rounded font-semibold"
                      style={{ background: 'var(--accent-danger)', color: 'white', opacity: 0.85 }}>
                      +multa
                    </span>
                  )}
                  <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lucro Bruto Total */}
      <div
        className="panel-card rounded-[1.6rem] px-5 py-5 cursor-pointer select-none"
        onClick={() => setExpanded(v => v === 'bruto' ? null : 'bruto')}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="type-label" style={{ color: 'var(--text-faint)' }}>Total Recebido</p>
            <p className="type-metric-xl mt-0.5" style={{ color: 'var(--accent-brass)' }}>
              {fmt(totals.bruto)}
            </p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Principal devolvido + Juros + Acréscimos
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📊</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {expanded === 'bruto' ? '▲' : '▼'}
            </span>
          </div>
        </div>

        {/* Breakdown resumido quando não expandido */}
        {expanded !== 'bruto' && totals.bruto > 0 && (
          <div className="mt-3 pt-3 border-t space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Principal devolvido</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmt(totals.principal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Juros</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--accent-positive)' }}>{fmt(totals.juros)}</span>
            </div>
            {totals.extras > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Multas + Mora</span>
                <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--accent-danger)' }}>{fmt(totals.extras)}</span>
              </div>
            )}
          </div>
        )}

        {/* Lista de parcelas — Bruto */}
        {expanded === 'bruto' && (
          <div className="space-y-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            {sortedFiltered.length === 0 && (
              <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
                Nenhuma parcela no período
              </p>
            )}
            {sortedFiltered.map((i, idx) => (
              <button
                key={i.id}
                onClick={(e) => { e.stopPropagation(); setSelectedInstallment(i); }}
                className="w-full flex items-center justify-between py-2.5 px-2 rounded-xl transition-colors text-left hover:bg-[var(--bg-soft)]"
                style={idx < sortedFiltered.length - 1 ? { borderBottom: '1px solid var(--border-subtle)' } : {}}
              >
                <div className="flex-1 min-w-0 mr-2">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {contractName(i)}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {debtorName(i)} · {fmtDate(i.paid_at)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs tabular-nums font-bold" style={{ color: 'var(--accent-brass)' }}>
                    {fmt(Number(i.amount_paid) || 0)}
                  </span>
                  {i.status === 'partial' && (
                    <span className="text-[10px] px-1 py-0.5 rounded font-semibold"
                      style={{ background: 'rgba(66, 165, 245, 0.12)', color: 'var(--accent-steel)' }}>
                      Parcial
                    </span>
                  )}
                  {hasExtra(i) && (
                    <span className="text-[10px] px-1 py-0.5 rounded font-semibold"
                      style={{ background: 'var(--accent-danger)', color: 'white', opacity: 0.85 }}>
                      +multa
                    </span>
                  )}
                  <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Resumo do período */}
      <div className="panel-card rounded-[1.6rem] px-5 py-4">
        <p className="type-label mb-2" style={{ color: 'var(--text-faint)' }}>
          Parcelas no período
        </p>
        <p className="type-metric-md" style={{ color: 'var(--text-primary)' }}>
          {(() => {
            const paidCount = filtered.filter(i => i.status === 'paid').length;
            const partialCount = filtered.filter(i => i.status === 'partial').length;
            return <>
              {paidCount} paga{paidCount !== 1 ? 's' : ''}
              {partialCount > 0 && <span style={{ color: 'var(--accent-steel)' }}> + {partialCount} parcial{partialCount !== 1 ? 'is' : ''}</span>}
            </>;
          })()}
        </p>
      </div>
    </div>
  );
};

export default SalaryDashboard;
