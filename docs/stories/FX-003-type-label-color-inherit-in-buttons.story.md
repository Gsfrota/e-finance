# FX-003 — [UX] Labels de botões de seleção ficam invisíveis quando selecionados

**Agente:** @dev (impl) / @qa (gate) / @devops (push)
**Status:** InReview
**Criada em:** 2026-05-29
**Origem:** Observação visual pós-deploy FX-002 — screenshot prod-bullet-filled.png
**Epic:** EPIC-FX — Forms UX & Theme Consistency
**Prioridade:** Alta — texto invisível em botões de seleção de modo (Parcelado / Juros Simples) e frequência

---

## 1. Causa-raiz

### Cascata CSS conflitante

```
index.html linha 8:  <script src="https://cdn.tailwindcss.com">  ← injeta <style> cedo
index.html linha 73: <link rel="stylesheet" href="/index.css">    ← carregado DEPOIS
```

`index.css` carrega DEPOIS de Tailwind CDN → tem prioridade na cascata CSS (mesma especificidade, último wins).

Logo: quando um `<button className="... text-white">` contém `<span className="type-label">`:
- `.type-label { color: var(--text-faint) }` de `index.css` é explícito no `<span>`
- `text-white` do Tailwind é HERDADO do pai (herança sempre perde para propriedade explícita)
- Resultado: span fica em `--text-faint` independente do fundo do botão

### Impacto por modo

| Modo tema | `--text-faint` | Fundo selecionado | Contraste |
|-----------|---------------|-------------------|-----------|
| Dark | `#4a5a78` | `--accent-caution` âmbar | ~1.8:1 ❌ WCAG fail |
| Light | `#6b7a9a` | `--accent-caution` âmbar | ~2.1:1 ❌ WCAG fail |
| Dark | `#4a5a78` | `--accent-positive` verde | ~1.5:1 ❌ |
| Light | `#6b7a9a` | `--accent-positive` verde | ~1.9:1 ❌ |

---

## 2. Acceptance Criteria

### AC-1: Texto de botão selecionado visível
**Dado** que o admin seleciona "Juros Simples" ou "Parcelado"
**Quando** o botão fica com fundo colorido
**Então** o texto do label fica branco (herda `text-white` do pai)

### AC-2: Frequências (Mensal / Semanal / Diário / Livre) visíveis ao selecionar
**Dado** qualquer botão de frequência selecionado
**Então** o texto da frequência fica branco (não cinza-azulado invisível)

### AC-3: Toggles (Pular Sábado / Pular Domingo) — texto coerente
**Dado** toggle ativo ou inativo
**Então** o texto herda a cor do pai (verde no ativo, muted no inativo)

### AC-4: Sem regressão em labels de form (campo normal)
**Dado** qualquer `<label>` com `.type-label` fora de botão selecionado
**Então** o texto continua em `--text-faint` (comportamento atual correto)

---

## 3. Implementação

### Estratégia: `style={{ color: 'inherit' }}` nos spans afetados

A fix NÃO altera `.type-label` no CSS global (evita regressão em labels de form). Aplica `color: inherit` inline apenas nos spans dentro de botões com cor contextual.

### Arquivo: `components/AdminContracts.tsx`

**Linha 967** (Parcelado):
```tsx
// antes
<span className="type-label">Parcelado</span>
// depois
<span className="type-label" style={{ color: 'inherit' }}>Parcelado</span>
```

**Linha 981** (Juros Simples):
```tsx
// antes
<span className="type-label">Juros Simples</span>
// depois
<span className="type-label" style={{ color: 'inherit' }}>Juros Simples</span>
```

**Linha 1155** (frequência: Mensal/Semanal/Diário/Livre):
```tsx
// antes
<span className="type-micro">{opt.label}</span>
// depois
<span className="type-micro" style={{ color: 'inherit' }}>{opt.label}</span>
```

**Linha 1243** (Pular Sábado):
```tsx
// antes
<span className="type-label">Pular Sábado</span>
// depois
<span className="type-label" style={{ color: 'inherit' }}>Pular Sábado</span>
```

**Linha 1256** (Pular Domingo):
```tsx
// antes
<span className="type-label">Pular Domingo</span>
// depois
<span className="type-label" style={{ color: 'inherit' }}>Pular Domingo</span>
```

---

## 4. Escopo

### IN
- `components/AdminContracts.tsx` — 5 spans afetados
- Somente spans dentro de botões de seleção de modo/frequência/toggle

### OUT
- CSS global `.type-label` — não alterar (evitar regressão em labels de form)
- Outros componentes (verificar: se tiverem padrão similar, cobrir em FX-004)
- Action buttons `type-label ... text-white` no próprio `<button>` — esses têm o conflito no mesmo elemento (não herança), verificar se estão OK visivelmente

---

## 5. Definition of Done

- [x] "Parcelado" e "Juros Simples" legíveis quando selecionados (fundo colorido)
- [x] Frequências (Mensal/Semanal/Diário/Livre) legíveis quando selecionadas
- [x] Toggles Pular Sábado/Domingo com cor coerente
- [x] Labels de form fora de botão sem alteração visual (style={{ color: 'inherit' }} não afeta spans fora de botão)
- [x] Build TypeScript sem erros (`npm run build` ✓)
- [ ] @qa gate PASS

---

## 6. File List

- [x] `components/AdminContracts.tsx` — 5 spans: Parcelado (967), Juros Simples (981), tipo-micro frequências (1155), Pular Sábado (1243), Pular Domingo (1256)

---

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @ux (Uma) | Identificado via screenshot prod, causa-raiz confirmada |
| 2026-05-29 | @po (Pax) | *validate — GO inline (bug crítico de contraste WCAG, fix cirúrgico) |
| 2026-05-29 | @dev (Dex) | 5 spans corrigidos com `style={{ color: 'inherit' }}`. Build ✓. InProgress → InReview. |
