/**
 * P5 — preservesAllFacts: garante que reescrita do LLM não muda valores/datas/CPFs.
 *
 * Cobertura crítica: o regex MONEY_RE precisa capturar R$ no formato BR
 * completo, com vírgula e centavos. Falsos negativos aqui = aceitar resposta
 * que perdeu centavos.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config', () => ({
  config: {
    gemini: { apiKey: '' },
    llmResponse: { enabled: false, timeoutMs: 1000, maxOutputTokens: 80 },
  },
}));

import { preservesAllFacts } from '../src/ai/response-generator';

describe('preservesAllFacts', () => {
  it('aceita reescrita que preserva todos os valores R$ com centavos', () => {
    const base = 'Você tem 5 parcelas, total R$ 1.234,56 a receber.';
    const rewrite = 'No mês: R$ 1.234,56 em 5 parcelas.';
    expect(preservesAllFacts(base, rewrite)).toBe(true);
  });

  it('REJEITA reescrita que perde centavos (truncamento)', () => {
    const base = 'Total R$ 1.234,56';
    const rewrite = 'Total R$ 1.234'; // perdeu ,56
    expect(preservesAllFacts(base, rewrite)).toBe(false);
  });

  it('REJEITA reescrita que muda valor monetário', () => {
    const base = 'Recebido R$ 100,00';
    const rewrite = 'Recebido R$ 1.000,00'; // mudou ordem de grandeza
    expect(preservesAllFacts(base, rewrite)).toBe(false);
  });

  it('aceita variações de espaço entre R$ e dígito', () => {
    const base = 'Total: R$ 500,00';
    const rewrite = 'Total: R$500,00';
    expect(preservesAllFacts(base, rewrite)).toBe(true);
  });

  it('preserva datas no formato DD/MM/YYYY', () => {
    const base = 'Vencimento 15/05/2026';
    const rewriteOk = 'Parcela vence 15/05/2026 amanhã.';
    const rewriteBad = 'Parcela vence 15/05/2027 amanhã.';
    expect(preservesAllFacts(base, rewriteOk)).toBe(true);
    expect(preservesAllFacts(base, rewriteBad)).toBe(false);
  });

  it('preserva CPF mascarado', () => {
    const base = 'Devedor João, CPF ***.***.***-25';
    const rewriteOk = 'João (***.***.***-25) deve...';
    const rewriteBad = 'João (***.***.***-99) deve...';
    expect(preservesAllFacts(base, rewriteOk)).toBe(true);
    expect(preservesAllFacts(base, rewriteBad)).toBe(false);
  });

  it('preserva taxa em %', () => {
    const base = 'Taxa de 2,5% ao mês';
    const rewriteOk = 'Cobra 2,5% mensalmente';
    const rewriteBad = 'Cobra 25% mensalmente';
    expect(preservesAllFacts(base, rewriteOk)).toBe(true);
    expect(preservesAllFacts(base, rewriteBad)).toBe(false);
  });

  it('aceita reescrita quando baseText não tem fatos numéricos', () => {
    const base = 'Como posso ajudar hoje?';
    const rewrite = 'Em que posso ser útil?';
    expect(preservesAllFacts(base, rewrite)).toBe(true);
  });

  it('detecta múltiplos valores — rejeita se um deles falta', () => {
    const base = 'João deve R$ 100,00 e Maria deve R$ 200,00';
    const rewriteOk = 'João: R$ 100,00. Maria: R$ 200,00.';
    const rewriteBad = 'Eles devem R$ 100,00 no total.'; // perdeu o R$ 200,00
    expect(preservesAllFacts(base, rewriteOk)).toBe(true);
    expect(preservesAllFacts(base, rewriteBad)).toBe(false);
  });
});
