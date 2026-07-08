import { describe, expect, it } from 'vitest';
import { withHighAmountWarning } from '../src/assistant/executors/create-contract';

// Teto de sanidade: mesmo com os parsers corrigidos, qualquer caminho (incl. LLM)
// que gere um valor absurdo precisa alertar o usuário antes do "sim".
describe('withHighAmountWarning — teto de sanidade no preview de contrato', () => {
  const preview = '*Novo contrato — confirmar*\nPrincipal: *R$ 4.000.000,00*';

  it('destaca aviso quando o valor >= R$ 1.000.000, preservando o preview original', () => {
    const out = withHighAmountWarning(preview, 4_000_000);
    expect(out).toContain('⚠️');
    expect(out).toContain('R$ 4.000.000,00');
    expect(out.endsWith(preview)).toBe(true);
  });

  it('alerta exatamente no limite (R$ 1.000.000)', () => {
    expect(withHighAmountWarning(preview, 1_000_000)).toContain('⚠️');
  });

  it('não altera o preview para valores normais', () => {
    expect(withHighAmountWarning(preview, 4_000)).toBe(preview);
    expect(withHighAmountWarning(preview, 999_999)).toBe(preview);
  });
});
