# NLU Learning Track (e-finance-bot)

## Objetivo
Evoluir compreensão natural do bot sem treinar modelo próprio, com ciclo contínuo de:
1. Curadoria de frases reais.
2. Avaliação offline automatizada.
3. Ajuste de regras/normalização e prompts.
4. Revalidação antes de deploy.

## Dataset Curado
- Fonte inicial: conversas reais anonimizadas + casos de regressão.
- Cobertura mínima:
  - Dashboard, recebíveis, contrato, pagamento, relatório, convite, desconectar.
  - Comandos curtos (`/contrato`, `/recebiveis`, `/pagamento`).
  - Frases ambíguas para validar clarificação.
- Avaliação implementada em: `tests/nlu-curated-eval.test.ts`.

## Critérios de Qualidade
- Acurácia de intent no dataset curado: `>= 90%`.
- Casos de baixa confiança: `100%` com resposta de clarificação.
- Guardrails de prompt injection permanecem ativos.

## Operação
- Rodar avaliação offline:
```bash
npm test -- tests/nlu-curated-eval.test.ts
```
- Rodar regressão completa:
```bash
npm test
npm run build
```

## Referências oficiais usadas
- Gemini Structured Output: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini Function Calling: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini Prompting Strategies: https://ai.google.dev/gemini-api/docs/prompting-strategies
- Rasa Training Data format: https://rasa.com/docs/reference/primitives/training-data-format/
- Dialogflow CX agent design: https://cloud.google.com/dialogflow/cx/docs/concept/agent-design
