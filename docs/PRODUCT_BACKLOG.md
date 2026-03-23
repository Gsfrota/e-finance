# Product Backlog — E-Finance

> Backlog de produto priorizado para evolução da plataforma de gestão de empréstimos.
> Atualizado em: 23/03/2026

---

## Prioridade 1 — Impacto direto na operação

### 1.1 Cobrança automática por WhatsApp
**Valor:** Reduz inadimplência em 20-30% sem esforço manual.

O bot WhatsApp já existe mas não envia lembretes automáticos. Implementar régua de cobrança configurável:

| Momento | Mensagem | Tom |
|---------|----------|-----|
| D-3 (3 dias antes) | "Sua parcela de R$X vence dia DD/MM" | Informativo |
| D0 (no dia) | "Sua parcela vence hoje. Pix: [código copiável]" | Direto, com Pix pronto |
| D+1 (1 dia depois) | "Sua parcela está atrasada. Regularize para evitar juros." | Alerta |
| D+7 (7 dias depois) | "Parcela em atraso há 7 dias. Entre em contato." | Firme |
| D+15, D+30 | Mensagens progressivas | Escalonamento |

**Requisitos:**
- Régua configurável por tenant (quais dias, quais mensagens)
- Incluir código Pix na mensagem (já existe `pix.ts`)
- Respeitar horário comercial (8h-20h, configurable)
- Opt-out por devedor (não cobrar automaticamente)
- Log de envios para auditoria
- Não duplicar envio se devedor já pagou

**Depende de:** Bot WhatsApp (existe), Cloud Scheduler (existe), tabela `loan_installments` com `due_date` e `status`

---

### 1.2 Antecipação de parcelas com desconto
**Valor:** Incentiva quitação antecipada, melhora fluxo de caixa do investidor.

Devedor ou admin quer pagar N parcelas futuras de uma vez, com desconto proporcional aos juros que não vão mais incidir.

**Fluxo proposto:**
1. Selecionar parcelas a antecipar (ex: #5, #6, #7)
2. Sistema calcula desconto: `juros_futuros * taxa_desconto`
3. Exibe resumo: "3 parcelas, valor original R$3.300, com desconto R$3.050"
4. Confirma → quita todas, grava audit log

**Requisitos:**
- Nova RPC `prepay_installments(installment_ids[], discount_rate)`
- Taxa de desconto configurável por contrato ou global
- Desconto incide apenas sobre `amount_interest`, nunca sobre `amount_principal`
- Gerar recibo consolidado
- Audit log tipo `prepayment` em `payment_transactions`

---

### 1.3 Simulador de empréstimo
**Valor:** Agiliza negociação com devedor, evita criar contrato "pra ver como fica".

Tela simples (modal ou seção) onde o investidor digita:
- Valor principal
- Taxa de juros (% a.m.)
- Quantidade de parcelas
- Modalidade (Price / SAC / Bullet)

E vê imediatamente:
- Valor de cada parcela
- Total de juros
- Total pago
- Tabela com cronograma completo

**Requisitos:**
- Componente `LoanSimulator.tsx` (modal ou tela)
- Cálculos client-side (sem RPC)
- Botão "Criar contrato com esses termos" → preenche `QuickContractInput`
- Suportar as 3 modalidades existentes (auto, manual, interest_only)
- Compartilhar simulação via WhatsApp (texto formatado)

---

## Prioridade 2 — Controle e visão do negócio

### 2.1 Fluxo de caixa projetado
**Valor:** Permite planejar novos empréstimos sabendo o que vai entrar.

Dashboard ou tela dedicada mostrando:
- Calendário mensal com valores esperados por dia/semana
- Separação: "provável" (clientes pontuais) vs "incerto" (clientes em atraso)
- Gráfico de barras: recebimentos projetados por mês (próximos 6-12 meses)
- Comparativo: projetado vs realizado (meses anteriores)

**Requisitos:**
- Hook `useCashFlowProjection(tenantId, months)`
- Fonte: parcelas pendentes + scoring do `TopClientes` para probabilidade
- Filtro por empresa (multi-company)
- Exportar como PDF/imagem

---

### 2.2 Indicadores de saúde da carteira
**Valor:** Visão executiva do risco da operação.

Painel consolidado com métricas:

| Indicador | Fórmula |
|-----------|---------|
| Taxa de inadimplência | parcelas atrasadas / total ativas |
| Concentração de risco | maior devedor / carteira total (alerta se > 20%) |
| Ticket médio | soma principal / qtd contratos |
| Prazo médio | média de parcelas por contrato |
| ROI da carteira | juros recebidos / capital emprestado |
| Tendência inadimplência | comparativo mês a mês (subindo/estável/caindo) |

**Requisitos:**
- Componente `PortfolioHealth.tsx`
- SQL view ou query agregada
- Alertas visuais quando indicador sai do saudável
- Histórico mensal para gráfico de tendência

---

### 2.3 Relatório de rendimentos (IR / Carnê-Leão)
**Valor:** Obrigatório para quem empresta legalmente. Economiza horas do contador.

Gerar relatório com:
- Total de juros recebidos no período (mês/trimestre/ano)
- Discriminação por devedor (nome, CPF, valor recebido)
- Separação: juros vs principal recebido
- Formato: PDF exportável + tela no sistema

**Requisitos:**
- Filtro por período (mês para carnê-leão, ano para DIRPF)
- Dados vêm de `payment_transactions` (type=payment, interest_portion)
- Template PDF com dados do investidor (nome, CPF)
- Botão "Exportar para contador"
- Filtro por empresa (multi-company)

---

## Prioridade 3 — Profissionalização

### 3.1 Contrato digital (PDF + assinatura)
**Valor:** Proteção legal e profissionalismo.

**Funcionalidades:**
- Gerar PDF de contrato com dados preenchidos (template configurável)
- Campos: partes (credor/devedor), valor, taxa, parcelas, garantias, cláusulas
- Assinatura digital simples (canvas de assinatura no celular)
- Armazenamento vinculado ao `investment` (Supabase Storage)
- Consulta posterior pelo admin ou devedor

**Requisitos:**
- Template PDF (react-pdf ou similar)
- Componente de assinatura (canvas touch)
- Upload para Supabase Storage bucket `contracts`
- Campo `contract_document_url` em `investments`
- Visualizador de PDF inline

---

### 3.2 Carência (grace period)
**Valor:** Flexibilidade em empréstimos maiores.

Permitir configurar período sem cobrança antes da primeira parcela.

**Requisitos:**
- Campo `grace_period_days` em `investments` (default: 0)
- Ao criar contrato com carência, primeira parcela = `start_date + grace_period_days`
- Opção: cobrar juros durante carência (capitalizar) ou não
- UI: campo numérico no formulário de criação

---

### 3.3 Tabela Price vs SAC
**Valor:** Diferencial competitivo, atende mais perfis de devedor.

Hoje: apenas parcelas fixas (Price). Adicionar SAC (Sistema de Amortização Constante):
- Amortização fixa, juros decrescentes
- Parcelas maiores no início, menores no final
- Útil para devedores com renda variável/sazonal

**Requisitos:**
- Campo `amortization_method` em `investments`: `price` | `sac` | `bullet`
- Lógica de cálculo SAC no `AdminContracts` e no `LoanSimulator`
- Exibir diferença no simulador: "Price: 12x R$1.100 / SAC: de R$1.200 a R$1.020"

---

### 3.4 Exportar relatórios (Excel + PDF)
**Valor:** Investidores querem dados na planilha deles.

Adicionar botão "Exportar" em:
- Lista de parcelas (por contrato ou geral)
- Histórico de pagamentos
- Dashboard de cobrança
- Relatório de rendimentos

**Formatos:** `.xlsx` (SheetJS) e `.pdf` (react-pdf ou jsPDF)

---

## Backlog futuro (avaliar depois)

| Item | Descrição |
|------|-----------|
| Garantias/avalista | Cadastro de garantidor por contrato |
| Multi-moeda | Suporte a USD, EUR (para operações internacionais) |
| API pública | REST API para integrações externas |
| Portal do devedor | Subdomínio separado, acesso simplificado |
| Comissões | Rastreamento de comissão para intermediários/agentes |
| CNAB/remessa bancária | Importar pagamentos via arquivo bancário |
| Webhooks outbound | Notificar sistemas externos em eventos |
| App mobile nativo | React Native para Android/iOS |

---

## Como usar este documento

1. **Escolha** um item por prioridade de negócio
2. **Detalhe** em story (usando AIOS `@sm *draft` ou diretamente)
3. **Implemente** seguindo o fluxo existente do projeto
4. **Marque** como concluído aqui quando em produção

Cada item tem requisitos suficientes para iniciar implementação sem ambiguidade.
