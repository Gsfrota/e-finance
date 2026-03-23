/**
 * Serviço de auditoria de transações de pagamento.
 * Grava entradas na tabela payment_transactions para rastreabilidade.
 */
import { LoanInstallment } from '../types';
import { getSupabase } from './supabase';

const normalizeNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

/** Grava uma entrada de auditoria em payment_transactions (non-blocking) */
export const logPaymentTransaction = async (tx: {
  tenant_id: string;
  investment_id: number;
  installment_id: string;
  transaction_type: 'payment' | 'surplus_applied' | 'surplus_received' | 'deferred' | 'missed' | 'reversal';
  amount: number;
  principal_portion?: number;
  interest_portion?: number;
  extras_portion?: number;
  related_installment_id?: string;
  related_installment_number?: number;
  payment_method?: string;
  notes?: string;
}) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('payment_transactions').insert({
      ...tx,
      principal_portion: tx.principal_portion ?? 0,
      interest_portion: tx.interest_portion ?? 0,
      extras_portion: tx.extras_portion ?? 0,
    });
  } catch { /* non-critical — não bloqueia o fluxo de pagamento */ }
};

/** Calcula breakdown proporcional de um pagamento */
export const calcBreakdown = (inst: LoanInstallment, paidAmount: number) => {
  const principal = normalizeNum(inst.amount_principal);
  const interest = normalizeNum(inst.amount_interest);
  const fine = normalizeNum(inst.fine_amount);
  const delay = normalizeNum(inst.interest_delay_amount);
  const obligation = principal + interest + fine + delay;
  if (obligation <= 0) return { principal_portion: 0, interest_portion: 0, extras_portion: 0 };
  return {
    principal_portion: paidAmount * (principal / obligation),
    interest_portion: paidAmount * (interest / obligation),
    extras_portion: paidAmount * ((fine + delay) / obligation),
  };
};
