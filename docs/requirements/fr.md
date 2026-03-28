# Requisitos Funcionais — E-Finance

> Especificação formal de requisitos funcionais por módulo.
> Complementa BRs (`docs/business-rules/e-finance-br.md`) e NFRs (`docs/requirements/nfr.md`).
> Mantenedor: @po (Pax) + @pm (Morgan)
> Criado: 28/03/2026

---

## Estrutura

Cada FR segue o formato:
- **ID:** `FR-{módulo}-{número}` (ex: `FR-PAG-01`)
- **Descrição:** O que o sistema deve fazer
- **Ator:** Quem executa (admin, investidor, devedor, sistema)
- **Pré-condições:** Estado necessário antes da execução
- **Fluxo principal:** Passos do cenário feliz
- **Fluxo alternativo/exceções:** Cenários de erro
- **BRs relacionadas:** IDs de Business Rules aplicáveis
- **Prioridade:** `P0 | P1 | P2 | P3`
- **Status:** `implementado | parcial | pendente`

Módulos:
- `PAG` — Operações de Pagamento
- `CNT` — Contratos (lifecycle, criação, renovação)
- `SUB` — Assinatura e Billing
- `BOT` — Bot / Assistente IA
- `REL` — Relatórios e Dashboards
- `AUTH` — Autenticação e Onboarding
- `CFG` — Configuração e Administração

---

## Operações de Pagamento (PAG)

### FR-PAG-01: Pagamento padrão de parcela
- **Ator:** Admin
- **Pré-condições:** Parcela com `status IN ('pending', 'late', 'partial')`
- **Fluxo principal:**
  1. Admin seleciona parcela e clica "Pagar"
  2. Sistema exibe valor total com encargos (`amount_total + fine_amount + interest_delay_amount`)
  3. Admin informa valor pago e data de pagamento
  4. Sistema executa `pay_installment`
  5. Se valor = total: status → `paid`
  6. Se valor < total: status → `partial`, registra `remainder_amount`
  7. Se valor > total: calcula surplus, exibe opções de alocação (BR-PAG-003)
  8. Registra em `payment_transactions` (BR-PAG-009)
  9. Exibe confirmação com opção de gerar recibo
- **Exceções:** Parcela já paga → erro (BR-PAG-002). Valor negativo → rejeitar
- **BRs:** BR-PAG-001, BR-PAG-002, BR-PAG-003, BR-PAG-005, BR-PAG-006, BR-PAG-009
- **Prioridade:** P0
- **Status:** implementado

### FR-PAG-02: Refinanciamento de parcela
- **Ator:** Admin
- **Pré-condições:** Parcela com `status IN ('pending', 'late', 'partial')`
- **Fluxo principal:**
  1. Admin seleciona parcela e clica "Refinanciar"
  2. Sistema exibe saldo devedor da parcela
  3. Admin informa valor de entrada (≥ R$1,00 ou 1% do saldo) e nova data de vencimento (futuro)
  4. Sistema executa `refinance_installment`
  5. Parcela original é marcada como `partial` com valor de entrada pago
  6. Nova parcela criada com saldo remanescente + juros recalculados
  7. Registra em `payment_transactions` tipo `refinance`
- **Exceções:** Valor de entrada < mínimo → rejeitar. Nova data ≤ hoje → rejeitar
- **BRs:** BR-PAG-011, BR-PAG-006, BR-PAG-009
- **Prioridade:** P0
- **Status:** implementado (sem validações de BR-PAG-011)

### FR-PAG-03: Reversão de pagamento
- **Ator:** Admin (exclusivo)
- **Pré-condições:** Parcela com `status = 'paid'`, dentro de 72h do pagamento
- **Fluxo principal:**
  1. Admin seleciona parcela paga e clica "Desfazer pagamento"
  2. Sistema exibe aviso: "Esta ação irá reverter o pagamento. Continuar?"
  3. Admin confirma
  4. Sistema verifica `paid_at` está dentro de 72h
  5. Executa `revert_installment_payment` → status volta para o anterior
  6. Registra em `payment_transactions` tipo `reversal`
- **Exceções:** Fora da janela de 72h → bloquear (BR-PAG-012). Role não-admin → bloquear
- **BRs:** BR-PAG-012, BR-PAG-009
- **Prioridade:** P0
- **Status:** implementado (sem validações de janela/role de BR-PAG-012)

### FR-PAG-04: Edição administrativa de parcela
- **Ator:** Admin
- **Pré-condições:** Parcela existente, qualquer status exceto `paid`
- **Fluxo principal:**
  1. Admin seleciona parcela e clica "Editar"
  2. Sistema exibe campos editáveis: valor total e data de vencimento
  3. Admin altera valores
  4. Sistema valida: delta de valor ≤ 50%, nova data ≥ hoje
  5. Executa `admin_update_installment`
  6. Registra log com before/after em `payment_transactions`
- **Exceções:** Delta > 50% → alertar (futuro: exigir segunda aprovação). Data passada → rejeitar
- **BRs:** BR-PAG-013, BR-PAG-009
- **Prioridade:** P0
- **Status:** implementado (sem validações de BR-PAG-013)

### FR-PAG-05: Pagamento avulso (off-schedule)
- **Ator:** Admin
- **Pré-condições:** Contrato ativo
- **Fluxo principal:**
  1. Admin acessa detalhe do contrato e clica "Pagamento avulso"
  2. Sistema exibe formulário: valor, destino (redução de principal / multas / crédito geral), data, notas
  3. Admin preenche e confirma
  4. Sistema executa `pay_avulso`
  5. Registra em `payment_transactions` tipo `avulso` com destino
  6. Se destino = `principal_reduction`: atualiza `remaining_balance` do contrato
- **Exceções:** Valor ≤ 0 → rejeitar. Contrato não ativo → rejeitar
- **BRs:** BR-PAG-014, BR-PAG-009
- **Prioridade:** P0
- **Status:** implementado (sem campo destino formal de BR-PAG-014)

### FR-PAG-06: Pagamento bullet (interest_only)
- **Ator:** Admin
- **Pré-condições:** Contrato com `calculation_mode = 'interest_only'`, parcela pendente de juros
- **Fluxo principal:**
  1. Admin seleciona parcela de juros e clica "Pagar juros"
  2. Sistema exibe valor dos juros do período
  3. Admin informa valor e data
  4. Sistema executa `pay_bullet_interest_only`
  5. Se valor = juros: parcela quitada, gera próxima parcela
  6. Se valor < juros: diferença capitalizada no saldo (BR-PAG-015)
- **Exceções:** Pagamento parcial com `capitalize_interest = false` → rejeitar
- **BRs:** BR-CNT-004, BR-PAG-015, BR-PAG-009
- **Prioridade:** P0
- **Status:** implementado (capitalização de BR-PAG-015 pendente)

### FR-PAG-07: Postergamento de parcela (missed)
- **Ator:** Admin
- **Pré-condições:** Parcela com `status IN ('pending', 'late')`
- **Fluxo principal:**
  1. Admin seleciona parcela e clica "Postergar"
  2. Sistema exibe aviso: "A parcela será zerada e uma nova será criada ao final"
  3. Admin confirma
  4. Sistema executa `mark_installment_missed`
  5. Parcela original: `amount_total = 0, amount_paid = 0, status = 'paid'`
  6. Nova parcela criada com `number = max + 1`, herda valores + encargos
  7. Nova parcela tem `deferred_from_id` apontando para original
- **Exceções:** Nenhuma
- **BRs:** BR-PAG-018, BR-REL-002
- **Prioridade:** P1
- **Status:** implementado

### FR-PAG-08: Pagamento self-service do devedor via PIX
- **Ator:** Devedor
- **Pré-condições:** Devedor autenticado, parcela pendente/atrasada, tenant com PIX configurado
- **Fluxo principal:**
  1. Devedor acessa dashboard e vê parcelas devidas
  2. Seleciona parcela e clica "Pagar"
  3. Sistema gera QR Code PIX com valor exato (BR-PAG-016)
  4. Exibe QR Code + código copiável + dados do beneficiário
  5. Devedor realiza pagamento via app bancário
  6. (Futuro) Webhook PIX confirma pagamento automaticamente
  7. (Atual) Admin confirma manualmente via painel
- **Exceções:** Sem PIX configurado → ocultar botão. Valor diferente do exato → não permitido
- **BRs:** BR-PAG-008, BR-PAG-016
- **Prioridade:** P1
- **Status:** parcial (sem confirmação automática via webhook)

---

## Contratos (CNT)

### FR-CNT-01: Criação de contrato padrão
- **Ator:** Admin
- **Pré-condições:** Investidor e devedor existem, empresa selecionada
- **Fluxo principal:**
  1. Admin acessa "Contratos" e preenche formulário (ou usa QuickContractInput)
  2. Informa: investidor, devedor, valor, taxa, parcelas, frequência, modalidade, data início
  3. Sistema valida (BR-CNT-001 a 006)
  4. Executa `create_investment_validated`
  5. RPC cria investment + gera loan_installments automaticamente
  6. Redireciona para detalhe do contrato
- **Exceções:** Investidor = devedor → erro. Taxa negativa → erro. 0 parcelas → erro
- **BRs:** BR-CNT-001, BR-CNT-002, BR-CNT-003, BR-CNT-004, BR-CNT-005, BR-CNT-006
- **Prioridade:** P0
- **Status:** implementado

### FR-CNT-02: Renovação de contrato
- **Ator:** Admin
- **Pré-condições:** Contrato existente (qualquer status exceto `defaulted`)
- **Fluxo principal:**
  1. Admin acessa detalhe do contrato e clica "Renovar"
  2. Modal exibe termos do contrato original (pré-preenchidos)
  3. Admin pode alterar taxa, parcelas, frequência
  4. Admin confirma
  5. Contrato original → `status = 'renewed'`
  6. Novo contrato criado com `parent_investment_id = original.id`
  7. Novo contrato herda investidor, devedor, empresa
- **Exceções:** Contrato defaulted → bloquear (decisão admin reverter status primeiro)
- **BRs:** BR-CNT-007, BR-CNT-009
- **Prioridade:** P0
- **Status:** implementado (sem validação de status/vínculo de BR-CNT-007)

### FR-CNT-03: Import de contrato legado
- **Ator:** Admin
- **Pré-condições:** Devedor existente (ou criar inline)
- **Fluxo principal:**
  1. Admin acessa "Importar Contrato Legado"
  2. Preenche: devedor (busca por CPF), valor, taxa, parcelas totais, parcelas pré-pagas
  3. Opcionalmente informa `original_contract_code`
  4. Configura datas das parcelas (manual ou automático)
  5. Sistema executa `create_legacy_investment`
  6. Parcelas pré-pagas criadas com `status = 'paid'`
- **Exceções:** Código duplicado no tenant → erro. Pré-pagas > total → erro
- **BRs:** BR-CNT-008
- **Prioridade:** P1
- **Status:** implementado (sem unicidade de código de BR-CNT-008)

### FR-CNT-04: Visualização de detalhe do contrato
- **Ator:** Admin, Investidor (read-only para seus contratos)
- **Pré-condições:** Contrato existente
- **Fluxo principal:**
  1. Acessar detalhe do contrato
  2. Exibe: dados do contrato, timeline de parcelas, métricas (juros pagos, principal recuperado, health score)
  3. Exibe histórico de renegociações
  4. Exibe cadeia de renovação (parent + children)
  5. Permite ações em parcelas (pagar, refinanciar, editar, etc.)
- **Exceções:** Investidor/devedor só vê seus próprios contratos (BR-USR-002)
- **BRs:** BR-USR-002, BR-REL-001
- **Prioridade:** P0
- **Status:** implementado

---

## Assinatura e Billing (SUB)

### FR-SUB-01: Exibição de planos e checkout
- **Ator:** Admin (dono do tenant)
- **Pré-condições:** Tenant existente
- **Fluxo principal:**
  1. Admin acessa Configurações → Assinatura
  2. Sistema exibe 3 planos: Free (R$0), Caderneta (R$150/mês), Empresarial (R$275/mês)
  3. Exibe features de cada plano com comparativo
  4. Admin clica "Assinar" → redirecionado para Stripe Checkout
  5. Após pagamento bem-sucedido, webhook atualiza `tenants.plan`, `plan_status`, `plan_expires_at`
- **Exceções:** Checkout abandonado → nenhuma alteração. Pagamento falhou → retornar com erro
- **BRs:** BR-SUB-001, BR-SUB-003
- **Prioridade:** P0
- **Status:** implementado

### FR-SUB-02: Trial automático de 15 dias
- **Ator:** Sistema (automático no onboarding)
- **Pré-condições:** Novo tenant criado
- **Fluxo principal:**
  1. Tenant criado via `complete_oauth_onboarding`
  2. `trial_ends_at` setado para `created_at + 15 dias`
  3. Durante trial, todas features de `empresarial` liberadas
  4. Frontend verifica `trial_ends_at > now()` antes de verificar plano pago
  5. Ao expirar, features restringem ao plano pago (ou `free`)
  6. Exibe banner "Trial expira em X dias" quando restam ≤ 5 dias
- **Exceções:** Tenant com plano pago ativo → trial é irrelevante. Tenants pré-trial → sem trial
- **BRs:** BR-SUB-003
- **Prioridade:** P1
- **Status:** implementado

### FR-SUB-03: Degradação graciosa por falha de pagamento
- **Ator:** Sistema (automático via webhook Stripe)
- **Pré-condições:** Tenant com plano pago
- **Fluxo principal:**
  1. Stripe envia evento `invoice.payment_failed`
  2. Webhook processa e seta `plan_status = 'past_due'`
  3. `grace_period_ends_at = NOW() + 7 dias`
  4. Durante grace period, acesso total mantido
  5. Exibe banner "Problema no pagamento. Regularize em X dias"
  6. Cron diário verifica `grace_period_ends_at < now()` → degrada para `free`
  7. Dados nunca deletados
- **Exceções:** Pagamento regularizado durante grace → cancela degradação. Evento duplicado → idempotente
- **BRs:** BR-SUB-001, BR-SUB-002
- **Prioridade:** P0
- **Status:** parcial (webhook existe, grace period não implementado)

---

## Bot / Assistente IA (BOT)

### FR-BOT-01: Processamento de mensagem inbound
- **Ator:** Usuário (via WhatsApp ou Telegram)
- **Pré-condições:** Bot conectado ao canal, número na whitelist
- **Fluxo principal:**
  1. Mensagem chega no webhook
  2. Prompt guard verifica injeção (BR-BOT-004)
  3. Buffer agrega mensagens rápidas (2s window)
  4. Intent classifier categoriza a intenção
  5. Intent router direciona ao handler correto
  6. Handler executa ação (consulta, mutação com confirmação, etc.)
  7. Response generator formata resposta em PT-BR
  8. Envia resposta pelo canal de origem
- **Exceções:** Número fora da whitelist → "Acesso não autorizado" (BR-BOT-005). Prompt injection → "Não posso ajudar com isso" (BR-BOT-004). `fromMe = true` → ignorar silenciosamente
- **BRs:** BR-BOT-001, BR-BOT-004, BR-BOT-005
- **Prioridade:** P0
- **Status:** implementado

### FR-BOT-02: Briefing matinal automático
- **Ator:** Sistema (Cloud Scheduler)
- **Pré-condições:** Admin conectado em pelo menos 1 canal, briefing habilitado
- **Fluxo principal:**
  1. Scheduler dispara no horário configurado (padrão 07:00 BRT)
  2. Sistema consulta parcelas vencendo hoje para o tenant
  3. Gera briefing: total de cobranças, valor total, lista devedor×valor
  4. Envia via WhatsApp (primário) ou Telegram (fallback)
  5. Registra envio para evitar duplicata no dia
- **Exceções:** Ambos canais desconectados → log de falha, retry no dia seguinte. Sem parcelas hoje → não enviar
- **BRs:** BR-BOT-002
- **Prioridade:** P1
- **Status:** implementado

### FR-BOT-03: Followup automático de pagamento
- **Ator:** Sistema (Scheduler)
- **Pré-condições:** Existem parcelas do dia ainda não pagas, horário entre 17:00-23:55 BRT
- **Fluxo principal:**
  1. Scheduler verifica parcelas `due_date = today AND status IN ('pending','late','partial')`
  2. Para cada parcela não lembrada hoje: envia lembrete ao admin
  3. Registra envio (1 por parcela por dia)
- **Exceções:** Parcela paga entre a verificação e o envio → não enviar. Fora da janela → skip
- **BRs:** BR-BOT-003
- **Prioridade:** P1
- **Status:** implementado

---

## Relatórios e Dashboards (REL)

### FR-REL-01: Dashboard executivo (admin)
- **Ator:** Admin
- **Pré-condições:** Autenticado como admin
- **Fluxo principal:**
  1. Admin acessa Dashboard
  2. Sistema exibe KPIs: capital na rua, recebido no mês, lucro total, projeção
  3. Gráficos: barras por mês (recebido vs esperado), pizza por status
  4. Tabelas: contratos ativos, parcelas do período
  5. Filtro por empresa (multi-company) e período
- **Exceções:** Sem contratos → exibe estado vazio com call-to-action. Dados em cache → indicador stale
- **BRs:** BR-REL-003, BR-SYS-004, BR-USR-002
- **Prioridade:** P0
- **Status:** implementado

### FR-REL-02: Painel de cobrança (collection)
- **Ator:** Admin
- **Pré-condições:** Autenticado como admin
- **Fluxo principal:**
  1. Admin acessa aba "Cobrança" no Dashboard ou DailyCollectionView
  2. Sistema exibe parcelas em buckets: atrasadas, hoje, 3d, 7d, 15d, 30d (BR-REL-005)
  3. Cada bucket mostra contagem e valor total
  4. Drill-down: clicar parcela → abre detalhe com ações (pagar, ligar, postergar)
  5. Busca por nome do devedor
- **Exceções:** Sem parcelas em nenhum bucket → estado vazio
- **BRs:** BR-REL-005
- **Prioridade:** P0
- **Status:** implementado

### FR-REL-03: Ranking de clientes (TopClientes)
- **Ator:** Admin
- **Pré-condições:** Existem devedores com parcelas vencidas
- **Fluxo principal:**
  1. Admin acessa "Top Clientes"
  2. Sistema calcula score por devedor (BR-REL-004)
  3. Exibe ranking com: nome, score, faixa (Pontual/Regular/Risco), total principal
  4. KPIs: total clientes, média score, % pontuais, % risco
  5. Clicar no devedor → abre dossier (AdminUserDetails)
- **Exceções:** Devedores sem parcelas vencidas não aparecem
- **BRs:** BR-REL-004
- **Prioridade:** P1
- **Status:** implementado

### FR-REL-04: Dashboard do investidor
- **Ator:** Investidor
- **Pré-condições:** Autenticado como investidor com contratos ativos
- **Fluxo principal:**
  1. Investidor acessa Dashboard
  2. Sistema exibe: capital alocado, total recebido, lucro de juros, esperado no mês, projetado, próximo pagamento
  3. Gráfico: barras mês a mês (projetado vs recebido)
  4. Filtro por período (mês atual, anterior, ano, todos)
  5. Histórico de recebimentos agrupado por evento (BR-REL-001)
- **Exceções:** Sem contratos → exibe estado vazio
- **BRs:** BR-REL-001, BR-REL-002, BR-REL-003, BR-USR-002
- **Prioridade:** P0
- **Status:** implementado

### FR-REL-05: Dashboard do devedor
- **Ator:** Devedor
- **Pré-condições:** Autenticado como devedor com contratos
- **Fluxo principal:**
  1. Devedor acessa Dashboard
  2. Sistema exibe: saldo devedor, alerta de atraso (se houver), próximo pagamento, contratos
  3. Cada contrato expandível com lista de parcelas
  4. Parcela pendente → botão "Pagar" (PIX self-service, FR-PAG-08)
- **Exceções:** Sem contratos → exibe estado vazio
- **BRs:** BR-USR-002, BR-PAG-016
- **Prioridade:** P0
- **Status:** implementado

### FR-REL-07: Visão mensal de investimentos
- **Ator:** Admin, Investidor
- **Pré-condições:** Autenticado, com contratos ativos
- **Fluxo principal:**
  1. Usuário acessa aba "Análise Mensal" (admin) ou "Visão Mensal" (investidor)
  2. Sistema exibe resumo do mês: capital ativo, juros recebidos, juros previstos, % realização
  3. Seção "Carteira dos Devedores" lista devedores com cards expansíveis
  4. Ao expandir, exibe tabela de parcelas do mês (número, vencimento, total, pago, status)
  5. Cada linha de parcela é clicável → navega para `InstallmentDetailScreen`
  6. Na tela de detalhe, botão "Voltar" retorna à visão mensal
  7. Navegação mês a mês via botões ◀ ▶ sem re-fetch
- **Exceções:** Parcelas fantasma (BR-REL-002) excluídas. Investidor vê apenas seus contratos (BR-USR-002)
- **BRs:** BR-REL-007, BR-REL-002, BR-REL-003, BR-USR-002
- **Prioridade:** P0
- **Status:** parcial (implementado sem navegação clicável nas parcelas)

### FR-REL-06: Geração de recibo de pagamento
- **Ator:** Admin (gera), Devedor (recebe compartilhamento)
- **Pré-condições:** Parcela com pagamento registrado
- **Fluxo principal:**
  1. Após pagamento ou no detalhe de parcela paga, admin clica "Gerar recibo"
  2. Sistema renderiza `ReceiptTemplate` com dados obrigatórios (BR-REL-006)
  3. Converte para imagem (html-to-image)
  4. Admin pode compartilhar via WhatsApp ou download
- **Exceções:** Parcela sem pagamento → botão indisponível
- **BRs:** BR-REL-006
- **Prioridade:** P1
- **Status:** implementado

---

## Autenticação e Onboarding (AUTH)

### FR-AUTH-01: Login por email e senha
- **Ator:** Qualquer usuário registrado
- **Pré-condições:** Conta existente no Supabase Auth
- **Fluxo principal:**
  1. Usuário acessa tela de login
  2. Informa email e senha
  3. Sistema autentica via Supabase Auth
  4. Busca perfil (`fetchProfileByAuthUserId`)
  5. Se perfil existe → redireciona para Dashboard (por role)
  6. Se não existe → redireciona para OnboardingWizard
- **Exceções:** Credenciais inválidas → erro em PT-BR. Conta não confirmada → erro com instrução
- **BRs:** BR-USR-005, BR-SYS-001
- **Prioridade:** P0
- **Status:** implementado

### FR-AUTH-02: Login por Google OAuth
- **Ator:** Novo usuário ou existente
- **Pré-condições:** Nenhuma
- **Fluxo principal:**
  1. Usuário clica "Entrar com Google"
  2. Redirecionado para OAuth do Google
  3. Após autenticação, callback retorna ao app
  4. Sistema busca perfil pelo auth_user_id
  5. Se perfil existe → Dashboard
  6. Se não existe → OnboardingWizard (criar tenant + company + profile)
- **Exceções:** OAuth cancelado → volta para login
- **BRs:** BR-USR-005, BR-SYS-005
- **Prioridade:** P0
- **Status:** implementado

### FR-AUTH-03: Signup via convite
- **Ator:** Novo usuário com código de convite
- **Pré-condições:** Convite válido e não expirado
- **Fluxo principal:**
  1. Usuário acessa link/tela com código de convite
  2. Sistema valida código (existe, não usado, não expirado)
  3. Usuário cria senha
  4. Sistema cria perfil com `role`, `company_id`, `tenant_id` do convite
  5. Convite marcado como `accepted`
  6. Redireciona para Dashboard
- **Exceções:** Código inválido/expirado → erro
- **BRs:** BR-USR-003, BR-USR-005
- **Prioridade:** P0
- **Status:** implementado

### FR-AUTH-04: Onboarding de novo admin
- **Ator:** Novo admin (pós-OAuth ou signup)
- **Pré-condições:** Autenticado sem perfil existente
- **Fluxo principal:**
  1. Sistema detecta ausência de perfil
  2. Exibe OnboardingWizard (3 steps): perfil pessoal → nome da empresa → configuração PIX
  3. Ao finalizar: `complete_oauth_onboarding` cria tenant + company primária + profile admin
  4. Operação atômica (BR-SYS-005)
  5. Redireciona para AdminHome
- **Exceções:** Falha no RPC → rollback completo, exibe erro
- **BRs:** BR-USR-005, BR-SYS-005, BR-TEN-001
- **Prioridade:** P0
- **Status:** implementado

### FR-AUTH-05: Reset de senha
- **Ator:** Qualquer usuário
- **Pré-condições:** Email registrado
- **Fluxo principal:**
  1. Usuário clica "Esqueci a senha" na tela de login
  2. Informa email
  3. Sistema envia email com link de reset (token 1h)
  4. Usuário clica no link → tela de nova senha
  5. Informa nova senha + confirmação
  6. Sistema atualiza via Supabase Auth
  7. Sessões anteriores invalidadas
- **Exceções:** Email não encontrado → mensagem genérica (segurança). Token expirado → erro com link para reenviar
- **BRs:** BR-USR-006
- **Prioridade:** P1
- **Status:** implementado

---

## Configuração e Administração (CFG)

### FR-CFG-01: Gestão de empresas (multi-company)
- **Ator:** Admin
- **Pré-condições:** Plano empresarial ou trial ativo (BR-TEN-002)
- **Fluxo principal:**
  1. Admin acessa Configurações → Empresas
  2. Exibe lista de empresas do tenant
  3. Pode criar nova empresa (nome, configuração PIX)
  4. Pode editar empresa existente
  5. Pode deletar empresa (exceto primária, BR-TEN-001)
  6. Company switcher no header permite alternar empresa ativa
- **Exceções:** Sem plano empresarial → switcher em modo `upsell_locked`. Tentar deletar primária → erro
- **BRs:** BR-TEN-001, BR-TEN-002, BR-TEN-003
- **Prioridade:** P0
- **Status:** implementado

### FR-CFG-02: Configuração do bot assistant
- **Ator:** Admin
- **Pré-condições:** Plano empresarial ou trial ativo
- **Fluxo principal:**
  1. Admin acessa Configurações → Assistente
  2. Abas: Conexões, Whitelist, Briefing, Perguntas, Automações
  3. Conexões: link WhatsApp/Telegram via código
  4. Whitelist: adicionar/remover números autorizados
  5. Briefing: configurar horário e conteúdo
  6. Automações: habilitar/desabilitar followup automático
  7. Salva via upsert em `bot_tenant_config`
- **Exceções:** Sem plano → AssistantPaywall bloqueia acesso
- **BRs:** BR-BOT-002, BR-BOT-003, BR-BOT-005
- **Prioridade:** P1
- **Status:** implementado

### FR-CFG-03: Gestão de usuários e convites
- **Ator:** Admin
- **Pré-condições:** Autenticado como admin
- **Fluxo principal:**
  1. Admin acessa "Usuários"
  2. Exibe tabs: Todos, Investidores, Devedores, Convites pendentes
  3. Pode criar usuário diretamente (nome, email, phone, CPF, role) → `create_client_direct`
  4. Pode gerar convite (email, role, empresa) → `generate_invite_code`
  5. Pode editar perfil existente (nome, phone, CPF, foto)
  6. Pode deletar convite pendente
- **Exceções:** CPF inválido para devedor → erro (BR-USR-004). Email duplicado → erro
- **BRs:** BR-USR-001, BR-USR-003, BR-USR-004, BR-TEN-004
- **Prioridade:** P0
- **Status:** implementado
