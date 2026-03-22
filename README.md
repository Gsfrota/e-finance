# E-Finance

Plataforma SaaS multi-tenant para gestão de contratos de crédito entre investidores e devedores, com painel web completo e bot de WhatsApp/Telegram com NLU em português.

## Visão geral

O E-Finance resolve um problema real de gestores de carteiras de crédito: controlar múltiplos contratos, parcelas, pagamentos e inadimplências em um único lugar — acessível tanto pelo painel web quanto pelo WhatsApp, via linguagem natural.

## Mudanças recentes

O sistema passou por uma transição operacional importante:

- O frontend agora resolve perfil por `auth_user_id` com fallback legado para `id`.
- O bot exige segredos próprios para `/setup`, Telegram e WhatsApp.
- A configuração pública do browser migra para `SUPABASE_ANON_KEY`, mas ainda aceita `SUPABASE_KEY` como compatibilidade temporária.

Para o impacto prático e o rollout seguro, veja [docs/guides/operational-differences.md](docs/guides/operational-differences.md).

**Módulos:**

- **Painel Web** — React 19 + TypeScript + Supabase, multi-tenant com roles (admin, investidor, devedor)
- **Bot WhatsApp/Telegram** — pipeline NLU de 20 estágios com fallback LLM (Gemini), processa comandos como *"quem vence essa semana?"* ou *"registra pagamento do João"*
- **Análise de portfólio com IA** — integração com Gemini para insights sobre a carteira
- **PIX** — geração de QR codes de cobrança nativos (padrão Pix brasileiro)

## Stack

| Camada | Tecnologias |
|--------|-------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Recharts |
| Backend | Supabase (PostgreSQL + RLS + Auth), Row Level Security por tenant |
| Bot | Node.js + Express, Gemini API, UazAPI (WhatsApp), Telegram Bot API |
| Deploy | Google Cloud Run (Docker), Artifact Registry, Secret Manager |
| IA | Google Gemini (NLU fallback + geração de resposta + análise de portfólio) |

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    Painel Web                        │
│  Login → Dashboard → [Admin | Investidor | Devedor]  │
│  AdminContracts / InvestorDashboard / DebtorDashboard│
└──────────────────────┬──────────────────────────────┘
                       │
               Supabase (Postgres + RLS)
                       │
┌──────────────────────┴──────────────────────────────┐
│                  E-Finance Bot                       │
│  WhatsApp/Telegram → Webhook → Pipeline NLU          │
│  intent-router (80+ regex) → Gemini fallback          │
│  intent-classifier → action-planner → tool-executor  │
│  → response-generator → resposta em PT-BR natural    │
└─────────────────────────────────────────────────────┘
```

### Pipeline NLU do bot (20 estágios)

```
Webhook → dedup → rate-limit → inbound-buffer (3.5s debounce)
  → session-manager → prompt-guard → audio-pipeline (speech-to-text)
  → confirmation-store → followup-resolver → command-understanding
  → intent-router → intent-classifier → action-planner → policy-engine
  → tool-executor → response-generator → canal (WhatsApp/Telegram)
```

**Estratégia híbrida:** 80+ regras regex cobrem os intents mais comuns (~100ms). Gemini entra apenas quando a confiança é baixa (timeout 2s, 80 tokens). Resultado: latência média <500ms na maioria das mensagens.

## Modelo de dados

```
Tenant ──┬── Profile (admin | investor | debtor)
         ├── Investment (contrato: investidor → devedor)
         │     └── LoanInstallment (parcelas: pending | paid | late | partial)
         ├── BotSession (histórico de conversa, working state)
         └── Invite (onboarding por código)
```

Row Level Security no Supabase garante isolamento total entre tenants.

## Funcionalidades principais

**Painel web (admin):**
- Cadastro e gestão de contratos com juros compostos
- Registro de pagamentos parciais e totais com cálculo de multa/juros de mora
- Geração de recibos (PNG) e QR code PIX para cobrança
- Dashboard de inadimplência e cobrança
- Renovação e renegociação de contratos
- Wizard de onboarding para novos tenants

**Bot (WhatsApp e Telegram):**
- Consultas em linguagem natural: *"quem vence hoje?"*, *"extrato do CPF 123"*
- Criação de contratos por voz/texto: *"cria contrato de 5 mil pra João, 12 parcelas, 3% ao mês"*
- Registro de pagamentos com confirmação explícita antes de mutações
- Briefing matinal agendado (Cloud Scheduler)
- Suporte a áudio com transcrição via Gemini

**IA:**
- Análise narrativa do portfólio com Gemini (pontos fortes, riscos, recomendações)
- NLU com fallback LLM para mensagens ambíguas
- Geração de respostas conversacionais em PT-BR

## Como rodar localmente

**Pré-requisitos:** Node.js 18+, conta Supabase

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env.local
# Adicionar: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

# 3. Configurar banco de dados
# Execute o SQL em context/database_schema.md no Supabase SQL Editor

# 4. Rodar
npm run dev        # http://localhost:3000
npm run build      # build de produção
```

**Bot (opcional):**

```bash
cd e-finance-bot
npm install
# Configurar .env com SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
#   GEMINI_API_KEY, UAZAPI_SERVER_URL, UAZAPI_INSTANCE_TOKEN,
#   TELEGRAM_BOT_TOKEN, SETUP_SECRET, TELEGRAM_WEBHOOK_SECRET_TOKEN,
#   UAZAPI_WEBHOOK_SECRET, BOT_BASE_URL
npm run dev
```

### Como usar o app

- `admin`: cria e revisa contratos, acompanha cobrança e administra usuários do tenant.
- `investor`: acompanha carteira, retornos e próximas parcelas recebíveis.
- `devedor`: vê saldo, parcelas e pagamentos pendentes.
- `bot`: recebe mensagens por WhatsApp/Telegram e só executa mutações após validação e confirmação explícita.

## Deploy

O projeto roda no **Google Cloud Run** via Docker multi-stage (Node 22 builder → nginx alpine).

```bash
./deploy.sh          # painel web
cd e-finance-bot && ./deploy-bot.sh   # bot
```

Secrets gerenciados pelo Google Secret Manager. Nenhuma credencial no código.

Para operação e rollback seguros, use [docs/devops/deploy-runbook.md](docs/devops/deploy-runbook.md).

## Estrutura do projeto

```
e-finance/
├── components/          # Componentes React (painel web)
├── hooks/               # Custom hooks de data fetching
├── services/
│   ├── supabase.ts      # Cliente Supabase + helpers
│   ├── gemini.ts        # Google GenAI para análise de portfólio
│   └── pix.ts           # Geração de strings PIX
├── types.ts             # Tipos globais TypeScript
├── context/
│   └── database_schema.md  # Schema SQL (v16+)
├── e-finance-bot/       # Bot WhatsApp/Telegram
│   └── src/
│       ├── ai/          # NLU: intent-router, classifier, response-generator
│       ├── assistant/   # action-planner, tool-executor, policy-engine
│       ├── actions/     # Lógica de negócio (~1850 linhas)
│       ├── channels/    # WhatsApp (UazAPI) + Telegram
│       └── scheduler/   # Cloud Scheduler (briefing matinal)
└── Dockerfile
```

## Licença

Projeto privado / portfólio pessoal.
