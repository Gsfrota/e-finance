# Business Rules — E-Finance

> Documento normativo. Toda feature e bug fix deve referenciar as BRs aplicáveis.
> Mantenedor: @po (Pax)
> Última atualização: 28/03/2026

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
- `SUB` — Assinatura e Billing (tenants.plan, Stripe)
- `BOT` — Bot / Assistente IA (e-finance-bot, canais, automações)

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

### BR-CNT-007: Renovação cria vínculo parent→child e transita status
- **Descrição:** Ao renovar um contrato, o novo contrato deve ter `parent_investment_id` apontando para o original. O contrato original deve ter seu `status` alterado para `renewed`
- **Condição:** Ao executar `ContractRenewalModal` / lógica de renovação
- **Resultado:** `child.parent_investment_id = parent.id`, `parent.status = 'renewed'`. Novos contratos herdam investidor e devedor; taxas e prazo podem ser alterados
- **Exceções:** Contrato em status `defaulted` não pode ser renovado sem reverter o status primeiro (decisão administrativa)
- **Tabelas:** `investments`
- **Status:** ativa

### BR-CNT-008: Import legado valida dados e exige unicidade de código
- **Descrição:** A importação via `create_legacy_investment` deve validar: amount > 0, investidor e devedor válidos no tenant, número de parcelas pré-pagas ≤ total de parcelas. O `original_contract_code`, quando informado, deve ser único por tenant
- **Condição:** Ao executar `create_legacy_investment`
- **Resultado:** Rejeitar imports com dados inválidos. Se `original_contract_code` já existir no tenant, retornar erro de duplicidade
- **Exceções:** Nenhuma
- **Tabelas:** `investments`
- **Status:** ativa

### BR-CNT-009: Máquina de estados de contratos
- **Descrição:** O campo `investments.status` segue transições definidas. Apenas as transições listadas são permitidas
- **Condição:** Qualquer operação que altera `investments.status`
- **Resultado:** Transições válidas: `active → completed` (todas parcelas pagas), `active → defaulted` (manual admin ou 90+ dias sem pagamento), `active → renewed` (renovação criada), `completed → active` (reversão administrativa). Nenhuma outra transição é permitida
- **Exceções:** Migrações de dados (scripts DBA com acesso direto) são tratadas separadamente
- **Tabelas:** `investments`
- **Status:** ativa

### BR-CNT-010: Cálculo de multa por atraso — base e carência
- **Descrição:** A multa por atraso (`fine_amount`) incide sobre o valor principal da parcela, não sobre o total. Existe carência configurável por tenant (padrão: 0 dias). Após a carência, a multa é aplicada integralmente
- **Condição:** Ao calcular encargos de atraso em `update_overdue_installments` ou ao exibir parcelas
- **Resultado:** `fine_amount = amount_principal * (fine_rate / 100)` aplicado após carência. `interest_delay_amount` calculado separadamente conforme BR-PAG-004
- **Exceções:** Tenant pode ter `fine_rate = 0` (sem multa)
- **Tabelas:** `loan_installments`, `tenants` (configuração de carência)
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

### BR-PAG-009: Auditoria financeira é obrigatória — não pode ser silenciada
- **Descrição:** Toda mutação financeira (pagamento, reversão, refinanciamento, override admin, avulso) DEVE gravar um registro em `payment_transactions`. A falha no audit não pode ser silenciada — deve falhar a operação principal ou ser retentada
- **Condição:** Qualquer RPC ou service que altera saldo/status de parcela
- **Resultado:** `payment_transactions` INSERT obrigatório. O padrão atual de `catch` silencioso em `paymentAudit.ts` deve ser substituído por re-throw ou retry
- **Exceções:** Operações de leitura pura, dashboards e relatórios
- **Tabelas:** `payment_transactions`
- **Status:** ativa

### BR-PAG-010: Preview dinâmico de alocação múltipla de excedente
- **Descrição:** Quando o valor excedente de um pagamento cobre mais de uma parcela via ação `next` ou `last`, a interface deve exibir label no plural e preview expansível listando quais parcelas serão quitadas, qual terá pagamento parcial, e quantas restam após a alocação
- **Condição:** Tela de alocação de excedente (`InstallmentModals`, `InstallmentDetailFlow`) quando `nextPreview.length > 1` ou `lastPreview.length > 1`
- **Resultado:** Label "Próximas parcelas" / "Últimas parcelas" com sublabel "N quitadas · M restantes" e preview expansível por parcela
- **Exceções:** Quando cobre apenas uma parcela, manter comportamento singular atual
- **Tabelas:** Nenhuma (frontend only)
- **Status:** ativa
- **Stories:** fix/br-pag-010-surplus-multi-preview (27/03/2026)

### BR-PAG-011: Refinanciamento exige pagamento mínimo e data futura
- **Descrição:** A operação de refinanciamento (`refinance_installment`) requer: (a) valor de entrada ≥ R$1,00 ou 1% do saldo devedor (o maior), (b) nova data de vencimento no futuro, (c) recálculo de juros sobre o saldo remanescente
- **Condição:** Ao executar `refinance_installment`
- **Resultado:** Rejeitar se pagamento < mínimo ou nova data ≤ hoje. Saldo remanescente = `amount_total - amount_paid`. Nova parcela herda taxa de juros do contrato
- **Exceções:** Admin pode ter limite mínimo diferente (configurável por tenant)
- **Tabelas:** `loan_installments`, `investments`
- **Status:** ativa

### BR-PAG-012: Reversão de pagamento requer admin, janela de 72h e audit trail
- **Descrição:** `revert_installment_payment` só pode ser executado por usuário com `role = 'admin'`. A reversão é permitida apenas dentro de 72 horas do pagamento original. Deve gerar registro de `type = 'reversal'` em `payment_transactions`
- **Condição:** Ao executar `revert_installment_payment`
- **Resultado:** Verificar role do solicitante. Verificar `paid_at` da parcela. Criar entry de reversão antes de alterar status. Restaurar status anterior da parcela
- **Exceções:** Reversões fora da janela podem ser autorizadas manualmente via DBA (registrar justificativa)
- **Tabelas:** `loan_installments`, `payment_transactions`
- **Status:** ativa

### BR-PAG-013: Override admin de parcela — teto de alteração e log obrigatório
- **Descrição:** `admin_update_installment` não pode alterar `amount_total` em mais de 50% do valor original sem aprovação secundária (a implementar). `due_date` não pode ser configurada para data passada. Toda alteração deve gerar log com valores antes/depois
- **Condição:** Ao executar `admin_update_installment`
- **Resultado:** Validar delta percentual. Rejeitar `due_date` < hoje. Inserir registro de auditoria com `old_amount`, `new_amount`, `old_due_date`, `new_due_date`, actor, timestamp
- **Exceções:** Correções de dados legados via DBA direto (fora do escopo desta BR)
- **Tabelas:** `loan_installments`, `payment_transactions` (log)
- **Status:** ativa

### BR-PAG-014: Pagamento avulso exige destino explícito e audit trail
- **Descrição:** A operação `pay_avulso` deve receber destino explícito: `principal_reduction` (reduz saldo devedor), `penalty_payment` (quita multas/encargos), `general_credit` (crédito geral a ser alocado). O destino deve ser registrado em `payment_transactions`
- **Condição:** Ao executar `pay_avulso`
- **Resultado:** Campo `p_notes` deve incluir destino. Criar entry em `payment_transactions` com `type = 'avulso'` e destino. Atualizar `remaining_balance` no contrato pai quando destino = `principal_reduction`
- **Exceções:** Nenhuma
- **Tabelas:** `avulso_payments`, `payment_transactions`, `investments`
- **Status:** ativa

### BR-PAG-015: Bullet interest_only — capitalização de juros e saldo residual
- **Descrição:** Na modalidade bullet, `pay_bullet_interest_only` aplica juros apenas do período corrente. Se o pagamento for menor que os juros devidos, a diferença deve ser registrada como `capitalized_interest` e somada ao `remaining_balance` do contrato (juros capitalizados)
- **Condição:** `investments.calculation_mode = 'interest_only'` + `pay_bullet_interest_only`
- **Resultado:** `interest_paid = min(amount_paid, interest_due)`. Se `amount_paid < interest_due`, `investments.remaining_balance += (interest_due - amount_paid)`. Gerar próxima parcela de juros via `generate_next_bullet_installment`
- **Exceções:** Se `capitalize_interest = false` no tenant, rejeitar pagamentos parciais de juros
- **Tabelas:** `loan_installments`, `investments`
- **Status:** ativa

### BR-PAG-016: Pagamento self-service do devedor via PIX — regras de execução
- **Descrição:** O devedor pode gerar QR Code PIX apenas para o valor exato da parcela (sem parcial, sem excedente). A confirmação do pagamento deve vir via webhook do provedor PIX, não por asserção do devedor
- **Condição:** `DebtorDashboard` + `PaymentModal` (self-service)
- **Resultado:** `amount_fixed = installment.amount_total + encargos`. PIX code gerado com valor fixo. Status da parcela só muda após confirmação via webhook (futuro) ou validação manual pelo admin
- **Exceções:** Enquanto webhook não estiver implementado, admin confirma manualmente. Pagamentos parciais não são permitidos via self-service
- **Tabelas:** `loan_installments`, `tenants` (config PIX)
- **Status:** ativa

### BR-PAG-017: Marcação automática de atraso — carência e notificação
- **Descrição:** `update_overdue_installments` marca como `late` parcelas com `due_date < (today - carência)`. A carência padrão é 0 dias (sem carência). Após marcar, deve haver trigger de notificação configurável por tenant
- **Condição:** Cron diário executando `update_overdue_installments`
- **Resultado:** `WHERE due_date < (CURRENT_DATE - carencia_dias) AND status = 'pending'` → `status = 'late'`. Aplicar `fine_amount` conforme BR-CNT-010. Registrar evento de notificação pendente
- **Exceções:** Parcelas de contratos com `status = 'completed'` ou `status = 'renewed'` não são marcadas
- **Tabelas:** `loan_installments`, `tenants`
- **Status:** ativa

### BR-PAG-018: Postergamento (missed) — zeragem e criação de substituta
- **Descrição:** `mark_installment_missed` deve: (1) zerar a parcela original (`amount_total = 0, amount_paid = 0, status = 'paid'`), (2) criar parcela substituta ao final do contrato com `deferred_from_id` apontando para a original, herdando `amount_total + fine + interest_delay` acumulados
- **Condição:** Ao executar `mark_installment_missed`
- **Resultado:** Parcela original zerada (conforme BR-REL-002, não aparece no extrato). Parcela substituta com `number = max(number) + 1` no contrato, herda todos os encargos
- **Exceções:** Nenhuma
- **Tabelas:** `loan_installments`
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

### BR-REL-003: KPIs executivos — fórmulas documentadas
- **Descrição:** Cada métrica do tipo `DashboardKPIs` deve ter fórmula documentada e aplicada de forma consistente. Métricas principais: `receivedMonth` = soma de `amount_paid` de parcelas com `paid_at` no mês corrente; `activeStreetMoney` = soma de `amount_invested` de contratos `status = 'active'`; `totalProfitReceived` = soma de porção de juros dos pagamentos (via `payment_transactions.interest_portion`)
- **Condição:** `useDashboardData` hook e qualquer view/query de KPIs
- **Resultado:** Fórmulas aplicadas uniformemente. Período "mês corrente" calculado no fuso horário `America/Sao_Paulo`
- **Exceções:** Nenhuma
- **Tabelas:** `investments`, `loan_installments`, `payment_transactions`
- **Status:** ativa

### BR-REL-004: Score de clientes — fórmula, faixas e atualização por evento
- **Descrição:** O score de pontualidade do cliente em `TopClientes` é calculado como: `score = (pagamentos_no_prazo / total_parcelas_vencidas) * 100`. Faixas: score ≥ 70 = "Pontual" (verde), 40-69 = "Regular" (amarelo), < 40 = "Risco" (vermelho). Score deve ser recalculado a cada evento de pagamento
- **Condição:** `useTopClientes` hook e qualquer exibição de score de cliente
- **Resultado:** Fórmula aplicada uniformemente. Labels textuais obrigatórios junto às cores (acessibilidade)
- **Exceções:** Devedores sem nenhuma parcela vencida não aparecem no ranking
- **Tabelas:** `loan_installments`, `investments`
- **Status:** ativa

### BR-REL-005: Buckets de cobrança — definição formal
- **Descrição:** A classificação de parcelas em buckets temporais segue: `overdue` = `due_date < hoje AND status IN ('pending','late','partial')`; `today` = `due_date = hoje`; `3d` = `due_date BETWEEN hoje+1 AND hoje+3`; `7d` = `hoje+4 AND hoje+7`; `15d` = `hoje+8 AND hoje+15`; `30d` = `hoje+16 AND hoje+30`
- **Condição:** `CollectionDashboard`, `DailyCollectionView` e qualquer view de cobrança
- **Resultado:** Classificação uniforme entre frontend e consultas SQL
- **Exceções:** Parcelas de contratos `completed` ou `renewed` não entram em nenhum bucket
- **Tabelas:** `loan_installments`, `investments`
- **Status:** ativa

### BR-REL-006: Recibo compartilhável — campos obrigatórios
- **Descrição:** O recibo gerado por `ReceiptTemplate` deve conter obrigatoriamente: nome do credor (tenant/company), nome do devedor, valor pago, data de pagamento, número da parcela, identificador do contrato. Recibos não podem ser editados após geração (imutabilidade por design)
- **Condição:** Qualquer geração de recibo via `ReceiptTemplate`
- **Resultado:** Todos os campos obrigatórios presentes. Recibo gerado como imagem (html-to-image) não editável pelo usuário
- **Exceções:** Recibos de pagamentos avulsos usam o contrato como referência
- **Tabelas:** `loan_installments`, `investments`, `tenants`
- **Status:** ativa

### BR-REL-007: Visão mensal do investidor
- **Descrição:** O investidor deve ter acesso a uma tela de resumo mensal que exiba, para cada mês navegável: (1) devedores ativos com valor devido e pago no mês; (2) capital investido ativo no mês; (3) juros recebidos no mês; (4) juros previstos no mês; (5) percentual de realização do mês — fórmula: `(total_pago / total_esperado) × 100`, exibido com barra de progresso visual + valores absolutos; (6) atrasados do mês — parcelas com `status='late'` e `due_date` no mês, com breakdown por devedor (nome, valor em atraso, dias de atraso). Navegação mês a mês via botões ◀ ▶ sem re-fetch (recomputa do cache)
- **Condição:** Tela "Visão Mensal" no `InvestorDashboard` (tab secundária)
- **Resultado:** Fórmula de % pagamento: `(sum(amount_paid das parcelas pagas/parciais no mês) / sum(amount_total das parcelas com due_date no mês)) × 100`. Cor da barra: verde ≥ 80%, amarelo 50-79%, vermelho < 50%
- **Exceções:** Parcelas fantasma (BR-REL-002) são excluídas. Timezone: `America/Sao_Paulo` (BR-REL-003). Contratos encerrados (`status=completed`) aparecem apenas nos meses em que tinham parcelas
- **Tabelas:** `investments`, `loan_installments` (leitura apenas)
- **Status:** ativa
- **Stories:** implementa feature visão mensal 28/03/2026

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

### BR-USR-005: Autenticação — modos suportados e fluxo pós-OAuth
- **Descrição:** O sistema suporta três modos de autenticação: (1) email+senha com signup de admin, (2) Google OAuth, (3) signup via convite. Após OAuth, se não existir perfil para o usuário autenticado, o sistema deve redirecionar ao `OnboardingWizard`. Signup de admin cria tenant + company primária + perfil atomicamente
- **Condição:** `Login.tsx` — qualquer fluxo de autenticação
- **Resultado:** Modo (1): criar tenant+company+profile via `complete_oauth_onboarding` se necessário. Modo (2): detectar ausência de perfil pós-OAuth e redirecionar. Modo (3): validar convite, herdar role+company+tenant
- **Exceções:** Nenhuma
- **Tabelas:** `profiles`, `tenants`, `companies`, `invites`
- **Status:** ativa

### BR-USR-006: Reset de senha — expiração e invalidação de sessões
- **Descrição:** Token de reset de senha expira em 1 hora (padrão Supabase). Após o reset bem-sucedido, todas as sessões anteriores do usuário devem ser invalidadas. Limite de tentativas de reset: 5 por hora por email (rate limiting no provedor)
- **Condição:** `ResetPassword.tsx` e endpoint de reset do Supabase
- **Resultado:** Token expirado retorna erro com instrução de nova solicitação. Após reset, logout forçado de outras sessões
- **Exceções:** Admin pode invalidar tokens manualmente via Supabase dashboard
- **Tabelas:** `profiles` (via Supabase Auth)
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

### BR-SYS-004: Cache local — TTL, indicador stale e invalidação
- **Descrição:** O `services/cache.ts` usa TTL de 5 minutos como padrão. Dados financeiros (saldos, parcelas) devem ter TTL de 2 minutos. Qualquer mutação financeira (pagamento, criação de contrato) deve invalidar imediatamente o cache relevante. Quando dados estiverem stale (offline ou TTL expirado sem refresh), exibir indicador visual
- **Condição:** Todo uso do `services/cache.ts`
- **Resultado:** TTL configurável por tipo de dado. Invalidação explícita pós-mutação. Degradação graciosa quando localStorage estiver cheio (evict LRU, não lançar erro)
- **Exceções:** Dados de configuração (tenants, companies) podem ter TTL mais longo (10 min)
- **Tabelas:** Nenhuma (localStorage)
- **Status:** ativa

### BR-SYS-005: Onboarding atômico — tenant + company + profile em transação única
- **Descrição:** A criação do tenant durante onboarding deve ser atômica: tenant, company primária e perfil admin são criados juntos via `complete_oauth_onboarding`. Se qualquer etapa falhar, toda a operação deve ser revertida (rollback). Não pode existir tenant sem company primária nem profile admin
- **Condição:** `OnboardingWizard` e RPC `complete_oauth_onboarding`
- **Resultado:** `complete_oauth_onboarding` executa em transação PostgreSQL com rollback em erro. Frontend exibe erro claro se falhar
- **Exceções:** Nenhuma
- **Tabelas:** `tenants`, `companies`, `profiles`
- **Status:** ativa

### BR-SYS-006: Configuração externa (SetupWizard) — validação e segurança
- **Descrição:** A URL do Supabase informada no `SetupWizard` deve ser validada como URL HTTPS válida antes de ser salva. A anon key não deve ser logada em console. Ambas são armazenadas em `localStorage` com prefixo `EF_EXTERNAL_` apenas em ambiente de dev
- **Condição:** `SetupWizard.tsx`
- **Resultado:** Validar formato `https://*.supabase.co` antes de salvar. Nunca logar a anon key. Em produção (Cloud Run), ignorar valores de localStorage
- **Exceções:** Instâncias self-hosted podem usar URLs diferentes de `*.supabase.co`
- **Tabelas:** Nenhuma (localStorage)
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

## Assinatura e Billing (SUB)

### BR-SUB-001: Webhook Stripe — idempotência e eventos obrigatórios
- **Descrição:** O handler do webhook Stripe (`supabase/functions/stripe-webhook`) deve ser idempotente: processar o mesmo `event.id` mais de uma vez não deve ter efeito colateral. Eventos obrigatórios a tratar: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- **Condição:** Qualquer evento recebido em `POST /functions/v1/stripe-webhook`
- **Resultado:** Verificar `event.id` em tabela de eventos processados antes de agir. Sempre retornar HTTP 200 mesmo em erros de processamento interno (para evitar retry storm do Stripe). Logar eventos com falha para retry manual
- **Exceções:** Eventos de tipos não listados podem ser ignorados com log
- **Tabelas:** `tenants`
- **Status:** ativa

### BR-SUB-002: Grace period — 7 dias após falha de pagamento antes de degradar
- **Descrição:** Quando `plan_status` muda para `past_due` (falha de pagamento Stripe), o tenant mantém acesso completo ao plano atual por 7 dias. Após esse período, o sistema degrada automaticamente para os limites do plano `free`. Dados nunca são deletados durante degradação
- **Condição:** Evento `invoice.payment_failed` + cron diário de verificação
- **Resultado:** `tenants.grace_period_ends_at = NOW() + 7 days` ao receber `past_due`. Cron verifica `grace_period_ends_at` e downgrade se expirado. Sem deleção de dados
- **Exceções:** Admin pode extender grace period manualmente via Supabase dashboard
- **Tabelas:** `tenants`
- **Status:** ativa

### BR-SUB-003: Trial — duração de 15 dias com features empresarial
- **Descrição:** O período de trial dura exatamente 15 dias a partir da criação do tenant. Durante o trial, todas as features do plano `empresarial` estão disponíveis. Ao expirar (`trial_ends_at < NOW()`), o acesso é restrito ao plano pago atual ou ao plano `free` se não houver assinatura ativa
- **Condição:** Verificação de entitlement em todo o frontend
- **Resultado:** `tenants.trial_ends_at = created_at + 15 days`. Qualquer feature gate verifica trial antes de verificar plano pago. Após expiração sem plano, restringir a `free`
- **Exceções:** Tenants criados antes do sistema de trial continuam sem trial
- **Tabelas:** `tenants`
- **Status:** ativa

### BR-SUB-004: Tenant proprietário tem acesso empresarial permanente
- **Descrição:** O tenant cujo `owner_email` é `guifrotasouza@gmail.com` tem acesso irrestrito a todas as features do plano `empresarial`, independente de qualquer estado de assinatura, trial ou webhook Stripe
- **Condição:** Verificação de entitlement em `isFreePlanLocked` e demais feature gates
- **Resultado:** `isFreePlanLocked` retorna `false` imediatamente para este tenant. Nenhuma lógica de paywall, degradação ou cron afeta este tenant
- **Exceções:** Nenhuma — regra absoluta
- **Tabelas:** `tenants`
- **Status:** ativa
- **Stories:** commit direto (27/03/2026)

---

## Bot / Assistente IA (BOT)

### BR-BOT-001: Policy engine — matriz de roles e capabilities com confirmação de mutações
- **Descrição:** O bot segue uma matriz de permissões por role: `admin` tem acesso a 14 capabilities (consultas + mutações), `investor` tem 3 (consultar portfólio, utilitários, desconectar), `debtor` tem 4 (ver parcelas, ver débito, utilitários, desconectar). Toda operação de mutação (marcar pago, criar contrato) exige confirmação explícita do usuário antes de executar
- **Condição:** `e-finance-bot/src/assistant/capability-registry.ts` e `policy-engine.ts`
- **Resultado:** Capabilities não autorizadas retornam "Não tenho permissão para isso". Mutações solicitam confirmação (sim/não) e aguardam resposta antes de agir
- **Exceções:** Nenhuma — sem bypass de confirmação
- **Tabelas:** `bot_sessions`, `bot_messages`
- **Status:** ativa

### BR-BOT-002: Briefing matinal — 1x por dia, horário configurável, conteúdo definido
- **Descrição:** O briefing matinal é enviado uma vez por dia por admin conectado, no horário configurado (padrão: 07:00 BRT). Conteúdo obrigatório: total de cobranças do dia, valor total, lista de devedores e valores. Canal primário: WhatsApp; fallback: Telegram
- **Condição:** `e-finance-bot/src/scheduler/morning-briefing.ts`
- **Resultado:** Garantir envio único por dia por admin. Respeitar horário configurado em `bot_tenant_config`. Se WhatsApp desconectado, tentar Telegram
- **Exceções:** Se ambos os canais estiverem desconectados, registrar falha e tentar no dia seguinte
- **Tabelas:** `bot_tenant_config`, `loan_installments`
- **Status:** ativa

### BR-BOT-003: Followup de pagamento — janela temporal e limite por parcela
- **Descrição:** Lembretes automáticos de pagamento são enviados entre 17:00 e 23:55 BRT apenas para parcelas do dia corrente ainda não pagas. Máximo de 1 lembrete por parcela por dia
- **Condição:** `e-finance-bot/src/scheduler/payment-followup.ts`
- **Resultado:** Verificar `due_date = today AND status IN ('pending','late','partial')`. Registrar envio para evitar duplicatas. Não enviar fora da janela 17:00-23:55 BRT
- **Exceções:** Admin pode desativar followup automático em `bot_tenant_config`
- **Tabelas:** `loan_installments`, `bot_tenant_config`
- **Status:** ativa

### BR-BOT-004: Prompt guard — categorias de bloqueio e log obrigatório
- **Descrição:** O `prompt-guard.ts` deve bloquear 6 categorias de ataques: instruction override ("ignore previous", "forget"), prompt exfiltration (pedir para revelar o prompt), role jailbreak ("você é agora..."), tool abuse (tentar usar ferramentas não autorizadas), data exfiltration (pedir dados de outros usuários), SQL injection. Payloads codificados (base64-like) também bloqueados. Toda tentativa bloqueada DEVE ser logada
- **Condição:** Todo `message-handler.ts` — antes de qualquer processamento
- **Resultado:** Mensagens bloqueadas retornam resposta genérica "Não posso ajudar com isso". Log estruturado com `category`, `pattern_matched`, `user_id`, `timestamp`
- **Exceções:** Nenhuma — sem bypass
- **Tabelas:** `bot_messages` (log de tentativas)
- **Status:** ativa

### BR-BOT-005: Whitelist de acesso — apenas números autorizados interagem com o bot
- **Descrição:** Apenas números de telefone na whitelist do tenant (`bot_tenant_config.whitelist`) podem interagir com o bot. Por padrão, a whitelist inclui apenas os números de phone dos admins do tenant. Números não listados recebem mensagem de "acesso não autorizado"
- **Condição:** `message-handler.ts` — verificação pré-processamento
- **Resultado:** Verificar `sender` contra whitelist antes de processar. Atualizar whitelist automaticamente quando novo admin é adicionado ao tenant
- **Exceções:** Whitelist pode ser expandida manualmente pelo admin via `AdminAssistant`
- **Tabelas:** `bot_tenant_config`, `profiles`
- **Status:** ativa

### BR-BOT-006: Alerta de desconexão — cooldown e multi-canal
- **Descrição:** Quando um canal (WhatsApp ou Telegram) fica desconectado, o sistema deve enviar alerta com cooldown mínimo de 5 minutos entre alertas do mesmo tipo. Canal primário de alerta é Telegram (mais estável); fallback é WhatsApp se Telegram disponível. Alerta deve incluir instruções de reconexão
- **Condição:** `e-finance-bot/src/alerts/connection-alert.ts`
- **Resultado:** Respeitar cooldown de 5 min por tipo de alerta. Tentar Telegram primeiro, depois WhatsApp. Incluir link/instrução de reconexão no alerta
- **Exceções:** Se ambos desconectados, registrar em log do sistema sem envio
- **Tabelas:** `bot_tenant_config`
- **Status:** ativa

---

## Backlog de BRs a Formalizar

> BRs identificadas mas ainda não totalmente especificadas.
> @po deve elaborar ao receber solicitações relacionadas, sempre consultando o usuário.

| Área | Descrição resumida | Prioridade |
|------|--------------------|-----------|
| PAG | Antecipação de parcelas (desconto apenas sobre juros futuros) — sem implementação ainda | Média |
| REL | Fórmulas completas para todas as 20+ métricas de `DashboardKPIs` (BR-REL-003 cobre as principais) | Média |
| BOT | Regras de escalação para suporte humano quando bot não consegue resolver | Baixa |

> **Itens removidos do backlog** (formalizados nesta atualização 28/03/2026):
> - Cálculo de multa por atraso → **BR-CNT-010** + **BR-PAG-017**
> - Regras de renegociação → **BR-CNT-007** + **BR-PAG-011**
> - Regras de onboarding por convite vs OAuth → **BR-USR-005**
> - Billing e upgrade/downgrade → **BR-SUB-001** + **BR-SUB-002** + **BR-SUB-003**
