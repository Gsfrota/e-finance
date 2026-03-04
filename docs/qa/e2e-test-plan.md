# Plano de Testes E2E — E-Finance
**Agente:** Quinn (@qa)
**Data:** 2026-03-04
**Ferramenta recomendada:** Playwright
**Status:** Pronto para implementação pelo @dev

---

## Setup & Configuração

### Instalação (instruções para @dev)

```bash
npm install -D @playwright/test
npx playwright install chromium
```

### `playwright.config.ts` (criar na raiz)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
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

### Estrutura de arquivos E2E

```
e2e/
├── auth.setup.ts          # Login global + salvar estado de auth
├── auth/
│   ├── login.spec.ts
│   ├── signup.spec.ts
│   └── reset-password.spec.ts
├── admin/
│   ├── dashboard.spec.ts
│   ├── users.spec.ts
│   ├── contracts.spec.ts
│   └── settings.spec.ts
├── investor/
│   └── dashboard.spec.ts
├── debtor/
│   ├── dashboard.spec.ts
│   └── payment.spec.ts
├── fixtures/
│   └── test-data.ts       # CPFs, valores, dados de teste
└── .auth/                 # Gerado automaticamente (gitignore)
    ├── admin.json
    ├── investor.json
    └── debtor.json
```

---

## GRUPO 1 — Autenticação (AUTH)

### AUTH-01: Login com credenciais válidas (RISCO: ALTO)

**Precondições:** Usuário admin existe no tenant de teste

```typescript
// e2e/auth/login.spec.ts
test('AUTH-01: Login com credenciais válidas', async ({ page }) => {
  // Given
  await page.goto('/');

  // When
  await page.getByPlaceholder('seu@email.com').fill(process.env.TEST_ADMIN_EMAIL!);
  await page.getByPlaceholder('••••••••').fill(process.env.TEST_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Then
  await expect(page.locator('aside')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Dashboard')).toBeVisible();
  await expect(page.locator('[data-testid="user-name"]')).not.toBeEmpty();
});
```

**Asserções:**
- Sidebar visível após login
- Menu "Dashboard" ativo
- Nome do usuário exibido no header
- Nenhum spinner de loading após 10s

---

### AUTH-02: Login com credenciais inválidas (RISCO: ALTO)

```typescript
test('AUTH-02: Login com credenciais inválidas exibe erro PT-BR', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('seu@email.com').fill('email@invalido.com');
  await page.getByPlaceholder('••••••••').fill('senhaerrada');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Mensagem de erro em PT-BR (parseSupabaseError)
  await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
  await expect(page.locator('[data-testid="error-message"]')).not.toContainText('Invalid');
  // Permanecer na tela de login
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
});
```

---

### AUTH-03: Cadastro de admin com empresa nova (RISCO: ALTO)

```typescript
test('AUTH-03: Cadastro de novo administrador cria tenant', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Criar conta como empresa').click();

  await page.getByPlaceholder('Nome da empresa').fill('Empresa Teste E2E');
  await page.getByPlaceholder('seu@email.com').fill(`e2e+${Date.now()}@teste.com`);
  await page.getByPlaceholder('••••••••').fill('SenhaForte123!');
  await page.getByRole('button', { name: 'Cadastrar' }).click();

  // Deve redirecionar ao dashboard de admin
  await expect(page.locator('aside')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Usuários')).toBeVisible();  // menu admin
});
```

---

### AUTH-04: Cadastro com código de convite (RISCO: ALTO)

```typescript
test('AUTH-04: Cadastro com invite code válido', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Tenho um código de convite').click();

  await page.getByPlaceholder('CÓDIGO-CONVITE').fill(process.env.TEST_INVITE_CODE!);
  await page.getByPlaceholder('seu@email.com').fill(`invited+${Date.now()}@teste.com`);
  await page.getByPlaceholder('••••••••').fill('SenhaForte123!');
  await page.getByRole('button', { name: 'Entrar na plataforma' }).click();

  await expect(page.locator('aside')).toBeVisible({ timeout: 15_000 });
});
```

---

### AUTH-05: Fluxo de recuperação de senha (RISCO: MÉDIO)

```typescript
test('AUTH-05: Fluxo de reset de senha envia email', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Esqueci minha senha').click();

  await page.getByPlaceholder('seu@email.com').fill(process.env.TEST_ADMIN_EMAIL!);
  await page.getByRole('button', { name: 'Enviar' }).click();

  await expect(page.getByText(/email enviado|verifique sua caixa/i)).toBeVisible();
});
```

---

## GRUPO 2 — Admin Dashboard (ADMIN)

### ADMIN-01: Dashboard admin carrega KPIs (RISCO: ALTO)

```typescript
test('ADMIN-01: KPIs do admin são exibidos corretamente', async ({ page }) => {
  await page.goto('/');  // usa storageState admin

  // Tab "Visão Geral" ativa por padrão
  await expect(page.getByText('Visão Geral')).toBeVisible();

  // Cards de KPI presentes
  await expect(page.locator('[data-testid="kpi-card"]')).toHaveCount({ minimum: 4 });

  // Valores numéricos formatados (R$)
  await expect(page.locator('[data-testid="kpi-value"]').first()).toContainText('R$');
});
```

---

### ADMIN-02: Navegação entre as 4 abas do dashboard (RISCO: MÉDIO)

```typescript
test('ADMIN-02: Navegação entre abas do dashboard admin', async ({ page }) => {
  await page.goto('/');

  const tabs = ['Visão Geral', 'Recebíveis', 'Investidores', 'Relatórios'];
  for (const tab of tabs) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    // Cada aba não exibe erro
    await expect(page.locator('[data-testid="error-message"]')).not.toBeVisible();
  }
});
```

---

### ADMIN-03: Criação de convite para investidor (RISCO: ALTO)

```typescript
test('ADMIN-03: Admin cria convite para investidor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Usuários' }).click();

  await page.getByRole('button', { name: 'Novo Convite' }).click();

  // Preencher formulário de convite
  await page.getByLabel('Nome').fill('João Investidor Teste');
  await page.getByLabel('Email').fill(`investidor+${Date.now()}@teste.com`);
  await page.getByLabel('Papel').selectOption('investor');
  await page.getByRole('button', { name: 'Gerar Convite' }).click();

  // Código gerado exibido
  await expect(page.locator('[data-testid="invite-code"]')).toBeVisible();
  await expect(page.locator('[data-testid="invite-code"]')).not.toBeEmpty();
});
```

---

### ADMIN-04: Criação de contrato de investimento (RISCO: ALTO)

```typescript
test('ADMIN-04: Admin cria contrato com parcelas calculadas automaticamente', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Contratos' }).click();

  await page.getByRole('button', { name: 'Novo Contrato' }).click();

  // Preencher dados financeiros
  await page.getByLabel('Valor Principal').fill('10000');
  await page.getByLabel('Taxa de Juros (%)').fill('3');
  await page.getByLabel('Número de Parcelas').fill('12');
  await page.getByLabel('Dia de Vencimento').fill('10');

  // Selecionar investidor e devedor
  await page.getByLabel('Investidor').selectOption({ index: 1 });
  await page.getByLabel('Devedor').selectOption({ index: 1 });

  // Verificar cálculo automático
  await expect(page.locator('[data-testid="installment-value"]')).not.toBeEmpty();
  await expect(page.locator('[data-testid="total-value"]')).not.toBeEmpty();

  await page.getByRole('button', { name: 'Criar Contrato' }).click();
  await expect(page.getByText(/contrato criado|sucesso/i)).toBeVisible();
});
```

---

### ADMIN-05: Edição de dados de usuário (RISCO: MÉDIO)

```typescript
test('ADMIN-05: Admin edita nome e CPF de usuário', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Usuários' }).click();

  // Abrir modal de edição do primeiro usuário
  await page.locator('[data-testid="edit-user-btn"]').first().click();

  await page.getByLabel('Nome Completo').clear();
  await page.getByLabel('Nome Completo').fill('Nome Atualizado Teste');
  await page.getByLabel('CPF').fill('529.982.247-25');  // CPF válido

  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Nome Atualizado Teste')).toBeVisible();
});
```

---

### ADMIN-06: Configurações do tenant (RISCO: BAIXO)

```typescript
test('ADMIN-06: Admin salva configurações do tenant', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Ajustes' }).click();

  await page.getByLabel('Chave PIX').fill('11999887766');
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page.getByText(/salvo|atualizado/i)).toBeVisible();
});
```

---

## GRUPO 3 — Investor Dashboard (INVESTOR)

### INV-01: Dashboard do investidor carrega métricas (RISCO: ALTO)

```typescript
test('INV-01: Investidor vê métricas de capital e lucro', async ({ page }) => {
  // usar storageState de investor
  await page.goto('/');

  await expect(page.getByText(/capital alocado|capital investido/i)).toBeVisible();
  await expect(page.getByText(/lucro|rendimento/i)).toBeVisible();

  // Gráfico de barras do Recharts presente
  await expect(page.locator('.recharts-wrapper')).toBeVisible();
});
```

---

### INV-02: Lista de investimentos com status de saúde (RISCO: MÉDIO)

```typescript
test('INV-02: Investidor vê lista de contratos com indicadores', async ({ page }) => {
  await page.goto('/');

  // Tabela ou lista de investimentos
  const investmentItems = page.locator('[data-testid="investment-item"]');
  await expect(investmentItems.first()).toBeVisible();

  // Badge de status (saúde do contrato)
  await expect(page.locator('[data-testid="health-badge"]').first()).toBeVisible();
});
```

---

### INV-03: ROI exibido por contrato (RISCO: MÉDIO)

```typescript
test('INV-03: ROI calculado e exibido por investimento', async ({ page }) => {
  await page.goto('/');

  // Valores de ROI em % presentes
  await expect(page.locator('[data-testid="roi-value"]').first()).toContainText('%');
});
```

---

### INV-04: Próximo pagamento destacado (RISCO: MÉDIO)

```typescript
test('INV-04: Card de próximo pagamento exibe data e valor', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('[data-testid="next-payment-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="next-payment-date"]')).not.toBeEmpty();
  await expect(page.locator('[data-testid="next-payment-value"]')).toContainText('R$');
});
```

---

## GRUPO 4 — Debtor Dashboard & Pagamento (DEBTOR)

### DEB-01: Dashboard do devedor lista contratos (RISCO: ALTO)

```typescript
test('DEB-01: Devedor vê contratos ativos', async ({ page }) => {
  // usar storageState de debtor
  await page.goto('/');

  await expect(page.getByText(/meus contratos|seus contratos/i)).toBeVisible();
  const contracts = page.locator('[data-testid="contract-item"]');
  await expect(contracts.first()).toBeVisible();
});
```

---

### DEB-02: Expansão de contrato exibe parcelas (RISCO: ALTO)

```typescript
test('DEB-02: Devedor expande contrato e vê parcelas', async ({ page }) => {
  await page.goto('/');

  // Clicar no primeiro contrato para expandir
  await page.locator('[data-testid="contract-item"]').first().click();

  // Parcelas visíveis
  await expect(page.locator('[data-testid="installment-row"]').first()).toBeVisible();

  // Status das parcelas (pago/pendente/atrasado)
  await expect(page.locator('[data-testid="installment-status"]').first()).toBeVisible();
});
```

---

### DEB-03: Alerta de parcela atrasada (RISCO: ALTO)

```typescript
test('DEB-03: Parcelas atrasadas exibem alerta visual', async ({ page }) => {
  await page.goto('/');

  // Se existir parcela atrasada, banner de aviso deve aparecer
  const lateAlert = page.locator('[data-testid="late-payment-alert"]');
  if (await lateAlert.isVisible()) {
    await expect(lateAlert).toContainText(/atrasado|vencido/i);
  }
});
```

---

### DEB-04: Abertura do modal de pagamento PIX (RISCO: ALTO)

```typescript
test('DEB-04: Devedor abre modal PIX e vê QR Code', async ({ page }) => {
  await page.goto('/');

  // Expandir contrato e clicar em pagar
  await page.locator('[data-testid="contract-item"]').first().click();
  await page.locator('[data-testid="pay-btn"]').first().click();

  // Modal de pagamento abre
  await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible();

  // QR Code gerado (canvas ou img do qrcode.react)
  await expect(page.locator('canvas, [data-testid="qr-code"]')).toBeVisible({ timeout: 10_000 });
});
```

---

### DEB-05: Cópia do código PIX (RISCO: MÉDIO)

```typescript
test('DEB-05: Código PIX copia para clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');

  await page.locator('[data-testid="contract-item"]').first().click();
  await page.locator('[data-testid="pay-btn"]').first().click();
  await page.locator('[data-testid="copy-pix-btn"]').click();

  const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardContent.length).toBeGreaterThan(20);  // PIX code tem ~100+ chars
});
```

---

### DEB-06: Fechamento do modal de pagamento (RISCO: BAIXO)

```typescript
test('DEB-06: Modal PIX fecha ao clicar em cancelar', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-testid="contract-item"]').first().click();
  await page.locator('[data-testid="pay-btn"]').first().click();
  await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible();

  await page.locator('[data-testid="close-modal-btn"]').click();
  await expect(page.locator('[data-testid="payment-modal"]')).not.toBeVisible();
});
```

---

## GRUPO 5 — Edge Cases & Segurança

### EDGE-01: Acesso não autenticado redireciona ao login (RISCO: ALTO)

```typescript
test('EDGE-01: URL de dashboard sem auth redireciona ao login', async ({ page }) => {
  // Sem storageState (não autenticado)
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
});
```

---

### EDGE-02: Devedor não acessa rotas de admin (RISCO: ALTO)

```typescript
test('EDGE-02: Devedor não vê menu de Usuários e Contratos', async ({ page }) => {
  // storageState de debtor
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Usuários' })).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Contratos' })).not.toBeVisible();
});
```

---

### EDGE-03: CPF inválido no cadastro de usuário (RISCO: MÉDIO)

```typescript
test('EDGE-03: CPF inválido exibe mensagem de erro', async ({ page }) => {
  // storageState de admin
  await page.goto('/');
  await page.getByRole('link', { name: 'Usuários' }).click();

  await page.locator('[data-testid="edit-user-btn"]').first().click();
  await page.getByLabel('CPF').fill('111.111.111-11');  // CPF inválido
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page.getByText(/CPF inválido/i)).toBeVisible();
});
```

---

### EDGE-04: Tela de configuração do Supabase quando não configurado (RISCO: MÉDIO)

```typescript
test('EDGE-04: SetupWizard exibido quando Supabase não configurado', async ({ page }) => {
  // Remover credenciais do localStorage
  await page.addInitScript(() => {
    localStorage.removeItem('EF_EXTERNAL_SUPABASE_URL');
    localStorage.removeItem('EF_EXTERNAL_SUPABASE_KEY');
  });

  await page.goto('/');
  await expect(page.getByText(/configurar supabase|setup/i)).toBeVisible();
});
```

---

## Fixtures de Dados de Teste

```typescript
// e2e/fixtures/test-data.ts
export const TEST_CPFS = {
  valid: '529.982.247-25',
  invalid: '111.111.111-11',
};

export const TEST_INVESTMENTS = {
  principal: 10000,
  rate: 3,
  installments: 12,
  dueDay: 10,
};

export const roles = {
  admin: { storageState: 'e2e/.auth/admin.json' },
  investor: { storageState: 'e2e/.auth/investor.json' },
  debtor: { storageState: 'e2e/.auth/debtor.json' },
};
```

---

## Resumo de Cobertura

| Grupo | Testes | Risco Alto | Risco Médio | Risco Baixo |
|-------|--------|------------|-------------|-------------|
| AUTH | 5 | 3 | 1 | 1 |
| ADMIN | 6 | 3 | 2 | 1 |
| INVESTOR | 4 | 1 | 3 | 0 |
| DEBTOR | 6 | 3 | 2 | 1 |
| EDGE | 4 | 2 | 2 | 0 |
| **Total** | **25** | **12** | **10** | **3** |

---

## Script de atualização do `package.json`

```json
"scripts": {
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:e2e:headed": "playwright test --headed",
  "test:e2e:report": "playwright show-report"
}
```

---

*Gerado por Quinn (@qa) — 2026-03-04*
