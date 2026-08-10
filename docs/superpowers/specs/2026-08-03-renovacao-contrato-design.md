# Renovação de Contrato — Paridade com a Criação

**Data:** 2026-08-03
**Frente:** A (de A→B→C: Renovação → Offline → Polimento)
**Status:** aprovado para plano de implementação

## Problema

Existem dois formulários de contrato no sistema, e eles divergiram.

O wizard de criação (`components/AdminContracts.tsx`, steps 1–3) envia 25 parâmetros para
o RPC `create_investment_validated`. O modal de renovação
(`components/ContractRenewalModal.tsx`, 534 linhas) reimplementou o mesmo formulário com
11 campos e escrita própria no cliente.

O cliente pediu que renovar um contrato quitado ofereça as mesmas opções de criar um
contrato novo — taxa de juros, pular sábado/domingo, e o resto. A causa não é "faltam
campos": é a duplicação. Adicionar os campos um a um faz os dois formulários divergirem
de novo no próximo campo que a criação ganhar.

### Campos ausentes na renovação

| Campo | Criar | Renovar |
|---|---|---|
| Lucro reinvestido (`source_profit_amount`) | sim, configurável | não, sempre 0 |
| `monthOffset` ("este mês" / "próximo mês") | sim | não |
| `skip_saturday` / `skip_sunday` | sim | não |
| Datas customizadas (freelancer) | sim | não — mas o select oferece "Freelancer" |
| `capitalize_interest` | sim | não |
| `break_fee_percent` | sim | não |
| `default_after_days` | sim | não |
| `late_fine_percent` | sim | não |
| Trocar investidor / devedor | sim | não |
| Escrita atômica + audit log | sim (RPC + `logEvent`) | não |

### Defeitos do modal atual

1. **Escrita não-atômica** (`ContractRenewalModal.tsx:162-277`): insert do contrato →
   insert das parcelas → update do pai, em três operações soltas. Falha entre a primeira e
   a segunda deixa um contrato sem parcelas.
2. **Erro do update do pai é ignorado** (linha 272-277): o `await` não verifica `error`, e
   `onSuccess()` é chamado mesmo se a transição de status falhar.
3. **`markRenewed` é um checkbox** (linha 94, 496-506): BR-CNT-007 não deixa a transição de
   status opcional.
4. **`completed → renewed`**: quando o pai está quitado, o modal tenta uma transição que
   BR-CNT-009 não permite e que BR-CNT-007 proíbe explicitamente.
5. **Não bloqueia pai `defaulted`**: BR-CNT-007 exige reversão administrativa antes.
6. **`source_capital = principal`, `source_profit = 0`** (linha 183-184): a equação de
   BR-CNT-005 fecha, mas a origem do capital fica falsificada quando o dinheiro que volta
   de um contrato quitado é capital + lucro.
7. **`calculateInstallmentDates` duplicado** (linha 15-46): reimplementação local que ignora
   `skip_saturday`/`skip_sunday`/`monthOffset`, enquanto `utils/financials.ts` já exporta a
   versão completa que o wizard usa.
8. **Frequência "Freelancer" quebrada**: o select oferece a opção (linha 377), mas a
   implementação local cai no ramo diário e gera datas erradas sem avisar.

### Bug correlato em produção

`hooks/useDashboardData.ts:348`, `components/dashboard/CollectionDashboard.tsx:88` e
`hooks/useYieldMetrics.ts:157` filtram apenas `status = 'completed'`. Nenhum filtra
`'renewed'`. Renovar um contrato **ativo** deixa as parcelas em aberto do pai cobrando ao
lado das do filho — dívida dupla. Não dispara no caso do cliente (renovar após quitação,
onde o pai fica `completed`), mas dispara para qualquer contrato ativo renovado.

Medido em produção: os 3 contratos `renewed` existentes têm **zero** parcelas em aberto,
ou seja, o bug é **latente** — não está cobrando ninguém a mais hoje. Ele passa a valer
justamente quando a renovação fica acessível e completa, que é o objetivo deste trabalho.

Um levantamento posterior mostrou que o problema é mais amplo do que estes três pontos:
`hooks/useDashboardData.ts` (`safeInvestments`) e `components/Dashboard.tsx` (o `forEach`
que reinjeta contratos sem parcelas) não filtram status **nenhum**, nem `completed`. Ambos
entram no escopo. Duas armadilhas foram identificadas e precisam ser respeitadas:
`hooks/useYieldMetrics.ts` testa `completed || defaulted` e a troca tem de ser aditiva,
porque `defaulted` não pertence à lista de inativos; e
`components/dashboard/CadernetaBullet.tsx` exclui `renewed` de propósito, mantendo
`completed` — aplicar a constante ali quebra a tela.

## Solução

Renovar deixa de ter formulário próprio e passa a abrir o wizard de criação
pré-preenchido. `ContractRenewalModal.tsx` é deletado.

A paridade deixa de ser algo a manter — passa a ser estrutural, porque só existe um
formulário.

### 1. Fluxo

```
onRenew(contrato)
  → setRenewalSource(contrato)
  → setContractsSubView('create')
  → useEffect([renewalSource, profiles]) pré-preenche o wizard
  → wizard abre no step 2 (partes já resolvidas, step 1 continua acessível)
  → submit envia p_parent_investment_id ao create_investment_validated
```

A sub-view `'renewal'` e o import do modal saem de `AdminContracts.tsx`. O estado
`renewalSource` permanece, agora como marcador de modo.

**Pré-preenchimento** — a partir do contrato pai, tudo editável:

- `selectedInvestor` / `selectedPayer`: resolvidos por
  `profiles.find(p => p.id === source.user_id | source.payer_id)`. O efeito depende de
  `profiles` porque a lista pode não estar carregada quando `renewalSource` é setado.
- `formData`: `asset_name` (+ sufixo " (Renovação)"), `amount_invested`, `interest_rate`,
  `total_installments`, `frequency`, `due_day`, `weekday`, `calculation_mode`,
  `bullet_principal_mode`, `capitalize_interest`, `break_fee_percent`,
  `default_after_days`, `late_fine_percent`, `skip_saturday`, `skip_sunday`.
- Espelhos string dos inputs: `installmentsInput`, `rateInput`, `installmentValueInput`
  precisam ser setados junto, senão os campos exibem o valor anterior.
- O pré-preenchimento passa pelo mesmo caminho de `handleFormChange` para que
  `calculateFinancials` recalcule `installment_value` e `current_value`.

**Banner** no topo do wizard enquanto `renewalSource` estiver setado: "Renovação de
#{id} — {asset_name}", com ação de cancelar que limpa `renewalSource` e volta para o
detalhe do contrato.

Os oito campos ausentes chegam sem serem escritos: já existem no wizard.

### 2. Migration — `create_investment_validated`

Ganha `p_parent_investment_id bigint DEFAULT NULL` como último parâmetro.

Adicionar um parâmetro a uma função existente cria um **overload** no Postgres, e o
PostgREST passa a não conseguir resolver entre as duas assinaturas. A migration precisa
ser `DROP FUNCTION` da assinatura antiga seguido de `CREATE`, **na mesma transação**.

Com `DEFAULT NULL`, os chamadores atuais (wizard, bot Go) seguem funcionando sem
alteração.

Quando `p_parent_investment_id IS NOT NULL`, dentro da mesma transação que cria o filho:

```sql
SELECT status INTO v_parent_status
  FROM investments
 WHERE id = p_parent_investment_id AND tenant_id = p_tenant_id
   FOR UPDATE;

-- não encontrado                → RAISE (tenant errado ou id inexistente)
-- 'defaulted'                   → RAISE (BR-CNT-007 exige reversão administrativa)
-- 'renewed'                     → RAISE (já renovado; evita cadeia ambígua)
-- 'active'                      → UPDATE investments SET status = 'renewed'  (BR-CNT-009)
-- 'completed'                   → permanece 'completed'  (BR-CNT-007, exceção)

INSERT ... parent_investment_id = p_parent_investment_id
```

O `FOR UPDATE` protege contra mudança concorrente de status entre a leitura e a decisão.

Isso elimina de uma vez: contrato órfão, erro de update silencioso, checkbox
`markRenewed` e a transição proibida `completed → renewed`.

### 3. Filtro de contratos inativos

Uma constante compartilhada substitui os literais espalhados:

```ts
export const INACTIVE_CONTRACT_STATUSES = ['completed', 'renewed'] as const;
```

Aplicada em `hooks/useDashboardData.ts:348`, `components/dashboard/CollectionDashboard.tsx:88`
e `hooks/useYieldMetrics.ts:157`. Os dados do pai ficam intactos — é a mesma estratégia já
usada hoje para `completed`.

`hooks/useDebtorLateMap.ts:26` já filtra ambos e serve de referência.

### 4. Origem do capital

O wizard já expõe o controle de lucro reinvestido (`source_profit_amount`, limitado por
`availableProfit`), e ele passa a valer na renovação. O admin decide a composição; o
sistema não presume mais `source_profit = 0`. BR-CNT-005 continua sendo verificada pelo
RPC.

### 5. Regras de negócio a atualizar

Em `docs/business-rules/e-finance-br.md`:

- **BR-CNT-007** — a transição do pai deixa de ser opcional (o checkbox some) e passa a ser
  aplicada pelo RPC. Registrar que `renewed → renewed` é rejeitado.
- **BR-CNT-011** — registrar que contratos `renewed` também são excluídos das telas de
  cobrança, dashboard e métricas de rendimento.

## Escopo adicional — remoção dos dashboards de investidor e devedor

Acrescentado em 2026-08-03, por decisão do usuário, e executado **antes** da renovação
porque apaga dois dos hooks que ela teria de corrigir (`useInvestorMetrics` e
`useDebtorFinance`).

As duas telas estão mortas: em produção há 310 perfis `debtor` (18 com login) e 77
`investor` (2 com login), e **nenhum deles logou nos últimos 90 dias** — o último acesso
foi em 2026-03-27.

O ponto sensível é que `components/Dashboard.tsx` faz fall-through para
`AdminDashboardView`, e os dois `if` de role são a **única barreira de frontend** entre um
não-admin e o painel administrativo: o botão "Dashboard" da sidebar aparece para todas as
roles e `AppView.DASHBOARD` não tem gate de role. Removê-los sem mais nada transformaria a
limpeza em vazamento de dados, incluindo as abas de Cobranças e Recebíveis, que expõem
ações de escrita.

Portanto a ordem é: (1) instalar um gate de role em `App.tsx` com uma tela terminal de
acesso indisponível para não-admin; (2) só então remover as telas.

Sai por completo: `InvestorDashboard`, `DebtorDashboard`, o `PaymentModal` da raiz (não o
homônimo de `InstallmentModals`, que é do admin), `useDebtorFinance`, `useGeneratePix`,
`services/pix.ts` (já órfão antes desta mudança) e a dependência `qrcode.react`.

Sobrevive, apesar do nome ou do caminho sugerirem o contrário:
`components/investor/MonthlyInvestorView.tsx` e os helpers `monthKeyToDate`,
`dateToMonthKey` e `computeMonthlyView` de `hooks/useInvestorMetrics.ts` — todos alimentam
a aba "Visão Mensal" **do admin**. O arquivo é podado, não deletado.

O fluxo de convite (`Login.tsx` e `OnboardingWizard.tsx`) também é fechado: ele continua
criando contas logáveis com role `investor`/`debtor`, que agora nasceriam direto na tela
de bloqueio.

## Testes

`e2e/contract/contract-lifecycle.spec.ts` (CNT-LC-01 e CNT-LC-02) exercita a renovação
pela UI e vai quebrar quando a tela mudar — atualizar os seletores para o wizard.

CNT-LC-01 hoje **não cobre nada**: ele procura `[data-testid="contract-card"]`, atributo
que não existe no DOM, e faz `test.skip` em todo run. Expor esse atributo no card da lista
é pré-requisito para o teste voltar a ter valor.

Casos a acrescentar:

1. Renovar contrato `completed` → pai continua `completed`, filho com
   `parent_investment_id` correto.
2. Renovar contrato `active` → pai vira `renewed`.
3. Renovar contrato `defaulted` → rejeitado com erro legível.
4. Renovar contrato `renewed` → rejeitado.
5. `skip_saturday` marcado na renovação → persiste no contrato filho e nas datas geradas.
6. Contrato `renewed` com parcelas em aberto → não aparece na cobrança nem no dashboard.

Gate obrigatório antes de push: `npx tsc --noEmit`.

## Fora de escopo

Levantados durante o brainstorming e deliberadamente adiados:

- Rollover de saldo devedor, renovação com aporte adicional, renovação com entrada e
  renegociação de contrato inadimplente. São fatos financeiros distintos de "renovar após
  quitação" e nenhum foi pedido.
- A tabela `restructuring_operation` e o vínculo N:N sugeridos pelo Codex — dimensionados
  para os cenários acima, que não estão no escopo.
- Consolidação do modo bullet com `pay_bullet_interest_only` (rolagem de ciclo).
- Frente B (rodar offline) e frente C (polimento visual) — specs próprios, nesta ordem.

## Riscos

| Risco | Mitigação |
|---|---|
| `DROP`+`CREATE` do RPC em produção | Transação única na migration; validar assinatura via MCP antes e depois |
| Testes E2E de renovação quebram | Previsto — atualização faz parte do escopo |
| `AdminContracts.tsx` tem 2.156 linhas e fica maior | Ganha ~40 linhas e o repo perde 534. Extrair o step 2 num componente próprio fica para a frente C |
| Pré-preenchimento corre antes de `profiles` carregar | Efeito depende de `[renewalSource, profiles]` |

---

# Adendo — 2026-08-10: mapa completo e fechamento dos caminhos errados

Com a renovação já rodando pelo wizard, foi feito o levantamento de **todas** as
possibilidades de renovar e do que cada uma produz. O resultado mudou uma decisão da spec
original: renovar contrato `active` não é "permitido com ressalva", passa a ser **proibido**.

## Superfície real

Um único ponto de entrada: `ContractDetail.tsx:538` → `AdminContracts.tsx:969` → wizard →
`create_investment_validated` com `p_parent_investment_id`. Os outros dois caminhos de
criação (`QuickContractInput`, `LegacyContractPage`) usam `create_legacy_investment`, que
não tem o parâmetro — não existe renovação por lá.

## O que foi encontrado

| # | Achado | Efeito | Decisão |
|---|---|---|---|
| B1 | Renovar contrato **freelancer** cria todas as parcelas vencendo hoje | `setFreelancerDates([])` no pré-preenchimento + `p_custom_dates` vazio → `array_length` NULL → o loop cai no ramo final e usa `CURRENT_DATE`. 19 contratos freelancer em produção | Corrigido nas duas pontas: guarda no RPC (BR-CNT-012) e pré-preenchimento gera as datas com `buildFreelancerDates` |
| B2 | Botão "Renovar" aparecia em qualquer status | Admin preenchia o wizard inteiro para receber `alert()` do RPC | Botão desabilitado fora de `completed` |
| B3 | Parcelas em aberto do pai `active` renovado seguiam vivas | `update_overdue_installments` marcava `late` e gravava multa de bullet; `getUserDebt` do bot somava a dívida do pai junto com a do filho. O dashboard as escondia (`INACTIVE_CONTRACT_STATUSES`), o que tornava o problema invisível | Eliminado pela raiz: renovar `active` passa a ser rejeitado |
| B4 | Renovar `active` contava o capital duas vezes | `view_investor_balances.total_own_capital` soma `source_capital` sem filtrar status, e o principal do pai nunca voltou ao caixa | Idem — rolagem de saldo continua fora de escopo, mas agora o caminho está fechado em vez de errado |
| B5 | Empresa não era herdada do pai | `p_company_id: activeCompanyId` — com escopo `'all'` o filho podia nascer separado do pai | `renewalSource?.company_id ?? activeCompanyId ?? null` |
| B6 | Preview mensal divergia do banco | Frontend: `hoje >= due_day → próximo mês`; RPC: `due_day >= hoje → este mês`. Discordavam no dia exato do vencimento | Frontend alinhado ao RPC (`>` em vez de `>=`), com teste unitário |
| B7 | **Renovar não fazia nada, sem mensagem** | `profiles` é filtrado por `company_id = activeCompanyId` (`AdminContracts.tsx:326`) e a lista de contratos não usa o mesmo critério: um contrato de empresa X com devedor de `company_id` nulo/diferente aparece na lista, mas suas partes ficam fora da lista de perfis. O pré-preenchimento resolvia investidor/devedor por `profiles.find(...)`, achava `null`, e `handleCreateContract` tinha `if (!selectedInvestor \|\| !selectedPayer) return` — voltava em silêncio. O admin preenchia o wizard, clicava em "Renovar Contrato" e **nada acontecia**. 9 contratos em produção com partes fora do filtro, 1 deles quitado (renovável hoje) | Pré-preenchimento busca por id os perfis que faltarem, e o `return` silencioso virou aviso |

> B7 foi encontrado pelo próprio CNT-LC-01 depois de atualizado: com o teste passando a exigir
> pai `completed`, ele caiu justamente num contrato cujo devedor estava fora do filtro. Antes,
> como aceitava `active`, escolhia outro contrato e o bug nunca aparecia.

## Fora de escopo, registrado

- **`getUserDebt` do bot** (`e-finance-bot/src/actions/admin-actions.ts:2093`) soma parcelas em
  aberto de todos os contratos do payer sem filtrar status. Com renovação de `active`
  bloqueada, nenhum `renewed` novo nasce com parcelas em aberto, e os 3 históricos têm zero —
  então a dívida dupla via WhatsApp deixa de ter como acontecer. A query continua frágil para
  contratos `completed` com resíduo. Decisão do usuário: não tocar no bot Node nesta frente.
- **`get_admin_dashboard_stats`** não filtra status nenhum, mas está órfão — nenhum chamador
  no frontend nem no bot.
- **`create_legacy_investment` tem o mesmo furo de freelancer** que a v49 fechou no RPC de
  criação: sem datas suficientes em `p_custom_dates`, o loop cai no ramo seguinte. O estrago é
  menor — esse ramo é o diário a partir de `p_first_due_date`, e não `CURRENT_DATE` — mas o
  contrato sai com vencimentos que o operador não pediu. Zero contratos legacy freelancer em
  produção. Decisão do usuário em 2026-08-10: registrar, não corrigir nesta frente. Se for
  corrigir depois, a guarda é a mesma de BR-CNT-012 e vale para os dois caminhos de "Contrato
  Antigo" (`QuickContractInput` e `LegacyContractPage`).
- **CNT-LC-02 e CNT-LC-05 pulam sempre**: o tenant de QA não tem contrato `renewed` nem bullet.
  Pré-existente. A renovação de bullet quitado foi verificada direto no banco (filho
  `interest_only`, 1 parcela de principal + juros, `remaining_balance` intacto, multa e taxa de
  quebra herdadas, pai seguindo `completed`), mas não tem teste automatizado.
- **Rollover de saldo devedor, aporte adicional, entrada e renegociação de inadimplente**
  seguem fora, como na spec original.
- **Dado histórico:** 3 contratos `renewed` em produção, só 1 com filho vinculado — sobra do
  `ContractRenewalModal`, que fazia a transição de status em escrita separada da criação do
  filho. Todos com zero parcelas em aberto; nenhum dinheiro em jogo.

## Entregue

- `context/migration_v49_renewal_guards.sql` — pai obrigatoriamente `completed`; freelancer
  exige datas. Assinatura inalterada (`CREATE OR REPLACE`, sem overload).
- `components/AdminContracts.tsx` — datas de freelancer no pré-preenchimento; empresa herdada;
  perfis das partes buscados por id quando estão fora do filtro de empresa; submit sem partes
  selecionadas avisa em vez de voltar em silêncio.
- `components/ContractDetail.tsx` — gate de status no botão.
- `utils/financials.ts` — regra do mês alinhada ao RPC.
- `tests/unit/financials.test.ts` — 4 casos de `calculateInstallmentDates`.
- `e2e/contract/contract-lifecycle.spec.ts` — CNT-LC-01 passa a exigir pai quitado;
  CNT-LC-09 (renovar ativo rejeitado) e CNT-LC-10 (freelancer sem datas) novos.
- `docs/business-rules/e-finance-br.md` — BR-CNT-007 reescrita, BR-CNT-009 ajustada,
  BR-CNT-012 criada.
