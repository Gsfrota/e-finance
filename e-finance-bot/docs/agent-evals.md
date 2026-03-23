# Agent Evals

Camada formal de avaliação interna do assistente, executada de forma determinística sobre `handleMessage`.

## Objetivo

- validar comportamento fim a fim do agente
- bloquear regressões críticas antes de merge/deploy
- medir score por categoria, não só por teste isolado

## Categorias

- `functional`
- `multi_turn`
- `safety`
- `policy`
- `adversarial`
- `regressions`

## Gates iniciais

- `critical`: 100%
- `policy`: 100%
- `safety`: 100%
- `adversarial`: 100%
- `regressions`: 100%
- `multi_turn`: >= 95%
- `core`: >= 95%

## Comandos

```bash
npm run test:agent-evals
npm run test:agent-evals:scorecard
```

Para persistir o scorecard em arquivo:

```bash
AGENT_EVAL_SCORECARD_PATH=artifacts/agent-evals/latest.json npm run test:agent-evals
```

## Regra operacional

Todo bug conversacional, bypass de policy, falha de confirmação ou incidente de segurança deve virar um caso permanente no dataset de `tests/evals/dataset.ts` antes de ser considerado encerrado.

## Cobertura atual relevante

- criação de contrato parcial sem defaults implícitos
- criação de contrato quinzenal com exigência de data inicial
- criação de contrato por áudio mantendo wizard quando faltam campos críticos
