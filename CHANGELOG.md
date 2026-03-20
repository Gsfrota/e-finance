# Changelog — E-Finance

## [Não publicado] — 2026-03-19

### feat(typography): sistema tipográfico profissional (Stripe-inspired)

Refatoração completa da tipografia em todos os 38 arquivos de componentes. Substituição do sistema caótico (292× `font-black`, 81× `font-extrabold`, 8+ valores de tracking arbitrários) por um type scale semântico e disciplinado.

#### Novos tokens CSS (`index.css`)

| Classe | Tamanho | Peso | Uso |
|---|---|---|---|
| `.type-display` | 2.25rem | 600 | Títulos de página (Playfair Display) |
| `.type-title` | 1.5rem | 600 | Títulos de seção (Playfair Display) |
| `.type-heading` | 1.125rem | 600 | Títulos de card/painel (Inter) |
| `.type-subheading` | 0.9375rem | 600 | Modal titles, sub-seções (Inter) |
| `.type-body` | 0.875rem | 400 | Texto principal |
| `.type-caption` | 0.75rem | 400 | Texto secundário, helpers |
| `.type-label` | 0.625rem | 600 | Labels uppercase, kickers, form labels |
| `.type-micro` | 0.5625rem | 500 | Labels minúsculas (raro) |
| `.type-metric-xl` | 1.875rem | 700 | KPIs hero (tabular-nums) |
| `.type-metric-lg` | 1.25rem | 700 | KPIs em cards (tabular-nums) |
| `.type-metric-md` | 1rem | 600 | Valores inline (tabular-nums) |
| `.type-metric-sm` | 0.75rem | 600 | Valores em tabelas (tabular-nums) |

#### Métricas de impacto

| Métrica | Antes | Depois |
|---|---|---|
| `font-black` (peso 900) | 292 | 0 |
| `font-extrabold` (peso 800) | 81 | 0 |
| `tracking-widest` (0.1em) | 142 | 0 |
| Valores custom `text-[Xpx]` | 10+ tipos | mínimos |
| Classes `type-*` aplicadas | 0 | 580+ |
| Paleta de pesos | 6 (300–900) | 4 (400–700) |
| Valores de tracking | 8+ | 3 (-0.02em, 0, 0.08em) |

#### Arquivos modificados

**Fundação**
- `index.css` — adicionado bloco `.type-*`, responsivo mobile, atualizado `.section-kicker` (800→600), `.chip` (800→600), `.btn` (700→600); removida regra blanket `h1-h6 { Playfair }`
- `index.html` — Google Fonts Inter reduzido de `wght@300;400;500;600;700;800` para `wght@400;500;600;700`

**Componentes (38 arquivos)**
- `components/AdminContracts.tsx`
- `components/dashboard/DashboardWidgets.tsx`
- `components/ContractDetail.tsx`
- `components/InstallmentDetailFlow.tsx`
- `components/InstallmentModals.tsx`
- `components/AdminUserDetails.tsx`
- `components/AdminHome.tsx`
- `components/AdminUsers.tsx`
- `components/QuickContractInput.tsx`
- `components/SubscriptionTab.tsx`
- `components/DailyCollectionView.tsx`
- `components/AdminAssistant.tsx`
- `components/DebtorDashboard.tsx`
- `components/dashboard/SalaryDashboard.tsx`
- `components/dashboard/CollectionDashboard.tsx`
- `components/AdminSettings.tsx`
- `components/ContractRenewalModal.tsx`
- `components/InstallmentHistory.tsx`
- `components/PaymentModal.tsx`
- `components/Login.tsx`
- `components/OnboardingWizard.tsx`
- `components/InvestorDashboard.tsx`
- `components/BotConnectionWidget.tsx`
- `components/SetupWizard.tsx`
- `components/InstallmentRowActions.tsx`
- `components/ResetPassword.tsx`
- `components/Dashboard.tsx`
- `components/LegacyContractPage.tsx`
- `components/SqlSetup.tsx`
- `components/AdminUserDetails.tsx`
- `components/PaymentModal.tsx`

#### Decisões de design

- **Inspiração Stripe:** hierarquia por tamanho + peso + cor, não por tudo ser bold/black
- **Playfair Display** reservado para `.type-display` e `.type-title` — opt-in explícito via classes, não regra global
- **`font-variant-numeric: tabular-nums`** embutido em todas as classes `.type-metric-*`
- **Responsive:** media query em `(max-width: 767px)` reduz display/title/metric-xl graciosamente
- **`.section-kicker`** mantido como alias semântico (tracking 0.26em→0.08em, peso 800→600)

---

### fix(ui): alinhar ícones do grid de atalhos (`AdminHome.tsx`)

Corrigido desalinhamento vertical dos ícones no grid 4×2 da tela inicial do admin. Labels longas ("Meus Recebimentos", "Cobranças de Hoje") quebravam em 2 linhas, fazendo os ícones flutuarem em alturas diferentes.

- `justify-center` → `justify-start`
- `p-3` → `px-2 pt-5 pb-3` (âncora os ícones sempre à mesma distância do topo)

---

## Histórico anterior

### [a4139d3] security(stripe): remediar 5 vulnerabilidades no fluxo de pagamento
### [720120e] feat(stripe): configurar Customer Portal de produção
### [a8a8d90] refactor(nav): substituir sidebar interna por abas horizontais no topo
### [ab4fdd7] docs(devops): adicionar deploy runbook com security gates e rollback
### [0a65835] fix(e2e): auth.setup skip gracioso quando TEST_* não configurado
### [b2e137e] fix(ts): corrigir todos os erros de TypeScript bloqueando o deploy
### [d6e42f5] feat(comprovante): redesign simples — sem texto no compartilhamento WA
### [bc3e054] feat: redesign dashboard investidor + deploy melhorado + remoção Gemini
### [6ed8d1d] feat(legacy): cadastro de contratos antigos com parcelas retroativas
### [5ea4fcf] feat(pagamento): fluxo 2-etapas para baixa parcial com destino do saldo
