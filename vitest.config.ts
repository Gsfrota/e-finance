import path from 'path';
import { defineConfig } from 'vitest/config';

// Camada A (unit puro): funções de dinheiro sem I/O — nem browser, nem banco.
// Roda em milissegundos. Regra da suíte: cada teste afirma um NÚMERO EXATO
// derivado da leitura do código-fonte; nada de toBeGreaterThan(0).
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
