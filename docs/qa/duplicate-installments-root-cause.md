# Root Cause: parcelas duplicadas em contratos

## Diagnóstico fechado
O problema não era apenas de renderização no front.

A duplicação acontecia no banco de dados durante a criação do contrato:

1. `public.create_investment_validated(...)` já cria o registro em `investments` e insere as parcelas em `loan_installments`.
2. Ao mesmo tempo, o banco ainda mantém um trigger em `public.investments` identificado no fluxo do produto como `on_investment_created_generate_installments`.
3. Resultado: cada criação de contrato gera dois conjuntos de parcelas para o mesmo `investment_id`.

## Evidência usada
- Contrato real no tenant de teste com linhas duplicadas em `loan_installments`.
- Reprodução isolada chamando a RPC `create_investment_validated` e lendo as parcelas logo depois.
- Busca no código do app e do bot não encontrou criação direta em `investments`; o caminho suportado é a RPC.

## Causa raiz
Dois geradores de parcelas ativos para o mesmo evento de criação do contrato:

- gerador 1: RPC `create_investment_validated`
- gerador 2: trigger em `public.investments`

## Correção definitiva recomendada
1. Manter a RPC `create_investment_validated` como fonte única de geração de parcelas.
2. Remover o trigger redundante `on_investment_created_generate_installments`.
3. Limpar o legado existente em `loan_installments`.
4. Criar uma trava de unicidade em `(investment_id, number)` para impedir retorno silencioso do problema.

## Contenção já aplicada
- Frontend:
  - deduplicação defensiva nas leituras
  - limpeza automática logo após criar contrato
- Bot:
  - limpeza automática logo após `create_investment_validated`

Essas proteções reduzem o dano, mas não substituem o fix estrutural no banco.

## Script
O patch SQL definitivo está em:

- [fix-duplicate-installments.sql](/Users/guilhermefrota/Documents/New project/e-finance-app-remote/docs/qa/fix-duplicate-installments.sql)
