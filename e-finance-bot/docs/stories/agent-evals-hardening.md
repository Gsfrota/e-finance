# Story: Agent Evals Hardening

## Objetivo

Criar uma suíte formal de avaliação do agente com scorecard e gates por categoria para elevar a confiabilidade operacional do assistente.

## Checklist

- [x] Criar contratos e dataset versionado de agent evals
- [x] Criar harness determinístico sobre `handleMessage`
- [x] Adicionar gate com scorecard agregado
- [x] Documentar comandos e thresholds
- [x] Endurecer áudio, linguagem regional e memória efêmera de fallback

## File List

- `tests/agent-evals.test.ts`
- `tests/evals/contracts.ts`
- `tests/evals/dataset.ts`
- `tests/evals/harness.ts`
- `docs/agent-evals.md`
- `docs/stories/agent-evals-hardening.md`
- `package.json`
- `README.md`
- `src/ai/audio-pipeline.ts`
- `src/ai/intent-router.ts`
- `src/ai/intent-classifier.ts`
- `src/assistant/command-understanding.ts`
- `src/session/session-manager.ts`
- `src/handlers/message-handler.ts`
- `src/utils/ptbr-regional-normalizer.ts`
- `tests/audio-pipeline.test.ts`
- `tests/intent-router.test.ts`
- `tests/session-manager.test.ts`
