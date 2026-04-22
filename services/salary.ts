/**
 * BR-REL-018: Fórmula única de rendimento
 * Toda tela/hook que exiba renda do operador deve consumir esta função.
 * Proibido recalcular porções inline em componentes ou hooks.
 */

export interface SalaryPortions {
  /** Juros contratuais recebidos (amount_interest proporcional) */
  juros: number;
  /** Multa + mora recebidos (fine_amount + interest_delay_amount proporcional) */
  atraso: number;
  /** Principal devolvido (amount_principal proporcional) */
  principal: number;
  /** Total efetivamente pago (amount_paid) */
  bruto: number;
}

interface InstallmentLike {
  status: string;
  amount_principal?: number | string | null;
  amount_interest?: number | string | null;
  fine_amount?: number | string | null;
  interest_delay_amount?: number | string | null;
  amount_paid?: number | string | null;
}

const n = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const num = Number(v);
  return isNaN(num) ? 0 : num;
};

/**
 * Calcula as porções de rendimento de uma parcela paga ou parcial.
 * BR-REL-018 — fonte única de verdade para decomposição de pagamentos.
 */
export function calcSalaryPortions(inst: InstallmentLike): SalaryPortions {
  const principal = n(inst.amount_principal);
  const jurosBase = n(inst.amount_interest);
  const fine = n(inst.fine_amount);
  const delay = n(inst.interest_delay_amount);
  const paid = n(inst.amount_paid);

  const obligation = principal + jurosBase + fine + delay;

  // Parcela quitada por excedente: status=paid, amount_paid=0
  // Usa valores integrais como implicitamente pagos
  if (inst.status === 'paid' && paid === 0) {
    if (obligation > 0) {
      return { juros: jurosBase, atraso: fine + delay, principal, bruto: obligation };
    }
    return { juros: 0, atraso: 0, principal: 0, bruto: 0 };
  }

  // Parcela paga integralmente
  if (inst.status === 'paid') {
    // Se componentes divergem muito do pago (bug de acúmulo), distribui proporcionalmente
    if (obligation > 0 && Math.abs(obligation - paid) > 1) {
      const ratio = paid / obligation;
      return {
        juros: jurosBase * ratio,
        atraso: (fine + delay) * ratio,
        principal: principal * ratio,
        bruto: paid,
      };
    }
    return { juros: jurosBase, atraso: fine + delay, principal, bruto: paid };
  }

  // Parcela parcial: distribui amount_paid proporcionalmente entre os componentes
  if (obligation <= 0 || paid <= 0) {
    return { juros: 0, atraso: 0, principal: 0, bruto: 0 };
  }
  const ratio = paid / obligation;
  return {
    juros: jurosBase * ratio,
    atraso: (fine + delay) * ratio,
    principal: principal * ratio,
    bruto: paid,
  };
}

/**
 * Predicate BR-REL-002: exclui parcelas fantasmas (deferidas via mark_installment_missed).
 * Fantasmas têm amount_total=0, amount_paid=0, status='paid'.
 */
export function isSalaryPhantom(inst: {
  status: string;
  amount_total?: number | string | null;
  amount_paid?: number | string | null;
}): boolean {
  return (
    inst.status === 'paid' &&
    n(inst.amount_total) === 0 &&
    n(inst.amount_paid) === 0
  );
}
