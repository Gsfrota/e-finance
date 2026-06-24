# MOBI-001 — Mobile UX: touch targets 44px + iOS auto-zoom completo

**Agentes:** @sm → @po → @dev → @qa → @devops
**Status:** Done
**Criada em:** 2026-06-24
**Prioridade:** P2 — impacta UX mobile mas não bloqueia funcionalidades
**Complexidade:** XS (1 arquivo CSS, 2 mudanças)
**Banco:** sem mudança de schema
**Valor:** Elimina iOS auto-zoom em campos de senha/telefone e garante que todos os botões `.btn` atendam o mínimo WCAG de 44px de touch target

---

## 1. Problemas

### MOBI-1 — iOS auto-zoom incompleto (`index.css:570`)

A regra `@media (max-width: 1024px)` previne auto-zoom em `text`, `email`, `number`, `date`, `select`, `textarea`, mas **falta `password` e `tel`**. Em iPhones, campos de senha e telefone ainda disparam o zoom automático ao receber foco.

### MOBI-2 — Botão `.btn` abaixo de 44px (`index.css:419`)

`.btn` tem `padding: 0.625rem 1.5rem` (10px vertical). Com `font-size: 0.875rem` (14px) e line-height ~1.5 (~21px), a altura total é ≈ 41px — abaixo do mínimo WCAG 2.1 AA de 44px para touch targets.

---

## 2. Acceptance Criteria

- **AC-1:** `index.css` — regra iOS anti-zoom inclui `input[type="password"]` e `input[type="tel"]`
- **AC-2:** `index.css` — `.btn` tem `min-height: 2.75rem` (44px)
- **AC-3:** `npm run build` passa sem erros TypeScript
- **AC-4:** Sem regressão visual em `.btn` existente (botão ainda exibe corretamente em desktop)

---

## 3. Implementação

### AC-1 — index.css linha ~572 (adicionar tipos faltantes)

```css
/* ANTES: */
@media (max-width: 1024px) {
  input[type="number"],
  input[type="text"],
  input[type="email"],
  input[type="date"],
  select,
  textarea {
    font-size: 16px !important;
  }
}

/* DEPOIS: */
@media (max-width: 1024px) {
  input[type="number"],
  input[type="text"],
  input[type="email"],
  input[type="password"],
  input[type="tel"],
  input[type="date"],
  select,
  textarea {
    font-size: 16px !important;
  }
}
```

### AC-2 — index.css linha ~419 (adicionar min-height ao .btn)

```css
/* ANTES: */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  border-radius: 9999px; font-weight: 600; font-size: 0.875rem;
  letter-spacing: 0.02em; transition: all 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  cursor: pointer; padding: 0.625rem 1.5rem; border: none; outline: none;
  white-space: nowrap;
}

/* DEPOIS: */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  border-radius: 9999px; font-weight: 600; font-size: 0.875rem;
  letter-spacing: 0.02em; transition: all 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  cursor: pointer; padding: 0.625rem 1.5rem; border: none; outline: none;
  white-space: nowrap; min-height: 2.75rem;
}
```

---

## 4. File List

- [x] `index.css` — AC-1 (password/tel no anti-zoom) + AC-2 (min-height no .btn)

---

## 5. QA Results

**Gate: PASS** — 2026-06-24 — Quinn (@qa)

| AC | Resultado |
|---|---|
| AC-1 password/tel no anti-zoom iOS | ✅ |
| AC-2 min-height: 2.75rem no .btn | ✅ |
| AC-3 `npm run build` | ✅ verde |
| AC-4 sem regressão visual em .btn | ✅ |
