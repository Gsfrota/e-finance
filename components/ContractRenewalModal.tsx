import React, { useState, useEffect, useMemo } from 'react';
import { X, Loader2, CheckCircle2, RotateCcw, AlertCircle } from 'lucide-react';
import { getSupabase, parseSupabaseError } from '../services/supabase';
import { Investment } from '../types';

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
  amount_invested: number;
  interest_rate: number;
  total_installments: number;
  frequency: 'monthly' | 'weekly' | 'daily' | 'freelancer';
  due_day: number;
  weekday: number;
  start_date: string;
  calculation_mode: 'auto' | 'manual';
  installment_value: number;
}

interface ContractRenewalModalProps {
  isOpen: boolean;
  sourceContract: Investment | null;
  onClose: () => void;
  onSuccess: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

const ContractRenewalModal: React.FC<ContractRenewalModalProps> = ({
  isOpen,
  sourceContract,
  onClose,
  onSuccess,
}) => {
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
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markRenewed, setMarkRenewed] = useState(true);

  // Pré-preenche com dados do contrato original quando abrir
  useEffect(() => {
    if (!isOpen || !sourceContract) return;
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
      calculation_mode: 'auto',
      installment_value: 0,
    });
  }, [isOpen, sourceContract]);

  const { installmentValue, totalValue } = useMemo(() => {
    const principal = Number(form.amount_invested) || 0;
    const count = Math.max(1, Number(form.total_installments));
    if (principal <= 0) return { installmentValue: 0, totalValue: 0 };

    if (form.calculation_mode === 'auto') {
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
        form.due_day,
        form.weekday,
        form.start_date,
        form.total_installments
      );

      const count = form.total_installments;
      const base = roundCurrency(installmentValue);
      const principals = Array.from({ length: count }, () => roundCurrency(Number(form.amount_invested) / count));
      // Ajuste de centavos na última parcela
      const pSum = roundCurrency(principals.slice(0, -1).reduce((s, v) => s + v, 0));
      principals[count - 1] = roundCurrency(Number(form.amount_invested) - pSum);

      const interestPerInstallment = roundCurrency((totalValue - Number(form.amount_invested)) / count);

      // 1. Cria novo contrato
      const { data: newContract, error: contractErr } = await supabase
        .from('investments')
        .insert({
          tenant_id: sourceContract.tenant_id,
          user_id: sourceContract.user_id,
          payer_id: sourceContract.payer_id,
          asset_name: form.asset_name,
          amount_invested: Number(form.amount_invested),
          current_value: totalValue,
          interest_rate: Number(form.interest_rate),
          installment_value: base,
          total_installments: count,
          current_installment: 1,
          type: sourceContract.type || 'Financing',
          frequency: form.frequency,
          due_day: form.frequency === 'monthly' ? form.due_day : null,
          weekday: form.frequency === 'weekly' ? form.weekday : null,
          start_date: form.frequency === 'daily' || form.frequency === 'freelancer' ? form.start_date : null,
          calculation_mode: form.calculation_mode,
          source_capital: Number(form.amount_invested),
          source_profit: 0,
          parent_investment_id: sourceContract.id,
          status: 'active',
        })
        .select()
        .single();

      if (contractErr) throw contractErr;

      // 2. Cria parcelas
      const installments = dates.map((date, idx) => ({
        investment_id: newContract.id,
        tenant_id: sourceContract.tenant_id,
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
      onClose();
    } catch (e: any) {
      setError(parseSupabaseError(e));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !sourceContract) return null;

  const set = (field: keyof RenewalForm, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-xl animate-fade-in-up rounded-t-[2.5rem] border border-white/[0.08] bg-[color:var(--bg-elevated)] shadow-2xl sm:rounded-[2.5rem]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-5">
          <div>
            <h3 className="font-display text-xl font-black text-[color:var(--text-primary)]">Renovar Contrato</h3>
            <p className="text-xs text-[color:var(--text-faint)]">Pré-preenchido com dados de: <span className="font-semibold text-[color:var(--accent-brass)]">{sourceContract.asset_name}</span></p>
          </div>
          <button onClick={onClose} className="rounded-full p-2.5 text-[color:var(--text-muted)] hover:bg-white/10 hover:text-[color:var(--text-primary)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="custom-scrollbar max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <AlertCircle size={16} className="shrink-0 text-red-400" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Nome */}
          <div>
            <label className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">Nome do Contrato</label>
            <input
              type="text"
              value={form.asset_name}
              onChange={(e) => set('asset_name', e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
            />
          </div>

          {/* Valor + Taxa */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">Valor (R$)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.amount_invested}
                onChange={(e) => set('amount_invested', parseFloat(e.target.value) || 0)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">Taxa (% a.m.)</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={form.interest_rate}
                onChange={(e) => set('interest_rate', parseFloat(e.target.value) || 0)}
                disabled={form.calculation_mode === 'manual'}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all disabled:opacity-40"
              />
            </div>
          </div>

          {/* Parcelas + Frequência */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">Parcelas</label>
              <input
                type="number"
                min={1}
                value={form.total_installments}
                onChange={(e) => set('total_installments', parseInt(e.target.value) || 1)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">Frequência</label>
              <select
                value={form.frequency}
                onChange={(e) => set('frequency', e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 transition-all"
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
              <label className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">Dia de Vencimento</label>
              <input
                type="number"
                min={1}
                max={28}
                value={form.due_day}
                onChange={(e) => set('due_day', parseInt(e.target.value) || 1)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
          )}

          {(form.frequency === 'daily' || form.frequency === 'freelancer') && (
            <div>
              <label className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">Data de Início</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => set('start_date', e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
          )}

          {/* Modo de cálculo */}
          <div>
            <label className="mb-2 block text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">Modo de Cálculo</label>
            <div className="flex rounded-2xl border border-white/10 bg-white/[0.03] p-1">
              {(['auto', 'manual'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => set('calculation_mode', mode)}
                  className={`flex-1 rounded-xl py-2 text-xs font-extrabold uppercase tracking-wider transition-all ${
                    form.calculation_mode === mode
                      ? 'bg-[color:var(--accent-brass)] text-[#17120b]'
                      : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                  }`}
                >
                  {mode === 'auto' ? 'Automático' : 'Manual'}
                </button>
              ))}
            </div>
          </div>

          {form.calculation_mode === 'manual' && (
            <div>
              <label className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--text-faint)]">Valor da Parcela (R$)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.installment_value}
                onChange={(e) => set('installment_value', parseFloat(e.target.value) || 0)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent-brass)]/50 focus:ring-1 focus:ring-[color:var(--accent-brass)]/30 transition-all"
              />
            </div>
          )}

          {/* Preview */}
          {installmentValue > 0 && (
            <div className="rounded-2xl border border-[color:var(--accent-brass)]/20 bg-[rgba(202,176,122,0.06)] px-4 py-4">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-[color:var(--accent-brass)]">Preview do Novo Contrato</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Parcela', value: fmt(installmentValue) },
                  { label: 'Montante', value: fmt(totalValue) },
                  { label: 'Juros', value: fmt(totalValue - Number(form.amount_invested)) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[10px] text-[color:var(--text-faint)]">{label}</p>
                    <p className="text-sm font-extrabold text-[color:var(--accent-brass)]">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Toggle: marcar original como renovado */}
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/[0.06] px-4 py-3">
            <input
              type="checkbox"
              checked={markRenewed}
              onChange={(e) => setMarkRenewed(e.target.checked)}
              className="h-4 w-4 accent-[color:var(--accent-teal)]"
            />
            <span className="text-xs text-[color:var(--text-secondary)]">
              Marcar contrato original como <span className="font-bold text-[color:var(--text-primary)]">"Renovado"</span>
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-white/[0.06] px-6 py-5">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl bg-white/[0.05] py-3.5 text-xs font-extrabold uppercase tracking-widest text-[color:var(--text-primary)] transition-all hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !form.asset_name.trim() || form.amount_invested <= 0}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[color:var(--accent-brass)] py-3.5 text-xs font-extrabold uppercase tracking-widest text-[#17120b] transition-all hover:opacity-90 disabled:opacity-40"
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
    </div>
  );
};

export default ContractRenewalModal;
