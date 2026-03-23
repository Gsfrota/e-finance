# Story: Contract Creation Hardening

## Objetivo

Endurecer a criação de contrato por mensagem e áudio para que o bot só confirme quando todos os campos críticos estiverem realmente entendidos, perguntando apenas pelos dados faltantes ou incertos.

## Checklist

- [x] Remover defaults implícitos de juros, parcelas e frequência no parse inicial
- [x] Melhorar extração natural de frequência, dia de cobrança, data inicial, parcela única e sem juros
- [x] Suportar fluxo guiado para contratos quinzenais e diários com data inicial
- [x] Cobrir texto e áudio com testes de wizard e smoke

## File List

- `src/actions/admin-actions.ts`
- `src/handlers/message-handler.ts`
- `src/tools/formatters.ts`
- `tests/admin-actions.test.ts`
- `tests/message-handler.test.ts`
- `tests/conversation-smoke.test.ts`
- `docs/stories/contract-creation-hardening.md`
