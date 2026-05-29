# CB-003 — [SPEC] Bullet: taxa de quebra, inadimplência configurável e encerramento ao quitar

**Agente:** @sm (draft) / @po (validar) / @data-engineer (schema/RPC) / @dev (impl) / @qa (gate) / @devops (deploy)
**Status:** Ready — GO do PO (usuário) em 2026-05-28 para o escopo das §3-§4; schema/RPC pendentes de aprovação explícita do guardião antes do apply
**Criada em:** 2026-05-28
**Origem:** Decisões de produto do usuário (sessão Telegram/Hermes 2026-05-28) + validação de dados reais via MCP Supabase (2026-05-28, este turno)
**Área:** Contratos bullet / `calculation_mode = 'interest_only'`
**Arquivos candidatos:** `utils/financials.ts`, `components/AdminContracts.tsx`, `components/QuickContractInput.tsx`, `components/dashboard/CadernetaBullet.tsx`, `components/AdminHome.tsx`, `types.ts`, RPC `pay_bullet_interest_only`, schema `investments`

---

## 1. Contexto

O cliente relatou que "contratos bullet estão bugando". A investigação (CB-001, já em produção) corrigiu a **visão operacional** da Caderneta. Esta story trata da **evolução das regras de contrato bullet** definidas pelo usuário, restritas ao que ainda **não existe** no código.

Princípio spec-driven: cada item abaixo rastreia a uma decisão do usuário ou a uma divergência comprovada com dados reais. Nada que já está implementado é reescrito.

---

## 2. Estado REAL validado (BR Gate — 2026-05-28)

### 2.1 Já existe em produção (`origin/main` @ `ba22b41`) — NÃO reimplementar

| Capacidade | Evidência no código / banco |
|---|---|
| Ciclo `interest_only` cobra juros do período | `calculateFinancials` (`utils/financials.ts:99-108`): `installmentValue = base × rate/100`, `totalValue = base + juros`. Validado: contrato 1224 `20000 × 2,2% = 440`. |
| Base rotativa = saldo devedor | coluna `investments.remaining_balance` ("Saldo devedor atual do bullet rotativo; NULL = não-bullet"). |
| Capitalização de juros não pago | coluna `investments.capitalize_interest` (TRUE: juros não pago soma ao saldo; FALSE: vira multa separada). 24/27 bullets ativos capitalizam. |
| Juros junto/separado do principal | coluna `investments.bullet_principal_mode` (`together`/`separate`). |
| Pagamento parcial | `loan_installments.status = 'partial'`. Validado: contrato 1224 parcela 1 `amount_paid=220` de `440` → `partial`. |
| Renovação de contrato | `ContractRenewalModal` + subview `renewal` em `AdminContracts.tsx`; tabela `contract_renegotiations` (82 linhas). |
| Status de encerramento existe | `investments.status` aceita `active` (176) e `completed` (82). |
| Inadimplência visual após 20 dias | `INADIMPLENTE_THRESHOLD_DAYS = 20` (`AdminHome.tsx:195`), `DEFAULTED_AFTER_DAYS` (CadernetaBullet) — camada visual de CB-001. |
| RPC de pagamento bullet | `pay_bullet_interest_only`. |

### 2.2 Divergências / gaps comprovados com dados reais

| # | Gap | Evidência real |
|---|---|---|
| G1 | **Taxa de quebra de contrato não existe** | Nenhuma coluna `break_fee`/`quebra` em `investments`; nenhuma lógica no código. |
| G2 | **Prazo de inadimplência é fixo (20d) e não configurável** | `INADIMPLENTE_THRESHOLD_DAYS = 20` hardcoded; sem campo no schema. |
| G3 | **Multa pós-inadimplência não é aplicada de forma consistente** | 10 parcelas bullet vencidas com saldo; **6 já com 20+ dias**, mas **só 1 tem `fine_amount > 0`** e 1 com `interest_delay_amount > 0`. |
| G4 | **Encerramento existe, mas escapa em casos legados** | **Correção 2026-05-28:** `process_bullet_payment` JÁ encerra (`status='completed'` quando `remaining_balance <= 0.01`), capitaliza juros e gera próxima parcela. `pay_bullet_interest_only` NUNCA encerra (`contract_closed:false` fixo) — por design, "só juros" rola pra sempre. Foguinho(632)/Leonice(633): principal totalmente pago (2000/1000) mas `remaining_balance = NULL` → fora da condição `<= 0.01` → ficaram `active`. |

> Correção do BR Gate: G4 NÃO é "encerramento ausente". A lógica existe em `process_bullet_payment`. O gap real é: (a) contratos com `remaining_balance = NULL` (não inicializado) nunca entram na condição de encerramento; (b) o fluxo "só juros" (`pay_bullet_interest_only`) nunca encerra mesmo quando não há mais principal a cobrar. Escopo G4 ajustado na §4.

---

## 3. Regras de negócio (decisões do usuário — 2026-05-28)

- **BR-BUL-020 (Taxa de quebra):** opcional, definida na criação do contrato bullet, a critério do usuário. Calculada como **percentual sobre o saldo devedor** (`remaining_balance`) no momento da quebra/quitação antecipada. Se não definida, contrato não tem taxa de quebra. **Decisão 2026-05-28: ao quebrar, gera transação/parcela cobrável no banco** (não é só registro) — afeta saldo/relatórios.
- **BR-BUL-021 (Prazo de inadimplência configurável):** cada contrato define seu próprio prazo em dias (**padrão 20**, via coluna com `DEFAULT 20` — cobre os 27 contratos existentes). Enquanto `dias_atraso < prazo`: parcela "em atraso". A partir de `dias_atraso >= prazo`: contrato/parcela "inadimplente", **e só então a multa é aplicada**.
- **BR-BUL-022 (Encerramento ao quitar):** quando o cliente paga o total devido do ciclo e o saldo devedor zera, o contrato é quitado/encerrado (`status='completed'`). Deve existir opção **opcional** de renovar (já coberta por `ContractRenewalModal`). **Decisão 2026-05-28: incluído nesta story** — ajuste no RPC `pay_bullet_interest_only`.
- **BR-BUL-023 (Não pagamento):** parcela não paga até o vencimento → "atrasado"; ao atingir o prazo (BR-BUL-021) → "inadimplente". Juros não pago capitaliza no saldo conforme `capitalize_interest` (já existente).
- **BR-BUL-024 (Multa de inadimplência):** **Decisão 2026-05-28: percentual sobre o saldo devedor** (`remaining_balance`), aplicado quando `dias_atraso >= default_after_days`. O valor calculado é persistido em `loan_installments.fine_amount` (reutiliza campo existente). O percentual é configurável por contrato.
  - **Mecanismo VALIDADO (não inventado):** a aplicação segue o padrão existente da BR-PAG-021 — o cron `update_overdue_installments()` (pg_cron jobid 1, diário 03:05 UTC) já marca `pending → late` e registra `late_auto`. G3 **estende essa mesma função** com um passo que aplica a multa em parcelas bullet inadimplentes. Idempotente (só aplica se `fine_amount` ainda zerado).

---

## 4. Escopo IN (todas as decisões fechadas em 2026-05-28)

1. **Taxa de quebra (G1):**
   - Nova coluna `investments.break_fee_percent numeric NULL` (percentual; NULL = sem taxa).
   - Campo opcional no form de criação bullet (`AdminContracts.tsx`, e `QuickContractInput.tsx` se aplicável).
   - Cálculo ao quebrar/quitar antecipadamente = `remaining_balance × break_fee_percent/100`.
   - **Gera transação/parcela cobrável** no banco (BR-BUL-020).
2. **Prazo de inadimplência configurável (G2):**
   - Nova coluna `investments.default_after_days integer NOT NULL DEFAULT 20` (fallback global cobre contratos existentes).
   - Campo opcional no form de criação bullet (padrão 20).
   - Substituir o uso de `INADIMPLENTE_THRESHOLD_DAYS`/`DEFAULTED_AFTER_DAYS` fixo pelo valor do contrato.
3. **Multa pós-inadimplência (G3 / BR-BUL-024):** nova coluna `investments.late_fine_percent numeric NULL` (percentual sobre saldo). Quando `dias_atraso >= default_after_days`, calcular `remaining_balance × late_fine_percent/100` e persistir em `loan_installments.fine_amount`.
4. **Encerramento ao quitar (G4 / BR-BUL-022):** a lógica já existe em `process_bullet_payment`. Escopo desta story = fechar os casos que escapam:
   - normalizar `remaining_balance` ao criar contrato bullet (não deixar NULL quando há principal), para que a condição de encerramento `<= 0.01` funcione;
   - garantir que o fluxo de quitação total da UI roteie para `process_bullet_payment` (que encerra), não para `pay_bullet_interest_only` (que rola);
   - backfill opcional (com aprovação) dos contratos legados quitados que ficaram `active` (ex: Foguinho/Leonice).

---

## 6. Escopo OUT

- Não alterar a visão operacional da Caderneta (CB-001, já entregue) além de consumir os novos campos.
- Não mudar regras de contratos não-bullet (`auto`/`manual`).
- Não retroagir/backfill em contratos existentes sem decisão explícita (ex: encerrar Foguinho/Leonice manualmente).
- Não tocar em `e-finance-bot`.

---

## 7. Mudanças por camada (proposta)

| Camada | Mudança | Gate |
|---|---|---|
| **Schema** | `ALTER TABLE investments ADD break_fee_percent numeric NULL, ADD default_after_days integer NOT NULL DEFAULT 20, ADD late_fine_percent numeric NULL` | **Guardião Supabase: aprovação explícita antes do apply** |
| **RPC** | Nova função/ajuste para cobrança da taxa de quebra como transação (G1); lógica de multa por `default_after_days` (G3). G4: NÃO mexer na lógica de encerramento já correta de `process_bullet_payment`; apenas normalizar `remaining_balance` na criação + rotear quitação total para `process_bullet_payment` + backfill legado opcional | Guardião Supabase |
| **types.ts** | adicionar `break_fee_percent?`, `default_after_days?`, `late_fine_percent?` em `Investment` | @dev |
| **Form criação** | `AdminContracts.tsx` (+ `QuickContractInput.tsx`): campos opcionais bullet (taxa quebra %, prazo inadimplência dias, multa %) | @dev |
| **UI/cálculo** | `utils/financials.ts` e telas que mostram inadimplência usam `default_after_days` do contrato | @dev |

---

## 8. Critérios de aceite

- [ ] Schema: `investments` possui `break_fee_percent` (nullable) e `default_after_days` (default 20), aplicados via guardião com aprovação explícita.
- [ ] Form de criação bullet permite definir taxa de quebra (%) opcional e prazo de inadimplência (dias, padrão 20).
- [ ] Contrato criado sem taxa de quebra → `break_fee_percent` NULL e nenhuma cobrança de quebra.
- [ ] Ao quebrar/quitar antecipadamente um contrato com taxa, o valor exibido = `remaining_balance × break_fee_percent/100`.
- [ ] A inadimplência (visual e aplicação de multa) usa `default_after_days` do contrato, não a constante fixa.
- [ ] Parcela com `dias_atraso >= default_after_days` é classificada inadimplente e tem a multa aplicada conforme BR confirmada.
- [ ] (Condicional G4) Bullet totalmente quitado passa a `status='completed'`; opção de renovar permanece disponível.
- [ ] `npm run build` passa.
- [ ] Validação com dados reais via MCP Supabase pós-implementação (não só E2E sintético).
- [ ] Nada deployado sem commit em `main` + push por @devops.

---

## 9. Decisões de alinhamento (PO — resolvidas 2026-05-28)

1. **Multa pós-inadimplência (G3):** ✅ percentual sobre o **saldo devedor** (`remaining_balance`); valor persistido em `loan_installments.fine_amount`. Percentual configurável por contrato (`late_fine_percent`).
2. **Encerramento G4:** ✅ **incluído nesta story** (ajuste no RPC `pay_bullet_interest_only`).
3. **Taxa de quebra:** ✅ **gera transação/parcela cobrável** no banco.
4. **Prazo de inadimplência:** ✅ coluna com `DEFAULT 20` (fallback global automático para contratos existentes).

### Pendência operacional (não bloqueia spec)
- Definir se a multa (G3) é **prospectiva apenas** ou retroativa às 6 parcelas já 20+ dias. Recomendação: prospectiva, para evitar cobrança inesperada (ver Risco em §10).

---

## 10. Riscos

- **Alto:** mudança em `pay_bullet_interest_only` (RPC financeiro) pode afetar baixas em produção — exige validação real e guardião.
- **Médio:** migration adiciona colunas; default em `default_after_days` deve cobrir 27 contratos bullet ativos sem quebrar a regra atual.
- **Médio:** aplicar multa automática retroativa nas 6 parcelas já inadimplentes pode gerar cobrança inesperada — definir se é prospectivo apenas.

---

## 11. Validação real executada (MCP Supabase — 2026-05-28)

- 27 contratos `interest_only` ativos; 25 com `remaining_balance`; 24 capitalizam juros; taxa média 14,17%; saldo total R$ 84.790.
- Ciclo confirmado: contrato 1224 (`Capital Fixo Carlos`) `20000 × 2,2% = 440`.
- Encerramento ausente: Foguinho/Leonice quitados mas `active` (G4).
- Inadimplência: 10 parcelas bullet vencidas com saldo, 6 com 20+ dias, só 1 com multa (G3).
- `investments.status`: `active` 176 / `completed` 82 (nenhum bullet `completed`).

---

## 12. File list

Lidos/inspecionados:
- `utils/financials.ts`, `components/AdminContracts.tsx`, `components/QuickContractInput.tsx`, `components/dashboard/CadernetaBullet.tsx`, `components/AdminHome.tsx`, `types.ts`, `context/database_schema.md`
- Schema real via `mcp__supabase__list_tables`; dados reais via `mcp__supabase__execute_sql`

Criados nesta etapa:
- `docs/stories/CB-003-bullet-quebra-inadimplencia-encerramento.story.md`

---

## 13. Change Log (implementação)

- **2026-05-28 — Schema:** migration `cb003_bullet_break_fee_inadimplencia` aplicada via guardião (aprovação explícita do usuário). Colunas `break_fee_percent`, `default_after_days` (DEFAULT 20), `late_fine_percent` em `investments`. Validado: 27 bullets ativos com prazo 20.
- **2026-05-28 — Frontend:** `types.ts` (3 campos em `Investment`); `components/AdminContracts.tsx` (campos no form bullet + persistência via update pós-`create_investment_validated`). `npm run build` e `tsc --noEmit` PASS.
- **2026-05-28 — G3 (cron):** migration `cb003_g3_late_fine_in_overdue_cron` aplicada via guardião (aprovação explícita). Estende `update_overdue_installments()` com passo de multa de inadimplência (bullet, `late_fine_percent`, `dias_atraso >= default_after_days`, idempotente). Validado: passo presente, 0 contratos afetados (efeito retroativo nulo).
- **2026-05-28 — G4 (validado, já implementado):** `create_investment_validated` JÁ inicializa `remaining_balance = amount_invested` para bullet; `process_bullet_payment` JÁ encerra (`status='completed'`) ao zerar saldo. Residual = backfill opcional de 2 contratos legados (Foguinho 632 / Leonice 633) com `remaining_balance=NULL` quitados. **Não requer nova implementação além do backfill opcional.**
- **2026-05-28 — G1 (config pronta; gatilho de cobrança em aberto):** `break_fee_percent` persistido (coluna + form). **Achado BR Gate:** o app NÃO possui ação de "quebrar/encerrar contrato antecipadamente". O único encerramento existente é o de pagamento que excede a dívida (`InstallmentModals.tsx` step `overpayment`), que não é uma quebra. Cobrar a taxa exige definir/criar o gatilho (decisão de produto — não inventar). Ver §9 pendência.
- **2026-05-28 — G1 decisão PO:** cobrança DEFERIDA para story futura; CB-003 entrega apenas a config (`break_fee_percent` persistível).
- **2026-05-28 — `QuickContractInput.tsx`:** N/A — valida que ele só cria contratos `manual` (`p_calculation_mode: 'manual'`), nunca bullet. Nenhuma mudança necessária.

---

## 14. Resultados da validação (2026-05-28)

| Teste | Resultado |
|---|---|
| `npm run build` (vite) | ✅ PASS (exit 0) |
| `npx tsc --noEmit` | ✅ PASS (exit 0) |
| Migration colunas (tipos/default) | ✅ `break_fee_percent` nullable, `default_after_days` NOT NULL DEFAULT 20, `late_fine_percent` nullable; 27 bullets ativos com prazo 20 |
| G3 lógica (espelho sem mutação, dados reais) | ✅ 5/6 parcelas inadimplentes qualificam; a 6ª (já com `fine_amount=10`) excluída → idempotência OK; fórmula `saldo×%` correta |
| G3 end-to-end (função real, BEGIN/ROLLBACK) | ✅ cron aplicou `fine_amount=5.00` em cenário 5%; ROLLBACK verificado — 0 resíduo em prod |
| Persistência do form (UPDATE 3 colunas, ROLLBACK) | ✅ colunas aceitam 3.5/30/8; ROLLBACK verificado limpo |
| Regressão cron (4 passos originais) | ✅ passos late/partial/reneg×2 intactos + passo G3 |
| `updateFormState` merge + tipos | ✅ merge correto; campos type-válidos |
| Security advisors (pós-DDL) | ✅ ZERO advisory novo do CB-003; `ERROR` pré-existente (`security_definer_view`/`bot_turn_traces`) não relacionado |
| **E2E/visual (UI ao vivo)** | ⚠️ **NÃO executado** — sem `.env.local` (credenciais Supabase de teste). Data path validado; renderização visual do form não testada automaticamente. |

