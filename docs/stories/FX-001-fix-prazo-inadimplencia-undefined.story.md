# FX-001 — [FIX] Prazo de inadimplência exibe "undefined" + campos vizinhos sem fallback

**Agente:** @dev (impl) / @qa (gate) / @devops (push)
**Status:** Done
**Criada em:** 2026-05-29
**Origem:** Análise estática do wizard de contrato bullet (`AdminContracts.tsx`)
**Epic:** EPIC-FX — Forms UX & Theme Consistency
**Prioridade:** Alta — bug funcional visível ao usuário admin toda vez que abre o wizard em modo bullet

---

## 1. Contexto para implementação

### Arquivos-chave

| Arquivo | Relevância |
|---|---|
| `components/AdminContracts.tsx:375-392` | `handleOpenWizard` — reseta `formData` sem incluir os 3 campos |
| `components/AdminContracts.tsx:196-216` | `useState` inicial — contém os defaults corretos |
| `components/AdminContracts.tsx:1084-1128` | Bloco "Regras de cobrança" — os 3 inputs afetados |
| `components/AdminContracts.tsx:536,550` | RPC call — já usa `formData.default_after_days \|\| 20` como fallback |

### Causa-raiz confirmada

`handleOpenWizard` (linha 375) reseta `formData` com `setFormData({...})` mas **omite** `default_after_days`, `late_fine_percent` e `break_fee_percent`. Embora o `useState` inicial (linha 214) defina `default_after_days: 20`, o reset do wizard sobrescreve tudo com um objeto que não tem essas chaves → ficam `undefined`.

Consequência:
- `value={String(formData.default_after_days)}` (linha 1093): `String(undefined)` = `"undefined"` literal no input
- `value={formData.late_fine_percent}` (linha 1109): `undefined` → React trata como uncontrolled, dispara warning
- `value={formData.break_fee_percent}` (linha 1122): mesmo problema

---

## 2. Acceptance Criteria

### AC-1: Campo "Prazo de inadimplência" nunca exibe "undefined"
**Dado** que o admin abre o wizard de criar contrato
**Quando** troca para modo "Juros Simples" (interest_only)
**Então** o campo "Prazo de inadimplência" exibe `20` (não `"undefined"`)

### AC-2: Campos multa e taxa de quebra são sempre controlled
**Dado** que o wizard é aberto (qualquer modo)
**Então** os campos `late_fine_percent` e `break_fee_percent` iniciam com `""` (string vazia)
**E** nenhum warning React controlled/uncontrolled aparece no console ao digitar nesses campos

### AC-3: `onBlur` restaura padrão 20 ao esvaziar o prazo
**Dado** que o admin limpa o campo "Prazo de inadimplência"
**Quando** perde o foco (onBlur)
**Então** o campo exibe `20` novamente

### AC-4: RPC recebe valor correto
**Dado** que o admin configura prazo como 30 e submete
**Então** `p_default_after_days = 30` é enviado ao RPC (não 20)

### AC-5: Não-regressão — contratos auto/manual inalterados
**Dado** qualquer modo de cálculo diferente de `interest_only`
**Então** o bloco "Regras de cobrança" não é exibido e os demais campos funcionam normalmente

---

## 3. Implementação

### Fix em `handleOpenWizard` (`AdminContracts.tsx:375-392`)

Adicionar ao objeto do `setFormData(...)`:
```typescript
default_after_days: 20,
late_fine_percent: '',
break_fee_percent: '',
```

### Guard defensivo na linha 1093

```typescript
// antes
value={String(formData.default_after_days)}
// depois
value={String(formData.default_after_days ?? 20)}
```

### Fallbacks nas linhas 1109 e 1122

```typescript
// antes (linha 1109)
value={formData.late_fine_percent}
// depois
value={formData.late_fine_percent ?? ''}

// antes (linha 1122)
value={formData.break_fee_percent}
// depois
value={formData.break_fee_percent ?? ''}
```

---

## 4. Escopo

### IN
- `components/AdminContracts.tsx` — `handleOpenWizard` + linhas 1093, 1109, 1122

### OUT
- RPCs — sem alteração (já usam `|| 20` como fallback)
- Schema do banco — sem alteração
- Outros formulários — sem tocar (CB-003 já cobriu a persistência)

---

## 5. Dependências

- **Requer:** CB-003 (campo `default_after_days` já existe no banco) ✓
- **Bloqueia:** nenhuma story

---

## 6. Complexidade e Riscos

**Estimativa:** 1 ponto (4 linhas cirúrgicas, 1 arquivo)

**Riscos:**
- Risco mínimo — a fix é additive (adiciona defaults que já existiam no `useState`).
- Nenhum RPC ou schema é alterado. `|| 20` já existia no envio à RPC.

---

## 7. Definition of Done

- [x] Campo "Prazo de inadimplência" exibe `20` ao abrir wizard em modo bullet
- [x] Nenhum warning controlled/uncontrolled no console
- [x] `onBlur` com campo vazio restaura `20`
- [x] RPC recebe valor correto ao submeter
- [x] Build TypeScript sem erros
- [x] @qa gate PASS

---

## 8. QA Results

**Agente:** @qa (Quinn) | **Data:** 2026-05-29 | **Veredicto:** PASS

| Check | Resultado | Observação |
|---|---|---|
| 1. Code review | ✅ PASS | Fix cirúrgico, 4 linhas, sem code smells |
| 2. Testes unitários | ✅ N/A | UI state fix, sem nova lógica de negócio |
| 3. Acceptance criteria | ✅ PASS | AC-1..5 cobertos pela implementação |
| 4. Sem regressões | ✅ PASS | Apenas defaults adicionados, nada removido |
| 5. Performance | ✅ PASS | Sem queries ou renders extras |
| 6. Segurança | ✅ PASS | Sem mudanças de segurança |
| 7. Documentação | ✅ PASS | Story atualizada |

---

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @po (Pax) | Story criada (análise estática) |
| 2026-05-29 | @po (Pax) | *validate-story-draft — GO 10/10. Draft → Ready. |
| 2026-05-29 | @dev (Dex) | Implementação aplicada. Build ✓. InProgress → InReview. |
| 2026-05-29 | @qa (Quinn) | PASS — fix cirúrgico, AC-1..5 verificados. InReview → Done. |
