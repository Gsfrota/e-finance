import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Loader2, CheckCircle2, RotateCcw, AlertCircle } from 'lucide-react';
import { getSupabase, parseSupabaseError } from '../services/supabase';
import { Investment } from '../types';
import { useCompanyContext } from '../services/companyScope';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

const roundCurrency = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

const calculateInstallmentDates = (
  frequency: string,
  dueDay: number,
  weekday: number,
  startDateStr: string,
  count: number
): string[] => {
  const dates: Date[] = [];
  const now = new Date();
  let cursor = new Date();

  if (frequency === 'monthly') {
    cursor.setDate(dueDay);
    if (now.getDate() >= dueDay) cursor.setMonth(cursor.getMonth() + 1);
  } else if (frequency === 'weekly') {
    const diff = ((weekday - now.getDay()) + 7) % 7 || 7;
    cursor.setDate(now.getDate() + diff);
  } else if (startDateStr) {
    const [y, m, d] = startDateStr.split('-').map(Number);
    cursor = new Date(y, m - 1, d);
  }

  for (let i = 0; i < count; i++) {
    const d = new Date(cursor);
    if (frequency === 'monthly') d.setMonth(d.getMonth() + i);
    else if (frequency === 'weekly') d.setDate(d.getDate() + i * 7);
    else d.setDate(d.getDate() + i);
    dates.push(d);
  }

  return dates.map((d) => d.toISOString().split('T')[0]);
};

// ── Types ──────────────────────────────────────────────────────────────────

interface RenewalForm {
  asset_name: string;
  amount_invested: number | string;
  interest_rate: number | string;
  total_installments: number | string;
  frequency: 'monthly' | 'weekly' | 'daily' | 'freelancer';
  due_day: number | string;
  weekday: number;
  start_date: string;
  calculation_mode: 'auto' | 'manual' | 'interest_only';
  installment_value: number | string;
  bullet_principal_mode: 'together' | 'separate';
}

interface ContractRenewalModalProps {
  sourceContract: Investment | null;
  onBack: () => void;
  onSuccess: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

const ContractRenewalModal: React.FC<ContractRenewalModalProps> = ({
  sourceContract,
  onBack,
  onSuccess,
}) => {
  const { activeCompanyId } = useCompanyContext();
  const [form, setForm] = useState<RenewalForm>({
    asset_name: '',
    amount_invested: 0,
    interest_rate: 10,
    total_installments: 12,
    frequency: 'monthly',
    due_day: 10,
    weekday: 1,
    start_date: new Date().toISOString().split('T')[0],
    calculation_mode: 'auto',
    installment_value: 0,
    bullet_principal_mode: 'together',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markRenewed, setMarkRenewed] = useState(true);

  // Pré-preenche com dados do contrato original quando montar
  useEffect(() => {
    if (!sourceContract) return;
    setError(null);
    setForm({
      asset_name: `${sourceContract.asset_name} (Renovação)`,
      amount_invested: Number(sourceContract.amount_invested) || 0,
      interest_rate: Number(sourceContract.interest_rate) || 10,
      total_installments: Number(sourceContract.total_installments) || 12,
      frequency: (sourceContract.frequency as RenewalForm['frequency']) || 'monthly',
      due_day: Number(sourceContract.due_day) || 10,
      weekday: Number(sourceContract.weekday) || 1,
      start_date: new Date().toISOString().split('T')[0],
      calculation_mode: sourceContract.calculation_mode === 'interest_only' ? 'interest_only' : 'auto',
      installment_value: 0,
      bullet_principal_mode: sourceContract.bullet_principal_mode || 'together',
    });
  }, [sourceContract]);

  const { installmentValue, totalValue } = useMemo(() => {
    const principal = Number(form.amount_invested) || 0;
    const count = Math.max(1, Number(form.total_installments));
    if (principal <= 0) return { installmentValue: 0, totalValue: 0 };

    if (form.calculation_mode === 'interest_only') {
      const interestPerPeriod = roundCurrency(principal * ((Number(form.interest_rate) || 0) / 100));
      const totalInterest = roundCurrency(interestPerPeriod * count);
      return { installmentValue: interestPerPeriod, totalValue: roundCurrency(principal + totalInterest) };
    } else if (form.calculation_mode === 'auto') {
      const total = roundCurrency(principal * (1 + (Number(form.interest_rate) || 0) / 100));
      return { installmentValue: roundCurrency(total / count), totalValue: total };
    } else {
      const iv = Number(form.installment_value) || 0;
      return { installmentValue: iv, totalValue: roundCurrency(iv * count) };
    }
  }, [form.amount_invested, form.interest_rate, form.total_installments, form.calculation_mode, form.installment_value]);

  const handleSubmit = async () => {
    if (!sourceContract) return;
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase não configurado');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const dates = calculateInstallmentDates(
        form.frequency,
        Number(form.due_day) || 1,
        form.weekday,
        form.start_date,
        Number(form.total_installments) || 1
      );

      const count = Number(form.total_installments) || 1;
      const isBullet = form.calculation_mode === 'interest_only';
      const base = roundCurrency(installmentValue);
      const principal = Number(form.amount_invested);

      // For bullet: total_installments stored includes the extra separate installment
      const storedCount = isBullet && form.bullet_principal_mode === 'separate' ? count + 1 : count;

      // 1. Cria novo contrato
      const { data: newContract, error: contractErr } = await supabase
        .from('investments')
        .insert({
          tenant_id: sourceContract.tenant_id,
          company_id: activeCompanyId || sourceContract.company_id || null,
          user_id: sourceContract.user_id,
          payer_id: sourceContract.payer_id,
          asset_name: form.asset_name,
          amount_invested: principal,
          current_value: totalValue,
          interest_rate: Number(form.interest_rate),
          installment_value: base,
          total_installments: storedCount,
          current_installment: 1,
          type: sourceContract.type || 'Financing',
          frequency: form.frequency,
          due_day: form.frequency === 'monthly' ? (Number(form.due_day) || 1) : null,
          weekday: form.frequency === 'weekly' ? form.weekday : null,
          start_date: form.frequency === 'daily' || form.frequency === 'freelancer' ? form.start_date : null,
          calculation_mode: form.calculation_mode,
          bullet_principal_mode: isBullet ? form.bullet_principal_mode : null,
          source_capital: principal,
          source_profit: 0,
          parent_investment_id: sourceContract.id,
          status: 'active',
        })
        .select()
        .single();

      if (contractErr) throw contractErr;

      // 2. Cria parcelas
      let installments: any[];

      if (isBullet) {
        const interestPerPeriod = roundCurrency(principal * ((Number(form.interest_rate) || 0) / 100));
        installments = dates.map((date, idx) => {
          const isLast = idx === count - 1;
          const includesPrincipal = form.bullet_principal_mode === 'together' && isLast;
          return {
            investment_id: newContract.id,
            tenant_id: sourceContract.tenant_id,
            company_id: activeCompanyId || sourceContract.company_id || null,
            number: idx + 1,
            due_date: date,
            amount_principal: includesPrincipal ? principal : 0,
            amount_interest: interestPerPeriod,
            amount_total: includesPrincipal ? roundCurrency(principal + interestPerPeriod) : interestPerPeriod,
            amount_paid: 0,
            fine_amount: 0,
            interest_delay_amount: 0,
            status: 'pending',
          };
        });

        // For "separate" mode, add extra principal-only installment
        if (form.bullet_principal_mode === 'separate') {
          // Calculate next date after last interest installment
          const lastDate = new Date(dates[dates.length - 1]);
          if (form.frequency === 'monthly') {
            lastDate.setMonth(lastDate.getMonth() + 1);
          } else if (form.frequency === 'weekly') {
            lastDate.setDate(lastDate.getDate() + 7);
          } else {
            lastDate.setDate(lastDate.getDate() + 1);
          }
          installments.push({
            investment_id: newContract.id,
            tenant_id: sourceContract.tenant_id,
            company_id: activeCompanyId || sourceContract.company_id || null,
            number: count + 1,
            due_date: lastDate.toISOString().split('T')[0],
            amount_principal: principal,
            amount_interest: 0,
            amount_total: principal,
            amount_paid: 0,
            fine_amount: 0,
            interest_delay_amount: 0,
            status: 'pending',
          });
        }
      } else {
        const principals = Array.from({ length: count }, () => roundCurrency(principal / count));
        const pSum = roundCurrency(principals.slice(0, -1).reduce((s, v) => s + v, 0));
        principals[count - 1] = roundCurrency(principal - pSum);
        const interestPerInstallment = roundCurrency((totalValue - principal) / count);

        installments = dates.map((date, idx) => ({
          investment_id: newContract.id,
          tenant_id: sourceContract.tenant_id,
          company_id: activeCompanyId || sourceContract.company_id || null,
          number: idx + 1,
          due_date: date,
          amount_principal: principals[idx],
          amount_interest: interestPerInstallment,
          amount_total: roundCurrency(principals[idx] + interestPerInstallment),
          amount_paid: 0,
          fine_amount: 0,
          interest_delay_amount: 0,
          status: 'pending',
        }));
      }

      const { error: installmentsErr } = await supabase
        .from('loan_installments')
        .insert(installments);

      if (installmentsErr) throw installmentsErr;

      // 3. Marca original como renovado (se selecionado)
      if (markRenewed) {
        await supabase
          .from('investments')
          .update({ status: 'renewed' })
          .eq('id', sourceContract.id);
      }

      onSuccess();
    } catch (e: any) {
      setError(parseSupabaseError(e));
    } finally {
      setLoading(false);
    }
  };

  if (!sourceContract) return null;

  const set = (field: keyof RenewalForm, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="flex h-full flex-col bg-[color:var(--bg-elevated)]">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] px-4 py-5 shrink-0">
          <button onClick={onBack} className="rounded-full p-2 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-soft)] transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h3 className="type-heading text-[color:var(--text-primary)]">Renovar Contrato</h3>
            <p className="text-xs text-[color:var(--text-faint)] truncate">Pré-preenchido: <span className="font-semibold text-[color:var(--accent-brass)]">{sourceContract.asset_name}</span></p>
          </div>
        </div>

        {/* Body */}
        <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <AlertCircle size={16} className="shrink-0 text-red-400" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Nome */}
          <div>
            <label className="mb-1.5 block type-label text-[color:var(--text-faint)]">Nome do Contrato</label>
            <input
              type="text"
              value={form.asset_name}
              onChange={(e) => set('asset_name', e.target.value)}
              className="w-full rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
            />
          </div>

          {/* Valor + Taxa */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block type-label text-[color:var(--text-faint)]">Valor (R$)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.amount_invested}
                inputMode="decimal"
                onChange={(e) => set('amount_invested', e.target.value)}
                className="w-full rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
            <div>
              <label className="mb-1.5 block type-label text-[color:var(--text-faint)]">Taxa (% a.m.)</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={form.interest_rate}
                inputMode="decimal"
                onChange={(e) => set('interest_rate', e.target.value)}
                disabled={form.calculation_mode === 'manual'}
                className="w-full rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all disabled:opacity-40"
              />
            </div>
          </div>

          {/* Parcelas + Frequência */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block type-label text-[color:var(--text-faint)]">Parcelas</label>
              <input
                type="number"
                min={1}
                value={form.total_installments}
                inputMode="numeric"
                onChange={(e) => set('total_installments', e.target.value)}
                className="w-full rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
            <div>
              <label className="mb-1.5 block type-label text-[color:var(--text-faint)]">Frequência</label>
              <select
                value={form.frequency}
                onChange={(e) => set('frequency', e.target.value)}
                className="w-full rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 transition-all [color-scheme:dark]"
              >
                <option value="monthly">Mensal</option>
                <option value="weekly">Semanal</option>
                <option value="daily">Diário</option>
                <option value="freelancer">Freelancer</option>
              </select>
            </div>
          </div>

          {/* Data/Dia de vencimento */}
          {form.frequency === 'monthly' && (
            <div>
              <label className="mb-1.5 block type-label text-[color:var(--text-faint)]">Dia de Vencimento</label>
              <input
                type="number"
                min={1}
                max={28}
                value={form.due_day}
                inputMode="numeric"
                onChange={(e) => set('due_day', e.target.value)}
                className="w-full rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
          )}

          {(form.frequency === 'daily' || form.frequency === 'freelancer') && (
            <div>
              <label className="mb-1.5 block type-label text-[color:var(--text-faint)]">Data de Início</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => set('start_date', e.target.value)}
                className="w-full rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
          )}

          {/* Modo de cálculo */}
          <div>
            <label className="mb-2 block type-label text-[color:var(--text-faint)]">Modo de Cálculo</label>
            <div className="flex rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-base)] p-1">
              {(['auto', 'manual', 'interest_only'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => set('calculation_mode', mode)}
                  className={`flex-1 rounded-xl py-2 type-label transition-all ${
                    form.calculation_mode === mode
                      ? mode === 'interest_only' ? 'bg-amber-600 text-white' : 'bg-[color:var(--accent-brass)] text-[color:var(--text-on-accent)]'
                      : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                  }`}
                >
                  {mode === 'auto' ? 'Auto' : mode === 'manual' ? 'Manual' : 'Bullet'}
                </button>
              ))}
            </div>
          </div>

          {form.calculation_mode === 'interest_only' && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-amber-500/20 bg-amber-900/10 px-4 py-3">
                <p className="type-label text-amber-400 mb-1">Juros Apenas</p>
                <p className="text-[10px] text-[color:var(--text-secondary)]">Parcelas de juros simples. Principal devolvido no final.</p>
              </div>
              <div className="flex gap-2">
                {(['together', 'separate'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => set('bullet_principal_mode', mode)}
                    className={`flex-1 rounded-xl py-2 type-label transition-all border ${
                      form.bullet_principal_mode === mode
                        ? 'bg-amber-900/20 border-amber-500/40 text-amber-300'
                        : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'
                    }`}
                  >
                    {mode === 'together' ? 'Junto' : 'Separado'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {form.calculation_mode === 'manual' && (
            <div>
              <label className="mb-1.5 block type-label text-[color:var(--text-faint)]">Valor da Parcela (R$)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.installment_value}
                inputMode="decimal"
                onChange={(e) => set('installment_value', e.target.value)}
                className="w-full rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-soft)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
          )}

          {/* Preview */}
          {installmentValue > 0 && (
            <div className={`rounded-2xl border px-4 py-4 ${form.calculation_mode === 'interest_only' ? 'border-amber-500/20 bg-amber-900/5' : 'border-[color:var(--accent-brass)]/20 bg-[rgba(202,176,122,0.06)]'}`}>
              <p className={`mb-2 type-label ${form.calculation_mode === 'interest_only' ? 'text-amber-400' : 'text-[color:var(--accent-brass)]'}`}>
                Preview do Novo Contrato {form.calculation_mode === 'interest_only' && '(Bullet)'}
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: form.calculation_mode === 'interest_only' ? 'Juros/mês' : 'Parcela', value: fmt(installmentValue) },
                  { label: 'Montante', value: fmt(totalValue) },
                  { label: 'Juros Total', value: fmt(totalValue - Number(form.amount_invested)) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[10px] text-[color:var(--text-faint)]">{label}</p>
                    <p className={`type-metric-sm ${form.calculation_mode === 'interest_only' ? 'text-amber-400' : 'text-[color:var(--accent-brass)]'}`}>{value}</p>
                  </div>
                ))}
              </div>
              {form.calculation_mode === 'interest_only' && form.bullet_principal_mode === 'separate' && (
                <p className="text-[10px] text-amber-400/60 mt-2 text-center">
                  + 1 parcela extra de {fmt(Number(form.amount_invested))} (devolução do principal)
                </p>
              )}
            </div>
          )}

          {/* Toggle: marcar original como renovado */}
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[color:var(--border-subtle)] px-4 py-3">
            <input
              type="checkbox"
              checked={markRenewed}
              onChange={(e) => setMarkRenewed(e.target.checked)}
              className="h-4 w-4 accent-[color:var(--accent-positive)]"
            />
            <span className="text-xs text-[color:var(--text-secondary)]">
              Marcar contrato original como <span className="font-bold text-[color:var(--text-primary)]">"Renovado"</span>
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-[color:var(--border-subtle)] px-6 py-5">
          <button
            onClick={onBack}
            className="flex-1 rounded-2xl bg-[color:var(--bg-soft)] py-3.5 type-label text-[color:var(--text-primary)] transition-all hover:bg-[color:var(--bg-strong)]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !form.asset_name.trim() || Number(form.amount_invested) <= 0}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[color:var(--accent-brass)] py-3.5 type-label text-[color:var(--text-on-accent)] transition-all hover:opacity-90 disabled:opacity-40"
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RotateCcw size={15} />
            )}
            {loading ? 'Criando...' : 'Renovar Contrato'}
          </button>
        </div>
    </div>
  );
};

export default ContractRenewalModal;
