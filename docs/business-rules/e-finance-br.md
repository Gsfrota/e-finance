# Business Rules — E-Finance

> Documento normativo. Toda feature e bug fix deve referenciar as BRs aplicáveis.
> Mantenedor: @po (Pax)
> Última atualização: 04/08/2026
>
> ⚠️ **Nota (2026-08):** A aplicação web é exclusiva do perfil `admin`. Perfis `investor` e `debtor` seguem existindo como **dados** (`investments.user_id` e `investments.payer_id`), mas não têm tela própria — usuário autenticado com role não-admin recebe uma tela de acesso indisponível.

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

### BR-CNT-004: Modalidade bullet — estrutura de parcelas, quitação e renovação
- **Descrição:** Na modalidade bullet (`interest_only`), a cobrança do ciclo representa o **total exigível**: principal/saldo-base aberto + juros do ciclo + encargos vencidos aplicáveis. O pagamento total do ciclo deve quitar a dívida exigível, zerar `remaining_balance`, marcar o contrato como `completed` e não gerar nova parcela automaticamente. Renovação é ação separada/opcional e deve criar nova operação/vínculo explícito, nunca reaproveitar o contrato quitado como se ainda estivesse ativo.
- **Condição:** `investments.calculation_mode = 'interest_only'`.
- **Resultado:** `loan_installments.amount_principal` reflete a base exigível/de display; `amount_interest` reflete juros do ciclo; `amount_total` reflete o total exigível do ciclo. Pagamento apenas dos juros regulariza o ciclo de juros e rola o principal. Pagamento parcial é permitido e deve seguir ordem de imputação explícita: encargos/taxa de quebra vencida → juros → principal. Se não houver pagamento até o próximo ciclo e o contrato permitir capitalização, a base do próximo ciclo passa a ser o total vencido.
- **Exceções:** Taxa/multa de quebra contratual é opcional, definida no cadastro Bullet, e só pode incidir após inadimplência (`daysLate >= default_after_days`). `default_after_days` é configurável por contrato com padrão 20 dias. Persistência desses campos depende de migration futura validada via Claude/MCP.
- **Tabelas:** `investments`, `loan_installments`, `payment_transactions`.
- **Status:** ativa como regra de produto — *atualizada em 2026-05-29 pela CB-002; implementação/RPC/migration ainda bloqueadas por aceite e revisão*

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
- **Condição:** Ao executar `create_investment_validated` com `p_parent_investment_id` não-nulo
- **Resultado:** Dentro da **mesma transação** que cria o contrato filho, o RPC lê o pai com `SELECT ... FOR UPDATE` (validando que pertence ao mesmo tenant), grava `child.parent_investment_id = parent.id` e, se `parent.status = 'active'`, executa `UPDATE investments SET status = 'renewed' WHERE id = parent.id`. A transição de status **não é opcional** — o formulário próprio de renovação (`ContractRenewalModal`, com checkbox "Marcar contrato original como Renovado") foi removido; renovar agora abre o mesmo wizard de criação de contrato, pré-preenchido, e o vínculo/transição é sempre aplicado pelo RPC. Um evento `contract_renewed` é registrado em `audit_events` via `log_audit_event`. Novos contratos herdam investidor e devedor; taxas e prazo podem ser alterados
- **Exceções:** Contrato pai não encontrado → exceção. Contrato pai em status `defaulted` não pode ser renovado sem reverter o status primeiro (`'Contrato inadimplente não pode ser renovado — reverta o status primeiro.'`). Contrato pai já em status `renewed` não pode ser renovado novamente (`'Contrato já foi renovado.'`) — sem renovação em cascata. Em contratos (inclusive Bullet) quitados pelo pagamento total do ciclo, o contrato pai `completed` **permanece** `completed` — não transita para `renewed`; apenas pais `active` transicionam. O `SELECT ... FOR UPDATE` sobre o pai existe justamente para travar contra mudança concorrente de status durante a transação.
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

### BR-CNT-011: Fechamento automático de contrato quando quitado 100%
- **Descrição:** Um contrato deve refletir seu estado financeiro real. Quando `remaining_balance <= 0` E todas as `loan_installments` com `status IN ('pending','late','partial')` são zeradas, `investments.status` DEVE ser atualizado para `'completed'` automaticamente pela RPC que executou o pagamento
- **Condição:** Ao final de **qualquer** RPC de mutação financeira que possa levar o saldo devedor a zero: `pay_installment`, `pay_avulso` (todos os destinos), `apply_surplus_action`, `apply_remainder_action`, `refinance_installment`, `admin_update_installment`, `pay_bullet_interest_only`, `generate_next_bullet_installment`
- **Resultado:** Chamar a função auxiliar `recalculate_investment_status(p_investment_id)` ao final de cada RPC listada acima. A função verifica se todas as parcelas são `paid` (exceto absorvidas via `missed_at` com `amount_total = 0`) e `remaining_balance < 0.01`; se sim, executa `UPDATE investments SET status = 'completed', updated_at = NOW() WHERE id = p_investment_id`
- **Inverso (revert):** Se uma RPC de reversão (`revert_installment_payment`, `revert_installment_missed`) restaurar saldo > 0 ou parcela não-paga, a mesma função deve restaurar `status = 'active'`
- **Efeito em UI:** Contratos `completed` NÃO aparecem em telas de cobrança (`CollectionDashboard`, `InstallmentsTable`, KPI de parcelas atrasadas). `useDashboardData` filtra `loan_installments` de investments com `status = 'completed'`. `CollectionDashboard` aplica filtro defensivo: `calcOutstanding(i) > 0.01 && i.investment?.status !== 'completed'`. Contratos `renewed` também são excluídos de cobrança, dashboard e métricas de capital — via a constante `INACTIVE_CONTRACT_STATUSES = ['completed', 'renewed']` e o helper `isInactiveContract(status)`, ambos em `types.ts`, aplicados em `hooks/useDashboardData.ts`, `components/dashboard/CollectionDashboard.tsx`, `hooks/useYieldMetrics.ts` e `components/Dashboard.tsx`. Antes dessa consolidação, só `completed` era filtrado nessas telas — um contrato `renewed` continuava cobrando ao lado do contrato filho (dívida duplicada). `status = 'defaulted'` **deliberadamente não** entra em `INACTIVE_CONTRACT_STATUSES` — representa dívida vencida ainda cobrável — e o tratamento diverge por tela de propósito: `useYieldMetrics` exclui `defaulted` do capital ativo, enquanto as telas de cobrança o mantêm
- **Exceções:** Contratos com `status IN ('defaulted', 'renewed')` não são automaticamente completados — requerem ação administrativa explícita. Avulso `penalty_payment` não necessariamente quita o contrato (só paga encargos de atraso); a verificação pela função auxiliar é o árbitro
- **Tabelas:** `investments`, `loan_installments`
- **Status:** ativa — *criada em 2026-04-11 (bug: cobranças de quem já pagou; contratos amortizados quitados não fechavam)*

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
- **Exceções:** No fluxo Bullet (`interest_only`), pagamento exatamente dos juros pode regularizar o ciclo/rolar o principal mesmo com `amount_paid < amount_total`; nesse caso, o status operacional `paid` só é permitido com evento/metadata de rolagem auditável, deixando claro que principal não foi quitado.
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
- **Descrição:** A operação `pay_avulso` DEVE receber o parâmetro `p_destination` com um dos valores aceitos: `principal_reduction` (reduz saldo devedor — exclusivo para contratos bullet), `penalty_payment` (quita multas/encargos), `general_credit` (crédito geral alocado em parcelas abertas last-first). O destino determina o comportamento da RPC e deve ser registrado como transaction_type `'avulso'` em `payment_transactions`. O campo `p_notes` pode conter informações adicionais mas não substitui o parâmetro formal de destino
- **Condição:** Ao executar `pay_avulso`
- **Resultado:** `p_destination` é parâmetro obrigatório da RPC (default `'general_credit'`). Inserir em `avulso_payments` E em `payment_transactions` com `transaction_type = 'avulso'`. Quando `p_destination = 'principal_reduction'`: seguir BR-PAG-022. Quando `general_credit`: quitar parcelas pendentes last-first sem descartar surplus — registrar cada quitação
- **Exceções:** Nenhuma — audit trail é obrigatório em todos os destinos (BR-PAG-009)
- **Vínculo:** O registro em `payment_transactions` DEVE ter `installment_id = NULL` — ver BR-PAG-023
- **Tabelas:** `avulso_payments`, `payment_transactions`, `investments`
- **Status:** ativa — *atualizada em 2026-04-09 (v40: p_destination implementado; BR-PAG-023 complementa vínculo contrato)*

### BR-PAG-015: Bullet interest_only — rolagem, parcial e capitalização do total vencido
- **Descrição:** No Bullet, o operador pode registrar: (a) pagamento total do ciclo, encerrando o contrato; (b) pagamento apenas dos juros, rolando o principal; (c) pagamento parcial, abatendo conforme ordem de imputação; ou (d) ausência de pagamento até novo ciclo, com capitalização do total vencido se contratualmente permitida. `pay_bullet_interest_only` cobre apenas o caso legado de juros/rolagem e não deve ser tratado como fluxo único definitivo.
- **Condição:** `investments.calculation_mode = 'interest_only'` e ação financeira Bullet explícita.
- **Resultado:** Pagamento total: `remaining_balance = 0`, parcela `paid`, contrato `completed`, sem nova parcela automática. Pagamento só de juros: juros quitados, principal mantido, nova parcela baseada no principal vigente. Parcial: imputar primeiro encargos vencidos/taxa de quebra, depois juros, depois principal; manter saldo aberto auditável. Não pagamento: após `default_after_days` (default 20), o ciclo fica inadimplente/default operacional; se `capitalize_interest = true` e houver base contratual, o próximo ciclo usa o total vencido como base.
- **Exceções:** Se `capitalize_interest = false` ou não houver cláusula/aceite, não capitalizar juros/total vencido automaticamente. Taxa/multa de quebra só pode ser aplicada após inadimplência e se configurada no contrato.
- **Tabelas:** `loan_installments`, `investments`, `payment_transactions`.
- **Status:** ativa como regra de produto — *atualizada em 2026-05-29 pela CB-002; implementação transacional/RPC única pendente*

### BR-PAG-016: Pagamento self-service do devedor via PIX — regras de execução
- **Descrição:** O devedor pode gerar QR Code PIX apenas para o valor exato da parcela (sem parcial, sem excedente). A confirmação do pagamento deve vir via webhook do provedor PIX, não por asserção do devedor
- **Condição:** `DebtorDashboard` + `PaymentModal` (self-service)
- **Resultado:** `amount_fixed = installment.amount_total + encargos`. PIX code gerado com valor fixo. Status da parcela só muda após confirmação via webhook (futuro) ou validação manual pelo admin
- **Exceções:** Enquanto webhook não estiver implementado, admin confirma manualmente. Pagamentos parciais não são permitidos via self-service
- **Tabelas:** `loan_installments`, `tenants` (config PIX)
- **Status:** descontinuada em 2026-08 — telas de role removidas

### BR-PAG-017: Marcação automática de atraso — carência e notificação
- **Descrição:** `update_overdue_installments` marca como `late` parcelas com `due_date < (today - carência)`. A carência padrão é 0 dias (sem carência). Após marcar, deve haver trigger de notificação configurável por tenant
- **Condição:** Cron diário executando `update_overdue_installments`
- **Resultado:** `WHERE due_date < (CURRENT_DATE - carencia_dias) AND status = 'pending'` → `status = 'late'`. Aplicar `fine_amount` conforme BR-CNT-010. Registrar evento de notificação pendente. Inserir registro em `payment_transactions` conforme **BR-PAG-021**
- **Limitação conhecida (ver BR-PAG-024):** O cron **não** transiciona parcelas `partial → late`. Parcelas com pagamento parcial que vencem ficam com `status = 'partial'` mesmo estando em atraso. A detecção de atraso para fins de cobrança deve usar comparação de data, não apenas o campo `status` (ver BR-PAG-024)
- **Exceções:** Parcelas de contratos com `status = 'completed'` ou `status = 'renewed'` não são marcadas
- **Tabelas:** `loan_installments`, `tenants`, `payment_transactions`
- **Status:** ativa

### BR-PAG-018: Postergamento (missed) — zeragem e criação de substituta
- **Descrição:** `mark_installment_missed` deve: (1) zerar a parcela original (`amount_total = 0, amount_paid = 0, status = 'paid'`), (2) criar parcela substituta ao final do contrato com `deferred_from_id` apontando para a original, herdando `amount_total + fine + interest_delay` acumulados
- **Condição:** Ao executar `mark_installment_missed`
- **Resultado:** Parcela original zerada (conforme BR-REL-002, não aparece no extrato). Parcela substituta com `number = max(number) + 1` no contrato, herda todos os encargos
- **Exceções:** Nenhuma
- **Tabelas:** `loan_installments`
- **Status:** ativa

### BR-PAG-019: Classificação de Criticidade — Fluxo de Baixas
- **Descrição:** O fluxo de baixas (todos os tipos de pagamento de parcela) é classificado como **EXTREMAMENTE CRÍTICO**. Qualquer falha neste fluxo impacta diretamente clientes pagadores e pode resultar em perda de clientes. Toda RPC de pagamento deve ter exatamente 1 assinatura (sem overloads). Antes de qualquer deploy que toque em pagamentos, o script `scripts/smoke-test-payment-rpcs.sql` deve ser executado e não retornar nenhum `[ERRO]`.
- **Condição:** Antes de qualquer deploy em produção que modifique RPCs de pagamento ou componentes de baixa
- **Resultado:** Deploy só avança se smoke test passar sem erros
- **Exceções:** Nenhuma — criticidade máxima (P0), sem waiver possível
- **Tabelas:** `loan_installments`, `payment_transactions`, `investments`
- **RPCs cobertas:** `pay_installment`, `apply_surplus_action`, `apply_remainder_action`, `mark_installment_missed`, `revert_installment_missed`, `revert_installment_payment`, `refinance_installment`, `admin_update_installment`, `pay_avulso`, `pay_bullet_interest_only`, `generate_next_bullet_installment`
- **Script de validação:** `scripts/smoke-test-payment-rpcs.sql`
- **Gate de overloads:** `SELECT proname, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('pay_installment',...) GROUP BY proname HAVING count(*)>1` — deve retornar 0 linhas
- **Status:** ativa

### BR-PAG-020: Reversão de Falta — Janela de 72h e Guards
- **Descrição:** A reversão de uma falta registrada (`revert_installment_missed`) é permitida apenas dentro de 72 horas do `missed_at`. Só disponível para admins. Se a parcela destino (substituta ou acumulada) já foi paga pelo devedor, a reversão é bloqueada.
- **Condição:** Ao executar `revert_installment_missed`
- **Resultado:** Parcela original restaurada com valores originais, `status = 'pending'`, `missed_at = NULL`. Para ação 'new': parcela substituta deletada e `total_installments` decrementado. Para ação 'last': valores subtraídos da parcela destino. Para ação 'postpone': `due_date` revertida.
- **Exceções:** Dados de reversão requerem `metadata` na `contract_renegotiations` (disponível a partir da v38). Faltas anteriores à v38 bloqueiam a reversão com mensagem orientando contato ao suporte.
- **Tabelas:** `loan_installments`, `contract_renegotiations`, `investments`
- **Status:** ativa

### BR-PAG-021: Registro de atraso automático no histórico — audit trail obrigatório
- **Descrição:** Quando `update_overdue_installments` transiciona uma parcela `pending → late`, deve inserir um registro em `payment_transactions` com `transaction_type = 'late_auto'`. Este evento é distinto de `missed` (falta manual pelo admin): não move dinheiro, apenas sinaliza o momento em que o atraso foi detectado pelo sistema
- **Condição:** Cron diário `update_overdue_installments` ao marcar `status = 'late'`
- **Resultado:** Uma linha em `payment_transactions` por parcela marcada. Campos obrigatórios: `installment_id`, `investment_id`, `tenant_id`, `transaction_type = 'late_auto'`, `amount = 0`, `created_at = NOW()`. Idempotente: se já existe registro `late_auto` para o `installment_id`, não duplicar
- **Diferença conceitual:**
  - `late_auto` = atraso automático — sinaliza vencimento sem ação financeira
  - `missed` = falta manual — admin decide destino do valor (postpone/last/new)
- **Exibição no histórico:** `InstallmentHistory.tsx` deve exibir `late_auto` como "Atrasada" com ícone e cor distintos de "Falta registrada" (conforme definição de UX)
- **Exceções:** Parcelas que já possuem `transaction_type = 'late_auto'` não recebem novo registro
- **Tabelas:** `payment_transactions`, `loan_installments`
- **Status:** ativa

### BR-PAG-022: Pagamento avulso com principal_reduction em contrato bullet
- **Descrição:** Quando `pay_avulso` é chamado com `p_destination = 'principal_reduction'` em um contrato com `calculation_mode = 'interest_only'`, o valor pago deve reduzir o `remaining_balance` do contrato e recalcular a parcela pendente existente com o novo saldo. Não quitar parcelas de juros como se fossem parcelas normais
- **Condição:** `pay_avulso` + `p_destination = 'principal_reduction'` + `investments.calculation_mode = 'interest_only'`
- **Resultado:**
  1. `investments.remaining_balance -= p_amount` (não pode ficar negativo — rejeitar se `p_amount > remaining_balance`)
  2. Se `remaining_balance > 0`: localizar parcela `pending` e recalcular: `amount_principal = new_remaining_balance`, `amount_interest = new_remaining_balance * interest_rate / 100`, `amount_total = amount_principal + amount_interest`
  3. Se `remaining_balance = 0`: marcar parcela `pending` como `paid` (`amount_paid = amount_total`, `paid_at = p_paid_at`); marcar contrato como `status = 'completed'`
  4. Sempre inserir em `payment_transactions` com `transaction_type = 'avulso'`, `principal_portion = p_amount`, `interest_portion = 0`
  5. Sempre inserir em `avulso_payments`
- **Exceções:** `p_destination = 'principal_reduction'` é inválido para contratos sem `calculation_mode = 'interest_only'` — deve ser rejeitado com erro descritivo
- **Tabelas:** `investments`, `loan_installments`, `avulso_payments`, `payment_transactions`
- **Status:** ativa — *criada em 2026-04-09 (v40, incidente #789 MD Veículos)*

### BR-PAG-023: Pagamento avulso é vinculado ao contrato, não à parcela
- **Descrição:** O pagamento avulso (`pay_avulso`) reduz a dívida total do contrato (`remaining_balance`), não o saldo de uma parcela individual. Por isso, o registro em `payment_transactions` gerado por `pay_avulso` DEVE ter `installment_id = NULL`. A associação é feita pelo `investment_id`
- **Condição:** Sempre que `pay_avulso` grava em `payment_transactions`
- **Resultado:**
  1. `payment_transactions.installment_id = NULL` — sem vínculo com parcela específica
  2. `payment_transactions.investment_id = p_investment_id` — vínculo com o contrato
  3. A exibição no histórico (`InstallmentHistory`) deve tratar registros com `installment_id = NULL` e `transaction_type = 'avulso'` como entradas de nível contrato, agrupadas com chave `avulso_{tx.id}` no agrupamento "Por Recebimento"
  4. O `totalReceived` de um grupo avulso deve usar o campo `amount` da transação (não apenas transações do tipo `payment`)
- **Motivação:** Avulso pode ser `principal_reduction`, `penalty_payment` ou `general_credit` — nenhum desses destinos é exclusivo de uma única parcela; o efeito se propaga pelo contrato inteiro
- **Exceções:** Se o `general_credit` quitar integralmente uma parcela específica, a RPC PODE vincular a transação à parcela quitada — mas o avulso raiz permanece com `installment_id = NULL`
- **Tabelas:** `payment_transactions`, `avulso_payments`, `investments`
- **Status:** ativa — *criada em 2026-04-09 (incidente #789 MD Veículos — avulso não aparecia no histórico por ter installment_id vinculado incorretamente)*

### BR-PAG-024: Detecção de parcelas atrasadas no fluxo de surplus — por data, não por status
- **Descrição:** O cron `update_overdue_installments` transiciona apenas `pending → late`; parcelas com `status = 'partial'` que vencem **nunca** são promovidas a `late` automaticamente. Por isso, qualquer lógica de negócio que precise identificar "parcelas atrasadas" para fins de cobrança ou de alocação de surplus **deve usar comparação de data**, não o campo `status` isolado.
- **Regra de detecção:** Uma parcela é considerada atrasada se: `due_date < hoje AND status NOT IN ('paid') AND outstanding > 0.01`, independente do valor de `status` ser `'pending'`, `'partial'` ou `'late'`
- **Condição:** Qualquer componente, hook ou RPC que lista ou filtra parcelas atrasadas para fins de: (a) alocação de surplus (`pay_late`); (b) exibição de badge "Atrasado" na UI; (c) cálculo de KPIs de inadimplência; (d) relatórios de cobrança
- **Resultado:**
  - `InstallmentModals.tsx` e `InstallmentDetailFlow.tsx`: `lateRows` filtrado por `due_date < getBrazilToday() && outstanding > 0.01 && status !== 'paid'`
  - `DashboardWidgets.tsx`: `isInstallmentOverdue = due_date < getBrazilToday() && outstanding > 0.01 && status !== 'paid'`
  - `apply_surplus_action` (DB): `WHERE status IN ('pending', 'partial', 'late')` — já inclui `partial`, correto
- **Motivação:** Caso real — MD Veículos / Silaucia (2026-04-12): parcela #15 recebeu surplus parcial → virou `partial`. Subsequent surplus ignorava a parcela porque o filtro era `status === 'late'`. O excedente ia para parcelas futuras em vez de quitar o saldo devedor atrasado. Fix: `8592d05`
- **Exceções:** O cron `update_overdue_installments` mantém sua lógica atual (`pending → late`); não é necessário promover `partial → late` pois a detecção por data resolve o problema sem alterar o DB
- **Tabelas:** `loan_installments`
- **Componentes afetados:** `InstallmentModals.tsx`, `InstallmentDetailFlow.tsx`, `DashboardWidgets.tsx`
- **Teste:** `e2e/payment/surplus-partial-overdue.spec.ts` (PAY-SURPLUS-PARTIAL-01/02)
- **Status:** ativa — *criada em 2026-04-13 (incidente MD Veículos — surplus não quitava parcelas partial+vencidas)*

---

## Relatórios e Extratos (REL)

### BR-REL-001: Histórico de recebimentos agrupado por evento
- **Descrição:** O histórico de recebimentos do investidor deve agrupar transações por evento de pagamento (mesmo `receipt_id` ou mesmo minuto para transações legadas), exibindo uma linha por evento com valor total e detalhes expandíveis
- **Condição:** Tela de histórico do investidor (`InvestorDashboard`) e view "Por Recebimento" em `InstallmentHistory`
- **Resultado:** Uma linha por pagamento real, não uma linha por `payment_transaction`. Cada card exibe: data, valor total recebido, método de pagamento. Ao expandir: lista de parcelas afetadas com valor aplicado e status atual. Texto descritivo usa linguagem do usuário: "1 parcela paga", "X parcelas pagas", "Pagamento avulso", "Pagamento geral"
- **Exceções:** Transações sem `receipt_id` agrupam por `investment_id + minuto` (dados legados). O indicador visual de dado legado (badge "histórico") não é exibido ao usuário — é detalhe de implementação interno
- **Tabelas:** `payment_transactions`, `loan_installments`
- **Status:** ativa — *atualizada em 2026-04-13 (redesign UX InstallmentHistory)*
- **Stories:** feat 311f8ca

### BR-REL-002: Parcelas fantasmas (deferidas) são omitidas das métricas financeiras do investidor
- **Descrição:** Parcelas resultantes de `mark_installment_missed` que foram zeradas e marcadas como `paid` não devem aparecer nas métricas financeiras do investidor (salário, visão mensal, gráficos). Essas parcelas têm `amount_total = 0`, `amount_paid = 0` e `status = 'paid'`, e possuem uma parcela substituta com `deferred_from_id` apontando para elas. **Exceção:** O histórico operacional do contrato (`InstallmentHistory`, aba "Por Parcela") exibe essas parcelas com status "Falta" e contexto do destino do valor — para transparência administrativa.
- **Condição:** Queries/views de métricas financeiras do investidor (`useInvestorMetrics`, `useDashboardData`). NÃO se aplica ao `InstallmentHistory` do contrato (visualização operacional admin).
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
- **Descrição:** O investidor deve ter acesso a uma tela de resumo mensal que exiba, para cada mês navegável: (1) devedores ativos com valor devido e pago no mês; (2) capital investido ativo no mês; (3) juros recebidos no mês; (4) juros previstos no mês; (5) percentual de realização do mês — fórmula: `(total_pago / total_esperado) × 100`, exibido com barra de progresso visual + valores absolutos; (6) atrasados do mês — parcelas com `status='late'` e `due_date` no mês, com breakdown por devedor (nome, valor em atraso, dias de atraso); (7) cada parcela na carteira do devedor deve ser clicável — ao clicar, o usuário navega para a tela de detalhe da parcela (`InstallmentDetailScreen`), com botão de voltar para a visão mensal. Navegação mês a mês via botões ◀ ▶ sem re-fetch (recomputa do cache)
- **Condição:** Tela "Visão Mensal" no `InvestorDashboard` (tab secundária)
- **Resultado:** Fórmula de % pagamento: `(sum(amount_paid das parcelas pagas/parciais no mês) / sum(amount_total das parcelas com due_date no mês)) × 100`. Cor da barra: verde ≥ 80%, amarelo 50-79%, vermelho < 50%
- **Exceções:** Parcelas fantasma (BR-REL-002) são excluídas. Timezone: `America/Sao_Paulo` (BR-REL-003). Contratos encerrados (`status=completed`) aparecem apenas nos meses em que tinham parcelas
- **Tabelas:** `investments`, `loan_installments` (leitura apenas)
- **Status:** ativa
- **Stories:** implementa feature visão mensal 28/03/2026

### BR-REL-008: Gráficos de evolução mensal do investidor
- **Descrição:** O dashboard do investidor deve exibir dois gráficos de linha na aba "Carteira": (1) volume emprestado por mês — soma de `amount_invested` dos contratos criados no mês; (2) juros recebidos por mês — soma da porção de juros das parcelas pagas/parciais no mês
- **Condição:** Tela "Carteira" no `InvestorDashboard` (tab principal)
- **Resultado:** Ambos gráficos respeitam filtro de contrato selecionado. Não são filtrados por período (exibem timeline completa, consistente com gráfico de barras existente). Parcelas fantasmas (BR-REL-002) são excluídas. Para parcelas `partial`, usar porção proporcional: `(amount_paid / amount_total) * amount_interest`
- **Exceções:** Meses sem atividade são omitidos (sem zero-fill). Gráfico de juros usa `paid_at` para agrupar (não `due_date`)
- **Tabelas:** `investments` (leitura via `created_at`, `amount_invested`), `loan_installments` (leitura via `paid_at`, `amount_interest`)
- **Status:** ativa
- **Stories:** implementa BR-REL-008 em 30/03/2026

### BR-REL-009: Rendimento mensal por tipo de contrato (Admin)
- **Descrição:** O dashboard admin deve exibir uma aba "Rendimento" com análise de rendimento mensal separada por tipo de contrato, com dois níveis de agrupamento: (1) geral — Bullet (todos) vs Parcelado (todos); (2) granular — combinação de `calculation_mode × frequency` (ex: Bullet Mensal, Parcelado Diário)
- **Condição:** Aba "Rendimento" no `AdminDashboardView`; acesso exclusivo ao perfil `admin`
- **Resultado:** Métricas exibidas por tipo: juros recebidos (porção de interesse das parcelas pagas/parciais no período), capital alocado (soma de `amount_invested` de contratos ativos), contratos ativos, rendimento projetado (soma de `amount_interest` de parcelas pendentes). Filtro de tipo via dropdown (Todos / Bullet / Parcelado / tipos granulares). Filtro de período (mês atual / mês anterior / ano / tudo). Tipos sem contratos são omitidos dinamicamente. Para parcelas `partial`, usar porção proporcional: `(amount_paid / amount_total) * amount_interest`
- **Exceções:** Contratos com `status = 'completed' | 'defaulted'` não entram no cálculo de capital ativo, mas seus juros recebidos históricos contam. Parcelas fantasmas (BR-REL-002) são excluídas. Tipos de contrato são derivados dos campos existentes `calculation_mode` e `frequency` — sem alteração de schema
- **Tabelas:** `investments` (leitura: `calculation_mode`, `frequency`, `amount_invested`, `status`), `loan_installments` (leitura: `amount_paid`, `amount_total`, `amount_interest`, `paid_at`, `status`)
- **Status:** ativa
- **Stories:** implementa BR-REL-009 em 30/03/2026

### BR-REL-010: Caderneta Bullet — acesso e escopo
- **Descrição:** A Caderneta Bullet é uma tela dedicada de cobrança mensal exclusiva para contratos bullet (`calculation_mode = 'interest_only'`). Acessível pelo menu home do admin como atalho direto.
- **Condição:** Perfil `admin`; plano não bloqueado (`isFreePlanLocked = false`)
- **Resultado:** Exibe parcelas de todos os investimentos com `calculation_mode = 'interest_only'` cujo `status != 'renewed'`. Contratos `active`, `completed` e `defaulted` são incluídos (podem ter parcelas históricas relevantes). Contratos `renewed` são excluídos pois foram substituídos por novo contrato. Parcelas de outros tipos de contrato são completamente omitidas. Visão padrão: mês corrente
- **Exceções:** Contratos `renewed` nunca aparecem — foram substituídos por contrato sucessor
- **Tabelas:** `investments` (leitura: `calculation_mode`, `payer_id`, `frequency`, `interest_rate`, `asset_name`, `status`), `loan_installments` (leitura: todos os campos)
- **Status:** ativa
- **Stories:** implementado em 09/04/2026; atualizado em 10/04/2026 (escopo de status expandido)

### BR-REL-011: Caderneta Bullet — navegação mensal
- **Descrição:** A caderneta opera com granularidade mensal. O usuário pode navegar entre meses (anterior/próximo). Não é possível avançar além do mês corrente.
- **Condição:** Toda exibição da Caderneta Bullet
- **Resultado:** Parcelas são filtradas por `due_date` dentro do mês selecionado (primeiro ao último dia do mês). Parcelas pagas cujo `due_date` cai no mês selecionado aparecem mesmo que `paid_at` seja de outro mês — o critério é sempre o vencimento, não o pagamento
- **Exceções:** Nenhuma
- **Tabelas:** `loan_installments.due_date`
- **Status:** ativa

### BR-REL-012: Caderneta Bullet — filtro operacional de status e ordenação
- **Descrição:** A caderneta exibe uma lista flat de parcelas (uma por card) e permite filtrar por status operacional: **Em aberto** / **Atraso** / **Pendentes** / **Pagas**. A visão principal é **Em aberto**, não “Todas”.
- **Condição:** Toda exibição da Caderneta Bullet
- **Resultado:** Filtro **Em aberto** inclui somente parcelas operacionais abertas (`pending`, `partial`, `late` e inadimplentes visuais), excluindo pagas quitadas. Filtro **Pendentes** inclui pendentes/parciais sem atraso operacional. Filtro **Atraso** inclui parcelas com saldo em aberto e `due_date < hoje` em BRT, independentemente de `loan_installments.status` já estar `late`. Filtro **Pagas** inclui parcelas quitadas operacionalmente. **Parcial** inclui tanto `status = 'partial'` quanto pagamento parcial (`amount_paid > 0` com saldo em aberto). **Inadimplente** é camada visual dentro de atraso quando `daysLate >= 20`, sem criar novo status persistido nesta BR. Ordenação padrão: inadimplentes/atrasadas primeiro, depois parciais/pendentes, depois pagas; dentro de cada grupo, por `due_date` ascendente. Os KPIs sempre refletem o mês completo independente do filtro ativo (BR-REL-013).
- **Exceções:** Parcela sem `investment_id` ou cujo investimento não é bullet é omitida. Parcelas fora do mês selecionado não aparecem em nenhum filtro. Regras específicas de valor cobrável em contratos bullet/`interest_only` devem respeitar BR-CNT-004 e FR-PAG-06.
- **Tabelas:** `loan_installments.status`, `loan_installments.due_date`, `loan_installments.amount_paid`, campos de valor usados para saldo em aberto
- **Status:** ativa
- **Atualizado:** 2026-05-27 — visão principal passa a ser **Em aberto**, pagos saem da visão principal, parcial/atraso/inadimplente passam a ser classificação operacional conforme decisão PO da CB-001

### BR-REL-013: Caderneta Bullet — KPIs do mês
- **Descrição:** A caderneta exibe 6 KPIs consolidados do mês selecionado:
  1. **Devedores** = contagem de `payer_id` únicos com parcelas bullet no mês (fallback por nome se `payer_id` nulo)
  2. **Esperado bruto** = `SUM(loan_installments.amount_total)` — inclui capital nas parcelas finais e só juros nas intermediárias
  3. **Esperado líquido** = `SUM(loan_installments.amount_interest ?? amount_total)` — somente rendimento (juros)
  4. **Recebido** = `SUM(loan_installments.amount_paid)`
  5. **Em atraso** = `SUM(calcOutstanding())` ou saldo operacional equivalente das parcelas com saldo em aberto e `due_date < hoje` em BRT, incluindo inadimplentes visuais (`daysLate >= 20`)
  6. **Taxa de cobrança** = `recebido / esperado_bruto * 100` (limitado a 100%)
- **Condição:** Toda exibição da Caderneta Bullet
- **Resultado:** KPIs sempre refletem o mês selecionado independente do filtro de status ativo. KPIs não são filtrados — mostram o total real do mês. KPIs 2 e 3 exibem barra de progresso (`recebido / esperado`) com rótulo de valor recebido e percentual
- **Exceções:** Se não há parcelas no mês, todos KPIs exibem zero. Taxa de cobrança exibe 0% se esperado bruto for zero
- **Tabelas:** `loan_installments`, `investments.payer_id`
- **Status:** ativa
- **Atualizado:** 2026-05-27 — KPI **Em atraso** alinhado à regra operacional da Caderneta: data acordada vencida + saldo em aberto, não apenas `status = 'late'`

### BR-REL-015: Caderneta Bullet — formatação de valores monetários nos KPIs
- **Descrição:** Valores monetários exibidos nos KPI cards da Caderneta Bullet devem sempre ser legíveis por completo (sem truncamento). Casas decimais são exibidas somente quando o valor não é inteiro — ex: R$ 1.364 (sem centavos) e R$ 1.364,67 (com centavos quando necessário)
- **Condição:** Toda exibição de valor monetário nos KPI cards da Caderneta Bullet
- **Resultado:** Usar formatter `fmtKpi` que detecta se o valor possui decimais relevantes. Se `v % 1 === 0`, exibir sem casas decimais. Caso contrário, exibir com 2 casas. Nunca usar `truncate` CSS em valores monetários de KPI — o card deve se adaptar ao conteúdo
- **Exceções:** Parcelas individuais na tabela de detalhes mantêm sempre 2 casas decimais via `fmtMoney` padrão
- **Tabelas:** —
- **Status:** ativa

### BR-REL-014: Caderneta Bullet — card de parcela (flat list)
- **Descrição:** Cada parcela bullet do mês é exibida como um card individual (flat list, sem accordion). O card deve conter as informações essenciais de cobrança em layout compacto, clicável para abrir o detalhe da parcela.
- **Condição:** Toda parcela bullet exibida na Caderneta Bullet
- **Resultado:** Cada card exibe obrigatoriamente: (a) barra lateral colorida pelo status operacional (`late/defaulted`=danger, `partial/pending`=warning, `paid`=positive); (b) foto do devedor em círculo 26px (fallback: inicial do nome com cor do status); (c) nome do devedor + nome do contrato (`asset_name`) como sublabel; (d) data de vencimento formatada `dd/mm/aaaa` e número da parcela `#N` alinhados à direita; (e) valor cobrável exibido conforme regra bullet vigente; (f) valor pago `amount_paid` quando houver pagamento; (g) barra de progresso do valor pago sobre o total cobrável operacional; (h) badge de status operacional, incluindo **Inadimplente** para 20+ dias de atraso; (i) linha de multa/juros de atraso exibida condicionalmente apenas quando `fine_amount > 0 || interest_delay_amount > 0`
- **Exceções:** Linha de multa/juros omitida quando ambos são zero. Barra de progresso com percentual numérico exibida apenas quando `0 < progress < 100`. Valor pago exibido apenas quando `amount_paid > 0`. A regra de valor cobrável para bullet/`interest_only` deve respeitar BR-CNT-004 e FR-PAG-06 para não confundir principal de referência com juros do ciclo.
- **Tabelas:** `loan_installments`, `investments.asset_name`, `profiles.photo_url`, `profiles.full_name`
- **Status:** ativa
- **Atualizado:** 2026-05-27 — card passa a comunicar status operacional da Caderneta, incluindo parcial por pagamento parcial e inadimplente visual com 20+ dias

### BR-REL-016: Histórico do Contrato é fonte única de verdade — acessível via ContractDetail
- **Descrição:** Existe exatamente **um** Histórico do Contrato por investment, exibido em `InstallmentHistory`. Ele é a fonte canônica de todos os eventos financeiros do contrato: pagamentos de parcelas, pagamentos avulsos, surplus, reversões, late_auto. Acessível via botão dedicado em `ContractDetail`
- **Condição:** Toda exibição de movimentações financeiras de um contrato específico
- **Resultado:**
  1. `InstallmentHistory` agrega: (a) `payment_transactions` via `SELECT * WHERE investment_id = ?` e (b) metadados de `loan_installments` para contexto de data/valor/status
  2. Ambas as views ("Por Recebimento" e "Por Parcela") devem exibir avulsos — sem dependência de scroll para localizá-los
  3. View "Por Parcela" exibe seção "◇ Pagamentos avulsos" **com contador visível no topo**, acima do header da tabela, quando houver avulsos
  4. View "Por Recebimento" agrupa avulsos como receipt próprio; label mostra tipo (pagamento avulso) e destino (principal_reduction / general_credit / penalty_payment) quando disponível em `notes`
  5. `ContractDetail` **não** duplica painel de avulsos — remove estado local `avulsoPayments` e query em `avulso_payments` e substitui por botão que abre `InstallmentHistory`
- **Nível de detalhe por transação (visível ao usuário):** data/hora, destino (para avulsos: lido de `payment_transactions.notes`), parcela afetada ou "nível contrato", método de pagamento, valor. Tipos visíveis ao usuário: `payment`, `avulso`, `reversal`, `missed`. Tipos internos (`late_auto`, `surplus_applied`, `deferred`) são registrados mas **ocultos por padrão** na UI — são eventos de roteamento interno sem valor informativo para o usuário final
- **UX obrigatória (redesign 2026-04-13):**
  - **Hero Card de Progresso:** exibido imediatamente abaixo do cabeçalho de identificação do devedor, visível sem scroll. Contém: barra de progresso (parcelas pagas / total), e 3 métricas — Pagas (valor + contagem), Pendentes (valor + contagem), Atrasadas (valor + contagem). Substitui o rodapé de tiles que ficava oculto sem scroll
  - **Badge de saúde global:** exibido junto ao ID do contrato no cabeçalho — "Em dia" (azul), "X atrasada(s)" (vermelho), "Quitado" (verde)
  - **Status badges padronizados:** exibidos como pills coloridos. Mapeamento obrigatório: `paid` → "Paga" (verde), `pending` → "Pendente" (âmbar), `late` → "Atrasada" (vermelho), `partial` → "Parcial" (azul), `missed/absorbed` → "Falta" (vermelho)
  - **Expand por parcela:** na view "Por Parcela", cada linha é expandível via clique — exibe data de pagamento, método, dias de atraso (quando positivo), nota, falta registrada e transações visíveis
- **Exceções:** `SalaryDashboard` continua lendo `loan_installments` para o painel de recebimentos mensais do investidor — não é histórico de contrato individual, não cobre esta BR. Eventual unificação de `SalaryDashboard` com `payment_transactions` é escopo de BR futura
- **Tabelas:** `payment_transactions`, `loan_installments`, `investments`
- **Status:** ativa — *atualizada em 2026-04-13 (redesign UX: hero card de progresso, status pills, eventos internos ocultos, expand por parcela)*

### BR-REL-017: Aba Salário — holerite mensal do operador de crédito
- **Descrição:** A aba Salário exibe o rendimento do operador como um holerite: um único número hero que responde "quanto ganhei este mês?". A métrica hero é o **Lucro do período** = soma de `amount_interest + fine_amount + interest_delay_amount` das parcelas com `status IN ('paid','partial')` e `paid_at` no período selecionado (timezone `America/Sao_Paulo`, conforme BR-TZ-001). Abaixo do hero, duas linhas finas decompõem em: (1) juros contratuais (`amount_interest`) e (2) atraso/multa (`fine_amount + interest_delay_amount`). A linha de atraso é omitida quando zero. Cards secundários exibem: "Caiu na mão" (soma de `amount_paid`) e "Dinheiro que voltou" (soma de `amount_principal`). Período default: mês corrente.
- **Condição:** `SalaryDashboard` — única tela que exibe este holerite
- **Resultado:** Hero = `SUM(amount_interest + fine_amount + interest_delay_amount)` filtrado por `paid_at` no período. Inclui parcelas de contratos com `status = 'completed'` — contratos quitados fazem parte do histórico real de rendimento. Parcelas fantasmas (BR-REL-002) são excluídas. Parcelas com `paid_at = NULL` são incluídas apenas no filtro "Tudo", com indicação visual.
- **Motivação (auditada via MCP 2026-04-15):** 192 parcelas (R$ 61.126,55 = 18,6% do total pago) estavam sumindo do histórico por filtro indevido em contratos `completed`. Operador não conseguia ver sua renda histórica correta.
- **Exceções:** Parcelas com `amount_total=0 AND amount_paid=0 AND status='paid'` (fantasmas BR-REL-002) são sempre excluídas. Período custom usa `paid_at` da parcela, nunca `due_date`.
- **Tabelas:** `loan_installments` (leitura via `paid_at`, `amount_interest`, `fine_amount`, `interest_delay_amount`, `amount_principal`, `amount_paid`, `status`)
- **Status:** ativa — *criada em 2026-04-15*

### BR-REL-018: Fórmula única de rendimento — `calcSalaryPortions`
- **Descrição:** Toda tela ou hook que exiba renda do operador (juros, atraso, principal, bruto recebido) DEVE consumir a função pura `calcSalaryPortions(installment)` de `services/salary.ts`. É proibido recalcular porções de rendimento inline em componentes ou hooks. A função retorna `{ juros: number, atraso: number, principal: number, bruto: number }` onde: `juros = amount_interest (proporcional ao pago em parciais)`, `atraso = fine_amount + interest_delay_amount (proporcional)`, `principal = amount_principal (proporcional)`, `bruto = amount_paid`. Para parcelas `paid` integrais, usa valores diretos; para `partial`, distribui proporcionalmente via `ratio = amount_paid / (amount_principal + amount_interest + fine_amount + interest_delay_amount)`.
- **Condição:** Qualquer exibição de breakdown de rendimento: `SalaryDashboard`, `buildKPIs` em `useDashboardData`, futuros relatórios de rendimento
- **Resultado:** KPIs do dashboard (`totalProfitReceived`) e aba Salário (`lucroReal`) usam a mesma função → valores sempre consistentes entre si
- **Motivação:** Dupla fórmula divergente identificada em 2026-04-15: hook usava `amountPaid - amountPrincipal` (ignora fine/delay); componente usava `juros + fine + delay` separado. Valores eram diferentes.
- **Exceções:** Parcelas com `obligation = 0` retornam `{ juros: 0, atraso: 0, principal: 0, bruto: 0 }` sem divisão por zero
- **Tabelas:** N/A — função frontend pura
- **Status:** ativa — *criada em 2026-04-15*

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

### BR-USR-007: Tab Administradores na gestão de usuários
- **Descrição:** A tela de gestão de usuários deve exibir uma tab "Administradores" que filtra exclusivamente perfis com `role = 'admin'` do tenant ativo
- **Condição:** Acesso à tela `AdminUsers`, tab "Administradores" selecionada
- **Resultado:** Somente profiles com `role = 'admin'` são exibidos; investidores e devedores continuam em suas respectivas tabs
- **Exceções:** Nenhuma
- **Tabelas:** `profiles`
- **Status:** ativa
- **Stories:** Migration v37, `components/AdminUsers.tsx`

### BR-USR-008: Métricas operacionais por administrador
- **Descrição:** Na tab Administradores, cada card exibe 4 métricas operacionais: (1) Contratos Criados — count de `investments.created_by = admin.id`; (2) Volume Financeiro — soma de `amount_invested` dos contratos criados; (3) Usuários Cadastrados — profiles diretos + invites aceitos com `created_by = admin.id`; (4) Último Acesso — `auth.users.last_sign_in_at`
- **Condição:** Tab Administradores ativa em `AdminUsers`
- **Resultado:** Métricas exibidas por card admin via RPC `get_admin_metrics`; dados históricos anteriores à migration v37 mostram `created_by = NULL` (métricas zeradas para contratos/usuários antigos)
- **Exceções:** Admin sem `auth_user_id` vinculado mostra "Nunca" em último acesso
- **Tabelas:** `investments`, `profiles`, `invites`, `auth.users`
- **Status:** ativa
- **Stories:** Migration v37, `hooks/useAdminMetrics.ts`, `components/AdminUsers.tsx`

### BR-PLAT-002: Métricas de admin no overlay de visualização de tenant
- **Descrição:** No overlay "Ver" de um tenant (PlatformOwnerPanel), os perfis com `role = 'admin'` exibem as mesmas 4 métricas operacionais de BR-USR-008 abaixo do nome/email: Contratos Criados, Volume Financeiro, Usuários Cadastrados e Último Acesso.
- **Condição:** Perfil com `role = 'admin'` no overlay TenantDetailOverlay
- **Resultado:** Grid 4 colunas com métricas via RPC `get_admin_metrics(p_tenant_id)`. Sem dados → tracinhos (`—`), falha silenciosa.
- **Exceções:** Nenhuma mudança no banco; reutiliza RPC existente (SECURITY DEFINER).
- **Tabelas:** `investments`, `profiles`, `invites`, `auth.users`
- **Status:** ativa
- **Stories:** `components/PlatformOwnerPanel.tsx`

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

### BR-SYS-007: Pipeline CI/CD com testes tiered obrigatórios
- **Descrição:** Todo push na branch `main` deve executar os dois tiers de testes E2E antes do deploy. Tier 1 (smoke) valida que o sistema está vivo. Tier 2 (core business) valida fluxos críticos de negócio — login, contratos, pagamentos, clientes. Ambos bloqueiam o deploy se falharem. Relatório detalhado com screenshots de falhas deve ser enviado ao Telegram após cada execução
- **Condição:** Qualquer commit na branch `main`
- **Resultado:** Deploy para Cloud Run só ocorre se Tier 1 AND Tier 2 passarem. Screenshots de falhas chegam ao Telegram via `sendPhoto` sem persistência em banco de dados
- **Exceções:** Tier 3 (investor/debtor) é informativo — não bloqueia deploy enquanto credenciais de teste não estiverem provisionadas
- **Tabelas:** Nenhuma (CI/CD only)
- **Story:** Implementa BR-SYS-003 (deploy via CI/CD)
- **Status:** ativa

### BR-SYS-008: Toda ação de cliente com efeito colateral deve ser registrada em `tenant_events`
- **Descrição:** Qualquer ação iniciada por usuário autenticado que modifique dados ou produza efeito observável (autenticar, criar/editar/excluir contrato, pagar, override administrativo) DEVE gerar um registro não-bloqueante em `tenant_events` com contexto suficiente para reproduzir o estado no momento do erro
- **Motivação:** Tenants em fase de teste realizam ações que resultam em estados inconsistentes. Sem log de atividade, é impossível reproduzir erros ou entender o que o usuário fez antes do problema
- **Condição:** Usuário autenticado realiza ação nas categorias: `auth`, `contract`, `payment`, `installment_admin`
- **Resultado:** INSERT em `tenant_events` (non-blocking, fire-and-forget via `services/eventLog.ts`) com `before`/`after` snapshot e `context` em JSONB
- **Exceções:** Leituras puras (GET sem side-effect); navegação entre páginas; falhas de autenticação sem sessão estabelecida
- **Tabelas:** `tenant_events` (nova — migration v42)
- **Status:** ativa

### BR-DB-001: Migrations de RPC devem dropar overloads anteriores explicitamente
- **Descrição:** Ao adicionar parâmetros a uma função PostgreSQL existente, `CREATE OR REPLACE FUNCTION` com assinatura diferente NÃO substitui a versão anterior — cria um novo overload. Múltiplos overloads com parâmetros opcionais causam erro "Could not choose the best candidate function" em runtime
- **Condição:** Qualquer migration que modifique a assinatura de uma função em `public.*`
- **Resultado:** O script de migration DEVE incluir `DROP FUNCTION IF EXISTS` para CADA versão anterior antes do `CREATE OR REPLACE` da nova versão. Usar `context/TEMPLATE_rpc_migration.sql` como base
- **Verificação:** Após aplicar, confirmar que `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='nome_funcao'` retorna exatamente 1. Script: `scripts/check-db-overloads.sh`
- **Exceções:** Overloads intencionais com tipos radicalmente diferentes (ex: `funcao(uuid)` e `funcao(text)`) são permitidos — mas devem ser documentados explicitamente na migration
- **Tabelas:** Qualquer função em `public.*`
- **Status:** ativa
- **Origem:** Bug crítico 2026-03-26 — `create_investment_validated` acumulou 5 overloads entre v28 e v33, bloqueando criação de contratos. Corrigido em `context/migration_v34_drop_overloads.sql`. Segundo incidente 2026-04-01 — `pay_installment` com 2 overloads (v32 não dropou v30 anterior), causando falha em baixas e perda de cliente. Corrigido em `context/migration_v37_drop_pay_installment_overload.sql`

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

### BR-BOT-007: Personalização do assistente IA por tenant
- **Descrição:** Cada tenant pode configurar seu próprio assistente IA com identidade própria, sem tocar em código. Campos configuráveis: `ai_enabled` (bool), `ai_persona_name` (texto, máx 40 chars, default "Assistente"), `ai_tone` (enum: `profissional` | `casual` | `amigavel` | `formal`, default `profissional`), `ai_system_prompt` (texto livre do admin, máx 3000 chars / ~3KB), `ai_faq_entries` (jsonb array de `{pergunta, resposta}`, máx 20 entries, cada resposta máx 500 chars), `ai_model_preference` (enum: `flash` | `pro`, default `flash`). **Modelo `flash` é o padrão universal para todos os tenants** (sem tier por plano) — tier por plano afeta apenas budget (BR-BOT-008). O pipeline LLM-first injeta essas configurações no system prompt ANTES de cada chamada ao Gemini. Mudanças refletem em ≤60s (cache TTL). O prompt do tenant é anexado a um prompt-base imutável que garante regras inegociáveis (não inventar dados, confirmar mutações, respeitar role) — admin NÃO pode sobrescrever essas regras
- **Condição:** `bot_tenant_config` (colunas `ai_*`), `e-finance-bot/src/ai/system-prompt-builder.ts`, `components/admin/AdminBotAI.tsx`
- **Resultado:** Admin do tenant acessa `/admin/bot-ai` e edita persona + tom + prompt customizado + FAQ. Validação: `system_prompt` ≤ 3KB; `faq_entries` ≤ 20 itens e cada resposta ≤ 500 chars; `persona_name` ≤ 40 chars. Preview em tempo real mostra como a persona responde a uma mensagem de teste. Ao salvar, cache é invalidado e próxima mensagem usa config nova. Apenas usuários com `role='admin'` do tenant podem editar (RLS policy). FAQ é injetada no prompt apenas se mensagem do usuário contém keyword relacionada (pre-filtro) para não estourar budget de tokens. Tom injeta instruções fixas no prompt-base (ex. `casual` → "Fale de forma descontraída")
- **Exceções:** Platform owner (`guifrotasouza@gmail.com`) pode editar qualquer tenant e usar `ai_model_preference='pro'`. Se `ai_enabled=false`, pipeline IA é ignorado e bot responde com mensagem padrão "Assistente IA desativado pelo admin"
- **Tabelas:** `bot_tenant_config`, `bot_messages`
- **Status:** ativa (pendente aplicação da migration `027_bot_tenant_ai_config.sql`)

### BR-BOT-008: Budget LLM por tenant e rate limit por usuário
- **Descrição:** Custo de tokens LLM é controlado em duas dimensões: (1) **budget mensal por tenant** em centavos de USD, calibrado para volume inicial de ~50-60 msgs/dia/tenant (~1.800 msgs/mês, dos quais ~60% vão ao LLM após fast-path): plano `free` 50¢, `caderneta` 100¢, `empresarial` 300¢. Cálculo de calibração: com medidas de economia (Parte 10 do plano), custo médio é ~$0.00014/call Flash → $0.15/mês estimado → margem de segurança 3x para picos. (2) **Rate limit por usuário final** — 20 msgs/min (mantido) + **20 msgs/dia** por `channel_user_id` (considerando tenant médio com 2-5 usuários ativos). Budget é incrementado em tempo real após cada chamada ao Gemini usando custo real (`tokens_in * 0.075/1M + tokens_out * 0.30/1M` para Flash; 16x para Pro). Reset mensal: dia 1 do mês às 00:00 BRT via Cloud Scheduler. Reset diário de rate limit: 00:00 BRT. Fast-path regex (saudações, confirmações, slash commands) NÃO conta no budget — não chama LLM
- **Condição:** `bot_tenant_config` (colunas `ai_monthly_budget_cents`, `ai_current_month_cents_spent`, `ai_budget_month_start`), `e-finance-bot/src/ai/conversation-orchestrator.ts`, `e-finance-bot/src/ai/budget-guard.ts`
- **Resultado:** Ao atingir **80%** do budget, sistema envia email ao admin do tenant ("seu bot atingiu 80% do limite mensal"). Ao atingir **100%**, bot responde com mensagem fixa: "Limite mensal do assistente IA atingido. Fale com o administrador para aumentar o plano." até o reset mensal. Fast-path continua funcionando mesmo após 100% (saudação/ajuda não usa tokens). Rate limit diário por usuário: ao atingir 20 msgs/dia, bot responde "Pausa, você mandou muitas mensagens hoje 😅, volta amanhã". Custo por chamada é registrado em `bot_messages.tokens_in`, `tokens_out`, `latency_ms`. Kill switch global: env `AI_NATIVE_KILL_SWITCH=true` desliga IA para todos tenants (fallback pipeline antiga). Budgets podem ser ajustados por tenant individualmente (admin não edita — apenas platform owner via SQL ou endpoint protegido) à medida que volume real for medido e calibração evoluir
- **Exceções:** Platform owner (`guifrotasouza@gmail.com`) é isento de budget e rate limit (para testes em produção). Se custo do Gemini subir (>3x preço atual), kill switch é acionado manualmente e budgets são recalculados
- **Tabelas:** `bot_tenant_config`, `bot_messages`, `bot_user_rate_limits` (nova — contador diário por `channel_user_id`)
- **Status:** ativa (pendente aplicação das migrations `027_bot_tenant_ai_config.sql` e `028_bot_user_rate_limits.sql`)

### BR-TZ-001: Timezone operacional do frontend
- **Descrição:** Toda computação de "hoje" e comparação de datas no frontend deve usar o fuso horário `America/Sao_Paulo`. Proibido usar `new Date().toISOString().split('T')[0]` para obter a data atual (retorna UTC — às 21h BRT já é dia seguinte em UTC). Proibido usar `new Date().getFullYear()/.getMonth()/.getDate()` sem timezone explícito.
- **Condição:** Qualquer hook, componente ou serviço que compare `due_date`, `paid_at`, ou compute "hoje"
- **Resultado:** Usar exclusivamente `services/dateUtils.ts`: `getBrazilToday()` para "hoje", `toBrazilYMD(date)` para converter Date, `isoToBrazilYMD(iso)` para converter timestamps do Supabase, `addDaysBR(ymd, n)` para somar dias, `getMonthRangeBR()` para limites de mês. Internamente usam `Intl.DateTimeFormat` com timezone `America/Sao_Paulo`.
- **Exceções:** Timestamps enviados ao Supabase (`paid_at`, `created_at`, `updated_at`) continuam em UTC/ISO — a conversão é apenas para exibição e comparação de datas no frontend. A função de banco `update_overdue_installments` usa `CURRENT_DATE` (PostgreSQL) — o cron está configurado para rodar às 03:05 UTC (00:05 BRT), momento em que UTC e BRT concordam no dia.
- **Tabelas:** N/A — regra de código frontend
- **Status:** ativa
- **Stories:** fix timezone bug 2026-04-10

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
