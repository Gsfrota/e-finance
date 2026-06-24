<div align="center">

<br/>

<img src="https://img.shields.io/badge/-%F0%9F%8F%A6%20Juros%20Certo-0f1d33?style=for-the-badge&logoColor=f0b429&labelColor=0f1d33&color=f0b429" alt="Juros Certo" height="42"/>

# Juros Certo — Gestão de Crédito operada por um Agente de IA no WhatsApp

**SaaS multi-tenant** para gestão de carteiras de crédito privado, operável por inteiro através de um **agente de IA conversacional no WhatsApp** — que cadastra contratos e clientes, dá baixa em pagamentos e dispara lembretes automáticos de manhã e à tarde — somado a um painel web completo (PIX nativo, inadimplência, multi-CNPJ).

<br/>

[![React](https://img.shields.io/badge/React_19-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Google Cloud Run](https://img.shields.io/badge/Cloud_Run-4285F4?style=flat-square&logo=googlecloud&logoColor=white)](https://cloud.google.com/run)
[![Gemini AI](https://img.shields.io/badge/Gemini_AI-8E75B2?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev)
[![WhatsApp](https://img.shields.io/badge/WhatsApp_AI_Agent-25D366?style=flat-square&logo=whatsapp&logoColor=white)](#-agente-de-ia-no-whatsapp)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

<br/>

</div>

---

## Visão Geral

O **Juros Certo** resolve um problema real de gestores de carteiras de crédito privado: controlar múltiplos contratos, parcelas, pagamentos e inadimplências em um único lugar, acessível tanto pelo painel web quanto pelo WhatsApp via linguagem natural.

> Plataforma pensada para o mercado brasileiro: cálculo de juros compostos, PIX nativo, multi-CNPJ e suporte completo a PT-BR.

---

## 🤖 Agente de IA no WhatsApp

> O coração do Juros Certo. Um **agente de IA conversacional** que opera a carteira inteira por **linguagem natural** no WhatsApp — o gestor administra contratos, cobranças e pagamentos sem nunca abrir o painel.

| Capacidade | Como o gestor usa (texto ou áudio) |
|------------|-----------------------------------|
| 📝 **Cadastra contratos e clientes** | *"cria contrato de 5 mil pra Maria, 12x, 3% ao mês"* |
| ✅ **Dá baixa em pagamentos** | *"baixar parcela do João"* → gera comprovante em PNG |
| 🔔 **Lembretes automáticos de manhã e à tarde** | briefing matinal dos vencimentos do dia + follow-up de cobrança no fim do dia (Cloud Scheduler) |
| 💬 **Responde consultas em PT-BR** | *"quem vence essa semana?"*, *"extrato do João?"* |
| 🎙️ **Entende mensagens de voz** | transcrição de áudio via Gemini |
| 🛡️ **Confirma antes de agir** | confirmação explícita + *policy-engine* antes de qualquer mutação de dados |

---

## Arquitetura

### 1 · Topologia do Sistema

Dois serviços independentes no Cloud Run — painel web e bot — compartilham o mesmo banco Supabase com isolamento garantido por RLS em todas as tabelas.

```mermaid
graph TD
    subgraph Clientes["Clientes"]
        WA["📱 WhatsApp<br/>(UazAPI)"]
        TG["💬 Telegram<br/>(Bot API)"]
        WEB["🖥️ Painel Web<br/>React 19 · TypeScript · Vite"]
    end

    subgraph GCP["☁️  Google Cloud Platform"]
        subgraph CR["Cloud Run"]
            BOT["🤖 e-finance-bot<br/>Node.js + Express<br/>Pipeline NLU · 20 estágios"]
            APP["📋 e-finance-web<br/>nginx · React SPA"]
        end
        SCHED["⏰ Cloud Scheduler<br/>9h briefing · 17h cobrança EOD"]
        AR["📦 Artifact Registry"]
        SM["🔒 Secret Manager"]
        GHA["🔄 GitHub Actions<br/>typecheck · Playwright E2E · deploy"]
    end

    subgraph AI["Inteligência Artificial"]
        GEM["🧠 Gemini 1.5 Flash<br/>NLU fallback · transcrição de áudio<br/>análise de portfólio"]
    end

    subgraph SB["🗄️  Supabase — BaaS"]
        AUTH["🔐 Auth<br/>JWT · OAuth · RLS"]
        DB[("PostgreSQL<br/>Row Level Security<br/>isolamento tenant + empresa")]
        EF["⚡ Edge Functions"]
    end

    WA & TG -->|"webhook POST"| BOT
    SCHED -->|cron| BOT
    BOT <-->|"fallback LLM  &lt; 500 ms"| GEM
    BOT -->|"RPC · RLS enforced"| DB
    WEB -->|"Supabase JS SDK"| AUTH
    WEB -->|"queries + mutations"| DB
    AUTH --> DB
    GHA -->|"push image"| AR
    AR -->|deploy| BOT & APP
    SM -. "secrets em runtime" .-> BOT & APP
    APP -. "serve SPA" .-> WEB
```

---

### 2 · Pipeline NLU — 20 Estágios

NLU híbrido: rotas de alta confiança (regex, ~100 ms) passam direto para execução; intents ambíguas caem no fallback Gemini (<500 ms). O `policy-engine` funciona como portão de segurança antes de qualquer mutação.

```mermaid
flowchart LR
    IN(["📨 Mensagem<br/>WhatsApp / Telegram"])

    subgraph Ingestao["Ingestão"]
        A[dedup] --> B[rate-limit] --> C["inbound-buffer<br/>debounce 3.5 s"]
    end

    subgraph Sessao["Sessão & Contexto"]
        D[session-manager] --> E[prompt-guard] --> F[audio-pipeline]
        F --> G[confirmation-store] --> H[followup-resolver] --> I[command-understanding]
    end

    subgraph NLU["NLU — Intent Recognition"]
        J{{"intent-router<br/>80 + regex · ~100 ms"}}
        J -->|"✅ alta confiança"| L[action-planner]
        J -->|"❓ baixa confiança"| K["🧠 Gemini<br/>fallback &lt; 500 ms"]
        K --> M[intent-classifier] --> L
    end

    subgraph Execucao["Execução"]
        N["🛡️ policy-engine<br/>confirmação + gates"]
        O[tool-executor] --> P[response-generator]
    end

    IN --> A
    C --> D
    I --> J
    L --> N --> O
    P --> OUT(["📤 Resposta<br/>+ comprovante PNG"])

    style J fill:#f0b429,color:#0f1d33,font-weight:bold
    style K fill:#7C3AED,color:#fff
    style N fill:#dc2626,color:#fff,font-weight:bold
```

---

### 3 · Fluxo de uma Conversa no WhatsApp

Exemplo real: dar baixa em parcela com desambiguação de devedor homônimo.

```mermaid
sequenceDiagram
    actor Gestor
    participant WA as WhatsApp
    participant Bot as Bot (Cloud Run)
    participant GEM as Gemini AI
    participant DB as PostgreSQL (Supabase)

    Gestor->>WA: "baixar parcela do João"
    WA->>Bot: POST /webhook
    Note over Bot: dedup → buffer 3.5 s → session
    Bot->>Bot: intent-router (80+ regex)
    Note over Bot: confiança < threshold
    Bot->>GEM: NLU fallback
    GEM-->>Bot: intent=PAY_INSTALLMENT · entity=João
    Bot->>DB: SELECT installments WHERE debtor ILIKE 'João%'
    DB-->>Bot: João Silva (R$ 350 · vence hoje)<br/>João Costa (R$ 820 · vence amanhã)
    Bot->>WA: "Encontrei 2 devedores chamados João.\n1. João Silva — R$ 350 (vence hoje)\n2. João Costa — R$ 820 (vence amanhã)"
    WA->>Gestor: 💬 pergunta de desambiguação

    Gestor->>WA: "1"
    WA->>Bot: POST /webhook
    Note over Bot: confirmation-store resolve
    Bot->>Bot: 🛡️ policy-engine → gate OK
    Bot->>DB: RPC pay_installment(id, paid_at)
    DB-->>Bot: OK + receipt_id
    Bot->>WA: 🧾 comprovante PNG + mensagem de confirmação
    WA->>Gestor: ✅ baixa registrada
```

---

### 4 · Modelo de Dados

Multi-tenant com dois níveis de isolamento: `tenant_id` separa clientes SaaS; `company_id` separa CNPJs dentro do mesmo tenant (plano empresarial).

```mermaid
erDiagram
    TENANT ||--o{ COMPANY        : possui
    TENANT ||--o{ BOT_CONFIG     : configura
    COMPANY ||--o{ PROFILE       : tem
    COMPANY ||--o{ INVESTMENT    : tem
    COMPANY ||--o{ INVITE        : gera
    INVESTMENT ||--o{ LOAN_INSTALLMENT       : gera
    INVESTMENT ||--o{ CONTRACT_RENEGOTIATION : tem
    INVESTMENT ||--o{ AVULSO_PAYMENT         : tem

    TENANT {
        uuid      id           PK
        string    plan            "free | caderneta | empresarial"
        string    plan_status
        timestamp trial_ends_at
    }
    COMPANY {
        uuid   id         PK
        uuid   tenant_id  FK
        string cnpj
        string name
    }
    PROFILE {
        uuid   id         PK
        uuid   company_id FK
        string role          "admin | investor | debtor"
        string email
    }
    INVESTMENT {
        uuid    id              PK
        uuid    company_id      FK
        uuid    user_id         FK "investidor"
        uuid    payer_id        FK "devedor"
        decimal principal
        decimal interest_rate
        int     installment_count
        string  source_capital     "own | profit"
        string  contract_type      "standard | bullet"
    }
    LOAN_INSTALLMENT {
        uuid    id                    PK
        uuid    investment_id         FK
        int     installment_number
        string  status                   "pending | paid | late | partial"
        decimal fine_amount
        decimal interest_delay_amount
        date    due_date
        date    paid_at
        string  receipt_id
    }
```

Row Level Security garante isolamento total entre tenants — e, no modelo multi-empresa, entre CNPJs do mesmo tenant.

---

## Screenshots

### Login

![Login](docs/screenshots/login.png)
*Tela de acesso com autenticação por e-mail/senha ou Google.*

### Painel Admin — Dashboard

![Dashboard Admin](docs/screenshots/dashboard-admin.png)
*Visão geral com métricas de contratos vigentes, vencimentos próximos, inadimplências e avisos do dia.*

### Wizard de Criação de Contrato

![Wizard de Contrato](docs/screenshots/contract-wizard.png)
*Criação guiada de contratos em 3 etapas: partes envolvidas, condições financeiras e resumo.*

---

## Funcionalidades

### Painel Web (Admin)
- **Gestão de Contratos** — Criação com juros compostos, wizard 3 etapas, investidor → devedor
- **Controle de Parcelas** — Status `pendente | pago | atrasado | parcial` com cálculo automático de multa e juros de mora
- **PIX Nativo** — Geração de QR Code e string PIX (padrão Banco Central) com um clique
- **Recibos em PNG** — Download de comprovante de pagamento para envio ao cliente
- **Dashboard de Inadimplência** — Ranking de devedores, alertas de vencimento, cobrança integrada
- **Renegociação de Contratos** — Renovação, reestruturação e quitação antecipada
- **Multi-empresa** — Um tenant pode operar múltiplos CNPJs com segregação total de dados via RLS

### Bot Conversacional (WhatsApp + Telegram)
- Consultas em linguagem natural: *"quem vence essa semana?"*, *"extrato do João?"*
- Criação de contratos por texto/voz: *"cria contrato de 5 mil pra Maria, 12x, 3% ao mês"*
- Confirmação explícita antes de qualquer mutação de dados
- Lembretes automáticos de manhã (briefing dos vencimentos) e à tarde (follow-up de cobrança) via Cloud Scheduler
- Transcrição de áudio via Gemini (suporte a mensagens de voz no WhatsApp)

### Análise com IA
- Narrativa de portfólio gerada pelo Gemini: pontos fortes, riscos e recomendações
- NLU híbrido: 80+ regex (~100ms) com fallback para Gemini quando a confiança é baixa (<500ms)

---

## Stack

| Camada | Tecnologias |
|--------|-------------|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, Recharts, Lucide |
| **Backend** | Supabase — PostgreSQL, Row Level Security, Auth, Edge Functions |
| **Bot** | Node.js + Express, Gemini API, UazAPI (WhatsApp), Telegram Bot API |
| **IA** | Google Gemini — NLU fallback, análise de portfólio, transcrição de áudio |
| **Pagamentos** | PIX (padrão Banco Central) — geração de QR Code nativa |
| **Deploy** | Google Cloud Run (Docker multi-stage), Artifact Registry, Secret Manager |
| **CI/CD** | GitHub Actions — build, testes E2E (Playwright) e deploy automático |

---


## Segurança

- **Row Level Security (RLS)** em todas as tabelas — políticas validadas por `tenant_id` e `company_id`
- **`owner_email` protegido via trigger** — impossível alterar por update convencional; exige RPC `SECURITY DEFINER`
- **Filtro de `tenant_id` server-side** — sem vazamento de dados entre tenants mesmo em queries mal formadas
- **Secrets via Google Secret Manager** — nenhuma credencial no código ou no repositório
- **Anon key pública** — apenas operações que o RLS permite; service role key nunca exposta ao frontend

---

## Como Rodar Localmente

**Pré-requisitos:** Node.js 18+, conta Supabase (free tier)

```bash
# 1. Clonar e instalar
git clone https://github.com/Gsfrota/e-finance.git
cd e-finance
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env.local
# Preencher: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, GEMINI_API_KEY

# 3. Criar schema no Supabase
# Executar o SQL em context/database_schema.md no Supabase SQL Editor

# 4. Rodar
npm run dev      # http://localhost:3000
npm run build    # build de produção
```

**Bot (opcional):**

```bash
cd e-finance-bot
npm install
# Configurar .env com SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
#   GEMINI_API_KEY, UAZAPI_INSTANCE_TOKEN, TELEGRAM_BOT_TOKEN
npm run dev
```

---

## Deploy

Produção roda no **Google Cloud Run** via Docker multi-stage (Node 22 builder → nginx alpine).

```bash
./deploy.sh                    # painel web
./e-finance-bot/deploy-bot.sh  # bot
```

Secrets gerenciados pelo **Google Secret Manager**. Nenhuma credencial no código ou no repositório.

---

## Testes E2E (Playwright)

Cobertura dos três roles e todos os fluxos críticos de negócio.

```bash
npm run preview          # servidor na porta 4173 (obrigatório)
npm run test:e2e          # todos os testes (headless)
npm run test:e2e:ui       # UI interativa do Playwright
npm run test:e2e:headed   # browser visível
npm run test:qa           # smoke tests pré-deploy
```

| Diretório | Escopo |
|-----------|--------|
| `auth/` | Login, isolamento entre roles |
| `admin/` | Dashboard, contratos, usuários, multi-tenant |
| `investor/` | Dashboard do investidor |
| `debtor/` | Dashboard do devedor |
| `payment/` | PIX, parcelado, quitação, surplus, histórico |
| `contract/` | Criação, ciclo de vida, validação |
| `reports/` | KPIs, relatórios mensais, caderneta, recibos |
| `system/` | Planos de assinatura, regras de sistema |
| `e2e-full/` | Flows integrados ponta a ponta |

---

## Estrutura do Projeto

```
e-finance/
├── components/          # UI (React) — Login, Dashboard, contratos, modais
├── hooks/               # Data fetching — useInvestorMetrics, useDebtorFinance
├── services/
│   ├── supabase.ts      # Cliente + helpers (parseSupabaseError, isValidCPF)
│   ├── gemini.ts        # Google GenAI — análise de portfólio
│   └── pix.ts           # Geração de strings PIX
├── types.ts             # Tipos globais TypeScript
├── context/             # SQL migrations (v25–v44) + schema completo
├── e-finance-bot/       # Bot WhatsApp/Telegram
│   └── src/
│       ├── ai/          # NLU: intent-router, classifier, response-generator
│       ├── assistant/   # action-planner, tool-executor, policy-engine
│       ├── actions/     # Lógica de negócio (~1.850 linhas)
│       ├── channels/    # UazAPI (WhatsApp) + Telegram
│       └── scheduler/   # Briefing matinal (Cloud Scheduler)
└── Dockerfile           # Multi-stage: Node 22 builder → nginx alpine
```

---

## Roles e Acessos

| Role | Capacidades |
|------|-------------|
| **admin** | Gerencia contratos, usuários, empresas; acessa todos os módulos |
| **investor** | Visualiza carteira própria, retornos e parcelas a receber |
| **devedor** | Vê saldo, parcelas pendentes e gera QR PIX para pagamento |
| **bot** | Processa mensagens; só executa mutações após confirmação explícita |

---

## Licença

Projeto privado — portfólio pessoal.

---

<div align="center">
  <sub>Desenvolvido com React 19 · Supabase · Google Cloud Run · Gemini AI</sub>
</div>
