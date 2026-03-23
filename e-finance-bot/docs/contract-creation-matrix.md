# Matriz de Criação de Contrato

## Objetivo

Listar as formas principais de criação de contrato que o bot deve aceitar por texto e áudio, e o que ele deve perguntar quando a mensagem vier incompleta.

## Campos críticos

- `debtor_name`
- `debtor_cpf`
- `amount`
- `rate`
- `installments`
- `frequency`

## Campos condicionais

- `due_day`
  Obrigatório para `monthly`
- `weekday`
  Obrigatório para `weekly`
- `start_date`
  Obrigatório para `biweekly` e `daily`

## Entradas que devem funcionar

- Completo mensal:
  `criar contrato para João Silva, CPF 529.982.247-25, R$ 5.000, 3% ao mês, 12 parcelas, todo dia 10`
- Completo semanal:
  `empréstimo para Maria Clara, CPF 52998224725, 2500, 5 parcelas semanais, toda sexta`
- Completo quinzenal:
  `contrato para Ana Paula, CPF 52998224725, 3 mil, sem juros, 6 parcelas quinzenais começando em 10/04/2026`
- Completo quinzenal regional:
  `contrato para Pedro Lima, CPF 529 982 247 25, 2 mil, sem juros, 4 parcelas de 15 em 15 começando em 10/04/2026`
- Completo diário:
  `criar contrato para Carlos, CPF 52998224725, 900 reais, 1% ao mês, 20 parcelas, todo santo dia, a partir de amanhã`
- Principal por total:
  `emprestar 1000 para Icaro, CPF 52998224725, receber 2000 em 10 parcelas todo dia 5`
- Parcela única:
  `contrato para Bruno, CPF 52998224725, 800 reais, sem juros, parcela única no dia 15`
- Áudio com dados completos:
  Deve ir direto para resumo + confirmação.
- Áudio com dados parciais:
  Deve manter o wizard e perguntar só o campo faltante.
- Áudio com CPF falado por extenso:
  `cpf cinco dois nove nove oito dois dois quatro sete dois cinco`
  Deve ser normalizado para `52998224725`.

## Regras de clarificação

- Não assumir `rate=0` a menos que o usuário diga `sem juros`, `sem taxa`, `juros zero` ou equivalente.
- Não assumir `installments=1` a menos que o usuário diga `à vista`, `parcela única`, `uma parcela` ou equivalente.
- Não assumir `frequency=monthly` quando a mensagem não disser a modalidade.
- Não confirmar contrato sem `due_day` para mensal.
- Não confirmar contrato sem `weekday` para semanal.
- Não confirmar contrato sem `start_date` para quinzenal ou diário.

## Ordem esperada das perguntas

1. Nome do devedor
2. CPF
3. Valor principal
4. Taxa
5. Parcelas
6. Frequência
7. Regra de vencimento condicional

## Casos já cobertos no código

- Wizard parcial por texto
- Wizard parcial por áudio
- Contrato quinzenal com data inicial
- Contrato com CPF em blocos
- Contrato com CPF falado por extenso em áudio
- Contrato com sinônimo regional de frequência
- Contrato por principal + total
- Fluxo CPF-first

## Próximos casos recomendados

- Datas relativas (`próxima segunda`, `semana que vem`)
- Contrato semanal com dia numérico e por nome na mesma suíte
- Áudio com nome soletrado
