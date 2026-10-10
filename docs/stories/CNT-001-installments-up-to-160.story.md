# CNT-001 — Parcelamento até 160x

**Status:** Ready for Review
**Criada em:** 2026-10-10
**Origem:** pedido do cliente: “as parcelas sejam até 160x”.

## Necessidade

Permitir configurar contratos parcelados com até 160 parcelas. Atualmente, os controles de quantidade em `components/AdminContracts.tsx` limitam o valor a 120.

## Acceptance Criteria

- **AC-1:** O botão de incremento permite alcançar 160 parcelas.
- **AC-2:** A digitação da quantidade aceita valores entre 1 e 160, inclusive, ao confirmar o campo.
- **AC-3:** Incremento e confirmação de valores acima de 160 mantêm a quantidade limitada a 160; o mínimo continua sendo 1.
- **AC-4:** O valor interno de 120 usado como sentinel no modo `interest_only` (juros simples/bullet) permanece preservado.

## Checklist

- [x] Registrar o pedido e os critérios de aceite.
- [x] Atualizar os limites do controle de parcelas.
- [x] Verificar seleção, digitação e limites de 1 e 160.
- [x] Verificar preservação do sentinel 120 em `interest_only`.
- [x] Executar `npm run lint`.
- [x] Executar `npm run typecheck`.
- [x] Executar `npm test`.
- [x] Executar `npm run build`.
- [x] Atualizar checklist, resultados e File List antes de concluir.

## File List

- `components/AdminContracts.tsx` — limites de confirmação do campo e incremento alterados de 120 para 160.
- `e2e/regression/frontend-resilience.spec.ts` — teste CNT-001 do formulário no navegador, com Supabase mockado.
- `docs/stories/CNT-001-installments-up-to-160.story.md` — story e acompanhamento.

## Resultados de validação

- `npm test`: aprovado, 9 testes Playwright, incluindo CNT-001 no formulário real: aceita 120, 159 e 160; limita 161 a 160; zero e vazio viram 1; decremento preserva mínimo 1; incremento chega a 160 e mantém o teto. O comando também executou `npm run lint`, `npm run typecheck` e `npm run build`, todos aprovados.
- Verificação pontual via Node das expressões reais do componente: entrada vazia e zero resultam em 1; 120, 159 e 160 são aceitos; 161 é limitado a 160; incremento permite 120 → 121 e 159 → 160 e mantém 160 no teto. Sentinel 120 preservado. Esta verificação não substitui uma interação manual no formulário.
- Build emitiu aviso de tamanho de bundle acima de 500 kB, sem impedir a conclusão.
