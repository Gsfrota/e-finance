# CB-001 — [PO/SPEC] Caderneta Bullet: visão operacional sem pagos na tela principal

**Agente:** @po / @architect  
**Status:** InProgress — GO aprovado pelo PO em 2026-05-27 para o escopo abaixo  
**Criada em:** 2026-05-26  
**Origem:** Relato do usuário + screenshot mobile `/home/guilherme/.hermes/image_cache/img_31d8aad91969.jpg` + ajuste PO de 2026-05-26 sobre pagos persistindo na visão principal + decisões PO de 2026-05-27 sobre Em aberto, parcial, atraso e inadimplência  
**Área:** Caderneta Bullet  
**Arquivos candidatos:** `components/dashboard/CadernetaBullet.tsx`, `App.tsx`, `e2e/reports/caderneta-bullet.spec.ts`, `e2e/fixtures/e2e-test-helpers.ts`, `docs/business-rules/e-finance-br.md`, `docs/requirements/fr.md`

---

## 1. Contexto e fluxo entendido

A **Caderneta Bullet** é uma tela operacional para ajudar o usuário/admin a enxergar e cobrar contratos **bullet** / **“só o juros”** (`calculation_mode = 'interest_only'`). Ela não deve funcionar como histórico principal de parcelas pagas. A visão principal deve priorizar o que ainda exige atenção operacional: contratos/parcelas bullet em aberto, pendentes, parciais ou atrasados.

Quando um cliente/parcela já pagou o ciclo exibido, esse item deve sair do fluxo visual principal e ficar acessível na aba/filtro **Pagas**. Pagos podem continuar contando em KPIs do mês, se isso for necessário para taxa/recebido, mas não devem persistir na lista principal atrapalhando a visão de cobrança.

Fluxo esperado:

1. Admin entra no app mobile.
2. Navega para **Caderneta Bullet**.
3. Tela deve abrir no topo, com título/navegação mensal/KPIs sem cortes.
4. O mês padrão deve ser o mês corrente.
5. O admin pode voltar para meses anteriores, mas não pode avançar para mês futuro.
6. A lista padrão deve mostrar somente o fluxo operacional em aberto do mês selecionado:
   - atraso;
   - pendentes;
   - parciais / juros parcialmente pagos ainda relevantes;
   - contratos bullet/só-juros que exigem ação.
7. Clientes/parcelas com `status = 'paid'` devem ficar fora da visão principal e aparecer somente quando o usuário abrir **Pagas**.
8. Filtros devem refletir o mês selecionado, com proposta de UX:
   - **Em aberto** (substitui o papel atual de “Todas” na visão principal: `late | pending | partial`);
   - **Atraso**;
   - **Pendentes**;
   - **Pagas**.
9. Cards devem exibir devedor, contrato, vencimento, número da parcela, valor cobrável do ciclo, progresso e badge.
10. Clique no card abre detalhe da parcela.

### 1.1 Decisões de produto aprovadas em 2026-05-27

Esta story recebeu **GO do usuário/PO** para implementação do escopo abaixo:

- A visão principal deixa de ser **Todas** e passa a ser **Em aberto**.
- **Em aberto** lista somente parcelas operacionais: pendentes, parciais, atrasadas e inadimplentes; pagos quitados saem da visão principal e ficam em **Pagas**.
- **Parcial** é uma classificação operacional quando:
  1. o status persistido da parcela é `partial`; **ou**
  2. o cliente pagou apenas parte da parcela (`amount_paid > 0` e ainda existe saldo em aberto).
- **Atraso** é operacional, não depende apenas do cron/status persistido: se a parcela não foi paga até o dia acordado (`due_date < hoje` em BRT) e ainda tem saldo em aberto, ela está atrasada.
- **Inadimplente** é uma camada visual/operacional dentro de atraso quando a parcela está há **20 dias ou mais** em atraso. Não cria novo status no banco nesta story.
- Mantém-se fora do escopo qualquer migration/RPC/Supabase direto; validações de dados reais seguem somente via Claude CLI/Claude Code guardião quando necessário.

Ciclo da story neste turno: `Draft → InProgress`; conclusão local deve atualizar evidências e checklist antes de retornar.

### 1.2 Rastreabilidade

- **Bug 1 — topo/scroll mobile:** evidência visual do screenshot + evidência técnica em `App.tsx` (`main` scrollável com `overflow-y-auto` e Caderneta renderizada na mesma área de views).
- **Bug 2 — mês futuro:** `BR-REL-011` proíbe avançar além do mês corrente; em `CadernetaBullet.tsx`, `disabled={isFuture}` só bloqueia quando `monthKey > currentMonthKey`.
- **Bug 3 — E2E frágil:** `e2e/reports/caderneta-bullet.spec.ts` contém `expect(isDisabled !== null || true).toBeTruthy()`, que passa sempre.
- **Bug 4 — atraso operacional:** hipótese visual comparada com `BR-REL-012` e `BR-REL-013`, que hoje definem atraso por `status = 'late'`.
- **Bug 5 — pago parcial/bullet:** hipótese visual comparada com `BR-REL-014` e `FR-PAG-06`; pode ser regra legítima de juros bullet ou bug de comunicação/status.
- **Bug 6 — header mobile:** evidência visual + duplicidade potencial entre título global em `App.tsx` e header interno em `CadernetaBullet.tsx`.
- **Bug 0 — pagos persistem na visão principal:** feedback PO do usuário + evidência técnica em `CadernetaBullet.tsx`: `statusFilter === 'all'` retorna `flatInstallments`, incluindo `status = 'paid'`; ordenação padrão ainda mantém pagos na lista, apenas no final.

---

## 2. Evidências do screenshot

Observações visíveis na imagem:

- Header mobile global exibindo:
  - horário do sistema
  - ícone hamburger
  - título **Caderneta Bullet**
  - avatar circular com letra `M`
- Conteúdo logo abaixo do header parece iniciar com a parte inferior de KPIs/progresso já cortada, sem mostrar o topo completo da tela interna.
- KPIs visíveis:
  - **Em atraso:** `R$ 0`
  - **Taxa cobrança:** `79,9%`
- Filtros visíveis:
  - `5 TODAS`
  - `0 ATRASO`
  - `1 PENDENTES`
  - `4 PAGAS`
- Cards visíveis:
  - Rodrigo irmão de Nilton foto — `R$ 400,00` — `25/05/2026 · #3` — badge `PENDENTE`
  - Fabio trabalha em Xavier Peneu — `R$ 600,00` — `05/05/2026 · #2` — `Pago R$ 100,00` — `17%` — badge `PAGO`
  - Foguinho moto táxi — `R$ 2.400,00` — `06/05/2026 · #2` — `Pago R$ 2.400,00` — badge `PAGO`
  - Claudia lanche — `R$ 360,00` — `08/05/2026 · #1` — `Pago R$ 360,00` — badge `PAGO`
  - Rafael sobrinho de Ceição — `R$ 708,00` — `08/05/2026 · #1` — `Pago R$ 708,00` — badge `PAGO`

---

## 3. Bugs / hipóteses extraídas

### Bug 0 — Pagos persistem na visão principal e poluem o fluxo operacional

**Evidência do usuário/PO:** “o cliente que pagou tem que ir para pagos e não atrapalhar o fluxo de visão”. A Caderneta Bullet existe para o usuário ver contratos bullet / “só o juros” que exigem atenção, não para manter clientes já pagos misturados na lista principal.

**Evidência no código:** em `components/dashboard/CadernetaBullet.tsx`, `statusFilter` inicia em `'all'` e `filteredInstallments` retorna `flatInstallments` completo quando `statusFilter === 'all'`. Como `flatInstallments` é criado a partir de `allPaidInstallments + pendingInstallments`, a visão padrão inclui `status = 'paid'`.

**Regra afetada:** `BR-REL-012` atualmente define filtro “Todos” como lista flat completa e ordena pagos por último. Esta regra precisa ser ajustada na implementação para a semântica operacional: visão principal = **Em aberto** (`late | pending | partial`); pagos = somente aba/filtro **Pagas**.

**Impacto:** no screenshot, 4 de 5 cards são pagos; isso faz o usuário procurar o que ainda precisa cobrar no meio de itens já resolvidos.

**Prioridade sugerida:** P0/P1 — correção principal desta rodada.

---

### Bug 1 — Conteúdo da tela abre cortado no mobile

**Evidência:** no screenshot, o conteúdo abaixo do header global começa no meio dos KPIs/progresso; o topo completo da área interna não aparece.

**Hipótese técnica:** o `<main>` do `App.tsx` é persistente e scrollável. Ao trocar de view para `CADERNETA_BULLET`, o scroll anterior pode estar sendo preservado, fazendo a Caderneta abrir deslocada.

**Impacto:** o admin perde contexto inicial da tela, KPIs superiores e possível navegação de mês/header interno.

**Prioridade sugerida:** P1.

---

### Bug 2 — Navegação mensal permite ir para mês futuro

**Evidência no código:** em `components/dashboard/CadernetaBullet.tsx`, o botão de próximo mês usa `disabled={isFuture}`, onde `isFuture = monthKey > currentMonthKey`. No mês corrente, `monthKey === currentMonthKey`, então o botão fica habilitado e permite avançar uma vez para o futuro.

**Regra afetada:** `BR-REL-011` diz que não é possível avançar além do mês corrente.

**Impacto:** usuário pode visualizar mês futuro indevido/vazio, confundindo cobrança do mês.

**Prioridade sugerida:** P1.

---

### Bug 3 — Teste E2E não protege a regra de mês futuro

**Evidência no teste:** `e2e/reports/caderneta-bullet.spec.ts` contém uma asserção frágil no cenário `REL-CB-02`:

```ts
expect(isDisabled !== null || true).toBeTruthy();
```

Essa condição sempre passa.

**Impacto:** regressão de navegação mensal não é barrada por teste.

**Prioridade sugerida:** P1.

---

### Bug 4 — Atraso deve seguir regra operacional por data/saldo

**Evidência visual:** screenshot mostra `0 ATRASO` e `Em atraso R$ 0`, mas há parcela `PENDENTE` com vencimento `25/05/2026`.

**Decisão PO confirmada em 2026-05-27:** para a Caderneta Bullet, se a parcela **não foi paga até o dia acordado**, ela deve entrar em **Atraso**. A regra operacional é `due_date < hoje` em BRT + saldo em aberto, independentemente de o cron/status persistido já ter mudado para `late`.

**Inadimplência:** quando o atraso atingir **20 dias ou mais**, a parcela deve ser comunicada como **Inadimplente** dentro do fluxo operacional de atraso/Em aberto. Nesta story, isso é camada visual/operacional e **não** cria novo status persistido no banco.

**Regras afetadas:**

- `BR-REL-012` deve substituir a semântica antiga baseada apenas em `status = 'late'` pela semântica operacional da Caderneta.
- `BR-REL-013` deve calcular o KPI **Em atraso** pela mesma regra operacional de data/saldo.

**Prioridade sugerida:** P1 — regra confirmada pelo PO.

---

### Bug 5 — Card exibindo `Pago R$ 100,00` com badge `PAGO`

**Evidência visual:** o card de Fabio mostra valor da parcela `R$ 600,00`, texto `Pago R$ 100,00`, progresso `17%` e badge `PAGO`.

**Decisão PO confirmada em 2026-05-27:** **Parcial** deve ser tratado quando o cliente pagou parte da parcela (`amount_paid > 0` e ainda há saldo em aberto) ou quando a parcela já vem com `status = 'partial'`. Portanto, a UI da Caderneta não deve comunicar quitação total quando houver saldo operacional em aberto.

**Cuidado específico de bullet:** antes de alterar cálculo financeiro, a implementação deve analisar a lógica existente de contratos `interest_only` (`BR-CNT-004` e `FR-PAG-06`), porque pode haver diferença entre `amount_total` como valor total da parcela/display e o valor efetivamente cobrável do ciclo de juros. Se essa regra exigir consulta a dados reais, a validação deve ocorrer somente via Claude CLI/Claude Code guardião, a partir do root do projeto.

**Prioridade sugerida:** P1 por risco de cobrança/financeiro.

---

### Bug 6 — Header duplicado/confuso no mobile

**Evidência no código:** `App.tsx` exibe título global `Caderneta Bullet`; `CadernetaBullet.tsx` também renderiza header interno com título, voltar e navegação mensal.

**Evidência visual:** screenshot mostra o header global, mas o header interno não aparece claramente — possivelmente cortado pelo Bug 1.

**Risco UX:** duplicidade de título ou perda de hierarquia no mobile.

**Decisão PO/UX necessária:** definir se no mobile:

- header global fica com o título e header interno mostra apenas navegação mensal; ou
- header interno mantém título e o global deve não duplicar informação.

**Prioridade sugerida:** P2.

---

## 4. Escopo IN

### 4.1 Escopo aprovado para implementação neste turno

- Ajustar a visão principal da Caderneta para **não listar pagos quitados** por padrão.
- Trocar a semântica/label de `Todas` para **Em aberto**: `pending | partial | late | inadimplente operacional`.
- Manter `status = 'paid'` quitado acessível somente no filtro/aba **Pagas**.
- Tratar como **Parcial** tanto `status = 'partial'` quanto pagamentos parciais (`amount_paid > 0` com saldo em aberto), ainda que o status persistido esteja divergente.
- Tratar como **Atraso** qualquer parcela com saldo em aberto e `due_date < hoje` em America/Sao_Paulo, independentemente de o cron já ter mudado o status persistido para `late`.
- Tratar como **Inadimplente** a parcela atrasada há 20 dias ou mais, visualmente dentro do fluxo de atraso/Em aberto, sem criar novo status persistido.
- Corrigir contadores dos filtros para refletirem essa nova semântica sem esconder a quantidade de pagos.
- Corrigir abertura da Caderneta no topo ao trocar para `AppView.CADERNETA_BULLET`.
- Corrigir regra de navegação para impedir avanço além do mês corrente.
- Corrigir testes E2E que hoje passam indevidamente.
- Adicionar seletores estáveis de teste para Caderneta Bullet nos pontos críticos necessários aos critérios de aceite.

### 4.2 Escopo ainda fora deste turno

- Não alterar RPCs/migrations/status persistido no Supabase para criar `defaulted`/inadimplente em parcela.
- Não redesenhar a hierarquia do header mobile além do reset de scroll/topo.
- Não alterar criação/importação de contrato bullet.
- Não mudar regras de contratos não bullet.

---

## 5. Escopo OUT

- Não alterar RPCs de pagamento sem nova spec específica.
- Não aplicar migration Supabase nesta story.
- Não consultar/escrever Supabase diretamente fora do Claude CLI/Claude Code guardião.
- Não redesenhar toda a Caderneta Bullet.
- Não mudar regras de contratos não bullet.
- Não alterar criação/importação de contrato bullet.
- Não remover pagos de histórico, recibos, relatório financeiro ou KPIs sem regra específica; a mudança proposta é de **visão/lista principal**, não de persistência de dados.

---

## 5.1 Dependências, valor, complexidade e riscos

**Dependências**

- Confirmado pelo PO em 2026-05-27: o filtro principal deve ser **Em aberto**, pagos ficam em **Pagas**, parcial inclui pagamento parcial/status parcial, atraso é por dia acordado não pago, e inadimplente ocorre com 20 dias de atraso.
- Pendência técnica de implementação: validar, antes de codar cálculo financeiro, se em contratos bullet/`interest_only` o saldo operacional da Caderneta deve usar `amount_total`, `amount_interest` ou outro valor cobrável do ciclo, para não confundir principal de referência com juros do período.
- Decisão UX para header mobile, caso a correção de scroll revele duplicidade de título.
- Supabase/dados reais: se necessário validar registros específicos do screenshot, fazer exclusivamente via Claude CLI/Claude Code guardião a partir de `/home/guilherme/projetos/e-finance`.

**Valor de negócio**

- Remove clientes já pagos do fluxo principal, deixando a Caderneta focada em cobrança/ação do dia.
- Reduz risco de cobrança errada ou leitura incorreta de inadimplência em contratos bullet.
- Evita que o admin opere em mês futuro por engano.
- Melhora confiabilidade dos testes que deveriam barrar regressões da Caderneta.

**Complexidade estimada**

- Técnico confirmado: **M** (visão principal sem pagos + layout/scroll + regra de navegação + E2E/selectors).
- Regra financeira/atraso: **M/L**, dependente de decisão PO e possível atualização de BR.

**Riscos**

- Se o label `Todas` permanecer, pode haver ambiguidade entre “todas do mês” e “todas abertas”; por isso a proposta é renomear para **Em aberto**.
- KPIs podem parecer inconsistentes se continuarem incluindo pagos enquanto a lista principal exclui pagos; a UI/testes devem deixar claro que KPIs são consolidados do mês e a lista é operacional.
- Mudança de atraso por data/saldo pode divergir das BRs atuais (`BR-REL-012`/`BR-REL-013`) e afetar indicadores financeiros.
- Ajustar badge `PAGO` sem entender `FR-PAG-06` pode quebrar semântica de pagamento de juros bullet.
- Reset global de scroll pode afetar telas que hoje dependem de posição preservada.
- E2E pode ficar instável se não houver seletores dedicados.

**Definition of Done da implementação futura**

- Story mantida em `InProgress` enquanto a implementação/validação local não for concluída.
- Código alterado apenas nos arquivos da File List aprovada, sem tocar em `e-finance-bot`.
- Critérios de aceite marcados com evidência de teste/manual.
- E2E sem `|| true`, skips silenciosos ou assertions permissivas para comportamento essencial.
- `npm run build` e `npm run test:e2e -- e2e/reports/caderneta-bullet.spec.ts` executados; ausência de `lint`, `typecheck` e `test` registrada se permanecerem ausentes no `package.json`.

---

## 6. Critérios de aceite

### Abertura e layout mobile

- [ ] Dado que o admin está no mobile e rolou outra tela antes, quando abrir **Caderneta Bullet**, então o conteúdo inicia no topo (`main.scrollTop === 0` ou equivalente observável).
- [ ] Dado viewport mobile comum (`390x844` e `375x667`), quando a tela abriu, então nenhum KPI/header aparece cortado verticalmente.
- [ ] Dado viewport mobile comum, então não há overflow horizontal no header/KPIs/filtros.

### Navegação mensal

- [ ] Dado que a Caderneta está no mês corrente, então o botão de próximo mês está desabilitado.
- [ ] Dado que o usuário está no mês corrente, quando tentar avançar, então o mês não muda para futuro.
- [ ] Dado que o usuário está em mês anterior, então o botão de próximo mês fica habilitado até retornar ao mês corrente.

### Filtros, visão principal e atraso

- [ ] Dado que a Caderneta Bullet abre no mês corrente, então a visão/lista principal não exibe cards com `status = 'paid'`.
- [ ] Dado que há parcelas pagas no mês, quando o usuário selecionar **Pagas**, então somente parcelas pagas aparecem.
- [ ] Dado que há parcelas pagas no mês, então o contador de **Pagas** continua visível para o usuário encontrar o histórico operacional sem poluir a visão principal.
- [ ] Dado o filtro principal **Em aberto**, então aparecem apenas parcelas operacionais abertas (`pending | partial | late | inadimplente visual`) do mês selecionado, excluindo pagas quitadas.
- [ ] Dado o filtro **Pendentes**, então parcelas pendentes/parciais sem atraso operacional aparecem conforme regra PO aprovada.
- [ ] Dado o filtro **Atraso**, então aparecem parcelas com saldo em aberto e `due_date < hoje` em BRT, incluindo inadimplentes.
- [ ] Dado uma parcela vencida com saldo em aberto, então ela aparece nos indicadores operacionais de cobrança mesmo que o status persistido ainda não seja `late`.
- [ ] Dado uma parcela com 20 dias ou mais de atraso operacional, então ela é comunicada visualmente como **Inadimplente** sem criar novo status persistido.

### Card bullet e status

- [ ] Dado uma parcela bullet com pagamento parcial de juros, então o badge comunica corretamente o estado financeiro aprovado por PO.
- [ ] Dado `amount_paid < totalDue`, então a UI não comunica quitação total sem regra explícita que justifique.
- [ ] Dado uma parcela paga, então `Pago R$ X` e barra de progresso são coerentes com o total cobrável exibido.

### Testes

- [ ] Teste cobre que a visão inicial/principal não renderiza cards pagos quando existem abertos no mês.
- [ ] Teste cobre que ao clicar em **Pagas** os cards pagos aparecem e os abertos saem da lista.
- [ ] `REL-CB-02` falha se o botão próximo estiver habilitado no mês corrente.
- [ ] Teste mobile cobre abrir a Caderneta depois de scroll prévio e valida topo visível.
- [ ] Teste de cards usa seletor estável, não heurística frágil.
- [ ] Teste de KPIs valida os 6 KPIs definidos em `BR-REL-013`.
- [ ] Nenhum teste essencial da Caderneta usa `|| true`, `found >= 0`, skip silencioso ou locator genérico que possa passar sem validar o comportamento.

---

## 7. Plano técnico proposto — sem implementar antes do alinhamento

### 7.0 Sequenciamento proposto

1. **Implementação A (escopo confirmado pelo PO):** ajustar/validar visão principal sem pagos, renomear/semantizar filtro principal para **Em aberto**, parcial por pagamento parcial/status parcial, atraso operacional por data/saldo, inadimplente visual com 20+ dias, scroll/topo, bloqueio de mês futuro, seletores estáveis e E2E.
2. **Implementação B (dependente de auditoria técnica, sem Supabase direto):** validar a base de cálculo do valor cobrável em contratos bullet/`interest_only` para evitar conflito entre `amount_total`, juros do ciclo e saldo principal. Se precisar de dado real, usar apenas Claude CLI/Claude Code guardião.
3. **Implementação C (apenas após decisão PO/UX adicional):** se o header mobile exigir redesenho além do reset de scroll, tratar em story/ajuste separado para não misturar com a regra de produto da Caderneta.

### 7.1 Visão principal sem pagos

- Em `components/dashboard/CadernetaBullet.tsx`, alterar o estado/filtro inicial para a visão operacional **Em aberto**.
- Substituir a semântica atual de `all` por um filtro que retorne apenas `status IN ('late', 'pending', 'partial')`.
- Manter o filtro **Pagas** retornando exclusivamente `status = 'paid'`.
- Ajustar `counts` para:
  - `open`: total de `late | pending | partial`;
  - `late`: total de atrasadas conforme regra vigente/aprovada;
  - `pending`: total de `pending | partial` conforme regra vigente/aprovada;
  - `paid`: total de `paid`.
- Proposta de copy: trocar o pill `Todas` por **Em aberto** para evitar ambiguidade.
- KPIs: manter consolidados do mês por enquanto, mas deixar claro nos testes/spec que a lista principal é operacional e o KPI pode incluir pagos.

### 7.2 Layout/scroll

- Localizar o container scrollável principal em `App.tsx`.
- Ao mudar para `AppView.CADERNETA_BULLET`, resetar `scrollTop` do `<main>` ou aplicar uma estratégia global de reset por view.
- Garantir que a correção não quebre telas que dependem de scroll preservado.

### 7.3 Navegação mensal

- Ajustar a condição conceitual do botão próximo para desabilitar quando `monthKey >= currentMonthKey`.
- Prevenir também no handler que `nextMonth(monthKey)` ultrapasse o mês corrente.
- Avaliar cálculo do mês corrente com timezone BRT, conforme convenções do projeto.

### 7.4 Atraso operacional e inadimplência visual

- Centralizar o predicado operacional da Caderneta, por exemplo:
  - `isBulletInstallmentOverdue(inst, todayBRT)` = saldo em aberto + `due_date < hoje` em BRT;
  - `isBulletInstallmentDefaulted(inst, todayBRT)` = atraso operacional com `daysLate >= 20`.
- Aplicar o predicado em:
  - contador/filtro **Atraso**;
  - KPI **Em atraso**;
  - ordenação, priorizando inadimplentes e atrasadas;
  - badge visual do card, exibindo **Inadimplente** para `>= 20` dias.
- Não persistir novo status `defaulted`/`inadimplente` em `loan_installments` nesta story.
### 7.5 Card bullet pago/parcial

- Auditar de onde vêm `amount_total`, `amount_interest`, `amount_paid`, `status`, `fine_amount`, `interest_delay_amount`.
- Definir total cobrável correto para bullet no ciclo exibido.
- Ajustar label/badge somente após decisão PO.

### 7.6 Testabilidade

- Adicionar `data-testid`/`data-installment-id` em elementos críticos:
  - raiz da Caderneta
  - botão mês anterior
  - botão próximo mês
  - label do mês
  - filtros
  - cards de parcela
  - KPIs
- Corrigir os testes E2E existentes para não passarem com `|| true`.

---

## 8. Plano de testes

### Testes manuais

1. Mobile: rolar a Home até o atalho e abrir Caderneta Bullet.
2. Confirmar que a tela abre no topo.
3. Confirmar que todos os KPIs iniciais são visíveis sem corte.
4. Confirmar que a lista inicial/principal não mostra cards pagos.
5. Confirmar que o botão/filtro **Pagas** mostra somente cards pagos.
6. Confirmar que o botão próximo está desabilitado no mês corrente.
7. Voltar um mês e retornar ao mês corrente.
8. Alternar filtros Em aberto/Atraso/Pendentes/Pagas.
9. Clicar nos cards e confirmar abertura do detalhe.

### Playwright

- Corrigir `REL-CB-02` para validar de fato o disabled do botão próximo.
- Adicionar teste para visão principal sem pagos e filtro **Pagas** isolando `status = 'paid'`.
- Adicionar teste mobile com viewport estreita e scroll prévio.
- Adicionar teste para presença dos 6 KPIs.
- Adicionar teste para cards via seletor estável.
- Criar cenário controlado com parcelas pagas, pendentes, parciais e atrasadas, se os fixtures já suportarem sem acessar Supabase diretamente.

### Build/checks esperados após implementação futura

- `npm run build`
- `npm run test:e2e -- e2e/reports/caderneta-bullet.spec.ts` ou comando equivalente aceito pelo projeto
- Se existirem scripts adicionais de lint/typecheck no projeto, rodar conforme `AGENTS.md`; caso não existam no `package.json`, registrar ausência.

### Observação sobre quality gates atuais

O `AGENTS.md` exige `npm run lint`, `npm run typecheck` e `npm test`, mas o `package.json` raiz atualmente expõe apenas `build`, `test:e2e`, `test:e2e:ui`, `test:e2e:headed`, `test:e2e:report` e `test:qa`. Na implementação futura, registrar explicitamente essa divergência e não marcar Done sem evidência dos checks realmente disponíveis.

---

## 9. Perguntas de alinhamento para o usuário/PO

### 9.1 Decisões já respondidas pelo PO em 2026-05-27

1. Filtro principal: **Em aberto**.
2. Pagos: saem da visão principal e ficam em **Pagas**.
3. Parcial: cliente pagou parte da parcela ou a parcela está/é parcial.
4. Atraso: não pagou no dia acordado → entra em atraso operacional.
5. Inadimplente: 20 dias de atraso.

### 9.2 Pontos técnicos que a implementação deve validar sem pedir nova decisão de produto

1. Confirmar no código de contratos bullet/`interest_only` qual campo representa o valor cobrável do ciclo exibido (`amount_total`, `amount_interest` ou derivado), antes de ajustar badge/progresso.
2. Confirmar se a correção de scroll/topo resolve a percepção de header duplicado; qualquer redesign além disso deve ser tratado separadamente.
3. Se houver necessidade de validar dados reais do screenshot, usar somente Claude CLI/Claude Code guardião para Supabase, a partir de `/home/guilherme/projetos/e-finance`.

---

## 10. Validação PO da spec

**Checklist de 10 pontos (`.claude/rules/story-lifecycle.md`):**

- Título claro: OK
- Descrição/problema completo: OK
- Critérios testáveis: OK para o escopo confirmado (visão principal sem pagos, Em aberto, parcial, atraso operacional, inadimplente visual, scroll/topo, mês futuro e testes); header mobile além de reset/topo permanece fora do escopo
- Escopo IN/OUT: OK
- Dependências mapeadas: OK
- Complexidade estimada: OK
- Valor de negócio: OK
- Riscos documentados: OK
- Definition of Done: OK
- Alinhamento FR/BR/research: regra de visão principal sem pagos e atraso operacional exige atualização de `BR-REL-012`/`BR-REL-013`; badge/parcial deve respeitar a regra confirmada pelo PO e a lógica técnica de bullet/`interest_only`

**Veredito:** **GO para implementar/validar o escopo confirmado da Caderneta Bullet**, sem tocar em `e-finance-bot` e sem acessar Supabase diretamente. A implementação deve seguir a sequência da seção 7, mantendo `Inadimplente` como camada visual/operacional e validando a lógica específica de valor cobrável em contratos bullet antes de alterar cálculo financeiro. Alterações de header mobile além de reset/topo permanecem fora do escopo desta rodada.

---

## 11. File list

Arquivos lidos/inspecionados para a spec:

- `App.tsx`
- `components/dashboard/CadernetaBullet.tsx`
- `docs/business-rules/e-finance-br.md`
- `docs/requirements/fr.md`
- `e2e/reports/caderneta-bullet.spec.ts`
- `e2e/fixtures/e2e-test-helpers.ts`
- `package.json`
- `AGENTS.md`
- `.claude/rules/story-lifecycle.md`
- `.claude/rules/workflow-execution.md`
- `docs/stories/HIST-001-ux-late-auto-history.story.md`
- `docs/stories/HIST-002-dev-late-auto-implementation.story.md`

Arquivos criados/modificados nesta etapa:

- `docs/stories/CB-001-po-caderneta-bullet-mobile-bugs.story.md`
- `docs/business-rules/e-finance-br.md`

---

## QA Results

**Gate:** Quinn (@qa) — 2026-05-27
**Verdict:** **CONCERNS** — spec drift detectado; fixes principais já implementadas em código local (untracked), pendentes commit + deploy. Validação MCP Supabase concluída. Validação visual Playwright pendente execução (arquivos criados, requer `npm run preview` rodando).

---

### Findings

#### 1. Spec drift — BLOQUEADOR para fechar gate sem refatoração da spec

Audit do código local (`CadernetaBullet.tsx`, `App.tsx`, `e2e/reports/caderneta-bullet.spec.ts`) revelou que `@dev` já implementou todas as correções principais. A spec CB-001 (seções 1.2 / 3) descreve os bugs como se ainda existissem no código — isso configura **spec drift** e impede o gate final até que `@po` refatore a spec.

O que já está implementado localmente (todos os arquivos `untracked` em `git status`):

| Bug | O que a spec dizia | Estado real do código |
|-----|--------------------|-----------------------|
| Bug 0 — filtro padrão | `statusFilter inicia em 'all'` | `useState<StatusFilter>('open')` em `CadernetaBullet.tsx:269` |
| Bug 0 — filtro "Todas" | `filteredInstallments retorna tudo` | `isOperationallyOpen` exclui `paid` em linhas 159-161 e 381-387 |
| Bug 0 — contador "todas" | chave `todas` presente nos counts | `counts` sem chave `todas` — apenas `open/late/pending/paid` (linhas 390-395) |
| Bug 2 — botão próximo | `disabled={isFuture}` com `>` | `disabled={isCurrentOrFuture}` com `>=` (linhas 271, 437) |
| Bug 3 — tautologia no teste | `expect(isDisabled !== null \|\| true).toBeTruthy()` | `await expect(nextBtn).toBeDisabled()` real em `e2e/reports/caderneta-bullet.spec.ts:60,67` |
| Bug 1 — scroll reset | sem tratamento | `App.tsx:156-160` reseta `scrollTop` ao entrar em `AppView.CADERNETA_BULLET` |
| Bug 4 — atraso operacional | sem lógica de data | `getOperationalStatus` em `CadernetaBullet.tsx:147-157`; `DEFAULTED_AFTER_DAYS=20` |

**Ação requerida:** `@po` refatora seções 1.2 / 3 / 7 / 10 / 11 da spec para refletir o estado real do código antes do gate final.

---

#### 2. Arquivos untracked — BLOQUEADOR para atender o cliente

`git status` em 2026-05-27 mostra todos os arquivos com correções como `??` (untracked). O repositório tem apenas 2 commits (`a98b178`, `109d752` — smart debtor search).

Arquivos untracked relevantes para esta story:
- `App.tsx`
- `components/dashboard/CadernetaBullet.tsx`
- `e2e/reports/caderneta-bullet.spec.ts`
- `docs/business-rules/e-finance-br.md`
- `docs/stories/CB-001-po-caderneta-bullet-mobile-bugs.story.md`
- `e2e/qa-validation/caderneta-bullet-mock.spec.ts` (criado neste gate)
- `e2e/qa-validation/fixtures/cb-001-screenshot.json` (criado neste gate)

David Aquino continua vendo a versão antiga em produção enquanto os arquivos não forem commitados e deployados.

**Ação requerida:** `@dev` commita em commits semânticos → `@devops` push + deploy.

---

#### 3. Validação MCP Supabase — CONCLUÍDA

Queries executadas contra o banco real do tenant **MD Veículos** (`tenant_id = 5e0473c9-b912-4ac3-a144-d9211bcf137d`) em 2026-05-27:

**Parcelas bullet de maio/2026 — estado atual do banco:**

| Devedor | `due_date` | `status` | `amount_paid` | `amount_total` | `amount_interest` |
|---------|-----------|---------|--------------|----------------|-------------------|
| Fabio | 2026-05-05 | paid | 100 | 600 | 100 |
| Foguinho | 2026-05-06 | paid | 2400 | 2400 | 400 |
| Claudia | 2026-05-08 | paid | 360 | 360 | 60 |
| Rafael | 2026-05-08 | paid | 708 | 708 | 118 |
| Rodrigo | 2026-05-25 | paid | 400 | 400 | 0 |

**Observação crítica:** no momento do screenshot de David Aquino (~2026-05-25), Rodrigo estava `pending`. Em 2026-05-27, todos os 5 estão `paid`. Após o deploy, David verá **0 cards em "Em aberto"** para maio/2026 — comportamento correto para o mês corrente.

**Verificação de bug 5 (parcial):** Fabio tem `amount_paid=100 < amount_total=600`. Porém, `getCycleAmountDue` usa `amount_interest=100` para contratos `interest_only` — não `amount_total`. `outstanding = max(0, 100-100) = 0` → classificado corretamente como `paid`. A barra de progresso 17% (100/600) é confusão visual cosmética, não erro de classificação. **Bug 5 não é bug — é comportamento esperado da lógica `interest_only`.**

**Verificação de bug 4 (atraso sem `status='late'`):** nenhuma parcela com `due_date < hoje` e status não pago encontrada. Sem casos de atraso operacional não persistido no momento da validação.

**Verificação RLS/security:** `get_advisors(type='security')` executado — output inconclusive (excedeu limite de token). Não há evidência de violação, mas verificação não foi possível completar neste gate.

---

#### 3b. Validação visual Playwright + mock — **11/11 PASSANDO** (2026-05-27)

**Resultado atualizado:** `11 passed (28.1s)` — todos os 8 cenários CB-MOCK passaram + 3 setup após correção do mock Rodrigo.

| Cenário | Resultado | Evidência |
|---------|-----------|-----------|
| CB-MOCK-01 — Filtro "Em aberto" padrão mostra Rodrigo com juros corretos | ✅ PASS | `docs/qa/cb-001-evidence/CB-MOCK-01.png` |
| CB-MOCK-02 — Filtro "Pagas" mostra 4 cards | ✅ PASS | `docs/qa/cb-001-evidence/CB-MOCK-02.png` |
| CB-MOCK-03 — Filtro "Atraso" mostra Rodrigo com `amount_interest = R$ 80,00` | ✅ PASS | `docs/qa/cb-001-evidence/CB-MOCK-03.png` |
| CB-MOCK-04 — Próximo mês desabilitado (BR-REL-011) | ✅ PASS | `docs/qa/cb-001-evidence/CB-MOCK-04.png` |
| CB-MOCK-05 — Prev/next coerentes | ✅ PASS | `docs/qa/cb-001-evidence/CB-MOCK-05.png` |
| CB-MOCK-06 — Badge PARCIAL para pagamento parcial (Bug 5) | ✅ PASS | `docs/qa/cb-001-evidence/CB-MOCK-06.png` |
| CB-MOCK-07 — Atraso operacional sem `status='late'` vira inadimplente visual com 20+ dias | ✅ PASS | `docs/qa/cb-001-evidence/CB-MOCK-07.png` |
| CB-MOCK-08 — Scroll reset ao trocar view (Bug 1) | ✅ PASS | `docs/qa/cb-001-evidence/CB-MOCK-08.png` |

**Achados visuais confirmados:**
- CB-MOCK-01: tela abre com `1 EM ABERTO` selecionado; Rodrigo aparece com `R$ 80,00`, badge `ATRASADO`, `1 ATRASO`, `0 PENDENTES`, `4 PAGAS`.
- CB-MOCK-02: filtro `4 PAGAS` exibe Fabio, Foguinho, Claudia, Rafael — todos com badge `PAGO`.
- CB-MOCK-03: filtro `ATRASO` exibe Rodrigo; o mock não renderiza mais `R$ 0,00` para contrato `interest_only` com saldo 400 e taxa 20%.
- CB-MOCK-06: Card do Fabio com `Pago R$ 50,00`, barra de progresso 50%, badge `PARCIAL`. Bug 5 — componente já suporta corretamente.
- CB-MOCK-07: Rodrigo com `due_date` antiga e `status=pending` aparece como `INADIMPLENTE`, confirmando atraso operacional independente do status persistido.
- CB-MOCK-08: `scrollTop === 0` confirmado após troca de view com scroll prévio.

**Fix aplicado em CB-MOCK-06:** `due_date` precisa permanecer sem atraso operacional para `getOperationalStatus` retornar `'partial'`; o cenário usa `2026-05-31` no mês do fixture.

**Conclusão Fase 1.5:** mock corrigido para a regra `interest_only`: `amount_interest = remaining_balance * interest_rate / 100`, `installment_value = amount_interest` e `amount_total = principal + juros`. Deploy continua apto (pendente apenas commit + push de `@dev`/`@devops`).

---

#### 4. Bugs ainda em aberto

| Bug | Status | Detalhes |
|-----|--------|---------|
| Bug 5 — badge "PAGO" com pagamento parcial cosmético | **Não é bug** — ver Finding 3 acima | `amount_interest` é o valor cobrável em `interest_only`; `amount_total` inclui principal que não vence no ciclo |
| Bug 6 — header duplicado mobile | **Em aberto (P2)** | `App.tsx:172` define label global "Caderneta Bullet" + `CadernetaBullet.tsx:411-413` renderiza `<h2>` interno — pendente decisão UX |

---

### Risk Profile

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Deploy sem commit dos arquivos untracked | A | A — cliente não vê fix | `@dev` commita antes de `@devops` push |
| Spec drift recorrente em futuras stories | A | M — retrabalho de gate | Spec-Driven Mode adicionado ao `CLAUDE.md` neste gate |
| Cliente reportar novamente após deploy (mês atual sem abertos) | B | M — confusão de UX | Smoke manual com David Aquino + orientar sobre filtro "Pagas" |
| Playwright CB-MOCK-06/07 falhar na execução | ~~M~~ **RESOLVIDO** | ~~A — Bug 4/5 não resolvidos~~ | 11/11 passando em 2026-05-27 |
| Verificação RLS incompleta | B | A — segurança | Rodar `get_advisors` em sessão dedicada antes do deploy |

---

### NFR Snapshot

- **Performance:** OK — `filteredInstallments` e `counts` são `useMemo` com complexidade O(n) por filtro.
- **Security:** Validação RLS incompleta neste gate (inconclusive). Verificar antes do deploy.
- **Reliability:** Suíte `REL-CB-01..07` em `e2e/reports/caderneta-bullet.spec.ts` cobre os fluxos principais. Suíte visual mock `CB-MOCK-01..08` **executada e passando** (11/11, 2026-05-27).
- **Observability:** Sem logs/telemetria nova nesta story — aceitável para o escopo.
- **Accessibility:** `data-testid` implementados em filtros, cards, KPIs e navegação mensal.

---

### Next Actions

1. ~~**`@qa` (imediato):** subir preview e executar `npm run test:e2e -- e2e/qa-validation/caderneta-bullet-mock.spec.ts`; atualizar este bloco com resultado dos 8 cenários.~~ **CONCLUÍDO** — 11/11 passando, screenshots em `docs/qa/cb-001-evidence/`.
2. **`@po` (imediato):** refatorar seções 1.2 / 3 / 7 / 10 / 11 da spec (ver Finding 1) para refletir estado real do código — corrigir spec drift antes do gate final.
3. **`@dev`:** commitar arquivos untracked em commits semânticos: `feat(caderneta-bullet)`, `test(caderneta-bullet)`, `docs(br)`, `docs(story)`.
4. **`@devops`:** push + deploy após commit de `@dev`.
5. **`@qa` (pós-deploy):** smoke manual — David Aquino abre Caderneta Bullet em 05/2026, confirma que visão "Em aberto" está vazia (todos pagos), e que "Pagas" lista os 5 cards. Gate fecha como `PASS` ou `CONCERNS` final.

---

*— Quinn, guardião da qualidade 🛡️*
