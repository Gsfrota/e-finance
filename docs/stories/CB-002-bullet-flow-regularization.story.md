# CB-002 — Regularização operacional do fluxo Bullet

**Status:** Ready for Review — spec fechada, incluindo form de criação Bullet; implementação bloqueada por aceite PO/jurídico e migration/RPC futura
**Criada em:** 2026-05-28
**Atualizada em:** 2026-05-29
**Tipo:** Spec/Story — sem implementação de código nesta etapa
**Origem:** Auditoria spec-driven do fluxo Bullet após CB-001 + decisões finais do usuário em 2026-05-28 + revisões Claude CLI
**Área:** Contratos Bullet / Caderneta Bullet / Pagamentos / Regularização contratual
**Fonte de verdade:** `/home/guilherme/projetos/e-finance` (consolidado a partir do worktree de spec `/home/guilherme/projetos/e-finance-actions-fix`)
**Escopo desta rodada:** fechar a regra contratual/financeira Bullet, registrar gaps código/banco e planejar implementação por fases. Não executar deploy, migration ou mutação de produção.

**Artefatos vinculados:**

- Validação Claude/MCP read-only: `docs/stories/cb-002-claude-mcp-validation-2026-05-28.md`.
- Sessão Claude Code inspecionada: `~/.claude/projects/-home-guilherme-projetos-e-finance/3a560abb-ea47-4493-9102-3849a7bada1a.jsonl`.
- Estado da sessão ativa: `~/.claude/sessions/22993.json` (`cwd=/home/guilherme/projetos/e-finance`, status `idle`).
- Resultado MCP salvo localmente pelo Claude: `~/.claude/projects/-home-guilherme-projetos-e-finance/3a560abb-ea47-4493-9102-3849a7bada1a/tool-results/mcp-supabase-get_advisors-1780016095383.txt`.
- Observação de escopo: a sessão Claude também criou artefatos CB-003 e reportou ações via MCP; esses artefatos/alegações não substituem o gate documental desta CB-002 e devem ser revisados separadamente antes de qualquer commit funcional ou migration.

---

## 1. Contexto

CB-001 corrigiu a visão operacional da Caderneta Bullet em código/main: filtro padrão **Em aberto**, pagos fora da lista principal, atraso operacional por data/saldo, navegação mensal bloqueada para mês futuro e E2E menos permissivo.

A auditoria com dados reais via Claude CLI/MCP apontou risco operacional fora da UI: contratos `interest_only` ativos sem parcela no mês corrente e uma parcela bullet não-paga com `amount_interest = 0` sem justificativa de `bullet_principal_mode = 'separate'`.

Esta story deixa de ser apenas diagnóstico e passa a formalizar a regra desejada pelo PO/usuário para a modalidade Bullet.

---

## 2. Decisões finais do usuário — regra Bullet

As perguntas bloqueantes da versão anterior foram respondidas pelo usuário e passam a ser regra de produto:

1. **Pagamento total do ciclo quita/encerra o contrato.**
   Exemplo: se a cobrança do ciclo é R$ 110,00 e o cliente paga R$ 110,00, o contrato deve ser quitado/encerrado (`remaining_balance = 0`, contrato `completed`). Deve existir opção de renovar o contrato, mas renovação é opcional e não automática.
2. **Não pagamento gera atraso e depois inadimplência.**
   Se o cliente não paga, a parcela fica `late`/atrasada por até **X dias**, com padrão **20 dias**. Após esse limite, fica inadimplente/defaulted. Na próxima parcela/vencimento, a dívida aumenta.
3. **Pagamento apenas dos juros rola o principal.**
   Exemplo: principal R$ 100, juros R$ 10, total do ciclo R$ 110. Se paga só R$ 10, a obrigação de juros do ciclo é paga e deve ser gerada nova parcela de R$ 110, mantendo o principal de R$ 100.
4. **Pagamento parcial da parcela é permitido.**
   Pagamento parcial é pagamento parcial da parcela/cobrança do ciclo, não deve ser rejeitado por padrão.
5. **Juros do próximo ciclo incidem sobre o total vencido.**
   Se o ciclo anterior não foi regularizado integralmente, o próximo cálculo deve usar o **total vencido** como base da dívida, desde que o contrato permita capitalização/rolagem.
6. **Taxa de quebra/multa contratual é opcional e definida no cadastro Bullet.**
   Na criação do contrato Bullet, o usuário decide se haverá taxa/multa de quebra de contrato/rescisão. Quando configurada, ela só deve ser aplicada após a parcela/contrato atingir inadimplência, isto é, depois do prazo `default_after_days` definido no próprio contrato.
7. **Tempo de inadimplência é configurável por contrato, padrão 20 dias.**
   O form deve permitir informar X dias de atraso até virar inadimplente/defaulted; se o usuário não alterar, usar **20 dias**. Exemplo: após 20 dias de atraso o contrato fica inadimplente e só então a multa/taxa de quebra passa a ser exigível, se configurada.

---

## 3. Modelo contratual e financeiro proposto

### 3.1. Vocabulário obrigatório

- **Principal/saldo-base:** valor originalmente emprestado ou saldo devedor atual do contrato Bullet (`remaining_balance`).
- **Juros remuneratórios do ciclo:** remuneração pactuada para o período (`amount_interest`).
- **Total exigível do ciclo:** `principal/saldo-base exigível + juros do ciclo + encargos vencidos`, apresentado ao operador como valor de quitação do ciclo.
- **Pagamento de juros com rolagem:** evento em que o devedor paga somente os juros do ciclo; o principal não é amortizado e é prorrogado para novo ciclo.
- **Pagamento parcial:** qualquer recebimento maior que zero e menor que o total exigível; deve reduzir o saldo aberto com regra explícita de imputação.
- **Prazo de inadimplência (`default_after_days`):** quantidade de dias corridos após o vencimento em que a cobrança permanece apenas atrasada (`late`) antes de virar inadimplente/defaulted; definido no cadastro Bullet e default **20 dias**.
- **Taxa/multa de quebra contratual (`break_fee_*`):** encargo opcional definido pelo usuário no cadastro Bullet; só é exigível depois de ultrapassado o prazo de inadimplência configurado. Pode ser percentual sobre saldo/total vencido ou valor fixo, a decidir na implementação/migration.
- **Quitação:** pagamento que zera a dívida exigível e encerra o contrato atual.
- **Renovação opcional:** criação de novo contrato/ciclo por ação explícita do operador/cliente, nunca automática após quitação.

### 3.2. Estados operacionais

Estados de parcela (`loan_installments.status` atual, conforme `types.ts`):

- `pending`: parcela ainda não vencida ou vencendo hoje, com saldo aberto.
- `late`: parcela vencida com saldo aberto antes do limite de inadimplência.
- `partial`: parcela com pagamento parcial e saldo aberto.
- `paid`: parcela sem saldo operacional aberto ou ciclo regularizado por evento próprio de rolagem.

Estados derivados/contratuais:

- `defaulted` em parcela: hoje deve ser **derivado na UI/consulta operacional**, não assumido como enum de `loan_installments`, até validação real do schema Supabase. A Caderneta já deriva `defaulted` após 20 dias.
- `defaulted` em contrato (`investments.status`): já existe no tipo local de `Investment`, mas precisa validação Supabase antes de qualquer migration/uso em produção.
- `completed` em contrato: contrato quitado/encerrado.
- `renewed` em contrato: usar somente se houver nova operação/contrato vinculado por renovação explícita.

### 3.3. Eventos financeiros mínimos

A implementação futura deve registrar eventos atômicos/auditáveis para:

1. `bullet_full_settlement`: pagamento total do ciclo; parcela paga; contrato `completed`; `remaining_balance = 0`.
2. `bullet_interest_rollover`: pagamento dos juros do ciclo; principal permanece; parcela/ciclo regularizado; nova parcela gerada.
3. `bullet_partial_payment`: pagamento parcial do total exigível; reduz saldo aberto conforme ordem de imputação.
4. `bullet_default_capitalization`: ausência de pagamento até próximo ciclo; juros/total vencido incorporado à base da próxima cobrança quando `capitalize_interest = true`.
5. `bullet_contract_break_fee_applied`: aplicação da taxa/multa de quebra contratual opcional, somente após `daysLate >= default_after_days` e quando o contrato tiver essa opção configurada.
6. `bullet_renewal`: criação explícita de novo contrato após quitação, com vínculo ao contrato anterior (`parent_investment_id` ou equivalente).

Eventos de pagamento e capitalização devem gerar trilha em `payment_transactions` dentro da mesma transação/RPC, não apenas por log client-side non-blocking.

### 3.4. Ordem de imputação de pagamentos

Regra recomendada para evitar ambiguidade fiscal/financeira:

1. encargos/mora vencidos (`fine_amount`, `interest_delay_amount`) e taxa/multa de quebra contratual (`break_fee_*`/`break_fee_amount`), se existirem e já forem exigíveis;
2. juros remuneratórios vencidos (`amount_interest` pendente);
3. principal/saldo-base (`remaining_balance`/`amount_principal`).

Critério: todo pagamento parcial deve registrar porções (`extras_portion`, `interest_portion`, `principal_portion`) na auditoria.

### 3.5. Invariantes

- O sistema nunca pode registrar quitação integral de contrato sem `remaining_balance <= 0,01`.
- Pagamento de apenas juros não pode ser confundido com quitação do principal; deve ser evento de rolagem/prorrogação auditável.
- Se `amount_paid < amount_total` e o ciclo for marcado `paid`, deve existir metadata/evento de rolagem explicando por que a parcela ficou operacionalmente regularizada.
- Uma nova parcela Bullet só deve ser gerada se o contrato continuar ativo e houver saldo-base remanescente.
- Após pagamento total do ciclo, não gerar nova parcela automaticamente; oferecer apenas ação opcional de renovação.
- Capitalização de vencidos só deve ocorrer quando `capitalize_interest = true` no contrato e houver cláusula contratual expressa autorizando capitalização/rolagem.
- `generate_next_bullet_installment` deve continuar idempotente: não criar duplicidade se já existir próxima parcela aberta equivalente.
- Caderneta Bullet deve distinguir: **Total do ciclo**, **Juros do ciclo**, **Recebido**, **Total vencido** e **Saldo para quitação**.

---

## 4. Exemplos numéricos de aceite

Base comum: contrato Bullet com principal R$ 100,00, taxa 10% ao ciclo, sem multa/mora para simplificar.

### Exemplo A — Pagamento total quita

- Parcela 1: principal/saldo-base R$ 100,00 + juros R$ 10,00 = total R$ 110,00.
- Cliente paga R$ 110,00.
- Resultado esperado:
  - parcela fica `paid`;
  - `remaining_balance = 0`;
  - contrato fica `completed`;
  - nenhuma nova parcela é gerada automaticamente;
  - UI oferece opção separada de renovar/criar novo contrato.

### Exemplo B — Pagamento só dos juros rola principal

- Parcela 1: total R$ 110,00.
- Cliente paga R$ 10,00.
- Resultado esperado:
  - juros do ciclo quitados;
  - principal R$ 100,00 permanece;
  - evento `bullet_interest_rollover` registrado;
  - nova parcela gerada: R$ 100,00 + 10% = R$ 110,00;
  - histórico não pode sugerir que os R$ 100,00 de principal foram pagos.

### Exemplo C — Não pagamento capitaliza vencido

- Parcela 1: total R$ 110,00.
- Cliente paga R$ 0,00.
- Até X dias (padrão 20, configurável no contrato) após vencimento: operacionalmente `late`.
- Após X dias: operacionalmente `defaulted`/inadimplente.
- Se o contrato tiver taxa/multa de quebra contratual configurada, ela passa a ser aplicável **somente nesse momento** (após a inadimplência), nunca no primeiro dia de atraso.
- Próximo vencimento, com capitalização autorizada:
  - base do próximo ciclo = total vencido R$ 110,00;
  - juros do próximo ciclo = R$ 11,00;
  - nova cobrança = R$ 121,00.

### Exemplo D — Pagamento parcial

- Parcela 1: total R$ 110,00.
- Cliente paga R$ 50,00.
- Pela ordem de imputação recomendada, sem encargos:
  - R$ 10,00 quitam juros;
  - R$ 40,00 amortizam principal;
  - saldo-base remanescente = R$ 60,00.
- Próximo ciclo, se gerado após regularização/renovação do saldo:
  - base = R$ 60,00;
  - juros = R$ 6,00;
  - cobrança = R$ 66,00.

### Exemplo E — Parcial menor que juros

- Parcela 1: total R$ 110,00, juros R$ 10,00.
- Cliente paga R$ 5,00.
- Resultado esperado:
  - R$ 5,00 abatem juros;
  - R$ 5,00 de juros + R$ 100,00 de principal seguem vencidos/abertos;
  - se `capitalize_interest = true` e chegar o próximo ciclo, base pode virar R$ 105,00;
  - juros do próximo ciclo = R$ 10,50;
  - cobrança = R$ 115,50.

---

## 5. Evidências usadas

### 5.1. Código/specs locais

- `components/dashboard/CadernetaBullet.tsx`
  - `getCycleAmountDue()` ainda usa `amount_interest` como valor cobrável para `interest_only`.
  - `getOperationalStatus()` deriva `paid | pending | partial | late | defaulted` por saldo e data.
  - `DEFAULTED_AFTER_DAYS = 20` já existe como padrão local.
- `components/InstallmentModals.tsx`
  - `PaymentModal` calcula saldo por `amount_total + multas/mora - amount_paid` e permite valor parcial.
  - `InterestOnlyModal` chama `pay_bullet_interest_only` sem `p_amount`, portanto só cobre o fluxo “pagar juros”.
  - Auditoria chama `logPaymentTransaction()` no frontend de forma não bloqueante.
- `components/InstallmentDetailFlow.tsx`
  - Também chama `pay_bullet_interest_only` para pagar só juros.
- `components/AdminContracts.tsx`
  - Form atual de criação nova possui wizard em 3 passos: partes envolvidas, termos financeiros e revisão final.
  - Para Bullet (`calculation_mode = 'interest_only'`), troca o tipo para “Juros Simples”, usa prazo indeterminado como placeholder técnico `total_installments = 120`, calcula `installment_value` como juros do ciclo e envia `p_bullet_principal_mode = null` para `create_investment_validated`.
  - Campo `capitalize_interest` já existe, mas o texto atual não explicita risco jurídico de capitalização sobre total vencido.
  - O preview do Bullet indeterminado mostra “Juros 1ª cobrança”/valor de juros, não o total exigível do ciclo (`principal + juros`).
- `components/LegacyContractPage.tsx`
  - Importação/cadastro manual de contrato antigo também aceita Bullet e chama `create_legacy_investment` com `p_bullet_principal_mode`, `p_paid_count` e `p_first_due_date`.
  - Mantém semântica antiga de “paga somente juros por parcela; principal devolvido no final”, com modos `together/separate`, que conflita com a regra rotativa/quitável consolidada nesta story.
- `components/QuickContractInput.tsx`
  - Fluxo rápido/IA cria contratos com `p_calculation_mode = 'manual'`; não cria Bullet hoje.
- `types.ts`
  - `LoanInstallment.status` local aceita apenas `pending | paid | late | partial`; `defaulted` de parcela é derivado.
  - `Investment.status` local aceita `active | completed | defaulted | renewed`.
- `services/paymentAudit.ts`
  - `logPaymentTransaction()` é non-blocking e engole exceções.
- `context/migration_v33_bullet_revolving.sql`
  - Tentou modelar `process_bullet_payment(p_amount)` com juros primeiro, principal depois e capitalização, mas não é o fluxo usado pelo frontend atual.
- `context/migration_v35_fix_simple_interest.sql`
  - `pay_bullet_interest_only(UUID, TIMESTAMPTZ, TEXT)` paga exatamente juros pendentes, marca parcela `paid`, não reduz `remaining_balance` e gera próxima parcela.
- `context/migration_v40_bullet_fixes.sql`
  - Mantém `create_investment_validated` Bullet com `amount_principal = p_amount_invested`, `amount_interest = principal * taxa`, `amount_total = principal + juros` e `capitalize_interest` no contrato.
- `docs/business-rules/e-finance-br.md`
  - Regras relacionadas: `BR-CNT-004`, `BR-PAG-009`, `BR-PAG-014`, `BR-PAG-015`, `BR-PAG-022`, `BR-PAG-023`, `BR-REL-011`, `BR-REL-012`, `BR-REL-013`.
- `docs/requirements/fr.md`
  - `FR-PAG-06` ainda descreve “admin informa valor” e capitalização parcial, mas o RPC atual `pay_bullet_interest_only` não recebe valor parcial. Drift confirmado.

### 5.2. Supabase via Claude CLI/MCP

Regra operacional mantida: Hermes não acessa Supabase diretamente. Claude CLI/Claude Code é o guardião exclusivo para Supabase/MCP.

- Claude Code instalado: `claude --version` → `2.1.143 (Claude Code)`.
- Investigação MCP/CWD em 2026-05-28:
  - `/home/guilherme/projetos/e-finance-actions-fix`: não contém `.mcp.json`; `claude mcp list` não lista Supabase nesse CWD.
  - `/home/guilherme/projetos/e-finance`: contém `.mcp.json` com `supabase` em `https://mcp.supabase.com/mcp?project_ref=enzgerrnlbiojkuzeilw`; `claude mcp list` retornou `supabase ... ✓ Connected`.
  - `/home/guilherme/projetos/e-finance/e-finance-bot`: também contém `.mcp.json`, porém sem `project_ref`; não é a fonte de verdade desta story.
- Revisão Supabase somente leitura executada pelo Claude Code a partir de `/home/guilherme/projetos/e-finance`, com `claude -p ... --model sonnet --permission-mode bypassPermissions`. Modelo solicitado: `sonnet`; provedor/CLI observado: Claude Code/Anthropic. O CLI não expôs no output o identificador completo do modelo efetivamente roteado.
- Resultado da revisão: Claude **validou Supabase/MCP real** e reportou 5 queries somente leitura bem-sucedidas.
- Parecer Claude/MCP incorporado:
  - campos Bullet core existem em `investments`: `bullet_principal_mode`, `capitalize_interest`, `parent_investment_id`, `remaining_balance`;
  - `default_after_days`/`grace_days` **não existem** no schema real; hoje o prazo 20 segue hardcoded/derivado na Caderneta;
  - campos de taxa/multa de quebra contratual, como `break_fee_rate`, `break_fee_fixed` ou `break_fee_amount`, **não existem** no schema real;
  - `loan_installments` possui encargos genéricos `fine_amount` e `interest_delay_amount`, mas não campo semântico específico para multa de quebra/rescisão;
  - `payment_transactions.extras_portion` existe e poderia absorver encargos, mas sem semântica/auditoria própria de quebra contratual;
  - RPCs reais encontradas: `create_investment_validated`, `create_legacy_investment`, `pay_bullet_interest_only`, `generate_next_bullet_installment` e `process_bullet_payment`;
  - `process_bullet_cycle`/`process_bullet_cycle_payment` não existe no schema real;
  - `pay_bullet_interest_only` não cobre quitação total nem parcial; `process_bullet_payment` existe, mas precisa revisão antes de virar fluxo único porque a UI atual ainda usa majoritariamente o fluxo de juros e a auditoria transacional/semântica de quebra não está fechada;
  - capitalização de juros vencidos continua sendo risco jurídico-financeiro e exige cláusula expressa;
  - `defaulted` de parcela deve permanecer derivado até validar/alterar enum/checks de status.

Artefatos anteriores reutilizados:

- `/tmp/claude-cb-analysis.json`
- `/tmp/claude-cb-followup.json`

Resumo das evidências anteriores:

- 27 contratos `interest_only` ativos.
- Maio/2026: 4 parcelas `late`, 7 `paid`, 0 `pending`, 0 `partial`.
- 17 contratos ativos sem parcela em maio/2026.
- Follow-up classificou:
  - 1 esperado/novo contrato semanal com próxima parcela em 2026-06-01;
  - 7 mensais pularam maio e retomam em junho: gap anômalo de 1 mês;
  - 9 contratos com gap operacional provável/confirmado sem futura parcela (8 mensais + 1 diário).
- 2 parcelas não-pagas com `amount_interest = 0`:
  - `investment_id=520`: esperado por `bullet_principal_mode='separate'`, devolução de principal;
  - `investment_id=3098`: anômalo, `interest_only`, mensal, `bullet_principal_mode=null`, `amount_interest=0`, `amount_total=1000`.

---

## 6. Gap analysis — regra desejada vs código/banco atual

### P0 — Total do ciclo vs Caderneta cobrando só juros

**Desejado:** Caderneta deve mostrar o total exigível do ciclo, ex. R$ 110,00, e permitir ações distintas: quitar, pagar só juros/rolar, parcial.
**Atual:** `CadernetaBullet.getCycleAmountDue()` retorna `amount_interest` para `interest_only`, então a régua operacional enxerga só R$ 10,00 no exemplo.
**Impacto:** KPIs de esperado bruto, recebido, atraso e taxa de cobrança ficam desalinhados com a regra do usuário.

### P0 — RPC de pagamento Bullet não aceita valor parcial/total

**Desejado:** uma baixa Bullet deve aceitar `p_amount` e decidir entre quitação total, rolagem de juros e parcial.
**Atual:** `pay_bullet_interest_only(UUID, TIMESTAMPTZ, TEXT)` sempre paga exatamente os juros pendentes, marca a parcela `paid`, não reduz `remaining_balance` e gera próxima parcela.
**Impacto:** não cobre pagamento de R$ 110,00 para encerrar contrato nem pagamento parcial de R$ 50,00.

### P0 — Pagamento total não encerra fluxo Bullet de forma clara

**Desejado:** pagar R$ 110,00 encerra contrato; renovação opcional separada.
**Atual:** há `pay_avulso(principal_reduction)`/regras de `completed`, mas não existe fluxo Bullet único para “quitar ciclo total e encerrar” com auditoria e sem gerar próxima parcela.
**Impacto:** risco de manter contrato ativo ou gerar nova parcela indevida após quitação.

### P0 — Capitalização por não pagamento não está operacionalizada no fluxo atual

**Desejado:** se não paga, fica atrasado; após X dias padrão 20, inadimplente; no próximo vencimento a dívida aumenta com juros sobre total vencido.
**Atual:** existe `capitalize_interest` no contrato e comentário em migrations, mas o fluxo atual de `pay_bullet_interest_only` só roda quando há pagamento. Não há rotina clara que, na ausência de pagamento, capitalize o total vencido e gere próxima cobrança.
**Impacto:** regra R$ 110,00 → R$ 121,00 pode não acontecer ou acontecer sem auditoria/contrato.

### P0 — Cadastro Bullet não possui taxa de quebra nem inadimplência configurável

**Desejado:** o form Bullet deve permitir ao usuário decidir, na criação, se haverá taxa/multa de quebra contratual opcional e informar `default_after_days` com padrão 20 dias. A multa só é aplicável após a cobrança ficar inadimplente.
**Atual:** Claude/MCP confirmou que `investments` não possui `default_after_days`, `grace_days`, `break_fee_rate`, `break_fee_fixed` ou equivalente; `loan_installments` só possui `fine_amount`/`interest_delay_amount` genéricos e a Caderneta usa `DEFAULTED_AFTER_DAYS = 20` hardcoded.
**Impacto:** sem migration/campo novo, o form só poderia mostrar regra informativa; salvar valores por contrato exigirá alteração de schema/RPC e auditoria.

### P0 — Auditoria financeira não é transacional

**Desejado:** todo recebimento/capitalização/rolagem deve ter trilha auditável obrigatória.
**Atual:** frontend chama `logPaymentTransaction()` depois das RPCs e o serviço engole falhas; `pay_bullet_interest_only` não insere `payment_transactions`.
**Impacto:** viola risco de `BR-PAG-009`; pagamento pode ocorrer sem audit trail.

### P1 — `defaulted` de parcela é derivado, não enum local

**Desejado:** atraso até X dias e inadimplência depois de X dias.
**Atual:** `types.ts` não inclui `defaulted` em `LoanInstallment.status`; `CadernetaBullet` deriva `defaulted` por dias em atraso.
**Impacto:** implementar `defaulted` como status persistido sem validar schema pode quebrar banco/tipos.

### P1 — Drift documental FR/BR

**Desejado:** docs devem refletir pagamento parcial permitido, pagamento total encerra, juros sobre total vencido e renovação opcional.
**Atual:** `FR-PAG-06` fala em valor informado e capitalização, mas status “implementado” não bate com RPC real; BRs precisam explicitar a nova semântica.
**Impacto:** specs guiam implementação errada.

### P1 — Gaps de dados reais anteriores

**Desejado:** todo contrato Bullet ativo esperado no mês deve ter parcela operacional ou justificativa.
**Atual:** evidência anterior aponta contratos `interest_only` ativos sem parcela corrente e uma parcela anômala com `amount_interest = 0`.
**Impacto:** Caderneta pode ocultar cobrança real e indicadores podem ficar incompletos.

---

## 7. Matriz de impacto/repercussões por camada

| Camada | Repercussão da nova regra Bullet | Conflitos/gaps atuais | Decisão/assunção para implementação futura | Prioridade |
|---|---|---|---|---|
| Contrato | Pagamento total do ciclo (`principal + juros + encargos vencidos`) encerra o contrato atual; renovação é nova ação/operação. | `pay_installment` pode marcar parcela `paid` sem reduzir `investments.remaining_balance`; `recalculate_investment_status()` só fecha Bullet quando `remaining_balance < 0,01`; `BR-CNT-004` ainda separa juros (`pay_bullet_interest_only`) e principal (`pay_avulso`). | A baixa Bullet deve ser transacional e ajustar parcela + contrato no mesmo RPC; quitação total deve gravar `completed` e `remaining_balance = 0`. | P0 |
| Parcelas | Uma parcela Bullet passa a representar cobrança de ciclo e precisa distinguir total exigível, juros, recebido, saldo vencido e motivo de regularização. | `pay_bullet_interest_only` marca `paid` com `amount_paid < amount_total`; regra geral `amount_paid < amount_total => partial` fica ambígua. | `paid` com valor menor que `amount_total` só é permitido com evento/metadata de rolagem (`bullet_interest_rollover`); parcial comum fica `partial` até ação explícita. | P0 |
| Pagamentos | O operador precisa registrar valor e intenção: quitar, pagar juros/rolar, parcial, ou capitalizar ausência de pagamento. | RPC atual de juros não recebe `p_amount`; fluxo genérico não entende quitação Bullet; `process_bullet_payment(p_amount)` em v33 está órfã/não chamada. | Criar/validar uma fonte única: `process_bullet_cycle_payment(p_installment_id, p_amount, p_action, ...)`, com imputação encargos → juros → principal. | P0 |
| Auditoria | Todo recebimento, rolagem, quitação, parcial e capitalização deve ser auditável e bloquear se a auditoria falhar. | `logPaymentTransaction()` é client-side, non-blocking e engole exceções; constraint local não inclui eventos `bullet_*`. | Inserir `payment_transactions` dentro da RPC/migration; decidir se serão novos `transaction_type` ou tipo existente com metadata obrigatória. | P0 |
| Relatórios/KPIs | KPIs devem separar cobrança bruta, rendimento/juros, principal recuperado, recebido e saldo para quitação. | Hooks/serviços calculam parcial proporcionalmente e podem tratar parcela `paid` por juros como principal recuperado. | Métricas devem consumir breakdown auditado (`interest_portion`, `principal_portion`, `extras_portion`) e não inferir por status apenas. | P1 |
| Caderneta Bullet | Lista operacional deve mostrar total do ciclo e ações distintas: quitar, pagar juros/rolar, parcial, renovar. | `getCycleAmountDue()` retorna `amount_interest` para `interest_only`; testes CB-001 protegem a semântica antiga de juros como valor cobrável. | `amount_total` deve ser o valor de quitação/ciclo; `amount_interest` deve aparecer como juros/rolagem, não como total. | P0 |
| Inadimplência | Não pagamento fica `late` até X dias; X é configurável por contrato com default 20; após X aparece como `defaulted` operacional; próximo ciclo aumenta se capitalização permitida. | `defaulted` de parcela não existe em `types.ts`; `DEFAULTED_AFTER_DAYS = 20` é hardcoded na Caderneta; Claude/MCP confirmou ausência de `default_after_days`/`grace_days`; cron atual só muda `pending -> late`. | Manter `defaulted` de parcela derivado até validar enum real; adicionar coluna/config por contrato antes de persistir o X escolhido no cadastro. | P0 |
| Taxa de quebra | O form Bullet deve permitir taxa/multa de quebra contratual opcional, decidida no cadastro; se configurada, só incide após inadimplência (`daysLate >= default_after_days`). | Claude/MCP confirmou ausência de `break_fee_rate`, `break_fee_fixed`, `break_fee_amount` ou similar; `fine_amount`/`interest_delay_amount` são genéricos e não distinguem quebra contratual. | Migration deve criar campos e auditoria/evento próprios; Caderneta, pagamento e recibos devem tratar a multa como encargo exigível apenas após default. | P0 |
| Renovação | Após quitação, renovar é opcional, explícito e não deve criar parcela automática no contrato quitado. | `ContractRenewalModal` pode mudar contrato original para `renewed`; CB-002 pede quitação como `completed`. `parent_investment_id` precisa validação no banco real. | Definir lifecycle: contrato quitado permanece `completed`; nova operação pode referenciar anterior e opcionalmente registrar evento `bullet_renewal`. | P1 |
| Banco/RPCs | Precisam refletir uma máquina financeira única para Bullet. | `pay_bullet_interest_only(UUID, TIMESTAMPTZ, TEXT)` cobre só juros; `process_bullet_payment` existe no schema real, mas precisa revisão contra regra atual; `generate_next_bullet_installment()` usa `remaining_balance` sem capitalizar vencidos automaticamente; `process_bullet_cycle_payment` não existe. | Validar/ajustar a RPC única transacional com ações explícitas; evitar overloads ambíguos; usar locks/idempotência. | P0 |
| Migrações | Necessárias para RPC única, auditoria transacional, `default_after_days`, campos `break_fee_*`, eventos Bullet e talvez vínculo de renovação. | Claude/MCP confirmou ausência de `default_after_days`/`grace_days` e `break_fee_*`; constraints/tipos locais não aceitam eventos `bullet_*`. | Preparar migrations apenas após aceite da spec; sem deploy/mutação nesta etapa. | P0 |
| Testes | Exemplos A–E devem virar testes unitários/E2E/smoke SQL. | E2E atual valida que Caderneta mostra juros; não cobre quitação total, parcial com imputação nem capitalização após 20 dias. | Atualizar suíte junto com mudança de regra; manter regressão de CB-001 para filtros/status, mas corrigir expectativas de valor. | P1 |
| Dados legados | Contratos ativos sem parcela e parcela com `amount_interest = 0` podem distorcer Caderneta e regularização. | Evidências anteriores: 17 contratos ativos sem parcela em maio/2026; `investment_id=3098` anômalo; não revalidado via MCP nesta rodada. | Rodar diagnóstico somente leitura via Claude/MCP; correção de dados só com backup e aprovação explícita. | P1 |
| Produção/deploy | Mudança altera semântica financeira e jurídica, com risco de dinheiro real, recibos e inadimplência. | Validação Supabase/MCP foi somente leitura; capitalização e taxa de quebra podem configurar encargos sensíveis sem cláusula expressa. | Bloquear deploy até: aceite jurídico/PO, migration revisada, testes verdes e plano de rollback. | P0 |

### 7.1. Decisões e assunções consolidadas

- **Decisão:** a story permanece spec/docs; nenhuma alteração funcional, migration, deploy ou mutação de produção deve ocorrer sem alinhamento explícito.
- **Decisão:** Hermes não acessa Supabase diretamente; validação real de schema/dados deve ocorrer via Claude Code/MCP.
- **Decisão:** `defaulted` de parcela é estado operacional derivado por enquanto; não persistir em `loan_installments.status` sem validar enum/schema real.
- **Decisão:** o cadastro Bullet deve ter `default_after_days` configurável pelo usuário com default 20 dias; persistência exige migration porque o campo não existe no schema real.
- **Decisão:** taxa/multa de quebra contratual é opcional no cadastro Bullet e só incide após inadimplência; persistência/cálculo exigem campos novos (`break_fee_*`) e auditoria própria.
- **Decisão:** pagamento parcial é aceito, mas a semântica de geração de próxima parcela após parcial deve ser fechada antes do código: permanecer `partial`, regularizar por ação explícita, ou capitalizar no próximo ciclo.
- **Assunção jurídica:** capitalização de total vencido só é segura se `capitalize_interest = true` e houver cláusula/aceite contratual expresso autorizando rolagem/capitalização.
- **Assunção técnica:** a implementação futura deve preferir uma RPC única transacional a orquestração client-side de `pay_bullet_interest_only` + `pay_avulso`.

### 7.2. Conflitos documentais/código que exigem atualização posterior

- `BR-CNT-004`: ainda descreve Bullet como juros via `pay_bullet_interest_only` e principal via `pay_avulso`; precisa refletir quitação total do ciclo.
- `BR-PAG-005`: regra genérica de parcial precisa exceção formal para rolagem de juros com evento auditável.
- `BR-PAG-015`: não deve rejeitar parcial por padrão quando `capitalize_interest = false`; nesse caso manter vencidos separados.
- `BR-CNT-007`: precisa decidir se contrato quitado e renovado permanece `completed` ou muda para `renewed`.
- `BR-CNT-009`: separar inadimplência operacional de parcela em 20 dias de inadimplência contratual persistida.
- `BR-REL-012/013/014`, `docs/daily-collection-screen.md`, `docs/installment-form-screen.md`: precisam deixar de confundir juros do ciclo com saldo de quitação/cobrança bruta.
- `FR-PAG-06`: status/descrição estão em drift porque falam em valor informado/capitalização enquanto o RPC atual de juros não recebe valor.
- `types.ts`, `services/paymentAudit.ts` e constraint de `payment_transactions`: não contemplam eventos `bullet_*`.
- `hooks/useContractDetail.ts`, `hooks/useInvestorMetrics.ts`, `hooks/useYieldMetrics.ts`, `services/salary.ts`: usam inferência/proporção que pode distorcer principal recuperado e juros recebidos.

### 7.3. Riscos de regressão a proteger

- **CB-001 / Caderneta:** alterar `getCycleAmountDue()` de juros para total do ciclo pode quebrar snapshots/E2E que hoje esperam valor de juros como cobrança; manter filtros “Em aberto”, pagos fora da lista principal e bloqueio de mês futuro.
- **Pagamento genérico:** reaproveitar `pay_installment` para Bullet pode fechar parcela sem atualizar `remaining_balance` ou gerar saldo negativo; Bullet precisa fluxo próprio/transacional.
- **Auditoria/recibos:** trocar logs client-side por auditoria em RPC pode duplicar eventos se o frontend continuar chamando `logPaymentTransaction()`; planejar remoção/feature flag por fluxo.
- **Métricas:** relatórios podem inflar “principal recuperado” se usarem `amount_principal` de parcela Bullet paga por juros; validar KPIs antes/depois com dataset fixture.
- **Inadimplência:** persistir `defaulted` em `loan_installments.status` sem schema real pode quebrar queries/tipos; até validação, manter derivado.
- **Renovação:** mudança de `renewed` para `completed + novo contrato vinculado` pode alterar telas administrativas e histórico; exigir teste de lifecycle.
- **Dados legados:** contratos sem parcela corrente podem desaparecer da operação se a Caderneta continuar listando apenas parcelas existentes; diagnóstico/regularização deve preceder rollout.
- **Produção:** qualquer migration que altere RPC usada por tela ativa deve ter rollback e smoke SQL para overloads/GRANTs; sem deploy automático nesta story.

### 7.4. Spec complementar — form de criação/importação de contrato Bullet

Esta subseção define como o form deve casar com a regra Bullet consolidada nesta story. Escopo: especificação/documentação; nenhuma alteração funcional nesta rodada.

#### 7.4.1. Análise do form atual

**Criação nova — `components/AdminContracts.tsx`:**

- Entrada por wizard:
  1. Partes envolvidas: credor/investidor e tomador/devedor.
  2. Termos financeiros: tipo de contrato, principal, origem de recursos, prazo, frequência, taxa/cálculo e capitalização.
  3. Revisão final e submit.
- Campos Bullet atuais:
  - Tipo de contrato: botão “Juros Simples”, que seta `calculation_mode = 'interest_only'`.
  - Principal: `amount_invested`.
  - Prazo: `Indeterminado`/`Determinado`; indeterminado usa `total_installments = 120` como placeholder de UI.
  - Frequência: `monthly | weekly | daily | freelancer`.
  - Mensal: `due_day` e seletor “Primeira cobrança: Este mês / Próximo mês” via `monthOffset`.
  - Diário: `start_date`, `skip_saturday`, `skip_sunday`.
  - Livre: `custom_dates`/`freelancerDates`.
  - Taxa: `interest_rate` como `% a.m.` na UI, apesar de tecnicamente ser “% por período” conforme `frequency`.
  - Capitalização: `capitalize_interest`, default `true`.
- Cálculo atual:
  - `calculateFinancials()` para `interest_only` calcula `installment_value = principal * taxa / 100` e `current_value/totalValue = principal + juros`.
  - O preview do Bullet indeterminado exibe principalmente o valor dos juros (`installment_value`), enquanto a regra nova exige destacar também o **total exigível do ciclo** (`principal + juros + encargos vencidos - recebido`).
- Payload atual para criação nova:
  - RPC: `create_investment_validated`.
  - Envia `p_calculation_mode = 'interest_only'`, `p_amount_invested`, `p_interest_rate`, `p_installment_value`, `p_current_value`, `p_total_installments`, `p_frequency`, `p_due_day`, `p_weekday`, `p_start_date`, `p_custom_dates`, `p_company_id`, `p_capitalize_interest`.
  - Envia `p_bullet_principal_mode = null` para Bullet novo, mesmo mantendo `bullet_principal_mode` no estado do form.
- Lacunas do form novo:
  - Label “Juros Simples” e help text “paga só juros por período” induzem semântica antiga; deve virar “Bullet / Juros por ciclo” com explicação de quitação, rolagem e parcial.
  - Falta preview explícito do ciclo: principal/saldo-base, juros do ciclo, total para quitação, valor para pagar só juros/rolar e regra de parcial.
  - `capitalize_interest` não mostra aviso de cláusula contratual/risco jurídico sobre juros em cima de total vencido.
  - Taxa aparece `% a.m.` mesmo para frequência semanal/diária/livre; deve ser “% por ciclo” e adaptar o label ao período.
  - Prazo determinado em Bullet ainda precisa de decisão de lifecycle: número máximo de ciclos informativo vs encerramento automático. Até decisão de produto/contrato, prazo indeterminado é o padrão recomendado.
  - Não há campo `default_after_days`; o prazo de inadimplência de 20 dias segue derivado/hardcoded fora do cadastro.
  - Não há campo de taxa/multa de quebra contratual opcional (`break_fee_rate`, `break_fee_fixed`, `break_fee_amount` ou similar); o form atual não permite o usuário decidir essa cláusula no cadastro.

**Importação/contrato antigo — `components/LegacyContractPage.tsx`:**

- Campos atuais: devedor existente/novo, principal, número de parcelas, modo `auto | manual | interest_only`, taxa, frequência, data da 1ª parcela, parcelas já recebidas, código original, origem do capital e `bullet_principal_mode = together | separate`.
- Payload atual: RPC `create_legacy_investment` com `p_paid_count`, `p_first_due_date`, `p_original_code`, `p_calculation_mode = 'interest_only'` e `p_bullet_principal_mode`.
- Lacunas:
  - O texto ainda descreve Bullet como “paga somente juros por parcela; principal devolvido no final”, divergente do Bullet rotativo/quitável definido nesta story.
  - `create_legacy_investment` local não recebe `p_capitalize_interest`; importações Bullet não conseguem declarar a cláusula de capitalização no mesmo payload.
  - Importar parcelas já pagas de Bullet precisa diferenciar “juros pagos com rolagem” de “quitação/parcial”, pois parcela `paid` com `amount_paid < amount_total` só é válida com evento/metadata.

**Fluxo rápido/IA — `components/QuickContractInput.tsx`:**

- Atualmente cria/importa como `manual`; não deve prometer criação Bullet até haver parser/preview específico e payload compatível.

#### 7.4.2. Análise DB/RPC real via Claude Code/MCP

Guardião Supabase: análise somente leitura executada com Claude Code `2.1.143`, modelo solicitado `sonnet`, a partir de `/home/guilherme/projetos/e-finance` (diretório que contém `.mcp.json`). MCP Supabase conectado e validado (`claude mcp list` → `supabase ... ✓ Connected`). Alterações de spec continuam no worktree limpo `/home/guilherme/projetos/e-finance-actions-fix`.

- `create_investment_validated` existe no schema real e é a RPC principal para contrato novo. Evidência local em `context/migration_v40_bullet_fixes.sql` indica assinatura com `p_capitalize_interest` e criação da primeira parcela Bullet com `amount_total = principal + juros`.
- Colunas Bullet core confirmadas em `investments`:
  - `bullet_principal_mode`;
  - `capitalize_interest`;
  - `parent_investment_id`;
  - `remaining_balance`.
- Campos ausentes no schema real, necessários para a nova regra de cadastro:
  - `default_after_days` ou `grace_days` para prazo configurável de inadimplência;
  - `break_fee_rate`, `break_fee_fixed`, `break_fee_amount` ou equivalente para taxa/multa de quebra contratual.
- `loan_installments` possui `fine_amount`, `interest_delay_amount` e `deferred_from_id`; não possui campo semântico de multa de quebra.
- `payment_transactions` possui `extras_portion`, mas a semântica de taxa de quebra precisa de metadata/tipo/evento específico para auditoria.
- RPCs reais confirmadas pelo Claude/MCP:
  - `create_investment_validated`;
  - `create_legacy_investment`;
  - `pay_bullet_interest_only`;
  - `generate_next_bullet_installment`;
  - `process_bullet_payment`.
- RPC ausente no schema real: `process_bullet_cycle`/`process_bullet_cycle_payment`.
- `pay_bullet_interest_only` continua insuficiente para quitação total/parcial. `process_bullet_payment` existe, mas deve ser revisada antes de uso produtivo para cobrir ações explícitas, auditoria transacional, inadimplência configurável e taxa/multa de quebra.

#### 7.4.3. Form Bullet alvo — campos, labels e validações

**Entrada recomendada no wizard de criação nova:**

- Tipo de contrato: **Bullet — juros por ciclo**.
  - Help text: “A cobrança do ciclo mostra principal/saldo-base + juros. O cliente pode quitar tudo, pagar só os juros para rolar o principal, pagar parcial ou ficar em atraso conforme contrato.”
- Credor/investidor: obrigatório; perfil admin/investidor do tenant/empresa.
- Tomador/devedor: obrigatório; permitir criar devedor inline como hoje.
- Nome do contrato: opcional; default `Contrato {primeiro nome do devedor}`.
- Principal/saldo-base inicial (`p_amount_invested`): obrigatório, > 0, duas casas decimais.
- Origem dos recursos (`p_source_capital`, `p_source_profit`): manter validação atual de não exceder principal nem saldo de lucro disponível.
- Taxa de juros do ciclo (`p_interest_rate`): obrigatória, > 0; label dinâmico:
  - mensal: “Taxa de juros por mês (%)”;
  - semanal: “Taxa de juros por semana (%)”;
  - diário: “Taxa de juros por dia (%)”;
  - livre: “Taxa de juros por ciclo (%)”.
- Frequência (`p_frequency`): obrigatório; `monthly | weekly | daily | freelancer`.
- Primeira cobrança:
  - mensal: `due_day` + escolha explícita “este mês/próximo mês”, convertida em `p_start_date` para não depender da decisão automática da RPC;
  - semanal: `weekday` e preview da próxima data;
  - diário: `start_date` + opções pular sábado/domingo;
  - livre: pelo menos uma `custom_date` para a primeira cobrança; para indeterminado, não gerar 120 datas artificiais.
- Prazo:
  - default **indeterminado até quitação**;
  - se “determinado”, tratar como quantidade planejada/máxima de ciclos e exigir decisão posterior de lifecycle antes de implementar encerramento automático.
- Capitalização de vencidos (`p_capitalize_interest`): obrigatório, default a decidir pelo PO; se ativo, exigir confirmação visual.
  - Help text ativo: “Se não houver pagamento e houver cláusula contratual, o próximo ciclo calcula juros sobre o total vencido.”
  - Help text inativo: “Vencidos permanecem separados; não aplicar juros sobre juros automaticamente.”
- Prazo de inadimplência (`default_after_days`): campo numérico obrigatório no form Bullet, default **20 dias**, mínimo recomendado 1; definido pelo usuário na criação do contrato.
  - Enquanto a migration/RPC não existir, a UI pode exibir como regra/preview, mas **não deve fingir persistência**.
  - Após migration, enviar no payload/coluna do contrato para substituir o hardcode `DEFAULTED_AFTER_DAYS = 20` por configuração por contrato.
- Taxa/multa de quebra contratual: opção **opcional** no form Bullet, decidida pelo usuário na criação.
  - Toggle: “Aplicar taxa de quebra de contrato se ficar inadimplente?” default desligado, salvo decisão do PO.
  - Se ligado, escolher tipo/valor: percentual (`break_fee_rate`) sobre saldo/total vencido ou valor fixo (`break_fee_fixed`), a fechar na migration.
  - Regra de aplicação: a multa não entra no atraso inicial; só se torna exigível após `daysLate >= default_after_days`.
  - Enquanto a migration/RPC não existir, o form deve tratar como requisito pendente/feature bloqueada ou preview informativo, não salvar silenciosamente em campo inexistente.

**Preview obrigatório antes de salvar:**

- Saldo-base/principal inicial.
- Juros do 1º ciclo.
- Total para quitação do 1º ciclo (`principal + juros`, sem encargos no cadastro inicial).
- Data da 1ª cobrança.
- Simulações fixas com os mesmos números do preview:
  1. **Paga total:** contrato encerra (`completed`), saldo-base zera, não gera próxima parcela automática.
  2. **Paga só juros:** juros do ciclo quitam, principal permanece, nova cobrança prevista com principal + juros original.
  3. **Não paga:** fica atrasado; após `default_after_days` dias (20 por padrão) aparece inadimplente; se capitalização ativa, próximo ciclo usa total vencido como base.
  4. **Quebra/inadimplência com multa:** se a taxa de quebra estiver configurada, mostrar quando ela passa a incidir (somente após inadimplência) e quanto adicionaria ao saldo exigível.
  5. **Paga parcial:** valor parcial é aceito e imputado em encargos/taxa de quebra exigível → juros → principal; saldo remanescente fica claro.
- Aviso final: “Salvar contrato não registra pagamento. Baixas Bullet ocorrerão por fluxo transacional próprio em etapa futura.”

**Payload esperado para criação nova Bullet (sem implementação nesta rodada):**

```ts
create_investment_validated({
  p_tenant_id,
  p_user_id,
  p_payer_id,
  p_asset_name,
  p_amount_invested: principal,
  p_source_capital,
  p_source_profit,
  p_current_value: principal + juros_do_primeiro_ciclo,
  p_interest_rate: taxa_por_ciclo,
  p_installment_value: juros_do_primeiro_ciclo,
  p_total_installments: prazo_indeterminado ? 120 /* placeholder UI atual; DB grava NULL */ : ciclos_planejados,
  p_frequency,
  p_due_day,
  p_weekday,
  p_start_date: primeira_data_calculada_ou_escolhida,
  p_calculation_mode: 'interest_only',
  p_skip_saturday,
  p_skip_sunday,
  p_custom_dates,
  p_company_id,
  p_bullet_principal_mode: null,
  p_capitalize_interest,
  // campos futuros exigidos pela spec após migration/RPC:
  p_default_after_days: defaultAfterDays, // default 20
  p_break_fee_enabled: breakFeeEnabled,
  p_break_fee_rate: breakFeeEnabled && breakFeeType === 'percent' ? breakFeeRate : null,
  p_break_fee_fixed: breakFeeEnabled && breakFeeType === 'fixed' ? breakFeeFixed : null,
})
```

Observação: Claude/MCP confirmou que `default_after_days` e `break_fee_*` ainda não existem no schema real; portanto esses parâmetros são **alvo de migration futura**, não payload válido hoje.

**Payload esperado para importação Bullet antiga:**

- Manter `create_legacy_investment` enquanto for import, mas a spec futura deve adicionar/validar suporte a:
  - `p_capitalize_interest`;
  - eventos/metadata para parcelas pré-pagas por juros com rolagem;
  - mapeamento explícito de parcelas quitadas, parciais e apenas juros, em vez de `p_paid_count` genérico para Bullet.

#### 7.4.4. Critérios de aceite específicos do form

- **AC-FORM-1:** Ao selecionar Bullet, o form deixa de dizer apenas “paga só juros” e apresenta “total do ciclo = principal + juros”.
- **AC-FORM-2:** O preview mostra, para principal R$ 100 e taxa 10%, juros R$ 10 e total para quitação R$ 110.
- **AC-FORM-3:** O preview explica cinco cenários: quitação total, juros com rolagem, não pagamento/default após `default_after_days`, taxa de quebra se configurada e parcial.
- **AC-FORM-4:** Ao salvar Bullet novo, o payload mantém `p_calculation_mode = 'interest_only'`, `p_bullet_principal_mode = null`, `p_capitalize_interest` explícito e primeira data controlada pelo operador.
- **AC-FORM-5:** O form não promete baixa parcial/total enquanto a RPC transacional de pagamento Bullet não existir; apenas cria o contrato e a primeira cobrança.
- **AC-FORM-6:** Para frequência mensal, a primeira cobrança não depende só da regra automática do banco: a UI envia `p_start_date` calculada pela escolha “este mês/próximo mês”.
- **AC-FORM-7:** O campo `default_after_days` é visível/editável no cadastro Bullet, vem preenchido com 20 dias e define quando atraso vira inadimplência/defaulted.
- **AC-FORM-8:** O cadastro Bullet oferece opção opcional de taxa/multa de quebra contratual; quando desligada, não há multa; quando ligada, o tipo/valor aparece no preview e só incide após inadimplência.
- **AC-FORM-9:** Enquanto `default_after_days`/`break_fee_*` não existirem no banco/RPC, a implementação deve bloquear persistência ou exigir migration antes de habilitar em produção; não salvar em metadata solta sem auditoria aprovada.
- **AC-FORM-10:** Importação Bullet antiga exibe alerta de compatibilidade e não converte `p_paid_count` em “principal quitado” sem metadata/evento.

#### 7.4.5. Impacto, riscos e migração de dados existentes

- **Form novo:** ajustar textos, labels, preview e validações sem alterar a RPC antes da validação Supabase real.
- **Form legado:** risco alto de contratos Bullet importados com semântica antiga `together/separate`; precisa plano de migração/compatibilidade antes de remover esse modo.
- **Dados existentes:** contratos Bullet ativos com `bullet_principal_mode = null` devem ser tratados como rotativos; contratos com `together/separate` precisam relatório de compatibilidade antes de migração automática.
- **Parcelas existentes:** parcelas `paid` com `amount_paid < amount_total` podem significar juros pagos/rolagem; não recalcular principal recuperado sem auditar origem.
- **Capitalização:** se `capitalize_interest` estiver `true` em dados antigos, não aplicar juros sobre total vencido sem cláusula/aceite documentado.
- **Primeira parcela:** se contratos Bullet foram criados sem `p_start_date`, a data pode ter sido escolhida pela RPC automaticamente; qualquer regularização deve comparar `due_day`, `start_date`, `frequency` e parcelas existentes.
- **Migração recomendada:** somente leitura via Claude/MCP para classificar contratos Bullet por `calculation_mode`, `bullet_principal_mode`, `capitalize_interest`, existência de parcela aberta/futura e anomalias de `amount_interest = 0`; nenhuma correção automática sem backup/aprovação.

---

## 8. Critérios de aceite testáveis

### AC1 — Quitação total do ciclo

Dado um contrato Bullet ativo com `remaining_balance = 100`, `interest_rate = 10` e parcela aberta `amount_total = 110`, quando o operador registra pagamento de R$ 110,00, então:

- a parcela fica `paid`;
- `amount_paid` acumula R$ 110,00;
- `remaining_balance` do contrato fica 0;
- contrato fica `completed`;
- nenhuma próxima parcela é gerada automaticamente;
- um evento/auditoria transacional registra principal R$ 100,00 e juros R$ 10,00;
- a UI apresenta opção separada de renovação/criar novo contrato.

### AC2 — Pagamento somente dos juros

Dado o mesmo contrato/parcela, quando o operador registra pagamento de R$ 10,00 como “pagar juros e rolar principal”, então:

- juros do ciclo ficam quitados;
- principal/saldo-base permanece R$ 100,00;
- a parcela fica operacionalmente regularizada com metadata/evento de rolagem;
- nova parcela é gerada com `amount_principal = 100`, `amount_interest = 10`, `amount_total = 110`;
- auditoria transacional registra `interest_portion = 10`, `principal_portion = 0` e evento de rolagem;
- histórico/recibo informa que o principal não foi quitado.

### AC3 — Não pagamento e capitalização do total vencido

Dado parcela Bullet vencida e sem pagamento, quando passa o prazo configurado `default_after_days` (padrão 20), então:

- a parcela aparece como inadimplente/defaulted operacionalmente;
- se `capitalize_interest = true` e houver cláusula contratual habilitada, a base do próximo ciclo é o total vencido;
- no exemplo R$ 110,00 vencidos a 10%, a próxima cobrança é R$ 121,00;
- a capitalização é registrada em auditoria transacional;
- se `capitalize_interest = false`, a implementação deve manter vencidos separados e não aplicar juros sobre juros.

### AC4 — Taxa/multa de quebra contratual opcional

Dado contrato Bullet criado com taxa/multa de quebra configurada e `default_after_days = 20`, quando a parcela está vencida há menos de 20 dias, então:

- a parcela aparece como `late`, não `defaulted`;
- a taxa/multa de quebra ainda não é exigível;
- o saldo exibido não inclui `break_fee_*`.

Quando a mesma parcela ultrapassa 20 dias de atraso, então:

- a parcela/contrato aparece como inadimplente/defaulted operacionalmente;
- a taxa/multa de quebra configurada passa a compor o saldo exigível;
- auditoria registra evento específico (`bullet_contract_break_fee_applied`) ou metadata equivalente;
- se o contrato foi criado sem taxa/multa de quebra, nenhum encargo de quebra é aplicado automaticamente.

### AC5 — Pagamento parcial da parcela

Dado parcela Bullet total R$ 110,00, quando o operador registra pagamento parcial R$ 50,00, então:

- pagamento é aceito;
- valor é imputado conforme ordem definida: encargos → juros → principal;
- no exemplo sem encargos: R$ 10,00 juros, R$ 40,00 principal;
- `remaining_balance` passa a R$ 60,00;
- parcela/contrato mantêm saldo aberto ou geram próximo ciclo conforme ação explícita;
- auditoria registra porções e saldo remanescente.

### AC6 — Parcial menor que juros

Dado parcela Bullet com juros R$ 10,00, quando o operador registra pagamento R$ 5,00, então:

- pagamento é aceito;
- R$ 5,00 abatem juros;
- saldo vencido remanescente é R$ 105,00 (R$ 100 principal + R$ 5 juros);
- se capitalização estiver habilitada e chegar novo ciclo, juros incidem sobre R$ 105,00;
- auditoria diferencia juros pagos, juros vencidos e principal.

### AC7 — Caderneta Bullet usa total vencido/total do ciclo

Dado uma parcela Bullet `interest_only`, quando a Caderneta listar cobranças, então:

- “Total do ciclo” usa `amount_total` e não apenas `amount_interest`;
- “Total vencido” soma principal/saldo-base exigível, juros vencidos, multas/mora e deduz recebidos;
- “Recebido” usa `amount_paid`;
- status `late/defaulted/partial/paid` é calculado por saldo operacional e data;
- KPIs não confundem rendimento esperado (juros) com cobrança bruta (principal + juros).

### AC8 — Renovação opcional

Dado contrato Bullet `completed`, quando o operador desejar renovar, então:

- deve haver ação explícita de renovação;
- a renovação cria novo contrato ou novo vínculo formal, com referência ao contrato anterior;
- nenhuma parcela é criada automaticamente no contrato quitado;
- recibo/metadata deixam claro que é nova operação, não continuidade automática.

### AC9 — Guardião Supabase obrigatório

Antes de qualquer migration/deploy:

- Claude Code deve validar schema real: enum/status de `loan_installments`, colunas de `investments`, RPCs ativas e overloads;
- nesta rodada, Claude/MCP já confirmou conexão do Supabase no CWD correto e ausência de `default_after_days`/`break_fee_*`;
- antes de migration/deploy, Claude deve revalidar dados reais sem PII: gaps de parcela e parcela `amount_interest = 0` anômala;
- Hermes não deve acessar Supabase diretamente.

---

## 9. Plano de implementação por fases — sem mexer em produção ainda

### Fase 0 — Alinhamento contratual/jurídico

- Confirmar texto contratual mínimo para: capitalização, rolagem de principal, inadimplência após X dias, renovação opcional, taxa/multa de quebra contratual e ordem de imputação.
- `default_after_days` passa a ser configurável por contrato, com default 20 dias.
- Decidir formato da taxa/multa de quebra contratual: percentual sobre saldo/total vencido, valor fixo, ambos, limites e base de cálculo.
- Definir se `defaulted` persistirá apenas em `investments.status`/derivado de parcela ou exigirá enum novo em `loan_installments`.

### Fase 1 — Validação Supabase pelo Claude

- MCP Supabase já foi localizado e conectado via Claude Code no CWD `/home/guilherme/projetos/e-finance`; antes de qualquer migration, reexecutar validação somente leitura.
- Validar schema real, RPCs e overloads.
- Confirmar enum/check de `loan_installments.status`, status de `investments`, colunas `remaining_balance`, `capitalize_interest`, `default_after_days`/`grace_days`, `break_fee_*`, `parent_investment_id` e constraint de `payment_transactions.transaction_type`.
- Reexecutar diagnóstico de contratos Bullet ativos sem parcela esperada.
- Confirmar causa de `investment_id=3098` com `amount_interest = 0` sem expor PII.
- Produzir relatório de dados para regularização.
- Checkpoint de segurança: se schema real divergir dos SQLs locais, atualizar a story antes de qualquer código.

### Fase 2 — Docs/BR/FR

- Atualizar `docs/business-rules/e-finance-br.md`:
  - Bullet total do ciclo;
  - quitação total encerra;
  - juros pagos rolam principal;
  - parcial permitido;
  - capitalização do total vencido condicionada a contrato;
  - `default_after_days` configurável com padrão 20;
  - taxa/multa de quebra opcional, aplicável só após inadimplência.
- Atualizar `docs/requirements/fr.md`, especialmente `FR-PAG-06`, tirando o status enganoso “implementado” para fluxos que não existem ou preparando nova versão.
- Atualizar `docs/daily-collection-screen.md`, `docs/installment-form-screen.md` e BRs de relatório para diferenciar cobrança bruta, juros e saldo de quitação.

### Fase 3 — Banco/RPC local em branch/worktree, sem deploy

- Criar/ajustar RPC única, sem overload indevido, por exemplo `process_bullet_cycle_payment(p_installment_id, p_amount, p_action, p_paid_at, p_payment_method)` ou revisar `process_bullet_payment` real para cumprir a spec.
- Ações mínimas: `full_settlement`, `interest_rollover`, `partial_payment`, `capitalize_default`, `apply_break_fee`.
- Adicionar schema para `default_after_days` com default 20 e campos `break_fee_*` no contrato/parcela/evento conforme decisão jurídica.
- Inserir `payment_transactions` dentro da própria RPC.
- Garantir idempotência e locks (`FOR UPDATE`).
- Criar migration para eventos `bullet_*` ou metadata obrigatória, conforme validação da constraint real.
- Evitar mutação de produção até aceite PO/jurídico, revisão de migration, testes e plano de rollback.

### Fase 4 — Frontend/CLI first

- Ajustar Caderneta Bullet para total do ciclo/total vencido.
- Ajustar form de criação Bullet para `default_after_days` editável default 20 e opção opcional de taxa/multa de quebra contratual.
- Ajustar modais para ações explícitas: quitar contrato, pagar juros e rolar, parcial, aplicar taxa de quebra após inadimplência, renovar.
- Exibir recibos claros de principal quitado vs principal rolado.

### Fase 5 — Testes e regularização de dados

- Testes unitários/e2e para exemplos A–E e para a nova regra de taxa/multa de quebra após `default_after_days`.
- Smoke SQL/RPC para ausência de overloads e auditoria transacional.
- Script de regularização de gaps somente após aprovação e backup.

### Fase 6 — Deploy controlado/rollback

- Preparar plano de rollout com feature flag ou caminho operacional reversível.
- Validar em staging com dataset sanitizado/espelhado antes de produção.
- Produção somente após aceite PO/jurídico, backup, smoke pós-deploy e plano de rollback.

### 9.1. Checkpoints/go-no-go

- **CP0 — Spec:** PO confirma exemplos A–E, `default_after_days` default 20, capitalização e formato da taxa/multa de quebra; saída: story aprovada sem código.
- **CP1 — Supabase read-only:** Claude/MCP já validou conexão/schema/RPCs principais; antes de migration, revalidar dados anômalos e constraints; saída: relatório anexado/atualização da story se houver divergência.
- **CP2 — Migration local:** campos `default_after_days`/`break_fee_*`, RPC única e auditoria transacional revisadas em branch local; saída: smoke SQL e rollback documentado, sem deploy.
- **CP3 — UI/relatórios:** Caderneta, modais, recibos e KPIs atualizados contra fixtures; saída: testes A–E verdes e regressão CB-001 mantida.
- **CP4 — Dados legados:** plano de regularização aprovado com backup; saída: script idempotente validado em staging.
- **CP5 — Produção:** janela, backup, feature flag/rollback e smoke pós-deploy aprovados; saída: deploy manual/controlado apenas com aceite explícito.

---

## 10. Fora do escopo desta rodada

- Executar migration em produção.
- Mutar dados Supabase.
- Fazer deploy.
- Alterar UI ou RPC sem nova aprovação após validação Supabase.
- Expor PII de devedores/investidores.

---

## 11. Checklist da story

- [x] Decisões finais do usuário incorporadas.
- [x] Regra contratual/financeira formalizada.
- [x] Estados, eventos e invariantes definidos.
- [x] Exemplos numéricos testáveis documentados.
- [x] Gap analysis código/banco atualizado.
- [x] Matriz de impacto/repercussões por camada adicionada.
- [x] Spec complementar do form de criação/importação Bullet adicionada.
- [x] Conflitos com BR/FR/código e riscos de regressão explicitados.
- [x] Plano de implementação por fases criado.
- [x] Claude CLI usado como revisor/guardião; Supabase não acessado diretamente por Hermes.
- [x] MCP Supabase localizado no CWD correto e validação real somente leitura executada por Claude/MCP.
- [x] Atualização oficial de BR/FR (`docs/business-rules/e-finance-br.md`, `docs/requirements/fr.md`).
- [x] Draft seguro de migration/RPC criado como artefato documental não aplicado.
- [ ] Implementação local de RPC/UI após aprovação.

---

## 12. File list desta etapa

Criado/modificado:

- `docs/stories/CB-002-bullet-flow-regularization.story.md`
- `docs/stories/cb-002-claude-mcp-validation-2026-05-28.md`
- `docs/stories/cb-002-bullet-rpc-migration-draft-not-applied.sql`
- `docs/business-rules/e-finance-br.md`
- `docs/requirements/fr.md`

Inspecionado:

- `AGENTS.md`
- `.aios-core/constitution.md`
- `/home/guilherme/projetos/e-finance/.mcp.json`
- `/home/guilherme/projetos/e-finance/e-finance-bot/.mcp.json`
- `package.json`
- `types.ts`
- `components/dashboard/CadernetaBullet.tsx`
- `components/InstallmentModals.tsx`
- `components/InstallmentDetailFlow.tsx`
- `components/AdminContracts.tsx`
- `components/LegacyContractPage.tsx`
- `components/QuickContractInput.tsx`
- `components/ContractRenewalModal.tsx`
- `hooks/useContractDetail.ts`
- `hooks/useInvestorMetrics.ts`
- `hooks/useYieldMetrics.ts`
- `services/salary.ts`
- `services/paymentAudit.ts`
- `context/migration_v39_late_auto_event.sql`
- `context/migration_v33_bullet_revolving.sql`
- `context/migration_v33_legacy_enhanced.sql`
- `context/migration_v35_fix_simple_interest.sql`
- `context/migration_v40_bullet_fixes.sql`
- `docs/business-rules/e-finance-br.md`
- `docs/requirements/fr.md`
- `docs/daily-collection-screen.md`
- `docs/installment-form-screen.md`
- `e2e/qa-validation/caderneta-bullet-mock.spec.ts`
- `e2e/payment/payment-bullet.spec.ts`

---

## 13. Notas de risco

- Capitalização sobre total vencido pode configurar juros sobre juros; deve haver cláusula contratual expressa e aceite antes de produção.
- Taxa/multa de quebra contratual é encargo sensível; só aplicar após inadimplência (`default_after_days`) e com cláusula/aceite explícito.
- A regra de `defaulted` não deve ser persistida em `loan_installments.status` sem validar enum real.
- O fluxo atual tem risco de auditoria incompleta porque logs de pagamento são client-side e non-blocking.
- Implementação agora é possível apenas como preparação local após aprovação; deploy/produção continuam bloqueados até aceite PO/jurídico, migration revisada, testes e rollback.
