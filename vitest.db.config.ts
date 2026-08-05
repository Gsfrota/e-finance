import path from 'path';
import { defineConfig } from 'vitest/config';

// Camada B (contrato de banco): PostgREST + RPC reais, sem browser.
//
// Config SEPARADA de propósito. Estes testes TOCAM PRODUÇÃO (tenant de QA) e
// FALHAM DE PROPÓSITO enquanto os bugs que provam existirem — não podem entrar
// no gate de deploy. Não estão em nenhum tier do .github/workflows/deploy.yml,
// e a extensão `.dbspec.ts` não casa com o testMatch padrão do Playwright,
// então `npx playwright test` também os ignora.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['e2e/contract-db/**/*.dbspec.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Um único tenant de QA: nada roda em paralelo contra o mesmo dado.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
