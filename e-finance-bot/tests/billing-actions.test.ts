import { beforeAll, describe, expect, it, vi } from 'vitest';

let pix: typeof import('../src/services/pix');
let billing: typeof import('../src/actions/billing-actions');

beforeAll(async () => {
  vi.stubEnv('PLATFORM_PIX_KEY', '45448618000157');
  vi.stubEnv('PLATFORM_PIX_NAME', 'GRUPO SS');
  vi.stubEnv('PLATFORM_PIX_CITY', 'SAO PAULO');
  vi.stubEnv('SUBSCRIPTION_AMOUNT_CADERNETA', '49.90');
  vi.stubEnv('SUBSCRIPTION_AMOUNT_EMPRESARIAL', '99.90');
  vi.stubEnv('SUBSCRIPTION_REMINDER_LEAD_DAYS', '3');
  pix = await import('../src/services/pix');
  billing = await import('../src/actions/billing-actions');
});

describe('pix — gerador BR Code (EMVCo)', () => {
  it('gera payload determinístico com a chave CNPJ embutida', () => {
    const a = pix.generatePixString('45448618000157', 'GRUPO SS', 'SAO PAULO', 49.9);
    const b = pix.generatePixString('45448618000157', 'GRUPO SS', 'SAO PAULO', 49.9);
    expect(a).toBe(b); // determinístico
    expect(a.startsWith('000201')).toBe(true); // Payload Format Indicator
    expect(a).toContain('BR.GOV.BCB.PIX');
    expect(a).toContain('45448618000157'); // chave CNPJ
    expect(a).toContain('5303986'); // moeda BRL
    expect(a).toContain('540549.90'); // valor (tag 54, len 05)
    expect(a).toMatch(/[0-9A-F]{4}$/); // CRC16 hex no fim
  });

  it('muda o CRC quando o valor muda', () => {
    const a = pix.generatePixString('45448618000157', 'GRUPO SS', 'SAO PAULO', 49.9);
    const b = pix.generatePixString('45448618000157', 'GRUPO SS', 'SAO PAULO', 99.9);
    expect(a.slice(-4)).not.toBe(b.slice(-4));
  });
});

describe('billing-actions — datas de vencimento', () => {
  const ref = new Date('2026-05-29T12:00:00Z'); // BRT ~09:00 de 29/05

  it('nextDueDate avança para o próximo mês quando o dia já passou', () => {
    const due = billing.nextDueDate(10, ref);
    expect(due.toISOString().slice(0, 10)).toBe('2026-06-10');
  });

  it('nextDueDate faz clamp para o último dia em meses curtos', () => {
    const due = billing.nextDueDate(28, new Date('2026-02-10T12:00:00Z'));
    expect(due.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('dueCycle reflete o mês do próximo vencimento', () => {
    expect(billing.dueCycle(10, ref)).toBe('2026-06');
  });

  it('isWithinReminderWindow respeita a antecedência', () => {
    expect(billing.isWithinReminderWindow(1, ref, 3)).toBe(true); // vence 01/06 → 3 dias
    expect(billing.isWithinReminderWindow(10, ref, 3)).toBe(false); // vence 10/06 → 12 dias
  });
});

describe('billing-actions — janela inteligente (antes + em atraso)', () => {
  // Hoje 29/05; vencimento dia 28 venceu ONTEM.
  const dia29 = new Date('2026-05-29T12:00:00Z');

  it('pega vencimento em atraso dentro da graça (dia 28 venceu ontem)', () => {
    const due = billing.relevantDueDate(28, dia29, 3, 7);
    expect(due).not.toBeNull();
    expect(due!.toISOString().slice(0, 10)).toBe('2026-05-28');
    expect(billing.daysOverdue(due!, dia29)).toBe(1);
    expect(billing.cycleOf(due!)).toBe('2026-05');
  });

  it('sai da janela quando o atraso passa do período de graça', () => {
    const dia10jun = new Date('2026-06-10T12:00:00Z'); // 13 dias após o 28/05
    expect(billing.relevantDueDate(28, dia10jun, 3, 7)).toBeNull();
  });

  it('mensagem fica no tom de regularização quando em atraso', () => {
    const block = billing.buildSubscriptionPixBlock('caderneta', 28, dia29);
    expect(block).not.toBeNull();
    expect(block!.message).toContain('venceu em 28/05');
    expect(block!.message.toLowerCase()).toContain('regularize');
  });

  it('antecedência: 3 dias antes do vencimento entra na janela', () => {
    const dia25 = new Date('2026-05-25T12:00:00Z'); // 3 dias antes do 28
    const due = billing.relevantDueDate(28, dia25, 3, 7);
    expect(due!.toISOString().slice(0, 10)).toBe('2026-05-28');
    expect(billing.daysOverdue(due!, dia25)).toBe(0);
  });
});

describe('billing-actions — bloco PIX da mensalidade', () => {
  const ref = new Date('2026-05-29T12:00:00Z');

  it('monta o bloco para um plano pago configurado', () => {
    const block = billing.buildSubscriptionPixBlock('caderneta', 10, ref);
    expect(block).not.toBeNull();
    expect(block!.amount).toBe(49.9);
    expect(block!.copyPaste).toContain('45448618000157');
    expect(block!.message).toContain('Caderneta');
    expect(block!.message).toContain(block!.copyPaste);
  });

  it('retorna null quando o plano não tem valor configurado', () => {
    expect(billing.buildSubscriptionPixBlock('free', 10, ref)).toBeNull();
    expect(billing.buildSubscriptionPixBlock('caderneta', null, ref)).toBeNull();
  });
});
