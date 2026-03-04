# QA Fix Request — E-Finance
**Para:** @dev (Dex)
**De:** Quinn (@qa) + Uma (@ux-design-expert)
**Data:** 2026-03-04
**Prioridade:** P0 → P2 (implementar nessa ordem)

---

## Visão Geral

Este documento consolida todas as mudanças necessárias identificadas pela análise de QA e UX do projeto E-Finance. Está organizado por arquivo, com instruções específicas de implementação.

**Referências:**
- Testes E2E: `docs/qa/e2e-test-plan.md`
- Melhorias UX: `docs/qa/ux-improvements.md`

---

## 📦 SETUP — Pré-requisitos (fazer primeiro)

### [SETUP-01] Instalar Playwright

```bash
npm install -D @playwright/test
npx playwright install chromium
```

### [SETUP-02] Criar `playwright.config.ts` na raiz

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### [SETUP-03] Atualizar `package.json` — adicionar scripts

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:e2e:report": "playwright show-report"
```

### [SETUP-04] Criar estrutura de diretórios

```bash
mkdir -p e2e/auth e2e/admin e2e/investor e2e/debtor e2e/fixtures e2e/.auth
echo "e2e/.auth/" >> .gitignore
```

### [SETUP-05] Criar `e2e/fixtures/test-data.ts`

```typescript
export const TEST_CPFS = {
  valid: '529.982.247-25',
  invalid: '111.111.111-11',
  valid2: '275.984.389-10',
};

export const TEST_INVESTMENTS = {
  principal: 10000,
  rate: 3,
  installments: 12,
  dueDay: 10,
};

export const storageStates = {
  admin: 'e2e/.auth/admin.json',
  investor: 'e2e/.auth/investor.json',
  debtor: 'e2e/.auth/debtor.json',
};
```

### [SETUP-06] Criar `e2e/auth.setup.ts`

```typescript
import { test as setup, expect } from '@playwright/test';

// Setup para admin
setup('authenticate as admin', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('seu@email.com').fill(process.env.TEST_ADMIN_EMAIL!);
  await page.getByPlaceholder('••••••••').fill(process.env.TEST_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForSelector('aside', { timeout: 10_000 });
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});

// Setup para investor
setup('authenticate as investor', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('seu@email.com').fill(process.env.TEST_INVESTOR_EMAIL!);
  await page.getByPlaceholder('••••••••').fill(process.env.TEST_INVESTOR_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForSelector('aside', { timeout: 10_000 });
  await page.context().storageState({ path: 'e2e/.auth/investor.json' });
});

// Setup para debtor
setup('authenticate as debtor', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('seu@email.com').fill(process.env.TEST_DEBTOR_EMAIL!);
  await page.getByPlaceholder('••••••••').fill(process.env.TEST_DEBTOR_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForSelector('aside', { timeout: 10_000 });
  await page.context().storageState({ path: 'e2e/.auth/debtor.json' });
});
```

### [SETUP-07] Criar `.env.test` (não commitar, apenas documentar)

```
TEST_ADMIN_EMAIL=admin@seudominio.com
TEST_ADMIN_PASSWORD=SenhaSegura123!
TEST_INVESTOR_EMAIL=investidor@seudominio.com
TEST_INVESTOR_PASSWORD=SenhaSegura123!
TEST_DEBTOR_EMAIL=devedor@seudominio.com
TEST_DEBTOR_PASSWORD=SenhaSegura123!
TEST_INVITE_CODE=CODIGO-VALIDO
```

---

## 🔧 MUDANÇAS NO CÓDIGO — Por Arquivo

### Arquivo: `App.tsx`

#### [APP-01] Adicionar menu mobile (P0)

**Problema:** Sem hamburger menu — sidebar não aparece em mobile.

**Implementação:**
```tsx
// Adicionar estado para controle do menu mobile
const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

// No header mobile, adicionar botão hamburger:
<button
  className="md:hidden p-2 rounded text-gray-400 hover:text-white"
  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
  aria-label="Abrir menu"
>
  {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
</button>

// No aside, adicionar classes condicionais:
<aside className={`
  fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 transform transition-transform duration-300
  md:translate-x-0 md:static md:block
  ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
`}>
```

**data-testid a adicionar:** `data-testid="mobile-menu-btn"`, `data-testid="sidebar"`

---

#### [APP-02] Overlay para fechar menu mobile (P1)

```tsx
{isMobileMenuOpen && (
  <div
    className="fixed inset-0 bg-black/50 z-40 md:hidden"
    onClick={() => setIsMobileMenuOpen(false)}
    aria-hidden="true"
  />
)}
```

---

### Arquivo: `components/Login.tsx`

#### [LOGIN-01] Spinner no botão durante autenticação (P0)

**Problema:** Botão "Entrar" não mostra loading — usuário pode clicar múltiplas vezes.

```tsx
// Adicionar estado de loading
const [isSubmitting, setIsSubmitting] = useState(false);

// No botão:
<button
  disabled={isSubmitting}
  className="w-full py-2 px-4 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed rounded font-medium transition-colors"
>
  {isSubmitting ? (
    <span className="flex items-center justify-center gap-2">
      <Loader2 className="animate-spin" size={16} />
      Aguarde...
    </span>
  ) : 'Entrar'}
</button>

// No handler de submit:
setIsSubmitting(true);
try {
  await signIn(...);
} finally {
  setIsSubmitting(false);
}
```

**data-testid a adicionar:** `data-testid="login-btn"`, `data-testid="error-message"`

---

#### [LOGIN-02] Indicador de força de senha no signup (P2)

```tsx
const getPasswordStrength = (password: string) => {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
};

// Abaixo do campo de senha no modo signup:
{mode !== 'login' && password && (
  <div className="mt-1">
    <div className="flex gap-1">
      {[1, 2, 3, 4].map(level => (
        <div
          key={level}
          className={`h-1 flex-1 rounded ${
            getPasswordStrength(password) >= level
              ? level <= 2 ? 'bg-red-500' : level === 3 ? 'bg-yellow-500' : 'bg-green-500'
              : 'bg-slate-700'
          }`}
        />
      ))}
    </div>
    <p className="text-xs text-gray-400 mt-1">
      {['', 'Fraca', 'Regular', 'Boa', 'Forte'][getPasswordStrength(password)]}
    </p>
  </div>
)}
```

---

### Arquivo: `components/dashboard/DashboardWidgets.tsx`

#### [WIDGET-01] Skeleton loading para KPI cards (P0)

**Problema:** Tela fica em branco enquanto dados carregam — experiência ruim.

```tsx
// Criar componente SkeletonKPI:
const SkeletonKPI = () => (
  <div className="bg-slate-800 rounded-xl p-4 animate-pulse">
    <div className="h-3 bg-slate-700 rounded w-24 mb-3" />
    <div className="h-7 bg-slate-700 rounded w-32 mb-2" />
    <div className="h-2 bg-slate-700 rounded w-16" />
  </div>
);

// No KPICards component, quando loading=true:
if (loading) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => <SkeletonKPI key={i} />)}
    </div>
  );
}
```

**data-testid a adicionar:** `data-testid="kpi-card"`, `data-testid="kpi-value"`

---

#### [WIDGET-02] Empty state amigável para tabelas (P1)

```tsx
const EmptyState = ({ message = 'Nenhum dado encontrado', icon: Icon = FileX }) => (
  <div className="flex flex-col items-center justify-center py-16 text-gray-500">
    <Icon size={48} className="mb-4 opacity-40" />
    <p className="text-sm">{message}</p>
  </div>
);

// Substituir textos de "Nenhum dado" por:
{investments.length === 0
  ? <EmptyState message="Nenhum contrato encontrado" icon={FileText} />
  : <InvestmentsTable investments={investments} />
}
```

---

#### [WIDGET-03] Tabelas responsivas — scroll horizontal em mobile (P1)

```tsx
// Envolver cada tabela em:
<div className="overflow-x-auto rounded-lg">
  <table className="min-w-full ...">
    {/* conteúdo da tabela */}
  </table>
</div>
```

---

### Arquivo: `components/InvestorDashboard.tsx`

#### [INV-01] data-testid nos elementos principais (P0 — necessário para testes E2E)

Adicionar os seguintes atributos nos elementos existentes:

```tsx
// Card de próximo pagamento:
<div data-testid="next-payment-card">
  <span data-testid="next-payment-date">{nextPaymentDate}</span>
  <span data-testid="next-payment-value">{formatCurrency(nextPaymentValue)}</span>
</div>

// Cada item de investimento:
<div data-testid="investment-item" key={investment.id}>
  <span data-testid="health-badge">{healthStatus}</span>
  <span data-testid="roi-value">{roi}%</span>
</div>
```

---

#### [INV-02] Filtro/busca na lista de investimentos (P2)

```tsx
const [search, setSearch] = useState('');

const filtered = investments.filter(inv =>
  inv.payer_name?.toLowerCase().includes(search.toLowerCase())
);

// Adicionar input de busca acima da lista:
<div className="relative mb-4">
  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
  <input
    type="text"
    placeholder="Buscar por devedor..."
    value={search}
    onChange={e => setSearch(e.target.value)}
    className="w-full pl-9 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:border-teal-500"
  />
</div>
```

---

### Arquivo: `components/DebtorDashboard.tsx`

#### [DEB-01] data-testid nos elementos principais (P0 — necessário para testes E2E)

```tsx
// Container de alerta de atraso:
<div data-testid="late-payment-alert">
  {/* conteúdo do alerta */}
</div>

// Cada contrato:
<div data-testid="contract-item" key={contract.id}>
  {/* accordion header */}

  {/* Botão de pagamento: */}
  <button data-testid="pay-btn" onClick={() => openPaymentModal(installment)}>
    Pagar
  </button>

  {/* Cada parcela: */}
  <div data-testid="installment-row">
    <span data-testid="installment-status">{installment.status}</span>
  </div>
</div>
```

---

#### [DEB-02] Indicador de progresso por contrato (P2)

```tsx
// Calcular progresso:
const paidCount = installments.filter(i => i.status === 'paid').length;
const progress = (paidCount / installments.length) * 100;

// Barra de progresso visual:
<div className="mt-3">
  <div className="flex justify-between text-xs text-gray-400 mb-1">
    <span>{paidCount} de {installments.length} parcelas pagas</span>
    <span>{Math.round(progress)}%</span>
  </div>
  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
    <div
      className="h-full bg-teal-500 rounded-full transition-all duration-500"
      style={{ width: `${progress}%` }}
    />
  </div>
</div>
```

---

### Arquivo: `components/PaymentModal.tsx`

#### [PAY-01] data-testid nos elementos do modal (P0 — necessário para testes E2E)

```tsx
<div data-testid="payment-modal" className="...modal-classes...">
  {/* QR Code */}
  <div data-testid="qr-code">
    <QRCodeCanvas value={pixString} size={200} />
  </div>

  {/* Botão copiar */}
  <button data-testid="copy-pix-btn" onClick={handleCopy}>
    Copiar código PIX
  </button>

  {/* Botão fechar */}
  <button data-testid="close-modal-btn" onClick={onClose}>
    Cancelar
  </button>
</div>
```

---

#### [PAY-02] Feedback visual ao copiar código PIX (P1)

```tsx
const [copied, setCopied] = useState(false);

const handleCopy = async () => {
  await navigator.clipboard.writeText(pixString);
  setCopied(true);
  setTimeout(() => setCopied(false), 3000);
};

// No botão:
<button
  data-testid="copy-pix-btn"
  onClick={handleCopy}
  className={`flex items-center gap-2 px-4 py-2 rounded transition-colors ${
    copied ? 'bg-green-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-white'
  }`}
>
  {copied ? (
    <><CheckCircle size={16} /> Copiado!</>
  ) : (
    <><Copy size={16} /> Copiar código PIX</>
  )}
</button>
```

---

### Arquivo: `components/AdminUsers.tsx`

#### [USERS-01] data-testid nos elementos de usuário (P0 — necessário para testes E2E)

```tsx
// Botão de editar usuário:
<button data-testid="edit-user-btn" onClick={() => openEditModal(user)}>
  <Pencil size={14} />
</button>

// Código de convite gerado:
<code data-testid="invite-code">{generatedCode}</code>
```

---

#### [USERS-02] Confirmação antes de deletar usuário (P1)

**Problema:** Delete sem confirmação — ação destrutiva irreversível.

```tsx
const [userToDelete, setUserToDelete] = useState<string | null>(null);

// Ao clicar em deletar, mostrar modal de confirmação:
{userToDelete && (
  <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div className="bg-slate-800 rounded-xl p-6 max-w-sm w-full">
      <h3 className="text-white font-semibold mb-2">Confirmar exclusão</h3>
      <p className="text-gray-400 text-sm mb-6">
        Esta ação não pode ser desfeita. O usuário perderá acesso à plataforma.
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => setUserToDelete(null)}
          className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm"
        >
          Cancelar
        </button>
        <button
          onClick={() => handleDelete(userToDelete)}
          className="flex-1 py-2 bg-red-600 hover:bg-red-700 rounded text-white text-sm"
        >
          Deletar
        </button>
      </div>
    </div>
  </div>
)}
```

---

### Arquivo: `components/AdminContracts.tsx`

#### [CONTRACTS-01] Feedback de sucesso na criação de contrato (P1)

```tsx
// Após criar contrato com sucesso:
const [showSuccess, setShowSuccess] = useState(false);

// No handler de submit após criar:
setShowSuccess(true);
setTimeout(() => setShowSuccess(false), 4000);

// Adicionar toast/banner de sucesso:
{showSuccess && (
  <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-right">
    <CheckCircle size={16} />
    <span>Contrato criado com sucesso!</span>
  </div>
)}
```

---

### Arquivo: `components/AdminSettings.tsx`

#### [SETTINGS-01] Feedback ao salvar configurações (P1)

Mesmo padrão do CONTRACTS-01 — adicionar toast de confirmação após salvar.

---

## 🧪 TESTES E2E — Criar arquivos

Copiar exatamente os cenários de `docs/qa/e2e-test-plan.md` para os arquivos:

| Arquivo | Testes |
|---------|--------|
| `e2e/auth/login.spec.ts` | AUTH-01 ao AUTH-05 |
| `e2e/admin/dashboard.spec.ts` | ADMIN-01, ADMIN-02 |
| `e2e/admin/users.spec.ts` | ADMIN-03, ADMIN-05 |
| `e2e/admin/contracts.spec.ts` | ADMIN-04 |
| `e2e/admin/settings.spec.ts` | ADMIN-06 |
| `e2e/investor/dashboard.spec.ts` | INV-01 ao INV-04 |
| `e2e/debtor/dashboard.spec.ts` | DEB-01 ao DEB-06 |
| `e2e/debtor/payment.spec.ts` | DEB-04, DEB-05 |
| `e2e/edge-cases.spec.ts` | EDGE-01 ao EDGE-04 |

---

## ✅ Ordem de Implementação Recomendada

### Sprint 1 — Fundação (SETUP + P0)
1. [ ] SETUP-01 a SETUP-07 (configuração Playwright)
2. [ ] LOGIN-01 (spinner no botão de login)
3. [ ] APP-01, APP-02 (menu mobile)
4. [ ] WIDGET-01 (skeleton loading)
5. [ ] Todos os `data-testid` (INV-01, DEB-01, PAY-01, USERS-01)

### Sprint 2 — Qualidade (P1)
6. [ ] WIDGET-02 (empty states)
7. [ ] WIDGET-03 (tabelas responsivas)
8. [ ] PAY-02 (feedback copiar PIX)
9. [ ] USERS-02 (confirmação de delete)
10. [ ] CONTRACTS-01 (toast de sucesso)
11. [ ] SETTINGS-01 (toast de sucesso)

### Sprint 3 — Melhorias (P2)
12. [ ] LOGIN-02 (força de senha)
13. [ ] INV-02 (busca de investimentos)
14. [ ] DEB-02 (progresso do contrato)

### Sprint 4 — Testes E2E
15. [ ] Criar todos os arquivos de teste conforme `e2e-test-plan.md`
16. [ ] Rodar `npm run test:e2e` e garantir que todos passam

---

## Notas para o @dev

1. **Imports necessários** — Adicionar imports de ícones Lucide conforme uso: `Copy, CheckCircle, FileX, FileText, Menu, X, Search, Loader2`
2. **data-testid** — Fundamental para os testes E2E. Adicionar em TODOS os elementos listados antes de criar os testes
3. **Variáveis de ambiente** — Criar `.env.test` local (não commitar) com as credenciais de teste
4. **Supabase de teste** — Recomendado usar um projeto Supabase separado para testes E2E (não contaminar produção)
5. **Ordem** — Implementar `data-testid` ANTES de rodar os testes

---

*Gerado por Quinn (@qa) — 2026-03-04*
*UX proposals geradas por Uma (@ux-design-expert) em `docs/qa/ux-improvements.md`*
