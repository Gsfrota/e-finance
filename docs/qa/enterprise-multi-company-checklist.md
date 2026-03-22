# QA Checklist — Enterprise Multiempresa

Checklist de regressão e aceite para a feature multiempresa no trial e no plano `empresarial`.

## Banco

- `companies` existe.
- todo tenant legado tem exatamente 1 company primária.
- `profiles.company_id` está preenchido.
- `invites.company_id` está preenchido.
- `investments.company_id` está preenchido.
- `loan_installments.company_id` está preenchido.
- `contract_renegotiations.company_id` está preenchido.
- `avulso_payments.company_id` está preenchido.

## Login e contexto

- admin com trial ativo ou `empresarial` ativo entra no app sem erro.
- switcher aparece no topo apenas para admin.
- valor padrão do switcher é `Todas as empresas`.
- logout limpa o escopo da company e não reaproveita contexto antigo.

## Upsell e bloqueio

- admin sem trial e sem `empresarial` vê switcher bloqueado.
- o CTA do switcher bloqueado leva para `Configurações > Assinatura`.
- investor e debtor não veem switcher.
- após o fim do trial sem upgrade, a company primária continua acessível.
- após o fim do trial sem upgrade, companies extras continuam salvas, mas bloqueadas.

## Visão consolidada

- `HOME` abre em modo consolidado.
- breakdown por company aparece.
- `DASHBOARD` agrega sem misturar tenant externo.
- `TOP_CLIENTES` agrega e não duplica clientes por troca de escopo.
- `COLLECTION` em `all` mostra apenas resumo consolidado.

## Visão por company

- trocar o switcher atualiza os números.
- `USERS` mostra só usuários da company ativa.
- `CONTRACTS` mostra só contratos da company ativa.
- `LEGACY_CONTRACT` exige company ativa.
- `SETTINGS > Empresa` edita apenas a company ativa.

## Mutações

- criar cliente grava `company_id` correto.
- criar convite grava `company_id` correto.
- criar contrato grava `company_id` em `investments`.
- parcelas novas herdam `company_id`.
- renovação e renegociação preservam `company_id`.
- pagamentos e cobranças não vazam entre companies.

## Regressões antigas

- usuário com `auth_user_id != profiles.id` continua funcionando.
- admin conhecido continua vendo o tenant correto.
- fluxo devedor continua vendo apenas seus contratos.
- fluxo investidor continua vendo apenas sua carteira.

## Smoke mínimo recomendado

1. login com admin em trial ou enterprise;
2. validar `Todas as empresas`;
3. trocar para a company A;
4. abrir `USERS`;
5. abrir `CONTRACTS`;
6. trocar para a company B;
7. comparar números;
8. voltar para `Todas as empresas`;
9. confirmar que o consolidado bate com A + B.
