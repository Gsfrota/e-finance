import { describe, it, expect } from 'vitest';
import { shouldReload } from '@/services/autoUpdate';

describe('autoUpdate.shouldReload', () => {
  it('não recarrega quando servidor e rodando são iguais', () => {
    expect(shouldReload('abc1234', 'abc1234', null)).toBe(false);
  });

  it('recarrega quando o servidor tem versão diferente', () => {
    expect(shouldReload('abc1234', 'def5678', null)).toBe(true);
  });

  it('nunca recarrega em dev (local sem commit)', () => {
    expect(shouldReload('dev', 'def5678', null)).toBe(false);
    expect(shouldReload('abc1234', 'dev', null)).toBe(false);
  });

  it('não recarrega sem resposta do servidor (offline)', () => {
    expect(shouldReload('abc1234', null, null)).toBe(false);
    expect(shouldReload('abc1234', undefined, null)).toBe(false);
  });

  it('guarda anti-loop: não recarrega de novo para a MESMA versão-alvo já tentada', () => {
    // Reload já aconteceu para def5678, mas o aparelho ainda roda abc1234
    // (ex.: service worker servindo bundle antigo). Não deve ficar em loop.
    expect(shouldReload('abc1234', 'def5678', 'def5678')).toBe(false);
  });

  it('recarrega se surgiu uma versão AINDA mais nova que a já tentada', () => {
    expect(shouldReload('abc1234', 'ghi9012', 'def5678')).toBe(true);
  });
});
