# FX-002 — [UX] Normalização de cores dos formulários: tokens em light e dark

**Agente:** @dev (impl) / @qa (gate) / @devops (push)
**Status:** Ready
**Criada em:** 2026-05-29
**Origem:** Audit de design (@ux Uma) + solicitação do usuário (cores confusas em light e dark)
**Epic:** EPIC-FX — Forms UX & Theme Consistency
**Prioridade:** Média-Alta — impacto visual em todos os fluxos de admin (criar contrato, pagamentos, configurações)

---

## 1. Contexto para implementação

### Problema

O e-finance possui tokens de tema em `index.css` que funcionam corretamente em light e dark mode (via `[data-theme="light"]` no `<html>`). Porém os formulários usam classes hardcoded do Tailwind que **não reagem ao tema**, causando:

1. **`hover:text-white` / `bg-white` / `text-white` em modo claro** → texto branco sobre fundo claro = invisível
2. **Cor de foco inconsistente** entre campos do mesmo form (`--accent-positive`, `--accent-caution`, `indigo-500`, `--accent-brass`)
3. **Erros de validação** alternando entre `border-red-500/text-red-400` e `--accent-danger`
4. **Fundos de input inconsistentes** (`--bg-base` vs `--bg-elevated` vs `--bg-soft` sem critério)
5. **Hues hardcoded** (`teal/amber/emerald/indigo/sky/violet`) fixos em ambos os temas
6. **Login divergente**: usa `bg-white/[0.03]` + foco `--accent-brass` + botão Google com `gray-*`

### Tokens disponíveis em `index.css` (referência)

```css
/* Fundos */
--bg-base      /* input background */
--bg-elevated  /* card/modal background */
--bg-soft      /* section softer background */

/* Bordas */
--border-subtle   /* input default border */
--border-strong   /* separadores */

/* Texto */
--text-primary    /* conteúdo principal */
--text-secondary  /* labels */
--text-muted      /* help text */
--text-faint      /* placeholder */
--text-on-accent  /* texto sobre botões accent/brass */

/* Acentos semânticos */
--accent-steel         /* azul — foco de input (padrão único) */
--accent-positive      /* verde — sucesso, pago */
--accent-danger        /* vermelho — erro, validação */
--accent-danger-subtle /* fundo vermelho suave */
--accent-danger-border /* borda vermelho suave */
--accent-caution       /* âmbar — alerta, parcial */
--accent-brass         /* dourado — destaque premium */
--accent-warning       /* âmbar escuro — aviso */
```

### Padrão canônico de campo (EPIC-FX)

```
bg-[color:var(--bg-base)]
border border-[color:var(--border-subtle)]
text-[color:var(--text-primary)]
placeholder:text-[color:var(--text-faint)]
focus:border-[color:var(--accent-steel)]
transition-colors
```

Erro de validação: `border-[color:var(--accent-danger)]`
Texto de erro: `text-[color:var(--accent-danger)]`

---

## 2. Acceptance Criteria

### AC-1: Foco unificado em todos os inputs dos forms-alvo
**Dado** qualquer campo de input nos 12 componentes-alvo
**Quando** o usuário foca o campo
**Então** a borda muda para `var(--accent-steel)` (azul)
**E** não há variação de cor de foco entre campos do mesmo form

### AC-2: Erros de validação usam token semântico
**Dado** um campo com validação (ex: CPF inválido, campo obrigatório vazio)
**Quando** a validação falha
**Então** a borda usa `var(--accent-danger)` e o texto de erro usa `var(--accent-danger)`

### AC-3: Nenhum `text-white` / `bg-white` / `hover:text-white` cru nos forms-alvo
**Dado** modo light (`[data-theme="light"]`)
**Quando** o usuário navega por qualquer form dos 12 componentes-alvo
**Então** nenhum texto/hover se torna invisível (branco sobre fundo claro)

### AC-4: Fundo dos inputs consistente (--bg-base)
**Dado** qualquer campo de input nos forms-alvo
**Então** o fundo usa `var(--bg-base)` (não `--bg-elevated`, `--bg-soft` ou `bg-transparent` sem critério)
**Exceção:** containers/cards que embrulham grupos de campos podem usar `--bg-elevated` ou `--bg-soft` — apenas os `<input>/<select>/<textarea>` são padronizados

### AC-5: Light e dark mode funcionais sem regressão visual
**Dado** o botão de toggle de tema
**Quando** o usuário alterna entre light e dark
**Então** todos os formulários dos 12 componentes-alvo apresentam contraste adequado em ambos os modos

### AC-6: Login e Reset alinhados ao padrão
**Dado** o form de login (`Login.tsx`) e de reset de senha (`ResetPassword.tsx`)
**Então** os inputs usam o padrão canônico (foco `--accent-steel`, fundo `--bg-base`)
**E** o botão Google usa tokens (`--text-primary` / `--bg-elevated`) em vez de `bg-white text-gray-800`

### AC-7: Não-regressão funcional
**Dado** qualquer fluxo de criar contrato, registrar pagamento, configurar tenant, onboarding
**Então** nenhum fluxo quebra por mudança de classe CSS

---

## 3. Componentes-alvo e regras de substituição

### 12 Componentes-alvo

| Prioridade | Componente | Descrição |
|---|---|---|
| 1 | `components/AdminContracts.tsx` | Wizard de criar/editar contrato, quick-create devedor |
| 2 | `components/InstallmentDetailFlow.tsx` | Fluxo de detalhes de parcela |
| 3 | `components/InstallmentModals.tsx` | Modais de parcela |
| 4 | `components/ContractDetail.tsx` | Detalhe de contrato |
| 5 | `components/PaymentModal.tsx` | Modal de pagamento |
| 6 | `components/AdminSettings.tsx` | Configurações do admin |
| 7 | `components/OnboardingWizard.tsx` | Wizard de onboarding |
| 8 | `components/SetupWizard.tsx` | Setup inicial |
| 9 | `components/QuickContractInput.tsx` | Input rápido de contrato |
| 10 | `components/ContractRenewalModal.tsx` | Modal de renovação |
| 11 | `components/Login.tsx` | Login (foco brass→steel, botão Google) |
| 12 | `components/ResetPassword.tsx` | Reset de senha |

### Regras de substituição (por componente, aplicar inline)

**R1 — Cor de foco:**
- `focus:border-[color:var(--accent-positive)]` → `focus:border-[color:var(--accent-steel)]`
- `focus:border-[color:var(--accent-caution)]` → `focus:border-[color:var(--accent-steel)]`
- `focus:border-[color:var(--accent-brass)]` → `focus:border-[color:var(--accent-steel)]`
- `focus:border-indigo-500` → `focus:border-[color:var(--accent-steel)]`
- `focus:ring-indigo-500` → `focus:ring-[color:var(--accent-steel)]`

**R2 — Erros de validação:**
- `border-red-500` → `border-[color:var(--accent-danger)]`
- `text-red-400`, `text-red-500`, `text-red-600` → `text-[color:var(--accent-danger)]`
- `bg-red-500/10`, `bg-red-100` → `bg-[color:var(--accent-danger-subtle)]`

**R3 — Theme-blind branco/preto:**
- `text-white` em labels/texto de form → `text-[color:var(--text-primary)]`
- `hover:text-white` em botões de form → `hover:text-[color:var(--text-on-accent)]` (quando sobre accent) ou `hover:text-[color:var(--text-primary)]`
- `bg-white` em inputs → `bg-[color:var(--bg-elevated)]`
- `text-gray-800`, `text-gray-700` → `text-[color:var(--text-primary)]`
- `bg-gray-100`, `bg-gray-50` → `bg-[color:var(--bg-elevated)]`

**R4 — Hues hardcoded em campos/labels:**
- `text-teal-*`, `text-emerald-*` → `text-[color:var(--accent-positive)]`
- `border-teal-*`, `border-emerald-*` → `border-[color:var(--accent-positive)]`
- `text-amber-*`, `text-yellow-*` → `text-[color:var(--accent-caution)]`
- `border-amber-*` → `border-[color:var(--accent-caution-border)]`
- `text-indigo-*`, `text-sky-*`, `text-blue-*` → `text-[color:var(--accent-steel)]`
- `text-violet-*`, `text-purple-*` → `text-[color:var(--accent-purple)]`
- Cores puramente decorativas em ícones/badges fora de input/label → manter (fora de escopo)

**R5 — Slate residual:**
- `bg-slate-700/60`, `bg-slate-800` → `bg-[color:var(--bg-strong)]`
- `text-slate-300`, `text-slate-400` → `text-[color:var(--text-secondary)]`
- `divide-slate-700`, `divide-slate-800` → `divide-[color:var(--border-subtle)]`

**R6 — Fundo de input:**
- Inputs (`<input>/<select>/<textarea>`) com `bg-[color:var(--bg-elevated)]` ou `bg-[color:var(--bg-soft)]` → `bg-[color:var(--bg-base)]`
- Containers/cards que embrulham grupos de campos: manter `--bg-elevated`/`--bg-soft` (não são inputs)

---

## 4. Escopo

### IN
- Os 12 componentes listados — apenas inline class fixes
- Regras R1-R6 aplicadas conforme necessário em cada arquivo

### OUT (backlog — `*backlog-add` após esta story)
- Limpeza global de cores em dashboards/painéis
- Criação de componentes `Input/Field/Button` compartilhados
- Remoção da paleta órfã `ink/brass/sage/...` do `index.html`
- Variantes light para `.chip-partial/surplus/deferred/absorbed/anomaly` em `index.css`
- Migração do Tailwind de CDN para build (necessária para usar `dark:` prefix)

---

## 5. Dependências

- **Requer:** FX-001 Done ✓ (sem dependência técnica, mas narrativa: bug funcional primeiro)
- **Bloqueia:** nenhuma story

---

## 6. Complexidade e Riscos

**Estimativa:** 8 pontos (12 arquivos, busca e substituição sistemática)

**Riscos:**
- R1: Foco `--accent-caution` no bloco "Regras de cobrança" de `AdminContracts.tsx` foi intencional (âmbar para campos de risco). Mudança para `--accent-steel` é OK — o âmbar continua nos labels e textos de ajuda.
- R2: `hover:text-white` em botões onde o fundo do hover é escuro (ex: botão `.btn-primary` que já tem fundo steel/positivo) não deve ser alterado — esses estão corretos. Substituir apenas onde o hover ficaria invisível no modo claro.
- R3: Algumas ocorrências de `bg-white` podem ser em modais/overlays com glassmorphism intencional (ex: `bg-white/[0.03]` — manter, é semi-transparente). Substituir apenas `bg-white` sólido.
- R4: Mudança massiva em muitos arquivos — review cuidadoso por arquivo antes de commitar.

---

## 7. Definition of Done

- [x] Todos os inputs dos 12 componentes-alvo com foco `--accent-steel`
- [x] Erros de validação usando `--accent-danger` em todos os forms
- [x] Nenhum `text-white`/`bg-white`/`hover:text-white` cru causando invisibilidade em light
- [x] Login e ResetPassword alinhados ao padrão canônico
- [ ] Inspeção visual em light e dark (screenshot ou Playwright) — pendente QA gate
- [x] Build TypeScript sem erros
- [ ] @qa gate PASS

---

## 8. File List

- [ ] `components/AdminContracts.tsx`
- [ ] `components/InstallmentDetailFlow.tsx`
- [ ] `components/InstallmentModals.tsx`
- [ ] `components/ContractDetail.tsx`
- [ ] `components/PaymentModal.tsx`
- [ ] `components/AdminSettings.tsx`
- [ ] `components/OnboardingWizard.tsx`
- [ ] `components/SetupWizard.tsx`
- [ ] `components/QuickContractInput.tsx`
- [ ] `components/ContractRenewalModal.tsx`
- [ ] `components/Login.tsx`
- [ ] `components/ResetPassword.tsx`

---

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @ux (Uma) + @po (Pax) | Story criada a partir de audit de design |
| 2026-05-29 | @po (Pax) | *validate-story-draft — GO 9/10. Draft → Ready. Obs: R2 (hover:text-white intencional em btn-primary) e R3 (bg-white/[0.03] glassmorphism) documentados como riscos — @dev deve validar caso a caso. |
