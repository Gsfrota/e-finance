# EPIC-FX — Forms UX & Theme Consistency

**Agente responsável:** @pm (Morgan) / @sm (River)
**Status:** Active
**Criada em:** 2026-05-29
**Objetivo:** Corrigir inconsistências visuais (cores light/dark) e funcionais nos formulários do e-finance

---

## Contexto

O e-finance possui um sistema de tokens de tema robusto em `index.css` (`:root` = dark, `[data-theme="light"]` = light), porém os formulários misturam tokens corretos com:
- ~570 cores hardcoded do Tailwind (`teal/red/amber/emerald/indigo/purple/sky`) que não reagem ao tema
- ~400 classes "theme-blind" (`bg-white`, `text-white`, `hover:text-white`) que quebram o modo claro

Além disso, há um bug funcional no wizard de contrato bullet onde campos de "Regras de cobrança" exibem `undefined` por inicialização incompleta do estado.

## Objetivo

1. Corrigir o bug funcional dos 3 campos de "Regras de cobrança" (prazo inadimplência, multa, quebra)
2. Normalizar as cores dos formulários principais para usar exclusivamente tokens do sistema de tema
3. Garantir experiência visual coesa em light e dark mode em todos os forms principais

## Stories

| ID | Título | Status | Prioridade |
|---|---|---|---|
| FX-001 | Fix: prazo de inadimplência exibe "undefined" + campos vizinhos | Done | Alta |
| FX-002 | Normalização de cores dos forms: tokens em light e dark | Ready | Média-Alta |

## Escopo

### IN
- Formulário de criação/edição de contratos (`AdminContracts.tsx`)
- Modais de parcelamento e pagamento (`InstallmentModals.tsx`, `InstallmentDetailFlow.tsx`, `PaymentModal.tsx`)
- Configurações do admin (`AdminSettings.tsx`)
- Onboarding e setup (`OnboardingWizard.tsx`, `SetupWizard.tsx`)
- Login e recuperação de senha (`Login.tsx`, `ResetPassword.tsx`)
- Quick-create e renovação (`QuickContractInput.tsx`, `ContractRenewalModal.tsx`)
- Detail de contrato (`ContractDetail.tsx`)

### OUT (backlog futuro)
- Limpeza global de cores em dashboards e painéis (não-form)
- Criação de componentes compartilhados `Input/Field/Button`
- Remoção da paleta órfã `ink/brass/sage/...` do `index.html`
- Variantes light para `.chip-*` com hex fixo em `index.css`
- Configurar Tailwind `dark:` mode (requer migrar Tailwind de CDN para build)

## Padrão canônico de campo (referência para todas as stories FX)

```
bg-[color:var(--bg-base)]
border border-[color:var(--border-subtle)]
text-[color:var(--text-primary)]
placeholder:text-[color:var(--text-faint)]
focus:border-[color:var(--accent-steel)]
```
- Estado de erro: `border-[color:var(--accent-danger)]` + `text-[color:var(--accent-danger)]`
- Texto sobre botões accent: `text-[color:var(--text-on-accent)]`

## Change Log

| Data | Agente | Ação |
|---|---|---|
| 2026-05-29 | @po (Pax) + @ux (Uma) | Epic criada a partir de análise estática + mapeamento de tokens |
