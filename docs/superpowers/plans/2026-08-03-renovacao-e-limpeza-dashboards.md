# Renovação de Contrato + Remoção dos Dashboards de Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renovar contrato passa a usar o próprio wizard de criação (paridade total de campos, escrita atômica), e as telas mortas de investidor/devedor são removidas com um gate de role que impede não-admin de alcançar o painel administrativo.

**Architecture:** Fase 0 remove as telas de role e instala o gate — ela precede a Fase 1 porque apaga dois dos hooks que a Fase 1 teria de corrigir. Fase 1 deleta `ContractRenewalModal` e liga a renovação ao wizard, com o vínculo pai→filho feito dentro do RPC `create_investment_validated`, em transação.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (PostgREST + plpgsql), Playwright.

**Nota sobre números de linha:** o Codex está editando o repo em paralelo. Cada passo cita o **trecho literal** a procurar — use o trecho como âncora, não o número da linha.

**Gate obrigatório antes de qualquer push:** `npx tsc --noEmit`. O `npm run build` (vite) NÃO typecheca, e `tsc` quebrado congela produção silenciosamente.

---

## Contexto verificado (não re-investigar)

Levantado contra o banco de produção e o código real:

- `create_investment_validated` existe com **25 parâmetros**, todos com `DEFAULT` a partir do 6º, e **não** aceita nem grava `parent_investment_id`.
- `log_audit_event` tem **15 parâmetros**; `audit_events` **não tem constraint CHECK** em `event_type` → um tipo novo não exige migration.
- Produção: 243 contratos `active`, 197 `completed`, 3 `renewed` (estes com **zero** parcelas em aberto — o bug de dívida dupla é latente, não ativo).
- Produção: 310 perfis `debtor` (18 com login) e 77 `investor` (2 com login). **Zero logins de qualquer um deles nos últimos 90 dias**; o último foi 2026-03-27.
- `Dashboard.tsx` → `if (userRole === 'investor' ...)` / `if (userRole === 'debtor' ...)` são a **única** barreira de frontend entre não-admin e `AdminDashboardView`. O botão "Dashboard" da sidebar aparece para todas as roles.

---

## File Structure

**Fase 0 — deletar por completo:**

| Arquivo | Por quê |
|---|---|
| `components/InvestorDashboard.tsx` | tela morta; só `Dashboard.tsx` importa |
| `components/DebtorDashboard.tsx` | tela morta; só `Dashboard.tsx` importa |
| `components/PaymentModal.tsx` (raiz) | só o `DebtorDashboard` usa. **Não confundir** com o `PaymentModal` nomeado exportado de `components/InstallmentModals.tsx`, que é do admin e fica |
| `hooks/useDebtorFinance.ts` | todos os exports morrem junto |
| `hooks/useGeneratePix.ts` | só `components/PaymentModal.tsx` importa |
| `services/pix.ts` | **já órfão hoje** — zero importadores no app (o bot tem cópia própria) |
| `e2e/debtor/dashboard.spec.ts` | `@deprecated`, já excluído por `testIgnore` |
| `e2e/investor/dashboard.spec.ts` | `@deprecated`, já excluído por `testIgnore` |
| `e2e/payment/payment-debtor-pix.spec.ts` | exercita só a tela do devedor |

**Fase 0 — podar, NÃO deletar:**

| Arquivo | O que sai | O que fica e por quê |
|---|---|---|
| `hooks/useInvestorMetrics.ts` | `useInvestorMetrics`, `EnrichedInvestment`, `InvestorPeriod`, `InvestorFilter`, `InvestorMetrics`, e os internos `CachedRawData`, `CachedInvestorData`, `getPeriodBounds`, `inPeriod`, `computeMetrics` | `monthKeyToDate`, `dateToMonthKey`, `computeMonthlyView` + os internos `RawInstallment`/`RawInvestment` — usados pela aba "Visão Mensal" **do admin** |

**Fase 0 — criar:**

| Arquivo | Responsabilidade |
|---|---|
| `components/AccessUnavailable.tsx` | tela terminal para não-admin, com botão de sair. Único conteúdo: mensagem + logout |

**Fase 0 — NÃO tocar (verificado como tela de admin, apesar do nome/caminho):**

- `components/investor/MonthlyInvestorView.tsx` — renderizado por `AdminDashboardView` na aba `monthly`
- `hooks/useDebtorLateMap.ts` — usado por `AdminContracts` e `AdminUsers`
- `components/AdminUserDetails.tsx` — o "ver detalhe do devedor" do admin
- forms de PIX em `AdminSettings.tsx` / `OnboardingWizard.tsx` — gravam config que o bot lê

**Fase 1 — deletar:** `components/ContractRenewalModal.tsx` (534 linhas).

**Fase 1 — modificar:** `types.ts`, `components/AdminContracts.tsx`, `hooks/useDashboardData.ts`, `components/dashboard/CollectionDashboard.tsx`, `hooks/useYieldMetrics.ts`, `components/Dashboard.tsx`, `e2e/contract/contract-lifecycle.spec.ts`, `docs/business-rules/e-finance-br.md`, + 1 migration Supabase.

---

# FASE 0 — Remoção dos dashboards de role

O gate vem **antes** da remoção. Fazer na ordem inversa abre uma janela em que não-admin alcança o painel administrativo com ações de escrita.

## Task 1: Gate de role + tela de acesso indisponível

**Files:**
- Create: `components/AccessUnavailable.tsx`
- Modify: `services/companyScope.ts`
- Modify: `App.tsx`

- [ ] **Step 1: Criar o componente de tela terminal**

Criar `components/AccessUnavailable.tsx`:

```tsx
import React from 'react';
import { ShieldOff, LogOut } from 'lucide-react';

interface AccessUnavailableProps {
  onLogout: () => void;
}

/**
 * Tela terminal para perfis sem acesso à aplicação (não-admin).
 * Os painéis de investidor e devedor foram descontinuados em 2026-08.
 */
const AccessUnavailable: React.FC<AccessUnavailableProps> = ({ onLogout }) => (
  <div className="flex min-h-screen items-center justify-center bg-[color:var(--bg-base)] p-6">
    <div className="panel-card w-full max-w-md rounded-[2rem] px-8 py-10 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--bg-soft)]">
        <ShieldOff size={26} className="text-[color:var(--text-muted)]" />
      </div>
      <h1 className="type-title font-display text-[color:var(--text-primary)]">
        Acesso indisponível
      </h1>
      <p className="mt-3 type-body text-[color:var(--text-secondary)]">
        Este acesso foi descontinuado. Fale com o administrador responsável pela sua conta
        para acompanhar seus contratos.
      </p>
      <button
        onClick={onLogout}
        className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--bg-soft)] py-3.5 type-label text-[color:var(--text-primary)] transition-all hover:bg-[color:var(--bg-strong)]"
      >
        <LogOut size={15} />
        Sair
      </button>
    </div>
  </div>
);

export default AccessUnavailable;
```

- [ ] **Step 2: Adicionar o helper de role em `services/companyScope.ts`**

Procurar o helper existente `isPlatformOwner` (o que contém `profile.role === 'admin'`) e adicionar logo abaixo dele:

```ts
/**
 * A aplicação web é exclusiva de administradores desde 2026-08.
 * Perfis 'investor' e 'debtor' continuam existindo como dados (investments.user_id /
 * payer_id), mas não têm tela própria — ver components/AccessUnavailable.tsx.
 * Nega por padrão: perfil ausente ou role desconhecida também é bloqueado.
 */
export const isRoleBlocked = (profile: Profile | null | undefined): boolean =>
  profile?.role !== 'admin';
```

- [ ] **Step 3: Aplicar o gate no `App.tsx`**

Importar o componente e o helper. No import existente de `services/companyScope`, acrescentar `isRoleBlocked` à lista. Adicionar:

```tsx
import AccessUnavailable from './components/AccessUnavailable';
```

Localizar o `return` que renderiza `<CompanyContextProvider value={companyContextValue}>` com o `<Layout ...>`. **Imediatamente antes desse return**, inserir:

```tsx
  // Gate de role: a aplicação é exclusiva de admin. Perfis investor/debtor foram
  // descontinuados. Vem ANTES do Layout para que não-admin nunca monte a sidebar
  // nem alcance AppView.DASHBOARD (que faz fall-through para AdminDashboardView).
  if (profile && isRoleBlocked(profile)) {
    return <AccessUnavailable onLogout={handleLogout} />;
  }
```

Regras de Hooks: este `return` precisa ficar **depois** de todos os `useState`/`useEffect`/`useMemo` do componente. O `useEffect` do paywall (`isFreeLocked && FREE_PLAN_BLOCKED_VIEWS.has(currentView)`) já está declarado acima do bloco de render — mantenha o novo return abaixo dele.

- [ ] **Step 4: Verificar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Verificar manualmente que admin não foi afetado**

Run: `npm run dev` e logar com um admin.
Expected: HOME do admin carrega normalmente; sidebar completa; nenhuma tela de bloqueio.

- [ ] **Step 6: Commit**

```bash
git add components/AccessUnavailable.tsx services/companyScope.ts App.tsx
git commit -m "feat(auth): gate de role — app exclusiva de admin, não-admin vê tela de acesso indisponível"
```

**Risco conhecido e aceito:** `App.tsx` tem um fallback para usuário sem profile que monta um perfil sintético com `role: (meta.role as UserRole) || 'investor'`. Com este gate, uma falha de carregamento do profile de um admin cai na tela de bloqueio em vez de conceder acesso. É o comportamento desejado (negar por padrão), e a tela oferece "Sair". Não alterar esse fallback nesta task.

---

## Task 2: Remover o dashboard do devedor

**Files:**
- Delete: `components/DebtorDashboard.tsx`, `components/PaymentModal.tsx`, `hooks/useDebtorFinance.ts`, `hooks/useGeneratePix.ts`, `services/pix.ts`
- Modify: `components/Dashboard.tsx`, `package.json`

- [ ] **Step 1: Remover o dispatch no `Dashboard.tsx`**

Apagar a linha de import:

```tsx
import DebtorDashboard from './DebtorDashboard';
```

E apagar a linha de dispatch:

```tsx
  if (userRole === 'debtor' && !targetUserId) return <DebtorDashboard />;
```

- [ ] **Step 2: Deletar os arquivos**

```bash
git rm components/DebtorDashboard.tsx components/PaymentModal.tsx hooks/useDebtorFinance.ts hooks/useGeneratePix.ts services/pix.ts
```

`services/pix.ts` já era órfão antes desta remoção (zero importadores no app; `e-finance-bot/src/services/pix.ts` é uma cópia portada, não um import — o bot não quebra).

- [ ] **Step 3: Remover a dependência `qrcode.react`**

Ela era usada apenas por `components/PaymentModal.tsx`. Em `package.json`, apagar a linha:

```json
    "qrcode.react": "^4.2.0",
```

Run: `npm install`
Expected: `package-lock.json` atualizado, sem erro.

- [ ] **Step 4: Confirmar que nada mais referencia o que foi apagado**

Run:
```bash
grep -rn "DebtorDashboard\|useDebtorFinance\|useGeneratePix\|services/pix\|qrcode.react" --include="*.ts" --include="*.tsx" --include="*.json" . | grep -v node_modules | grep -v e-finance-bot
```
Expected: nenhuma linha (a busca exclui os bots de propósito — o bot tem cópia própria de pix).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros. Se acusar `DebtorInstallment`, sobrou um import de `hooks/useDebtorFinance` em algum lugar — o único conhecido era `components/PaymentModal.tsx`, que foi deletado.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remover dashboard do devedor, PaymentModal do devedor, useDebtorFinance, useGeneratePix, services/pix e qrcode.react"
```

---

## Task 3: Remover o dashboard do investidor e podar `useInvestorMetrics`

**Files:**
- Delete: `components/InvestorDashboard.tsx`
- Modify: `hooks/useInvestorMetrics.ts`, `components/Dashboard.tsx`, `App.tsx`

- [ ] **Step 1: Remover o dispatch no `Dashboard.tsx`**

Apagar a linha de import:

```tsx
import InvestorDashboard from './InvestorDashboard';
```

E apagar a linha de dispatch:

```tsx
  if (userRole === 'investor' && !targetUserId) return <InvestorDashboard defaultTab={investorDefaultTab} />;
```

Com as duas roles removidas, o corpo do componente `Dashboard` fica só com o `return <AdminDashboardView ... />`. Remover também `investorDefaultTab` da desestruturação de props e da interface `DashboardProps`.

- [ ] **Step 2: Remover a HOME do investidor no `App.tsx`**

Apagar o bloco inteiro que começa com:

```tsx
          {currentView === AppView.HOME && profile?.role === 'investor' && (
```

até o `)}` que o fecha (contém os dois cards "Minha Carteira" e "Análise Mensal").

Apagar também a declaração de estado:

```tsx
  const [investorDefaultTab, setInvestorDefaultTab] = useState<'portfolio' | 'monthly'>('portfolio');
```

e a prop passada ao Dashboard:

```tsx
                investorDefaultTab={investorDefaultTab}
```

- [ ] **Step 3: Deletar o componente**

```bash
git rm components/InvestorDashboard.tsx
```

- [ ] **Step 4: Podar `hooks/useInvestorMetrics.ts` — REMOVER apenas o que é órfão**

⚠️ **Não deletar o arquivo.** Três exports são consumidos por telas de admin.

Remover destes símbolos (todos exportados, todos sem consumidor após o passo 3):
- `interface EnrichedInvestment`
- `type InvestorPeriod`
- `interface InvestorFilter`
- `interface InvestorMetrics`
- `const useInvestorMetrics`

Remover destes símbolos internos (usados apenas pelo hook removido):
- `interface CachedRawData`
- `interface CachedInvestorData`
- `function getPeriodBounds`
- `function inPeriod`
- `function computeMetrics`

**MANTER obrigatoriamente:**
- `function monthKeyToDate` — importado por `components/Dashboard.tsx`, `components/dashboard/CadernetaBullet.tsx` e `components/investor/MonthlyInvestorView.tsx`
- `function dateToMonthKey` — importado por `components/Dashboard.tsx` e `components/dashboard/CadernetaBullet.tsx`
- `function computeMonthlyView` — importado por `components/Dashboard.tsx`
- `interface RawInstallment` e `interface RawInvestment` — assinatura de `computeMonthlyView`

Ajustar os imports do topo do arquivo: os que sobrevivem são o de `types` (`Investment`, `MonthlyViewData`, `MonthlyDebtorSummary`, `MonthlyOverdueEntry`) e `getBrazilToday` de `services/dateUtils`. Os que saem são `useState/useEffect/useRef` do react, `fetchProfileByAuthUserId/getSupabase/withRetry` de `services/supabase` e `getCached/setCached` de `services/cache`.

O arquivo deve encolher de ~567 para ~200 linhas e passar a ser um módulo de helpers puros.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros. Se acusar `monthKeyToDate`/`dateToMonthKey`/`computeMonthlyView` como inexistentes, algum deles foi removido por engano — restaurar.

- [ ] **Step 6: Verificar a aba "Visão Mensal" do admin**

Run: `npm run dev`, logar como admin, ir em Dashboard → aba "Visão Mensal".
Expected: a aba renderiza com dados; é ela que consome os três helpers mantidos.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remover dashboard do investidor e podar useInvestorMetrics para helpers de visão mensal"
```

---

## Task 4: Fechar o resgate de convite

Sem isto, `Login` e `OnboardingWizard` continuam criando contas logáveis com role `investor`/`debtor` — que agora nascem direto na tela de bloqueio. A UI ficaria oferecendo um caminho que não leva a lugar nenhum.

**Files:**
- Modify: `components/Login.tsx`, `components/OnboardingWizard.tsx`

- [ ] **Step 1: Localizar os pontos exatos antes de editar**

Run:
```bash
grep -n "signUpInvited\|invite_code\|inviteCode\|Recebeu um convite" components/Login.tsx
grep -n "inviteMode\|p_invite_code\|complete_oauth_onboarding\|'invite'" components/OnboardingWizard.tsx
```
Expected: em `Login.tsx`, o branch de `signUpInvited` que chama `supabase.auth.signUp` com `invite_code` dentro de `options.data`, o input do código e o toggle "Recebeu um convite?". Em `OnboardingWizard.tsx`, a chamada `supabase.rpc('complete_oauth_onboarding', { p_full_name, p_mode: inviteMode, p_company_name, p_invite_code })` e o toggle de modo.

Ler os dois arquivos antes de editar — a remoção precisa levar junto o estado que só existia para esse fluxo (o `authMode`/`inviteMode` e seus setters), senão o `tsc` acusa variável não usada ou o toggle fica órfão.

- [ ] **Step 2: Remover o modo de convite dos dois arquivos**

Em `components/Login.tsx`: apagar o branch `signUpInvited` do handler de submit, o campo de input do código de convite, o toggle "Recebeu um convite?" e o estado associado. O `authMode` deve ficar apenas com os modos de login e recuperação de senha.

Em `components/OnboardingWizard.tsx`: apagar o modo `'invite'`, passando sempre o modo de criação de organização para `complete_oauth_onboarding`, e remover o toggle e o campo de código.

O critério de pronto é: nenhum caminho da UI consegue mais criar uma conta com role diferente de `admin`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add components/Login.tsx components/OnboardingWizard.tsx
git commit -m "chore: remover resgate de convite — só admin acessa a aplicação"
```

**Fora do escopo desta task:** a RPC `complete_oauth_onboarding` continua aceitando `p_mode: 'invite'` no banco, e convites pendentes antigos permanecem na tabela. Remover isso exige migration própria — registrar como follow-up, não fazer aqui.

---

## Task 5: Limpar testes e o mapa de QA

**Files:**
- Delete: `e2e/debtor/dashboard.spec.ts`, `e2e/investor/dashboard.spec.ts`, `e2e/payment/payment-debtor-pix.spec.ts`
- Modify: `e2e/e2e-full/role-views.spec.ts`, `scripts/qa/flow-map.ts`, `playwright.config.ts`

- [ ] **Step 1: Deletar os specs mortos**

```bash
git rm e2e/debtor/dashboard.spec.ts e2e/investor/dashboard.spec.ts e2e/payment/payment-debtor-pix.spec.ts
```

Os três já eram `@deprecated` ou nunca executados em CI (o workflow roda só `--project=chromium --project=no-auth`).

- [ ] **Step 2: Remover o describe de devedor em `role-views.spec.ts`**

Em `e2e/e2e-full/role-views.spec.ts`, remover o bloco `describe` "Devedor — Contratos e Pagamento PIX". O teste ROL-05 dele **falharia** após a remoção — ele espera texto do DebtorDashboard e não tem guarda de skip. Os testes ROL-03/06/07/08 que dependem do `data-testid="next-payment-card"` (que só existia no DebtorDashboard) também devem sair.

- [ ] **Step 3: Limpar `scripts/qa/flow-map.ts`**

Remover as entradas cujo `filePattern` aponta para arquivos deletados: `InvestorDashboard.tsx`, `DebtorDashboard.tsx`, `useDebtorFinance.ts`, e a de `useInvestorMetrics.ts` (o arquivo sobrevive, mas o mapeamento para `e2e/investor/dashboard.spec.ts` fica inválido).

Corrigir também as entradas que apontam `testFiles: ['e2e/debtor/dashboard.spec.ts']` para componentes que **continuam vivos** — `InstallmentDetailFlow.tsx`, `InstallmentRowActions.tsx`, `InstallmentModals.tsx`. Redirecionar para um spec de admin existente (`e2e/payment/` ou `e2e/e2e-full/payment-flows.spec.ts`); do contrário, mexer nesses arquivos deixaria de rodar qualquer teste.

⚠️ A entrada com `filePattern: 'PaymentModal.tsx'` casa por **substring** — ela afeta também o `PaymentModal` do admin em `InstallmentModals.tsx`. Não deixar apontando para spec inexistente.

Remover de `ALL_SPEC_FILES` as entradas `'e2e/investor/dashboard.spec.ts'` e `'e2e/debtor/dashboard.spec.ts'`.

- [ ] **Step 4: Reescrever `role-isolation.spec.ts` como teste puramente REST — NÃO apenas realocar**

⚠️ **Correção de uma premissa errada deste plano** (encontrada na revisão da Task 1): `e2e/auth/role-isolation.spec.ts` **não** é puramente REST. USR-ISO-01 e USR-ISO-02 fazem asserções de **UI**:

- `await expect(page.locator('aside')).toBeVisible({ timeout: 12_000 })` — **sem `.catch()`**. Após o gate da Task 1, um investidor nunca renderiza `<aside>`, então este teste passa a falhar por timeout e as asserções de RLS abaixo dele nunca são alcançadas.
- `expect(usersVisible).toBeFalsy()` — rodar isso com storageState de **admin** faz `usersVisible` ser `true`, ou seja, o teste falha. E `e2e/auth/` **está no Tier 2 do CI**, então a falha bloquearia o deploy.

Portanto: **não realocar como está.** Reescrever USR-ISO-01 e USR-ISO-02 para validar isolamento **apenas via REST**, sem `page.goto` e sem asserção de UI — obtendo o token do investidor/devedor via API e verificando o que a RLS retorna. É essa a cobertura que importa: o gate da Task 1 é de UI, e um não-admin bloqueado continua com JWT válido. A barreira real contra leitura/escrita indevida é a RLS do Supabase, e este spec é a única coisa que a cobre.

Se reescrever integralmente for grande demais para esta task, **pare e reporte** em vez de deletar o arquivo ou realocá-lo quebrado. Perder essa cobertura é pior que adiar a limpeza dos projetos.

- [ ] **Step 5: Remover os projetos de role do `playwright.config.ts`**

Só depois que o passo anterior estiver resolvido: remover os projetos `chromium-investor` e `chromium-debtor` e as entradas de `testIgnore` que referenciam `/investor/` e `/debtor/`.

Remover também de `e2e/auth.setup.ts` os dois `setup(...)` que autenticam investidor e devedor. Eles chamam `loginAs`, que espera `waitForSelector('aside')` — após o gate da Task 1, isso trava 15 s por role para qualquer dev que configure `TEST_INVESTOR_*` / `TEST_DEBTOR_*`. Hoje não morde porque essas variáveis não existem nem no CI nem no `.env.local`, e o setup cai no ramo `writeEmptyAuth`.

- [ ] **Step 6: Rodar a suíte que o CI roda**

Run: `npm run build && npm run preview` em um terminal, e em outro:
```bash
npx playwright test e2e/auth/ e2e/edge-cases.spec.ts e2e/admin/ e2e/contract/ e2e/reports/ e2e/system/ e2e/e2e-full/client-management.spec.ts e2e/e2e-full/contract-creation.spec.ts e2e/e2e-full/payment-flows.spec.ts e2e/payment/ --project=chromium --project=no-auth
```
Expected: mesma quantidade de falhas de antes da Fase 0 (idealmente zero). Qualquer falha nova é regressão desta fase.

⚠️ Verificar especificamente `e2e/reports/investor-monthly.spec.ts` (REL-INV-01): ele **roda** no projeto `chromium` com storageState de admin e seu cabeçalho menciona `chromium-investor`. Confirmar que ele exercita a aba mensal do admin e não o `InvestorDashboard` removido.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: remover specs e mapeamentos de QA das telas de investidor/devedor"
```

---

# FASE 1 — Renovação de contrato

## Task 6: Constante `INACTIVE_CONTRACT_STATUSES`

**Files:**
- Modify: `types.ts`, `hooks/useDashboardData.ts`, `components/dashboard/CollectionDashboard.tsx`, `hooks/useYieldMetrics.ts`, `components/Dashboard.tsx`

- [ ] **Step 1: Declarar a constante em `types.ts`**

`types.ts` é o dono do vocabulário de status (a union de `Investment.status`), não tem imports (sem risco de ciclo), já exporta valor em runtime (`export enum AppView`) e é importado por todos os call-sites. Adicionar logo abaixo do campo `status` da interface `Investment`:

```ts
/**
 * Contratos que NÃO representam dívida viva: já quitados ou substituídos por
 * uma renovação. Devem sair de cobrança, dashboard e métricas de capital.
 * 'defaulted' NÃO entra aqui — inadimplente continua sendo dinheiro na rua.
 */
export const INACTIVE_CONTRACT_STATUSES = ['completed', 'renewed'] as const;

export type InactiveContractStatus = (typeof INACTIVE_CONTRACT_STATUSES)[number];

export const isInactiveContract = (status?: string | null): boolean =>
  !!status && (INACTIVE_CONTRACT_STATUSES as readonly string[]).includes(status);
```

- [ ] **Step 2: Aplicar em `hooks/useDashboardData.ts` (ponto de estrangulamento)**

Este é o filtro que alimenta, por prop, todas as telas de cobrança. Procurar:

```ts
      const uniqueInstallments = instData.filter(
        (inst: any) => inst.investment?.status !== 'completed',
      );
```

Substituir por:

```ts
      const uniqueInstallments = instData.filter(
        (inst: any) => !isInactiveContract(inst.investment?.status),
      );
```

Acrescentar `isInactiveContract` ao import de `types`.

- [ ] **Step 3: Aplicar em `components/dashboard/CollectionDashboard.tsx`**

Procurar:

```tsx
      i.status !== 'paid' &&
      (i.investment as any)?.status !== 'completed' &&
```

Substituir a segunda linha por:

```tsx
      !isInactiveContract((i.investment as any)?.status) &&
```

Redundante após o Step 2 (todos os call-sites recebem `installments` já filtrado), mas mantido como defesa em profundidade — e porque o literal atual fica mentindo.

- [ ] **Step 4: Aplicar em `hooks/useYieldMetrics.ts` — ATENÇÃO À ARMADILHA**

Procurar:

```ts
      if (inv.status === 'completed' || inv.status === 'defaulted') return;
```

Substituir por:

```ts
      if (isInactiveContract(inv.status) || inv.status === 'defaulted') return;
```

⚠️ **Não** trocar o predicado inteiro pela constante: `'defaulted'` **não** pertence a `INACTIVE_CONTRACT_STATUSES`, e removê-lo daqui faria contratos inadimplentes voltarem a contar como capital ativo. A troca é aditiva.

- [ ] **Step 5: Aplicar em `components/Dashboard.tsx`**

Procurar o `forEach` sobre `investments` que reinjeta contratos sem parcelas no capital alocado (o comentário fala em "garante que contratos sem parcelas apareçam"). Ele não filtra status nenhum e reintroduz contratos que o Step 2 removeu. Adicionar a guarda no início do callback:

```tsx
      if (isInactiveContract(inv.status)) return;
```

- [ ] **Step 6: NÃO tocar nestes — verificados como corretos**

- `components/dashboard/CadernetaBullet.tsx` → `inv.status !== 'renewed'`: exclui `renewed` **de propósito** e mostra o ciclo de contratos quitados. Aplicar a constante aqui **quebra a tela**.
- `components/dashboard/YieldByContractType.tsx` → `!inv.status || inv.status === 'active'`: é allowlist, `renewed` já está fora.
- `hooks/useDebtorLateMap.ts` → `.not('investments.status', 'in', '(completed,renewed)')`: já correto; é filtro no servidor com sintaxe PostgREST própria.
- Todos os pontos de **exibição** de status (badges de "Quitado"/"Renovado" em `AdminContracts`, `ContractDetail`, `PlatformOwnerPanel`): são rótulos, não filtros.
- `hooks/useContractDetail.ts`: constrói a cadeia pai↔filho. Filtrar status aqui apaga a cadeia — o pai é justamente quem está `renewed`.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add types.ts hooks/useDashboardData.ts components/dashboard/CollectionDashboard.tsx hooks/useYieldMetrics.ts components/Dashboard.tsx
git commit -m "fix(dashboard): excluir contratos 'renewed' de cobrança, capital e métricas (dívida dupla)"
```

**Follow-up declarado, fora deste plano:** `hooks/useTopClientes.ts` e as stats agregadas de `components/AdminUserDetails.tsx` também somam pai renovado + filho. Não entram aqui porque exigem decidir se cada tela quer exposição atual ou histórico.

---

## Task 7: `data-testid` no card de contrato

Sem isto o teste de renovação não consegue abrir um contrato. O seletor que os testes usam hoje (`[data-testid="contract-card"]`) **não existe no DOM** — por isso `CNT-LC-01` faz `test.skip` em todo run e a renovação está, na prática, sem cobertura.

**Files:**
- Modify: `components/AdminContracts.tsx`

- [ ] **Step 1: Adicionar o atributo no card da lista**

Localizar o card da lista de contratos — o `div` com `key={contract.id}` e `className` contendo `panel-card`. Acrescentar:

```tsx
data-testid="contract-card"
data-contract-id={contract.id}
```

- [ ] **Step 2: Verificar que o seletor passa a casar**

Run: `npm run build && npm run preview`, e em outro terminal:
```bash
npx playwright test e2e/contract/contract-lifecycle.spec.ts --project=chromium --reporter=list
```
Expected: `CNT-LC-01` deixa de reportar "Sem contratos visíveis para renovar". Ele ainda pode falhar adiante (a UI de renovação muda na Task 9) — o que importa neste passo é que ele **para de pular**.

- [ ] **Step 3: Commit**

```bash
git add components/AdminContracts.tsx
git commit -m "test(e2e): expor data-testid no card de contrato — CNT-LC-01 pulava em todo run"
```

---

## Task 8: Migration — `p_parent_investment_id` no RPC

⚠️ **Migration em produção. Requer aprovação explícita do usuário antes de aplicar** (Claude é o guardião do banco). Validar o schema real via MCP antes e depois.

**Files:**
- Create: migration Supabase (via `mcp__supabase__apply_migration`, nome `add_parent_investment_id_to_create_investment_validated`)

- [ ] **Step 1: Confirmar a assinatura atual antes de mexer**

Run (MCP Supabase, `execute_sql`):
```sql
select pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_investment_validated';
```
Expected: exatamente uma linha, com 25 parâmetros terminando em `p_late_fine_percent numeric`.

Se retornar mais de uma linha, **parar** — já existe overload e o plano precisa ser revisto.

- [ ] **Step 2: Entender por que é `DROP` + `CREATE`, não `CREATE OR REPLACE`**

No Postgres, funções são identificadas por (nome, tipos dos argumentos). Adicionar um parâmetro **cria uma função nova** em vez de substituir a existente, mesmo com `CREATE OR REPLACE`. Com as duas coexistindo, o PostgREST não consegue resolver qual chamar quando recebe os 25 parâmetros antigos e responde `PGRST203` (ambiguidade). Por isso a migration derruba a assinatura antiga e cria a nova — **na mesma transação**, que é como o `apply_migration` executa.

- [ ] **Step 3: Aplicar a migration**

```sql
DROP FUNCTION IF EXISTS public.create_investment_validated(
  uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, numeric,
  integer, text, integer, integer, date, text, boolean, boolean, date[], uuid,
  text, boolean, numeric, integer, numeric
);

CREATE OR REPLACE FUNCTION public.create_investment_validated(
  p_tenant_id uuid,
  p_user_id uuid,
  p_payer_id uuid,
  p_asset_name text,
  p_amount_invested numeric,
  p_source_capital numeric DEFAULT 0,
  p_source_profit numeric DEFAULT 0,
  p_current_value numeric DEFAULT 0,
  p_interest_rate numeric DEFAULT 0,
  p_installment_value numeric DEFAULT 0,
  p_total_installments integer DEFAULT 1,
  p_frequency text DEFAULT 'monthly'::text,
  p_due_day integer DEFAULT NULL::integer,
  p_weekday integer DEFAULT NULL::integer,
  p_start_date date DEFAULT NULL::date,
  p_calculation_mode text DEFAULT 'manual'::text,
  p_skip_saturday boolean DEFAULT false,
  p_skip_sunday boolean DEFAULT false,
  p_custom_dates date[] DEFAULT NULL::date[],
  p_company_id uuid DEFAULT NULL::uuid,
  p_bullet_principal_mode text DEFAULT NULL::text,
  p_capitalize_interest boolean DEFAULT true,
  p_break_fee_percent numeric DEFAULT NULL::numeric,
  p_default_after_days integer DEFAULT 20,
  p_late_fine_percent numeric DEFAULT NULL::numeric,
  p_parent_investment_id bigint DEFAULT NULL::bigint
)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_investment_id BIGINT; v_amount_principal NUMERIC; v_amount_interest NUMERIC;
  v_installment_value_rounded NUMERIC; v_due_date DATE; v_base_date DATE; v_effective_day INTEGER;
  v_bd_count INTEGER; v_candidate DATE; v_target_company_id UUID; v_is_bullet BOOLEAN;
  v_interest_per_period NUMERIC; i INTEGER; v_correlation UUID := gen_random_uuid(); v_first_inst_id UUID;
  v_days_ahead INTEGER;
  v_parent_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND public.get_tenant_id_safe() IS NOT NULL AND p_tenant_id <> public.get_tenant_id_safe() THEN
    RAISE EXCEPTION 'Tenant inválido para o usuário autenticado.';
  END IF;
  IF p_default_after_days IS NOT NULL AND p_default_after_days < 1 THEN
    RAISE EXCEPTION 'default_after_days deve ser >= 1 (recebido: %)', p_default_after_days; END IF;
  IF p_break_fee_percent IS NOT NULL AND (p_break_fee_percent < 0 OR p_break_fee_percent > 100) THEN
    RAISE EXCEPTION 'break_fee_percent deve estar entre 0 e 100 (recebido: %)', p_break_fee_percent; END IF;
  IF p_late_fine_percent IS NOT NULL AND (p_late_fine_percent < 0 OR p_late_fine_percent > 100) THEN
    RAISE EXCEPTION 'late_fine_percent deve estar entre 0 e 100 (recebido: %)', p_late_fine_percent; END IF;

  -- BR-CNT-007 / BR-CNT-009: renovação valida e trava o contrato de origem ANTES de criar o filho.
  -- FOR UPDATE evita corrida entre a leitura do status e a transição.
  IF p_parent_investment_id IS NOT NULL THEN
    SELECT status INTO v_parent_status
      FROM public.investments
     WHERE id = p_parent_investment_id AND tenant_id = p_tenant_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contrato de origem % não encontrado neste tenant.', p_parent_investment_id;
    END IF;
    IF v_parent_status = 'defaulted' THEN
      RAISE EXCEPTION 'Contrato inadimplente não pode ser renovado — reverta o status primeiro.';
    END IF;
    IF v_parent_status = 'renewed' THEN
      RAISE EXCEPTION 'Contrato já foi renovado.';
    END IF;
  END IF;

  v_target_company_id := public.resolve_company_id_for_tenant(p_tenant_id, p_company_id, p_user_id, p_payer_id);
  v_is_bullet := (p_calculation_mode = 'interest_only');
  v_installment_value_rounded := ROUND(p_installment_value::numeric, 2);
  IF v_is_bullet THEN
    v_interest_per_period := ROUND(p_amount_invested * (p_interest_rate / 100), 2);
    v_installment_value_rounded := v_interest_per_period;
  END IF;

  INSERT INTO public.investments (
    tenant_id, company_id, user_id, payer_id, asset_name, amount_invested, current_value, interest_rate,
    installment_value, total_installments, frequency, due_day, weekday, start_date, calculation_mode,
    source_capital, source_profit, bullet_principal_mode, remaining_balance, capitalize_interest,
    break_fee_percent, default_after_days, late_fine_percent,
    include_saturday, include_sunday, parent_investment_id
  ) VALUES (
    p_tenant_id, v_target_company_id, p_user_id, p_payer_id, p_asset_name, p_amount_invested, p_current_value, p_interest_rate,
    v_installment_value_rounded,
    CASE WHEN v_is_bullet THEN NULL WHEN p_bullet_principal_mode = 'separate' THEN p_total_installments + 1 ELSE p_total_installments END,
    p_frequency, p_due_day, p_weekday, p_start_date, p_calculation_mode, p_source_capital, p_source_profit,
    CASE WHEN v_is_bullet THEN NULL ELSE p_bullet_principal_mode END,
    CASE WHEN v_is_bullet THEN p_amount_invested ELSE NULL END,
    CASE WHEN v_is_bullet THEN p_capitalize_interest ELSE TRUE END,
    CASE WHEN v_is_bullet THEN p_break_fee_percent ELSE NULL END,
    COALESCE(p_default_after_days, 20),
    CASE WHEN v_is_bullet THEN p_late_fine_percent ELSE NULL END,
    NOT COALESCE(p_skip_saturday, false),
    NOT COALESCE(p_skip_sunday, false),
    p_parent_investment_id
  ) RETURNING id INTO v_investment_id;

  -- BR-CNT-007: pai 'active' vira 'renewed'; pai 'completed' PERMANECE 'completed'
  -- (BR-CNT-009 não permite completed -> renewed).
  IF p_parent_investment_id IS NOT NULL AND v_parent_status = 'active' THEN
    UPDATE public.investments
       SET status = 'renewed', updated_at = NOW()
     WHERE id = p_parent_investment_id;
  END IF;

  IF p_parent_investment_id IS NOT NULL THEN
    PERFORM public.log_audit_event(
      p_tenant_id, 'contract_renewed', 'rpc', auth.uid(), v_target_company_id, v_investment_id, NULL, NULL,
      v_correlation, NULL,
      jsonb_build_object('parent_investment_id', p_parent_investment_id, 'parent_status_before', v_parent_status),
      jsonb_build_object('child_investment_id', v_investment_id,
                         'parent_status_after', CASE WHEN v_parent_status = 'active' THEN 'renewed' ELSE v_parent_status END),
      NULL, NULL, NULL
    );
  END IF;

  PERFORM public.log_audit_event(
    p_tenant_id, CASE WHEN v_is_bullet THEN 'bullet_contract_created' ELSE 'contract_created' END, 'rpc',
    auth.uid(), v_target_company_id, v_investment_id, NULL, NULL, v_correlation, NULL, NULL,
    jsonb_build_object('calculation_mode',p_calculation_mode,'amount_invested',p_amount_invested,'interest_rate',p_interest_rate,
                       'break_fee_percent',CASE WHEN v_is_bullet THEN p_break_fee_percent END,
                       'default_after_days',COALESCE(p_default_after_days,20),
                       'late_fine_percent',CASE WHEN v_is_bullet THEN p_late_fine_percent END),
    jsonb_build_object('amount_invested',p_amount_invested), NULL, NULL
  );

  IF v_is_bullet THEN
    IF p_frequency = 'monthly' THEN
      IF p_start_date IS NOT NULL THEN v_due_date := p_start_date;
      ELSE
        v_effective_day := COALESCE(p_due_day, 1);
        IF v_effective_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
          v_base_date := (DATE_TRUNC('month', CURRENT_DATE) + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
        ELSE v_base_date := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + (v_effective_day - 1) * INTERVAL '1 day')::DATE; END IF;
        v_due_date := LEAST(v_base_date, (DATE_TRUNC('month', v_base_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);
      END IF;
    ELSIF p_frequency = 'weekly' THEN
      IF p_start_date IS NOT NULL THEN v_due_date := p_start_date;
      ELSE
        v_days_ahead := ((COALESCE(p_weekday, 1) - EXTRACT(DOW FROM CURRENT_DATE)::INTEGER + 7) % 7);
        IF v_days_ahead = 0 THEN v_days_ahead := 7; END IF;
        v_due_date := (CURRENT_DATE + (v_days_ahead || ' days')::INTERVAL)::DATE;
      END IF;
    ELSIF p_frequency = 'freelancer' AND p_custom_dates IS NOT NULL AND array_length(p_custom_dates, 1) >= 1 THEN
      v_due_date := p_custom_dates[1];
    ELSE
      v_candidate := COALESCE(p_start_date, CURRENT_DATE);
      IF p_skip_saturday OR p_skip_sunday THEN
        WHILE (p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0) OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6) LOOP
          v_candidate := v_candidate + INTERVAL '1 day'; END LOOP;
      END IF;
      v_due_date := v_candidate;
    END IF;

    INSERT INTO public.loan_installments (investment_id, tenant_id, company_id, number, due_date, amount_principal, amount_interest, amount_total, status)
    VALUES (v_investment_id, p_tenant_id, v_target_company_id, 1, v_due_date, p_amount_invested, v_interest_per_period, p_amount_invested + v_interest_per_period, 'pending')
    RETURNING id INTO v_first_inst_id;

    PERFORM public.log_audit_event(
      p_tenant_id, 'bullet_cycle_created', 'rpc', auth.uid(), v_target_company_id, v_investment_id, v_first_inst_id, NULL, v_correlation, NULL, NULL,
      jsonb_build_object('number',1,'due_date',v_due_date,'amount_interest',v_interest_per_period),
      jsonb_build_object('interest',v_interest_per_period,'principal',p_amount_invested), NULL, NULL
    );

    RETURN v_investment_id;
  END IF;

  v_amount_principal := ROUND(p_amount_invested / NULLIF(p_total_installments, 0), 2);
  v_amount_interest  := ROUND((p_current_value - p_amount_invested) / NULLIF(p_total_installments, 0), 2);
  IF p_frequency = 'monthly' THEN
    IF p_start_date IS NOT NULL THEN v_base_date := p_start_date;
    ELSE
      v_effective_day := COALESCE(p_due_day, 1);
      IF v_effective_day >= EXTRACT(DAY FROM CURRENT_DATE)::INTEGER THEN
        v_base_date := (DATE_TRUNC('month', CURRENT_DATE) + (v_effective_day - 1) * INTERVAL '1 day')::DATE;
      ELSE v_base_date := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + (v_effective_day - 1) * INTERVAL '1 day')::DATE; END IF;
    END IF;
  END IF;
  FOR i IN 1..p_total_installments LOOP
    IF p_frequency = 'monthly' THEN
      v_due_date := (DATE_TRUNC('month', v_base_date + ((i-1) || ' months')::INTERVAL) + (EXTRACT(DAY FROM v_base_date)::INTEGER - 1) * INTERVAL '1 day')::DATE;
      v_due_date := LEAST(v_due_date, (DATE_TRUNC('month', v_due_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);
    ELSIF p_frequency = 'weekly' THEN v_due_date := (CURRENT_DATE + (i * 7 || ' days')::INTERVAL)::DATE;
    ELSIF p_frequency = 'freelancer' AND p_custom_dates IS NOT NULL AND array_length(p_custom_dates, 1) >= i THEN v_due_date := p_custom_dates[i];
    ELSIF p_frequency = 'daily' THEN
      IF p_skip_saturday OR p_skip_sunday THEN
        v_bd_count := 0; v_candidate := COALESCE(p_start_date, CURRENT_DATE);
        WHILE v_bd_count < i LOOP
          IF NOT ((p_skip_sunday AND EXTRACT(DOW FROM v_candidate) = 0) OR (p_skip_saturday AND EXTRACT(DOW FROM v_candidate) = 6)) THEN v_bd_count := v_bd_count + 1; END IF;
          IF v_bd_count < i THEN v_candidate := v_candidate + INTERVAL '1 day'; END IF;
        END LOOP;
        v_due_date := v_candidate;
      ELSE v_due_date := COALESCE(p_start_date, CURRENT_DATE) + ((i - 1) || ' days')::INTERVAL; END IF;
    ELSE v_due_date := CURRENT_DATE; END IF;
    INSERT INTO public.loan_installments (investment_id, tenant_id, company_id, number, due_date, amount_principal, amount_interest, amount_total, status)
    VALUES (v_investment_id, p_tenant_id, v_target_company_id, i, v_due_date, v_amount_principal, v_amount_interest, ROUND(v_amount_principal + v_amount_interest, 2), 'pending');
  END LOOP;
  RETURN v_investment_id;
END;
$function$;
```

- [ ] **Step 4: Validar que ficou UMA função só**

Run (MCP Supabase, `execute_sql`):
```sql
select pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'create_investment_validated';
```
Expected: exatamente **uma** linha, terminando em `p_parent_investment_id bigint`.

Mais de uma linha significa overload ativo → PostgREST vai responder `PGRST203` em toda criação de contrato. Derrubar a assinatura sobrando imediatamente.

- [ ] **Step 5: Verificar que os chamadores existentes não quebraram**

Seis pontos chamam esta RPC: `components/AdminContracts.tsx`, `components/QuickContractInput.tsx`, `e-finance-bot/src/actions/admin-actions.ts`, `e-finance-bot/scripts/validate-window-reports.ts`, `e2e/fixtures/e2e-test-helpers.ts` e o stub em `e-finance-bot-go/cmd/spike/main.go`. Todos passam parâmetros **nomeados**, e o novo tem `DEFAULT NULL` — nenhum precisa mudar.

Run: `npm run build && npm run preview`, criar um contrato normal pelo wizard na UI.
Expected: contrato criado, com `parent_investment_id` nulo.

- [ ] **Step 6: Commit**

A migration vive no Supabase, mas registre a mudança no repo:

```bash
git add docs/superpowers/plans/2026-08-03-renovacao-e-limpeza-dashboards.md
git commit -m "feat(db): create_investment_validated aceita p_parent_investment_id com vínculo e transição atômicos"
```

---

## Task 9: Wizard em modo renovação

**Files:**
- Modify: `components/AdminContracts.tsx`

- [ ] **Step 1: Redirecionar `onRenew` para o wizard**

Procurar:

```tsx
        onRenew={(inv) => { setRenewalSource(inv); setContractsSubView('renewal'); }}
```

Substituir por:

```tsx
        onRenew={(inv) => { setRenewalSource(inv); setStep(2); setContractsSubView('create'); }}
```

O wizard abre direto no step 2 porque investidor e devedor vêm do contrato pai. O step 1 continua alcançável pelo botão "Voltar", permitindo trocar as partes.

- [ ] **Step 2: Pré-preencher o wizard a partir do contrato pai**

Adicionar este `useEffect` junto aos demais efeitos do componente (depois do efeito que carrega `availableProfit`):

```tsx
  // Renovação: o wizard é a única tela de contrato. Ao receber um contrato de origem,
  // espelha os termos dele no formulário — tudo editável. Depende de `profiles` porque
  // investidor/devedor são resolvidos por id.
  useEffect(() => {
    if (!renewalSource || contractsSubView !== 'create' || profiles.length === 0) return;

    const src = renewalSource;
    const isBullet = src.calculation_mode === 'interest_only';

    setSelectedInvestor(profiles.find(p => p.id === src.user_id) || null);
    setSelectedPayer(profiles.find(p => p.id === src.payer_id) || null);

    const nextForm = {
      asset_name: `${src.asset_name} (Renovação)`,
      amount_invested: Number(src.amount_invested) || 0,
      total_installments: Number(src.total_installments) || 12,
      frequency: (src.frequency || 'monthly') as typeof formData.frequency,
      due_day: Number(src.due_day) || 10,
      weekday: Number(src.weekday) || 1,
      start_date: getBrazilToday(),
      interest_rate: src.interest_rate != null ? Number(src.interest_rate) : 10,
      installment_value: Number(src.installment_value) || 0,
      current_value: 0,
      calculation_mode: (src.calculation_mode || 'auto') as typeof formData.calculation_mode,
      // source_profit_amount fica 0: availableProfit chega por efeito assíncrono e
      // qualquer valor pré-preenchido aqui seria clampado a 0 por updateFormState.
      source_profit_amount: 0,
      skip_saturday: src.include_saturday === false,
      skip_sunday: src.include_sunday === false,
      bullet_principal_mode: (src.bullet_principal_mode || 'together') as typeof formData.bullet_principal_mode,
      capitalize_interest: src.capitalize_interest !== false,
      break_fee_percent: isBullet && src.break_fee_percent != null ? String(src.break_fee_percent) : '',
      default_after_days: Number(src.default_after_days) || 20,
      late_fine_percent: isBullet && src.late_fine_percent != null ? String(src.late_fine_percent) : '',
    };

    const financial = calculateFinancials(
      nextForm.amount_invested,
      nextForm.total_installments,
      nextForm.interest_rate,
      nextForm.calculation_mode,
      nextForm.installment_value,
      nextForm.bullet_principal_mode,
    );

    setFormData({
      ...nextForm,
      installment_value: financial.installmentValue,
      current_value: financial.totalValue,
      interest_rate: financial.interestRate,
    });

    setInstallmentsInput(String(nextForm.total_installments));
    setRateInput(String(financial.interestRate));
    setInstallmentValueInput(String(financial.installmentValue));
    setMonthOffset(undefined);
    setFreelancerDates([]);

    if (nextForm.frequency !== 'freelancer') {
      const dateObjects = calculateInstallmentDates(
        nextForm.frequency,
        nextForm.due_day,
        nextForm.weekday,
        nextForm.start_date,
        nextForm.total_installments,
        nextForm.skip_saturday,
        nextForm.skip_sunday,
        undefined,
      );
      setPreviewDateStrings(dateObjects.map(d =>
        d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })
      ));
    } else {
      setPreviewDateStrings([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renewalSource, contractsSubView, profiles]);
```

⚠️ **Por que não usar `updateFormState` aqui:** ela monta `merged` a partir do `formData` do closure, não de `prev`. Duas chamadas no mesmo tick recalculariam ambas sobre o estado velho. O prefill faz um único `setFormData` e replica manualmente os três efeitos colaterais dela (espelhos de input, `monthOffset`, preview de datas).

⚠️ `skip_saturday`/`skip_sunday` são o **inverso** de `include_saturday`/`include_sunday` no banco — o RPC grava `NOT COALESCE(p_skip_saturday, false)`. A conversão acima respeita isso.

- [ ] **Step 3: Banner de renovação no header do wizard**

Procurar o título do wizard:

```tsx
                <h3 className="type-label text-[color:var(--text-primary)] flex items-center gap-2">
                    Novo Contrato
                </h3>
```

Substituir o texto por condicional:

```tsx
                <h3 className="type-label text-[color:var(--text-primary)] flex items-center gap-2">
                    {renewalSource ? 'Renovar Contrato' : 'Novo Contrato'}
                </h3>
                {renewalSource && (
                    <p className="mt-1 text-xs text-[color:var(--text-faint)] truncate">
                        Renovação de #{renewalSource.id} —{' '}
                        <span className="font-semibold text-[color:var(--accent-brass)]">{renewalSource.asset_name}</span>
                    </p>
                )}
```

O texto "Renovar Contrato" mantém compatível o seletor que os testes já usam.

- [ ] **Step 4: Ajustar o botão X do header para o modo renovação**

Procurar o `onClick` do botão de fechar do wizard (`setContractsSubView('list')` dentro do header) e substituir por:

```tsx
              onClick={() => {
                  if (renewalSource) { setRenewalSource(null); setContractsSubView('detail'); return; }
                  setContractsSubView('list');
              }}
```

- [ ] **Step 5: Rotular o botão de submit**

Procurar o botão final do wizard, cujo label é `Criar Contrato`, e trocar o texto por:

```tsx
{renewalSource ? 'Renovar Contrato' : 'Criar Contrato'}
```

- [ ] **Step 6: Enviar `p_parent_investment_id` no submit**

Em `handleCreateContract`, dentro do objeto de parâmetros do `supabase.rpc('create_investment_validated', {...})`, acrescentar após `p_late_fine_percent`:

```ts
              p_parent_investment_id: renewalSource?.id ?? null,
```

E no `logEvent` de sucesso, trocar o `event_type` por condicional e registrar o pai:

```ts
              event_category: 'contract', event_type: renewalSource ? 'contract_renewed' : 'contract_created',
```

acrescentando ao objeto `after`:

```ts
                ...(renewalSource ? { parent_investment_id: renewalSource.id } : {}),
```

- [ ] **Step 7: Limpar `renewalSource` no sucesso**

Ainda em `handleCreateContract`, procurar:

```ts
          setContractsSubView('list');
          fetchData();
```

Substituir por:

```ts
          setRenewalSource(null);
          setContractsSubView('list');
          fetchData();
```

- [ ] **Step 8: Limpar `renewalSource` ao abrir o wizard normal — OBRIGATÓRIO**

Em `handleOpenWizard`, junto dos demais resets (`setStep(1)`, `setMonthOffset(undefined)` etc.), adicionar:

```tsx
      setRenewalSource(null);
```

Sem isto, `renewalSource` fica pegajoso: depois de uma renovação, o próximo "Novo Contrato" criaria um contrato com `p_parent_investment_id` do contrato anterior e derrubaria o pai para `renewed`. É o bug mais grave que esta task pode introduzir.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add components/AdminContracts.tsx
git commit -m "feat(contracts): renovação usa o wizard de criação — paridade total de campos e vínculo via RPC"
```

---

## Task 10: Deletar o `ContractRenewalModal`

**Files:**
- Delete: `components/ContractRenewalModal.tsx`
- Modify: `components/AdminContracts.tsx`

- [ ] **Step 1: Remover o import**

```tsx
import ContractRenewalModal from './ContractRenewalModal';
```

- [ ] **Step 2: Remover a branch da sub-view**

Apagar o bloco inteiro:

```tsx
  if (contractsSubView === 'renewal') {
    return (
      <ContractRenewalModal
        sourceContract={renewalSource}
        onBack={() => setContractsSubView('detail')}
        onSuccess={() => { fetchData(); setContractsSubView('list'); setViewingContractId(null); setRenewalSource(null); }}
      />
    );
  }
```

- [ ] **Step 3: Remover `'renewal'` da union do estado**

Procurar:

```tsx
  const [contractsSubView, setContractsSubView] = useState<'list' | 'detail' | 'renewal' | 'create' | 'create-client' | 'edit'>(autoOpenCreate ? 'create' : 'list');
```

Substituir por:

```tsx
  const [contractsSubView, setContractsSubView] = useState<'list' | 'detail' | 'create' | 'create-client' | 'edit'>(autoOpenCreate ? 'create' : 'list');
```

O TypeScript passa a acusar qualquer referência remanescente a `'renewal'` — use isso como verificação.

- [ ] **Step 4: Deletar o arquivo**

```bash
git rm components/ContractRenewalModal.tsx
```

- [ ] **Step 5: Confirmar que nada referencia o modal**

Run:
```bash
grep -rn "ContractRenewalModal\|'renewal'" --include="*.ts" --include="*.tsx" . | grep -v node_modules
```
Expected: apenas `scripts/qa/flow-map.ts` (corrigido no passo seguinte) e nenhuma referência em `components/`.

- [ ] **Step 6: Corrigir `scripts/qa/flow-map.ts`**

Remover ou redirecionar a entrada com `filePattern: 'ContractRenewalModal.tsx'` para `e2e/contract/contract-lifecycle.spec.ts`.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: deletar ContractRenewalModal — renovação passou a usar o wizard (-534 linhas)"
```

---

## Task 11: Testes E2E de renovação

**Files:**
- Modify: `e2e/contract/contract-lifecycle.spec.ts`

- [ ] **Step 1: Reescrever CNT-LC-01 para o wizard**

Substituir o corpo do teste `CNT-LC-01` por:

```ts
test('CNT-LC-01 [BR-CNT-007]: Renovar contrato via wizard → filho com parent_investment_id', async ({ page }) => {
  await waitForApp(page);
  const ctx = await getCtx(page);
  if (!ctx) { test.skip(true, 'Credenciais ausentes'); return; }
  const { tenantId } = await resolveScope(ctx);
  if (!tenantId) { test.skip(true, 'Tenant não encontrado'); return; }

  await selectSpecificCompany(page);
  await navigateToView(page, 'Contratos');

  const card = page.locator('[data-testid="contract-card"]').first();
  if (!(await card.isVisible({ timeout: 8_000 }).catch(() => false))) {
    test.skip(true, 'Sem contratos visíveis para renovar');
    return;
  }
  const parentId = await card.getAttribute('data-contract-id');
  expect(parentId).toBeTruthy();

  // Abre o detalhe pelo botão de olho
  await page.getByTitle('Ver detalhes').first().click();

  const renewBtn = page.getByRole('button', { name: /Renovar Contrato/i }).first();
  await renewBtn.waitFor({ state: 'visible', timeout: 8_000 });
  await renewBtn.click();

  // O wizard abre no step 2 — "Termos Financeiros"
  await expect(page.getByText(/Termos Financeiros/i).first()).toBeVisible({ timeout: 8_000 });

  // Avança para a revisão e confirma
  await page.getByRole('button', { name: /^Próximo/i }).click();
  await expect(page.getByText(/Revisão Final/i).first()).toBeVisible({ timeout: 6_000 });
  await page.getByRole('button', { name: /Renovar Contrato/i }).last().click();

  // Volta para a lista; confirma o vínculo no banco
  await page.waitForTimeout(2_000);
  const children = await restCall(
    ctx,
    `investments?tenant_id=eq.${tenantId}&parent_investment_id=eq.${parentId}&select=id,status&limit=1`,
  );
  expect(children?.length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Rodar e verificar que passa**

Run: `npm run build && npm run preview`, e em outro terminal:
```bash
npx playwright test e2e/contract/contract-lifecycle.spec.ts --project=chromium --reporter=list
```
Expected: `CNT-LC-01` **passa** (não pula). Se pular por "Sem contratos visíveis", a Task 7 não foi aplicada.

- [ ] **Step 3: Acrescentar o teste de contrato quitado**

```ts
test('CNT-LC-06 [BR-CNT-007]: Renovar contrato quitado mantém o pai como completed', async ({ page }) => {
  await waitForApp(page);
  const ctx = await getCtx(page);
  if (!ctx) { test.skip(true, 'Credenciais ausentes'); return; }
  const { tenantId, companyId } = await resolveScope(ctx);
  if (!tenantId) { test.skip(true, 'Tenant não encontrado'); return; }

  const profs = await restCall(ctx, `profiles?select=id&tenant_id=eq.${tenantId}&limit=2`);
  if (!profs || profs.length < 2) { test.skip(true, 'Perfis insuficientes'); return; }

  // Cria um contrato já quitado direto via REST
  const created = await restCall(ctx, 'investments', 'POST', {
    tenant_id: tenantId, company_id: companyId,
    user_id: profs[0].id, payer_id: profs[1].id,
    asset_name: 'TESTE E2E RENOVACAO QUITADO',
    amount_invested: 1000, current_value: 1100, interest_rate: 10,
    installment_value: 1100, total_installments: 1, current_installment: 1,
    type: 'Bond', frequency: 'monthly', due_day: 10,
    calculation_mode: 'auto', status: 'completed',
    source_capital: 1000, source_profit: 0,
    notes: 'E2E_TEST_RENEWAL',
  }, 'return=representation');

  const parentId = created?.[0]?.id;
  expect(parentId).toBeTruthy();

  try {
    const childId = await restCall(ctx, 'rpc/create_investment_validated', 'POST', {
      p_tenant_id: tenantId, p_user_id: profs[0].id, p_payer_id: profs[1].id,
      p_asset_name: 'TESTE E2E RENOVACAO FILHO',
      p_amount_invested: 1000, p_source_capital: 1000, p_source_profit: 0,
      p_current_value: 1100, p_interest_rate: 10, p_installment_value: 1100,
      p_total_installments: 1, p_frequency: 'monthly', p_due_day: 10,
      p_calculation_mode: 'auto', p_company_id: companyId,
      p_parent_investment_id: parentId,
    });
    expect(childId).toBeTruthy();

    const parent = await restCall(ctx, `investments?id=eq.${parentId}&select=status`);
    expect(parent?.[0]?.status).toBe('completed');   // BR-CNT-007: quitado NÃO vira renewed

    const child = await restCall(ctx, `investments?id=eq.${childId}&select=parent_investment_id`);
    expect(Number(child?.[0]?.parent_investment_id)).toBe(Number(parentId));

    await restCall(ctx, `loan_installments?investment_id=eq.${childId}`, 'DELETE');
    await restCall(ctx, `investments?id=eq.${childId}`, 'DELETE');
  } finally {
    await restCall(ctx, `investments?id=eq.${parentId}`, 'DELETE');
  }
});
```

- [ ] **Step 4: Acrescentar o teste de contrato inadimplente bloqueado**

```ts
test('CNT-LC-07 [BR-CNT-007]: Renovar contrato defaulted é rejeitado pelo RPC', async ({ page }) => {
  await waitForApp(page);
  const ctx = await getCtx(page);
  if (!ctx) { test.skip(true, 'Credenciais ausentes'); return; }
  const { tenantId, companyId } = await resolveScope(ctx);
  if (!tenantId) { test.skip(true, 'Tenant não encontrado'); return; }

  const profs = await restCall(ctx, `profiles?select=id&tenant_id=eq.${tenantId}&limit=2`);
  if (!profs || profs.length < 2) { test.skip(true, 'Perfis insuficientes'); return; }

  const created = await restCall(ctx, 'investments', 'POST', {
    tenant_id: tenantId, company_id: companyId,
    user_id: profs[0].id, payer_id: profs[1].id,
    asset_name: 'TESTE E2E RENOVACAO DEFAULTED',
    amount_invested: 1000, current_value: 1100, interest_rate: 10,
    installment_value: 1100, total_installments: 1, current_installment: 1,
    type: 'Bond', frequency: 'monthly', due_day: 10,
    calculation_mode: 'auto', status: 'defaulted',
    source_capital: 1000, source_profit: 0,
    notes: 'E2E_TEST_RENEWAL',
  }, 'return=representation');

  const parentId = created?.[0]?.id;
  expect(parentId).toBeTruthy();

  try {
    let rejected = false;
    try {
      await restCall(ctx, 'rpc/create_investment_validated', 'POST', {
        p_tenant_id: tenantId, p_user_id: profs[0].id, p_payer_id: profs[1].id,
        p_asset_name: 'TESTE E2E FILHO PROIBIDO',
        p_amount_invested: 1000, p_source_capital: 1000, p_source_profit: 0,
        p_current_value: 1100, p_interest_rate: 10, p_installment_value: 1100,
        p_total_installments: 1, p_frequency: 'monthly', p_due_day: 10,
        p_calculation_mode: 'auto', p_company_id: companyId,
        p_parent_investment_id: parentId,
      });
    } catch {
      rejected = true;   // restCall lança em resposta !ok
    }
    expect(rejected).toBeTruthy();

    // Nenhum filho pode ter sido criado
    const children = await restCall(ctx, `investments?parent_investment_id=eq.${parentId}&select=id`);
    expect(children?.length ?? 0).toBe(0);
  } finally {
    await restCall(ctx, `investments?id=eq.${parentId}`, 'DELETE');
  }
});
```

- [ ] **Step 5: Rodar a suíte de contratos inteira**

Run:
```bash
npx playwright test e2e/contract/ --project=chromium --reporter=list
```
Expected: CNT-LC-01, CNT-LC-06 e CNT-LC-07 passam; os demais mantêm o resultado anterior.

- [ ] **Step 6: Commit**

```bash
git add e2e/contract/contract-lifecycle.spec.ts
git commit -m "test(e2e): cobrir renovação pelo wizard, pai quitado e bloqueio de inadimplente"
```

---

## Task 12: Atualizar as regras de negócio

**Files:**
- Modify: `docs/business-rules/e-finance-br.md`

- [ ] **Step 1: Atualizar BR-CNT-007**

Na seção `### BR-CNT-007: Renovação cria vínculo parent→child e transita status`:

- Trocar a **Condição** de `Ao executar ContractRenewalModal / lógica de renovação` para `Ao executar create_investment_validated com p_parent_investment_id não-nulo`.
- No **Resultado**, registrar que a transição é aplicada pelo RPC dentro da transação que cria o filho, e **não é opcional** (o checkbox "Marcar contrato original como Renovado" deixou de existir).
- Nas **Exceções**, acrescentar que renovar um contrato já `renewed` é rejeitado, e que a leitura do pai usa `FOR UPDATE`.

- [ ] **Step 2: Atualizar BR-CNT-011**

Na seção `### BR-CNT-011`, no item **Efeito em UI**, registrar que contratos `renewed` também são excluídos de cobrança, dashboard e métricas de capital, via `INACTIVE_CONTRACT_STATUSES` em `types.ts`, e que `defaulted` continua fora dessa lista por representar dívida viva.

- [ ] **Step 3: Registrar a remoção das telas de role**

Acrescentar uma nota no topo do documento indicando que, desde 2026-08, a aplicação web é exclusiva de `admin`; os perfis `investor` e `debtor` seguem existindo como dados (`investments.user_id` / `payer_id`) mas não têm tela própria.

- [ ] **Step 4: Commit**

```bash
git add docs/business-rules/e-finance-br.md
git commit -m "docs(br): BR-CNT-007/011 refletem renovação via RPC e exclusão de 'renewed'"
```

---

## Verificação final

- [ ] **Step 1: Typecheck — o gate real do CI**

Run: `npx tsc --noEmit`
Expected: sem erros. Este é o comando que congela produção quando falha.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build conclui sem erro.

- [ ] **Step 3: Suíte que o CI executa**

Run: `npm run preview` em um terminal e, em outro:
```bash
npx playwright test e2e/auth/ e2e/edge-cases.spec.ts e2e/admin/ e2e/contract/ e2e/reports/ e2e/system/ e2e/e2e-full/client-management.spec.ts e2e/e2e-full/contract-creation.spec.ts e2e/e2e-full/payment-flows.spec.ts e2e/payment/ --project=chromium --project=no-auth
```
Expected: nenhuma falha nova em relação ao baseline anterior à Fase 0.

- [ ] **Step 4: Validar o banco depois de tudo**

Run (MCP Supabase):
```sql
select count(*) as funcoes from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'create_investment_validated';
select status, count(*) from investments group by status order by 2 desc;
```
Expected: `funcoes = 1`; distribuição de status coerente com o baseline (243 active / 197 completed / 3 renewed, mais o que os testes criaram e limparam).

- [ ] **Step 5: Entregar ao @devops**

`git push`, PR e merge são autoridade **exclusiva** do @devops. Não executar aqui.

---

## Follow-ups declarados (fora deste plano)

1. `hooks/useTopClientes.ts` e as stats agregadas de `components/AdminUserDetails.tsx` somam pai renovado + filho. Exige decidir por tela entre exposição atual e histórico.
2. A RPC `complete_oauth_onboarding` continua aceitando `p_mode: 'invite'`; convites pendentes seguem na tabela. Remover exige migration própria.
3. A Edge Function `generate-pix` continua publicada no Supabase sem consumidor no app após a Fase 0. Decidir se despublica.
4. 2 parcelas em aberto (R$ 1.760) em contratos com status `completed` — anomalia de dados encontrada durante o levantamento, não causada por este trabalho.
5. Os forms de PIX em `AdminSettings` e `OnboardingWizard` gravam config que, após a Fase 0, só o bot lê. Mantidos de propósito.
6. Cenários de renovação não pedidos: rollover de saldo devedor, aporte adicional, entrada e renegociação de inadimplente.
