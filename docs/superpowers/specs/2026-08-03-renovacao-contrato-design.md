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

## Testes

`e2e/contract/contract-lifecycle.spec.ts` (CNT-LC-01 e CNT-LC-02) exercita a renovação
pela UI e vai quebrar quando a tela mudar — atualizar os seletores para o wizard.

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
