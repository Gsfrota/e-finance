# Business Rules — E-Finance

> Documento normativo. Toda feature e bug fix deve referenciar as BRs aplicáveis.
> Mantenedor: @po (Pax)
> Última atualização: 26/03/2026

---

## Estrutura

Cada BR segue o formato:
- **ID:** `BR-{categoria}-{número}` (ex: `BR-CNT-001`)
- **Descrição:** O que a regra determina
- **Condição:** Quando se aplica
- **Resultado:** O que deve acontecer
- **Exceções:** Casos especiais
- **Tabelas:** Tabelas do banco afetadas
- **Status:** `ativa | deprecada | pendente`
- **Stories:** IDs/commits que implementam esta BR

Categorias:
- `CNT` — Contratos (investments)
- `PAG` — Pagamentos (loan_installments, payment_transactions)
- `REL` — Relatórios e Extratos (views, histórico, recebimentos)
- `USR` — Usuários e Perfis (profiles, invites)
- `TEN` — Multi-tenant e Multi-empresa (tenants, companies)
- `SYS` — Sistema (regras transversais)

---

## Contratos (CNT)

### BR-CNT-001: Contrato exige investidor e devedor distintos
- **Descrição:** Um contrato não pode ter o mesmo usuário como investidor e devedor
- **Condição:** Ao criar `investments`
- **Resultado:** `user_id != payer_id` — rejeitar se iguais
- **Exceções:** Nenhuma
- **Tabelas:** `investments`
- **Status:** ativa

### BR-CNT-002: Taxa de juros é positiva ou zero
- **Descrição:** A taxa de juros não pode ser negativa
- **Condição:** Ao criar ou editar `investments.interest_rate`
- **Resultado:** `interest_rate >= 0` — rejeitar valores negativos
- **Exceções:** Nenhuma
- **Tabelas:** `investments`
- **Status:** ativa

### BR-CNT-003: Parcelas mensais exigem número mínimo de 1
- **Descrição:** Um contrato deve ter pelo menos 1 parcela
- **Condição:** Ao criar `investments` com `frequency = monthly`
- **Resultado:** `total_installments >= 1`
- **Exceções:** Modalidade bullet (interest_only) pode ter ciclo indefinido
- **Tabelas:** `investments`, `loan_installments`
- **Status:** ativa

### BR-CNT-004: Modalidade bullet paga apenas juros nas parcelas intermediárias
- **Descrição:** Na modalidade bullet, parcelas intermediárias contêm apenas `amount_interest`. O principal é devolvido somente na última parcela
- **Condição:** `investments.calculation_mode = 'interest_only'`
- **Resultado:** `loan_installments.amount_principal = 0` para todas exceto a última; última parcela tem `amount_principal = investments.amount_invested`
- **Exceções:** Nenhuma
- **Tabelas:** `investments`, `loan_installments`
- **Status:** ativa

### BR-CNT-005: Capital de origem deve ser classificado
- **Descrição:** Todo contrato deve ter origem do capital identificada
- **Condição:** Ao criar `investments`
- **Resultado:** `source_capital + source_profit = amount_invested` (podem ser parciais, mas a soma deve bater)
- **Exceções:** Pode ser 100% `source_capital` ou 100% `source_profit`
- **Tabelas:** `investments`
- **Status:** ativa

### BR-CNT-006: Contrato pertence a exatamente uma empresa
- **Descrição:** Todo contrato deve estar vinculado a uma `company_id` válida dentro do tenant
- **Condição:** Ao criar `investments`
- **Resultado:** `company_id` não pode ser null em novos contratos
- **Exceções:** Contratos legados pré-multiempresa podem ter `company_id` null durante rollout
- **Tabelas:** `investments`, `loan_installments`
- **Status:** ativa

---

## Pagamentos (PAG)

### BR-PAG-001: Valor pago não pode exceder o total com encargos
- **Descrição:** O valor informado em um pagamento não pode ser maior que `amount_total + fine_amount + interest_delay_amount`
- **Condição:** Ao executar `pay_installment`
- **Resultado:** Rejeitar pagamento ou tratar excedente como surplus (ver BR-PAG-003)
- **Exceções:** Nenhuma
- **Tabelas:** `loan_installments`
- **Status:** ativa

### BR-PAG-002: Parcela paga não pode ser paga novamente
- **Descrição:** Uma parcela com `status = paid` não aceita novo pagamento
- **Condição:** Ao executar qualquer RPC de pagamento
- **Resultado:** Rejeitar com erro "parcela já quitada"
- **Exceções:** Reversão (`reversal`) é operação administrativa distinta e permitida
- **Tabelas:** `loan_installments`
- **Status:** ativa

### BR-PAG-003: Surplus residual após pagamento com atraso deve ter destino obrigatório
- **Descrição:** Quando um pagamento em atraso gera surplus (pago a mais), esse valor não pode sumir — deve ser direcionado: próxima parcela (`next`), última parcela (`last`) ou distribuído (`spread`)
- **Condição:** `pay_late` gera `surplus_amount > 0`
- **Resultado:** `apply_surplus_action` deve ser chamado obrigatoriamente com destino válido
- **Exceções:** Nenhuma — esta regra não tem exceção
- **Tabelas:** `loan_installments`
- **Status:** ativa
- **Stories:** fix b614b98

### BR-PAG-004: Juros de mora incidem sobre valor principal
- **Descrição:** O cálculo de `interest_delay_amount` usa como base o valor principal da parcela, não o total com juros
- **Condição:** Ao calcular encargos de atraso
- **Resultado:** `interest_delay_amount = amount_principal * (delay_rate / 100) * dias_atraso`
- **Exceções:** Configuração de tenant pode alterar a base de cálculo (a definir)
- **Tabelas:** `loan_installments`
- **Status:** ativa

### BR-PAG-005: Pagamento parcial cria status "partial", não "paid"
- **Descrição:** Se `amount_paid < amount_total`, o status da parcela é `partial`, não `paid`
- **Condição:** Ao executar `pay_installment` com valor menor que o devido
- **Resultado:** `status = 'partial'`, `remainder_amount = amount_total - amount_paid`
- **Exceções:** Nenhuma
- **Tabelas:** `loan_installments`
- **Status:** ativa

### BR-PAG-006: Toda RPC de pagamento usa SELECT FOR UPDATE
- **Descrição:** Para evitar race conditions em pagamentos concorrentes, todas as RPCs que leem `loan_installments` para alteração devem usar `FOR UPDATE`
- **Condição:** Qualquer RPC que modifica `loan_installments`
- **Resultado:** Lock de linha antes de qualquer modificação
- **Exceções:** Queries de leitura pura (reports, dashboards) não precisam de FOR UPDATE
- **Tabelas:** `loan_installments`
- **Status:** ativa

### BR-PAG-007: Ação `next` de surplus aplica na próxima parcela numericamente posterior
- **Descrição:** A ação `next` em `apply_surplus_action` filtra parcelas com `number > numero_da_parcela_atual`, não a primeira parcela pendente do contrato
- **Condição:** `apply_surplus_action` com `action = 'next'`
- **Resultado:** `WHERE number > v_src.number AND status IN ('pending', 'partial', 'late')`
- **Exceções:** Nenhuma
- **Tabelas:** `loan_installments`
- **Status:** ativa
- **Stories:** fix 86c4410

### BR-PAG-008: Pagamento via PIX usa código gerado pelo serviço pix.ts
- **Descrição:** Todo pagamento via PIX deve usar o código gerado por `services/pix.ts`, nunca string hardcodada
- **Condição:** Qualquer componente que exibe QR Code ou chave PIX
- **Resultado:** Chamar `generatePixCode(...)` de `services/pix.ts`
- **Exceções:** Testes podem usar strings mockadas
- **Tabelas:** Nenhuma (frontend only)
- **Status:** ativa

---

## Relatórios e Extratos (REL)

### BR-REL-001: Histórico de recebimentos agrupado por evento
- **Descrição:** O histórico de recebimentos do investidor deve agrupar transações por evento de pagamento (mesmo `receipt_id` ou mesmo minuto para transações legadas), exibindo uma linha por evento com valor total e detalhes expandíveis
- **Condição:** Tela de histórico do investidor (`InvestorDashboard`)
- **Resultado:** Uma linha por pagamento real, não uma linha por `payment_transaction`
- **Exceções:** Transações sem `receipt_id` agrupam por `investment_id + minuto`
- **Tabelas:** `payment_transactions`, `loan_installments`
- **Status:** ativa
- **Stories:** feat 311f8ca

### BR-REL-002: Parcelas fantasmas (deferidas) são omitidas do extrato de recebimentos
- **Descrição:** Parcelas resultantes de `mark_installment_missed` que foram zeradas e marcadas como `paid` não devem aparecer no extrato de recebimentos do investidor. Essas parcelas têm `amount_total = 0`, `amount_paid = 0` e `status = 'paid'`, e possuem uma parcela substituta com `deferred_from_id` apontando para elas.
- **Condição:** Qualquer query ou view que exibe recebimentos/salário do investidor
- **Resultado:** Filtrar `WHERE NOT (amount_total = 0 AND amount_paid = 0 AND status = 'paid')` nas queries de recebimentos — ou equivalente: excluir parcelas que são referenciadas como `deferred_from_id` por outra parcela
- **Exceções:** Parcelas com `amount_paid > 0` sempre aparecem, mesmo que `amount_total = 0`
- **Tabelas:** `loan_installments`, `view_investor_balances` (ou equivalente)
- **Status:** ativa
- **Stories:** análise 26/03/2026 — parcela 883e405a do contrato 499

---

## Usuários e Perfis (USR)

### BR-USR-001: Todo usuário tem exatamente um role
- **Descrição:** Um perfil só pode ter um role: `admin`, `investor` ou `debtor`
- **Condição:** Ao criar ou editar `profiles`
- **Resultado:** `role IN ('admin', 'investor', 'debtor')`
- **Exceções:** Nenhuma — sem roles compostos no v1
- **Tabelas:** `profiles`
- **Status:** ativa

### BR-USR-002: Admin vê todo o tenant; investor e debtor isolados por empresa
- **Descrição:** `admin` pode ver dados de todas as empresas do tenant. `investor` e `debtor` só enxergam dados da própria `company_id`
- **Condição:** Todas as queries e RLS policies
- **Resultado:** RLS filtra por `company_id` para investor/debtor; admin não é filtrado por company
- **Exceções:** Admin pode usar o switcher de empresa no frontend para filtrar voluntariamente
- **Tabelas:** `profiles`, `investments`, `loan_installments`, `invites`
- **Status:** ativa

### BR-USR-003: Convite associa usuário a empresa específica
- **Descrição:** Um convite deve carregar `company_id` para que o perfil criado via convite já nasça vinculado à empresa correta
- **Condição:** Ao criar `invites`
- **Resultado:** `invites.company_id` não pode ser null
- **Exceções:** Convites legados pré-multiempresa
- **Tabelas:** `invites`, `profiles`
- **Status:** ativa

### BR-USR-004: CPF válido é obrigatório para devedores
- **Descrição:** O CPF de um devedor deve passar pela validação de dígitos verificadores
- **Condição:** Ao criar ou editar perfil com `role = 'debtor'`
- **Resultado:** `isValidCPF(cpf) === true` (helper em `services/supabase.ts`)
- **Exceções:** Testes podem usar CPFs de teste padrão apenas em ambiente de dev
- **Tabelas:** `profiles`
- **Status:** ativa

---

## Multi-tenant e Multi-empresa (TEN)

### BR-TEN-001: Cada tenant tem exatamente uma empresa primária
- **Descrição:** Sempre deve existir exatamente 1 `company` com `is_primary = true` por tenant
- **Condição:** Ao criar tenant, ao deletar company
- **Resultado:** Garantido por `ensure_primary_company()` — nunca deletar a company primária
- **Exceções:** Nenhuma
- **Tabelas:** `companies`
- **Status:** ativa

### BR-TEN-002: Acesso multi-empresa requer trial ativo ou plano empresarial
- **Descrição:** O switcher de empresa e funcionalidades multi-empresa só são liberadas quando o tenant tem trial ativo (`trial_ends_at > now()`) ou plano `empresarial` com `plan_status = 'active'`
- **Condição:** Ao verificar entitlement no frontend
- **Resultado:** Fora dessas condições, exibir switcher em modo `upsell_locked`
- **Exceções:** Nenhuma
- **Tabelas:** `tenants`
- **Status:** ativa

### BR-TEN-003: Empresas extras não são deletadas ao perder entitlement
- **Descrição:** Quando trial expira ou plano deixa de ser empresarial, as companies extras continuam existindo — apenas ficam inacessíveis via switcher
- **Condição:** Ao expirar trial ou downgrade de plano
- **Resultado:** Nenhuma `company` é deletada automaticamente
- **Exceções:** Exclusão manual por admin é permitida
- **Tabelas:** `companies`, `tenants`
- **Status:** ativa

### BR-TEN-004: Novos dados operacionais SEMPRE recebem company_id
- **Descrição:** Qualquer nova linha em tabelas operacionais deve receber `company_id` válido
- **Condição:** Qualquer INSERT nas tabelas operacionais
- **Resultado:** `company_id` not null, FK para `companies.id` do mesmo tenant
- **Exceções:** Dados legados pré-rollout e `bot_tenant_config` (tenant-level no v1)
- **Tabelas:** `investments`, `loan_installments`, `profiles`, `invites`
- **Status:** ativa

---

## Sistema (SYS)

### BR-SYS-001: UI em PT-BR obrigatório
- **Descrição:** Todas as strings visíveis ao usuário devem estar em Português Brasileiro. Mensagens de erro do `parseSupabaseError` também em PT-BR
- **Condição:** Qualquer componente ou mensagem de erro
- **Resultado:** Sem strings em inglês na UI
- **Exceções:** Nomes técnicos (PIX, CPF), termos de código interno
- **Tabelas:** Nenhuma (frontend only)
- **Status:** ativa

### BR-SYS-002: Credenciais Supabase não são hardcodadas
- **Descrição:** As credenciais do Supabase são lidas de `window._env_` primeiro, depois de env vars Vite, e em dev local do localStorage
- **Condição:** Qualquer código que instancia o cliente Supabase
- **Resultado:** Usar `getSupabaseClient()` de `services/supabase.ts`, nunca instanciar diretamente
- **Exceções:** O próprio `services/supabase.ts` que implementa a lógica de leitura
- **Tabelas:** Nenhuma
- **Status:** ativa

### BR-SYS-003: Deploy sempre via CI/CD, nunca manual
- **Descrição:** O deploy do e-finance vai para Cloud Run via GitHub Actions ao fazer push na main. Nunca executar `./deploy.sh` manual em produção
- **Condição:** Qualquer mudança pronta para produção
- **Resultado:** Commit + push na main → GitHub Actions dispara automaticamente
- **Exceções:** Hotfixes emergenciais autorizados pelo dono do projeto
- **Tabelas:** Nenhuma
- **Status:** ativa

### BR-DB-001: Migrations de RPC devem dropar overloads anteriores explicitamente
- **Descrição:** Ao adicionar parâmetros a uma função PostgreSQL existente, `CREATE OR REPLACE FUNCTION` com assinatura diferente NÃO substitui a versão anterior — cria um novo overload. Múltiplos overloads com parâmetros opcionais causam erro "Could not choose the best candidate function" em runtime
- **Condição:** Qualquer migration que modifique a assinatura de uma função em `public.*`
- **Resultado:** O script de migration DEVE incluir `DROP FUNCTION IF EXISTS` para CADA versão anterior antes do `CREATE OR REPLACE` da nova versão. Usar `context/TEMPLATE_rpc_migration.sql` como base
- **Verificação:** Após aplicar, confirmar que `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='nome_funcao'` retorna exatamente 1. Script: `scripts/check-db-overloads.sh`
- **Exceções:** Overloads intencionais com tipos radicalmente diferentes (ex: `funcao(uuid)` e `funcao(text)`) são permitidos — mas devem ser documentados explicitamente na migration
- **Tabelas:** Qualquer função em `public.*`
- **Status:** ativa
- **Origem:** Bug crítico 2026-03-26 — `create_investment_validated` acumulou 5 overloads entre v28 e v33, bloqueando criação de contratos. Corrigido em `context/migration_v34_drop_overloads.sql`

---

## Backlog de BRs a Formalizar

> BRs identificadas mas ainda não totalmente especificadas.
> @po deve elaborar ao receber solicitações relacionadas, sempre consultando o usuário.

| Área | Descrição resumida | Prioridade |
|------|--------------------|-----------|
| PAG | Cálculo de multa por atraso (percentual vs fixo, prazo de carência) | Alta |
| CNT | Regras de renegociação (quem pode, quando, quais campos mudam) | Alta |
| CNT | Antecipação de parcelas (desconto apenas sobre juros futuros) | Média |
| USR | Regras de onboarding por convite vs OAuth | Média |
| TEN | Regras de billing e upgrade/downgrade de plano | Baixa |
