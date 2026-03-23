# Story: CPF Query Hardening

## Objetivo

Permitir que o bot resolva consultas de dívida por CPF com a mesma fluidez das consultas por nome, mesmo quando o roteador não extrai a entidade do devedor.

## Checklist

- [x] Extrair CPF de perguntas naturais de dívida no `command-understanding`
- [x] Resolver busca exata por CPF em `searchUser`
- [x] Cobrir fluxo com testes unitários e de integração do `message-handler`

## File List

- `src/assistant/command-understanding.ts`
- `src/actions/admin-actions.ts`
- `tests/command-understanding.test.ts`
- `tests/message-handler.test.ts`
- `docs/stories/cpf-query-hardening.md`
