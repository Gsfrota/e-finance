/**
 * TEST-001 — gate de confiabilidade. Exercita o caminho fresh-read do comprovante
 * (fix V44d), antes não coberto porque getSupabaseClient não era mockado, e a
 * cobertura de disconnect_bot (mutação com confirmação).
 */
import { describe, expect, it } from 'vitest';
import type { AgentEvalCase, AgentEvalSetupContext } from './evals/contracts';
import { runAgentEvalCase, setInstallmentReceiptRow } from './evals/harness';

const CONFIRM_PAYMENT = 'Baixar parcela — confirmar';

function routePay(entities: Record<string, unknown>) {
  return ({ mocks }: AgentEvalSetupContext) => {
    mocks.routeIntent.mockResolvedValue({
      intent: 'marcar_pagamento', entities: {}, normalizedEntities: entities,
      confidence: 'high', source: 'rule',
    });
  };
}
function candidate(over: Partial<{ id: string; number: number; contractId: number; debtorName: string; amount: number; dueDate: string; status: string }> = {}) {
  return { id: 'inst-2', number: 2, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-04-10', status: 'pending', ...over };
}

const CASES: AgentEvalCase[] = [
  {
    id: 'test001-freshread-success',
    description: 'comprovante usa nome/valor FRESCOS do banco (não os do candidato)',
    category: 'functional', criticality: 'critical', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 2 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(candidate({ debtorName: 'Carlos', amount: 900 }));
      // banco devolve dados diferentes do candidato → prova que o fresh-read foi usado.
      setInstallmentReceiptRow({ number: 2, amount_total: 900, amount_paid: 0, due_date: '2026-04-10', paid_at: '2026-04-10T18:30:00Z', investmentId: 123, debtorName: 'Maria Fresca' });
    },
    steps: [
      { input: { text: 'baixar contrato 123 parcela 2' }, expect: { textIncludes: [CONFIRM_PAYMENT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Pagamento confirmado', 'Maria Fresca', 'R$ 900.00'], textExcludes: ['Cliente'], mockCalls: { markInstallmentPaid: 1 } } },
    ],
  },
  {
    id: 'test001-freshread-amount-paid',
    description: 'comprovante usa amount_paid quando > 0 (pagamento parcial)',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 2 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(candidate({ amount: 900 }));
      setInstallmentReceiptRow({ number: 2, amount_total: 900, amount_paid: 450, due_date: '2026-04-10', paid_at: '2026-04-10T18:30:00Z', investmentId: 123, debtorName: 'Carlos' });
    },
    steps: [
      { input: { text: 'baixar contrato 123 parcela 2' }, expect: { textIncludes: [CONFIRM_PAYMENT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Pagamento confirmado', 'R$ 450.00'], mockCalls: { markInstallmentPaid: 1 } } },
    ],
  },
  {
    id: 'test001-freshread-null-fallback',
    description: 'fresh=null (V44d) → cai no fallback do candidato sem quebrar',
    category: 'functional', criticality: 'core', failureTag: 'response_regression',
    setup: (ctx) => {
      routePay({ contract_id: 123, installment_number: 2 })(ctx);
      ctx.mocks.getContractOpenInstallmentByNumber.mockResolvedValue(candidate({ debtorName: 'Carlos', amount: 900 }));
      // não seta receipt row → fresh-read retorna null → fallback usa o candidato.
    },
    steps: [
      { input: { text: 'baixar contrato 123 parcela 2' }, expect: { textIncludes: [CONFIRM_PAYMENT] } },
      { input: { text: 'sim' }, expect: { textIncludes: ['Pagamento confirmado', 'Carlos', 'R$ 900.00'], mockCalls: { markInstallmentPaid: 1 } } },
    ],
  },
  {
    id: 'test001-disconnect-bot-confirm',
    description: 'disconnect_bot: confirmação executa a desvinculação (disconnectBot 1×)',
    category: 'functional', criticality: 'core', failureTag: 'bad_confirmation_flow',
    setup: (ctx) => {
      ctx.mocks.routeIntent.mockResolvedValue({ intent: 'desconectar', entities: {}, normalizedEntities: {}, confidence: 'high', source: 'rule' });
      ctx.mocks.disconnectBot.mockResolvedValue(true);
    },
    steps: [
      { input: { text: 'desconectar' }, expect: { textIncludes: ['desconectar este chat'], mockCalls: { disconnectBot: 0 } } },
      { input: { text: 'sim' }, expect: { textIncludes: ['desvinculada com sucesso'], mockCalls: { disconnectBot: 1 } } },
    ],
  },
];

describe('TEST-001 — confiabilidade (fresh-read + disconnect)', () => {
  for (const testCase of CASES) {
    it(`${testCase.id} — ${testCase.description}`, async () => {
      const result = await runAgentEvalCase(testCase);
      if (result.status !== 'pass') throw new Error(`[${testCase.id}] ${result.status}: ${result.details}`);
      expect(result.status).toBe('pass');
    });
  }
});
