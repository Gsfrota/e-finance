# CB-008 — [FIX] Inconsistências do formulário bullet: preview, sentinela, freelancer, current_value

**Agente:** @dev (impl UI + RPC) / @qa (gate) / @devops (push)
**Status:** Draft
**Criada em:** 2026-05-29
**Origem:** Análise estática do form + smoke test — 5 problemas identificados
**Epic:** Caderneta Bullet (CB)
**Prioridade:** Alta — bugs 1, 2 e 3 podem causar configuração silenciosamente errada pelo admin

---

## 1. Contexto para implementação

### Arquivos-chave (ler antes de codar)

| Arquivo | Relevância |
|---|---|
| `components/AdminContracts.tsx:459,967,1081-1140,1190-1210,1358-1390,1435-1488` | Form bullet: sentinela, modo, frequência, preview |
| `utils/financials.ts:85-127` | `calculateFinancials` — `totalValue` para `interest_only` |
| `components/dashboard/CadernetaBullet.tsx:268-275` | Guard CB-001 navegação futura |
| Supabase prod: `generate_next_bullet_installment` | RPC que gera próxima parcela bullet — já em prod |

### Estado atual das variáveis de form (para referência)

```typescript
// AdminContracts.tsx — estado inicial
const [formData, setFormData] = useState({
  calculation_mode: 'auto',       // 'auto' | 'manual' | 'interest_only'
  total_installments: 12,
  frequency: 'monthly',           // 'monthly' | 'weekly' | 'daily' | 'freelancer'
  bullet_principal_mode: 'together',
  capitalize_interest: true,
  break_fee_percent: '',
  default_after_days: 20,
  late_fine_percent: '',
  // ...
});

const [bulletHasFixedDuration, setBulletHasFixedDuration] = useState(false);
// Quando interest_only + indeterminado → total_installments = 120 (sentinel)
// Quando interest_only + determinado  → total_installments = N (1–120)
```

### RPC `generate_next_bullet_installment` — lógica de frequência (prod)

```sql
-- Para next_due quando já há histórico de parcelas:
IF v_inv.frequency = 'monthly' THEN
  v_next_due := -- próximo mês no mesmo due_day
ELSIF v_inv.frequency = 'weekly' THEN
  v_next_due := (v_last_inst.due_date + INTERVAL '7 days')::DATE;
ELSE  -- ← 'daily' E 'freelancer' caem aqui: +1 dia
  v_next_due := (v_last_inst.due_date + INTERVAL '1 day')::DATE;
END IF;
```

---

## 2. Bugs a corrigir (5 itens)

---

### BUG-1 — Sentinela `>= 100` conflita com bullet determinado 100+ períodos `[HIGH]`

**Arquivo:** `AdminContracts.tsx:459, 1358, 1386`

**Problema:** O sentinel para "indeterminado" é `total_installments = 120`. O check de detecção usa `>= 100`:

```javascript
// atual — ERRADO
const isBulletIndeterminate =
  merged.calculation_mode === 'interest_only' && merged.total_installments >= 100;
```

Bullet semanal de 2 anos = 104 períodos. Admin escolhe "Determinado", digita 104 → `isBulletIndeterminate = true` → no modo freelancer só 1 data é gerada, preview e submit quebram silenciosamente.

**Fix:** Substituir as 3 ocorrências pelo estado real do usuário:

```javascript
// correto
const isBulletIndeterminate =
  formData.calculation_mode === 'interest_only' && !bulletHasFixedDuration;
```

Nos 3 lugares (linhas 459, 1358, 1386), trocar `merged.total_installments >= 100` por `!bulletHasFixedDuration`.

**Atenção linha 459:** `merged` vem do `updateFormState`, que não tem acesso a `bulletHasFixedDuration` diretamente. Solução: passar `bulletHasFixedDuration` como parâmetro de `updateFormState`, ou mover o check para fora da função (nos callers já temos acesso ao state).

---

### BUG-2 — Frequência "Livre" permitida para bullet mas RPC gera +1 dia `[HIGH]`

**Arquivo:** `AdminContracts.tsx:1190-1210` (seletor de frequência)

**Problema:** O form exibe as 4 frequências para qualquer modo de contrato. Para `interest_only`, ao selecionar "Livre" e pagar a parcela, o `generate_next_bullet_installment` usa o `ELSE` branch e gera `last_due_date + 1 dia` — ignora completamente as datas customizadas do form freelancer.

**Fix:** Ocultar o botão "Livre" quando `calculation_mode === 'interest_only'`:

```tsx
// AdminContracts.tsx — seletor de frequências (linha ~1192-1210)
{[
  { id: 'monthly', label: 'Mensal', icon: Calendar },
  { id: 'weekly',  label: 'Semanal', icon: CalendarDays },
  { id: 'daily',   label: 'Diário',  icon: CalendarClock },
  // Só mostra 'Livre' para contratos não-bullet:
  ...(formData.calculation_mode !== 'interest_only'
    ? [{ id: 'freelancer', label: 'Livre', icon: Zap }]
    : []),
].map(opt => (
  // ... botão existente
))}
```

Adicionar também: se `calculation_mode` mudar para `interest_only` enquanto `frequency === 'freelancer'`, forçar `frequency` de volta para `'monthly'`:

```javascript
// em updateFormState, quando calculation_mode muda para interest_only:
if (partial.calculation_mode === 'interest_only' && merged.frequency === 'freelancer') {
  merged.frequency = 'monthly';
}
```

---

### BUG-3 — Preview bullet DETERMINADO omite que principal é cobrado no settlement `[HIGH]`

**Arquivo:** `AdminContracts.tsx:1435-1488`

**Problema:** Para bullet determinado, o preview exibe N linhas iguais com `installmentValue` (só os juros), sem indicar que o principal é cobrado separadamente no settlement. Admin configura esperando N cobranças iguais, mas na prática é (N-1) cobranças de juros + 1 settlement com principal + juros.

**Código atual problemático (linha 1436-1464):**
```tsx
{previewDateStrings.length > 0 && !(formData.calculation_mode === 'interest_only' && !bulletHasFixedDuration) && (
  <div>
    <span>Preview das {previewDateStrings.length} parcelas</span>
    <span>{formatCurrency(formData.installment_value)} cada</span>  {/* ← só os juros */}
    {/* ... N linhas com o mesmo valor */}
  </div>
)}
```

**Fix:** Para bullet determinado, substituir o preview padrão por um específico que:
1. Mostra as primeiras (N-1) datas com label "Só juros — R$ X"
2. Adiciona a última linha com label diferenciado "Quitação — R$ (principal + juros)"
3. Ou, mais simples: adicionar banner de aviso logo abaixo do preview existente

**Opção A (banner — menor risco):**
```tsx
{previewDateStrings.length > 0 && formData.calculation_mode === 'interest_only' && bulletHasFixedDuration && (
  <div className="rounded-xl border border-[color:var(--accent-caution-border)] bg-[color:var(--accent-caution-bg)] px-4 py-3 mt-2">
    <p className="text-xs text-[color:var(--accent-caution)] font-semibold">
      ⚠️ As {previewDateStrings.length} cobranças acima são apenas os juros
      ({formatCurrency(formData.installment_value)}/período).
      O saldo de {formatCurrency(formData.amount_invested)} é cobrado
      na quitação (botão "Receber" na Caderneta Bullet).
    </p>
  </div>
)}
```

**Opção B (última linha diferenciada — mais preciso, mais trabalho):**
Renderizar as N-1 primeiras linhas com `installment_value` e a última com `installment_value + amount_invested`.

**Implementar opção A** (menor risco de regressão, suficiente para orientar o admin).

---

### BUG-4 — `current_value` exibido como "Valor do Contrato" para bullet (semântica errada) `[MEDIUM]`

**Arquivo:** `utils/financials.ts:99-108`

**Problema:**
```javascript
if (mode === 'interest_only') {
  const interestPerPeriod = roundCurrency(base * (r / 100));
  return {
    installmentValue: interestPerPeriod,
    totalValue: roundCurrency(base + interestPerPeriod),  // ← principal + 1 período de juros
    interestRate: r
  };
}
```

Para bullet R$1.000 a 10% mensal: `current_value = R$ 1.100` (principal + 1 mês de juros). Esse valor é persistido em `investments.current_value` e exibido como "Valor do Contrato" na lista de contratos e em relatórios — subestimando ou distorcendo o valor real do contrato de prazo longo.

O campo correto para bullet é `remaining_balance` (o saldo devedor atual).

**Fix A — `financials.ts`:** Para `interest_only`, retornar `base` como `totalValue` (o principal é o "valor real" do contrato):
```javascript
if (mode === 'interest_only') {
  const interestPerPeriod = roundCurrency(base * (r / 100));
  return {
    installmentValue: interestPerPeriod,
    totalValue: base,   // ← principal = valor real do contrato bullet
    interestRate: r
  };
}
```

**Fix B — exibição na lista de contratos:** Verificar onde `current_value` é exibido para contratos bullet e substituir por `remaining_balance ?? amount_invested`.

Buscar nos componentes: `AdminContracts.tsx` (lista e detail), `ContractDetail.tsx`, `InvestorDashboard.tsx` — onde `current_value` é exibido com label "Total" ou "Valor do Contrato" para `calculation_mode === 'interest_only'`.

**Implementar Fix A** (financials.ts) — mais seguro, corrige na fonte. Fix B como complemento se os testes visuais revelar exibição errada.

---

### BUG-5 — Bullet semanal: parcela do mês seguinte invisível por CB-001 `[MEDIUM]`

**Arquivo:** `CadernetaBullet.tsx:272-275`

**Problema:** CB-001 bloqueou navegação futura na Caderneta:
```javascript
const goToNextMonth = () => {
  const next = nextMonth(monthKey);
  if (next <= currentMonthKey) setMonthKey(next);  // bloqueia futuro
};
```

Para bullet semanal, quando o admin paga a última cobrança do mês (ex: 29/mai), o RPC gera a próxima parcela em 5/jun. Essa parcela fica invisível na Caderneta até virar junho — o admin não tem visibilidade imediata do próximo vencimento.

**Fix:** Para contratos `interest_only`, a geração é sempre "1 período à frente" pelo RPC. Permitir ver até `currentMonth + 1` na Caderneta quando existem parcelas bullet pendentes no próximo mês:

```javascript
const goToNextMonth = () => {
  const next = nextMonth(monthKey);
  // CB-001: bloqueia futuro, exceto para ver próxima parcela bullet
  const hasBulletInNext = pendingInstallments.some(
    inst => bulletInvestmentIds.has(inst.investment_id) && isInMonth(inst.due_date, next)
  );
  if (next <= currentMonthKey || hasBulletInNext) setMonthKey(next);
};
```

**Alternativa mais simples:** Permitir +1 mês sempre (só bloquear +2 ou mais).

**Implementar a alternativa simples** — menos acoplamento ao dado:
```javascript
const goToNextMonth = () => {
  const next = nextMonth(monthKey);
  const oneAhead = nextMonth(currentMonthKey);
  if (next <= oneAhead) setMonthKey(next);  // permite ver até o mês seguinte ao atual
};
```

---

## 3. Critérios de aceite

### AC-1: Sentinela correta (BUG-1)
**Dado** bullet determinado com 104 períodos semanais
**Quando** admin configura e submete
**Então** o form trata como determinado (não como indeterminado), `total_installments = 104` persistido

### AC-2: "Livre" oculto para bullet (BUG-2)
**Dado** admin seleciona "Juros Simples" (interest_only)
**Então** o botão "Livre" desaparece do seletor de frequência
**E** se estava em "Livre" antes, muda automaticamente para "Mensal"

### AC-3: Preview avisa sobre o principal (BUG-3)
**Dado** bullet determinado com N períodos configurado
**Quando** admin vê o preview
**Então** um banner avisa que as N cobranças são só juros e o saldo de R$X é cobrado na quitação

### AC-4: `current_value` bullet = principal (BUG-4)
**Dado** `calculateFinancials` chamada com `mode = 'interest_only'`
**Então** `totalValue = amount_invested` (não `amount_invested + 1 ciclo de juros`)

### AC-5: Caderneta permite ver próximo mês (BUG-5)
**Dado** bullet semanal com parcela pendente em junho sendo exibido em maio
**Quando** admin clica ">" para avançar o mês
**Então** a navegação avança para junho (não fica bloqueada em maio)

### AC-6: Não-regressão
- Contratos `auto` e `manual`: comportamentos inalterados
- Frequência "Livre" para parcelado: inalterada
- Bullet indeterminado: preview de 1 exemplo inalterado (linha 1467-1488)
- CB-001: Caderneta continua bloqueando navegação para além de `currentMonth + 1`

---

## 4. Escopo

### IN
- `components/AdminContracts.tsx` — BUG-1, BUG-2, BUG-3
- `utils/financials.ts` — BUG-4
- `components/dashboard/CadernetaBullet.tsx` — BUG-5

### OUT
- `generate_next_bullet_installment` RPC — não alterar (funciona corretamente para daily/weekly/monthly)
- Outros RPCs — sem alteração
- Schema do banco — sem alteração
- CB-003 campos (break_fee, default_after_days, late_fine) — sem tocar
- `InstallmentDetailFlow.tsx` — sem tocar

---

## 5. Dependências

- **Requer:** CB-001 a CB-007 (todos em prod) ✓
- **Bloqueia:** nenhuma story

---

## 6. Complexidade e riscos

**Estimativa:** 5 pontos (5 mudanças cirúrgicas em 3 arquivos)

**Riscos:**
- R1: BUG-1 — `isBulletIndeterminate` usado em `updateFormState` que não tem acesso direto a `bulletHasFixedDuration`. Solução: refatorar `updateFormState` para aceitar parâmetro ou mover o check para os callers. Testar todos os casos: indeterminado, determinado < 100, determinado ≥ 100.
- R2: BUG-4 — `current_value = principal` pode quebrar `editInterestRatePreview` no modo de edição de contrato (linha `AdminContracts.tsx:278-282`), que usa `editCurrentValuePreview` baseado em `current_value`. Testar edição de contrato bullet existente antes de commitar.
- R3: BUG-5 — abrir +1 mês na Caderneta pode mostrar parcelas de outros contratos (não-bullet) no mês futuro se existirem. Verificar se o `flatInstallments` já filtra apenas bullet (`bulletInvestmentIds.has`).

---

## 7. Definition of Done

- [ ] BUG-1: `isBulletIndeterminate` usa `!bulletHasFixedDuration` nas 3 ocorrências
- [ ] BUG-2: Botão "Livre" oculto para `interest_only`; `frequency` resetada para `monthly` ao trocar para bullet
- [ ] BUG-3: Banner de aviso aparece no preview de bullet determinado com o valor do saldo
- [ ] BUG-4: `calculateFinancials` retorna `totalValue = base` para `interest_only`
- [ ] BUG-5: `goToNextMonth` permite navegar até `currentMonth + 1`
- [ ] Build TypeScript sem erros
- [ ] Edição de contrato bullet existente não regride
- [ ] @qa gate PASS

---

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @sm (River) | Story criada a partir de análise estática do form bullet + smoke test CB-007 |
