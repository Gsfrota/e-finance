# UAZAPI — Guia técnico em Markdown para Claude Code

> Documento de apoio para implementação de integrações com a UAZAPI.
> Foco principal: autenticação, ciclo de vida de instância, endpoints administrativos/operacionais e módulos de IA/Chatbot.
> Baseado na documentação oficial em `docs.uazapi.com` e na coleção pública oficial do Postman da UAZAPI v2.

---

## 1) O que é este documento

Este arquivo foi escrito para servir como **contexto técnico de referência** dentro do Claude Code.
A ideia é permitir que o agente:

- entenda a diferença entre `admintoken` e `token`
- implemente o fluxo correto de criação e uso de instâncias
- saiba quais endpoints pertencem ao ciclo de vida da instância
- reconheça os módulos disponíveis na API
- trate **inconsistências visíveis na documentação oficial** sem quebrar a integração

---

## 2) Regras centrais de autenticação

A UAZAPI trabalha com **dois níveis principais de autenticação**:

### 2.1 `admintoken`
Use `admintoken` para operações administrativas globais, especialmente:

- criar instância
- listar todas as instâncias
- atualizar `adminField01` e `adminField02`
- consultar erros globalmente via rota administrativa

### 2.2 `token`
Use `token` da instância para operações específicas da instância:

- conectar / desconectar
- consultar status
- atualizar nome da instância
- enviar mensagens
- usar chatbot / IA
- consultar erros da instância
- operar contatos, chats, grupos, campanhas etc.

### 2.3 Regra prática

- **Nunca** usar `token` para criar instância
- **Nunca** assumir que `admintoken` substitui o `token` no envio de mensagens
- Após criar a instância, **persistir o token retornado**, porque ele será necessário para praticamente todo o resto do uso

---

## 3) Base URL e observações de ambiente

Na coleção oficial do Postman, os exemplos usam:

```txt
http://127.0.0.1:8090
```

ou

```txt
{{baseUrl}}
```

### Regra para implementação
Claude Code deve:

1. parametrizar a base URL por variável de ambiente
2. não hardcodar `127.0.0.1:8090`
3. permitir ambientes como:
   - local
   - staging
   - produção

### Sugestão de env vars

```bash
UAZAPI_BASE_URL=
UAZAPI_ADMIN_TOKEN=
UAZAPI_INSTANCE_TOKEN=
```

---

## 4) Fluxo de ciclo de vida da instância

A sequência recomendada é:

1. criar instância com `admintoken`
2. salvar `id`, `name`, `systemName`, `token` e metadados administrativos
3. conectar a instância
4. acompanhar o status até ficar pronta
5. usar o `token` dessa instância para operações normais
6. se necessário, atualizar nome/configurações
7. em casos extremos, desconectar ou deletar a instância

---

## 5) Endpoints principais — Instance Controller

## 5.1 Criar instância

### Endpoint
```http
POST /instance/init
```

### Auth
Header:

```http
admintoken: <ADMIN_TOKEN>
```

### Body conhecido
```json
{
  "name": "outro",
  "systemName": "apilocal",
  "adminField01": "teste1-adminField01",
  "adminField02": "teste2-adminField02"
}
```

### Semântica observada
- `systemName`: nome que aparecerá no WhatsApp
- `name`: campo de controle/organização do cliente
- `adminField01` e `adminField02`: campos administrativos sem função operacional; servem apenas para organização interna
- a instância é criada **desconectada**
- a documentação indica que será gerado um **token único** para autenticação futura

### Regras de implementação
- salvar a resposta completa
- persistir o token imediatamente
- registrar os campos administrativos em banco próprio também, não confiar apenas neles como única fonte de verdade

---

## 5.2 Listar todas as instâncias

### Endpoint
```http
GET /instance/all
```

### Auth
```http
admintoken: <ADMIN_TOKEN>
```

### Uso recomendado
- painel administrativo
- sincronização periódica
- auditoria de instâncias cadastradas

---

## 5.3 Atualizar campos administrativos

### Endpoint
```http
POST /instance/updateAdminFields
```

### Auth
```http
admintoken: <ADMIN_TOKEN>
```

### Body conhecido
```json
{
  "id": "r183e2ef9597845",
  "adminField01": "adminField01",
  "adminField02": "adminField02"
}
```

### Observação
Esses campos não ficam expostos ao cliente final e servem apenas para organização interna.

### Uso ideal
- associar tenant
- associar plano
- associar origem do cliente
- associar vendedor / squad / canal

---

## 5.4 Conectar instância

### Endpoint
```http
POST /instance/connect
```

### Auth
```http
token: <INSTANCE_TOKEN>
```

### Body conhecido
```json
{
  "phone": "5511999999999"
}
```

### Comportamento documentado
- se **não enviar `phone`**: retorna **QR code**
- se **enviar `phone`**: retorna **pair code**

### Regra prática
Claude Code deve suportar os dois modos:

- `connectByQr()`
- `connectByPairCode(phone)`

---

## 5.5 Desconectar instância

### Endpoint
```http
POST /instance/disconnect
```

### Auth
```http
token: <INSTANCE_TOKEN>
```

### Uso recomendado
- manutenção
- troca de sessão
- reautenticação
- limpeza operacional antes de reconnect

---

## 5.6 Consultar status da instância

### Endpoint
```http
GET /instance/status
```

### Auth
```http
token: <INSTANCE_TOKEN>
```

### Uso recomendado
- polling após `connect`
- monitoramento de saúde da sessão
- ver atualizações de QR code

### Regra de implementação
- tratar esse endpoint como fonte principal de estado da sessão
- montar um normalizador interno de status, por exemplo:

```ts
export type InstanceHealth =
  | 'CREATED'
  | 'CONNECTING'
  | 'QRCODE'
  | 'PAIR_CODE'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR';
```

---

## 5.7 Atualizar nome da instância

### Endpoint
```http
POST /instance/updateInstanceName
```

### Auth
```http
token: <INSTANCE_TOKEN>
```

### Body conhecido
```json
{
  "name": "novo nome"
}
```

### Observação
O campo `name` é descrito como organizacional, sem função operacional específica.

---

## 5.8 Deletar instância

### Endpoint
```http
DELETE /instance
```

### Auth
```http
token: <INSTANCE_TOKEN>
```

### Cuidado
A documentação indexada não detalha parâmetros extras no trecho encontrado. Antes de automatizar exclusão em produção, validar:

- se o delete exige body ou query adicional
- se a operação é irreversível
- se há soft delete ou hard delete

### Recomendação
Implementar exclusão apenas atrás de confirmação explícita.

---

## 5.9 Privacy (documentação inconsistente)

A coleção indexada mostra dois itens chamados `privacy`:

- `GET privacy`
- `POST privacy`

Porém, no trecho indexado, ambos aparecem apontando para:

```http
/instance/status
```

Isso é **provavelmente uma inconsistência da documentação/indexação**.

### Regra para Claude Code
- não implementar automaticamente `privacy` assumindo que a rota correta é `/instance/status`
- marcar como endpoint **pendente de validação manual**
- se necessário, isolar em feature flag

---

## 5.10 Config (documentação inconsistente / integração Chatwoot)

A coleção mostra:

- `PUT config`
- `GET config`

Nos resultados indexados, ao menos um deles aparece como:

```http
GET /chatwoot/config
```

Isso sugere que a seção `config` pode estar relacionada à integração com **Chatwoot**, mesmo aparecendo dentro de `Instance Controller`.

### Regra para Claude Code
- tratar `config` como endpoint de integração específica, não como “config genérica da instância” sem validação
- encapsular em módulo separado, por exemplo:

```txt
integrations/chatwoot
```

---

## 5.11 Endpoints internos / experimentais

A coleção pública também mostra itens como:

- `teste2`
- `test`

Um dos trechos indexados de `teste2` aponta para rota de contatos do Chatwoot:

```http
POST http://localhost:8090/api/v1/accounts/{ACCOUNT_ID}/contacts
```

### Regra
Esses endpoints **não devem ser usados em integrações produtivas** sem validação humana.

---

## 6) Tratamento de erros

## 6.1 Consultar erros via admin token

### Endpoint
```http
GET /errors
```

### Auth
```http
admintoken: <ADMIN_TOKEN>
```

### Header observado
```http
convert: true
```

## 6.2 Consultar erros via token da instância

### Endpoint
```http
GET /errors
```

### Auth
```http
token: <INSTANCE_TOKEN>
```

### Header observado
```http
convert: true
```

### Regra de implementação
Claude Code deve criar duas funções distintas:

```ts
getGlobalErrors()
getInstanceErrors(instanceToken)
```

E deve registrar:

- status code
- payload bruto
- payload convertido
- contexto da operação que causou erro

---

## 7) Mapa de módulos da coleção UAZAPI v2

A coleção pública mostra os seguintes grupos principais:

1. **Instance Controller**
2. **Webhooks e SSE**
3. **Enviar Mensagem**
4. **Ações na mensagem e Buscar**
5. **Chats, Bloqueios, Contatos e etiquetas**
6. **Grupos e Comunidades**
7. **Multiatendimento**
8. **Mensagem em massa**
9. **ChatBot e IA**
10. **Ver erros**

### Leitura arquitetural recomendada
Se for criar um SDK ou adapter, dividir em módulos:

```txt
uazapi/
  admin/
  instance/
  webhooks/
  send/
  messages/
  chats/
  contacts/
  groups/
  service-desk/
  campaigns/
  ai/
  errors/
```

---

## 8) Endpoints conhecidos de outras áreas (mapa rápido)

> Abaixo está um mapa resumido para ajudar Claude Code a entender o ecossistema da API, mesmo que a implementação inicial foque em administração.

## 8.1 Webhooks e SSE
A coleção lista, entre outros:

- `POST /webhook/global` ou equivalente de webhook global (nome visto: “Definir Webhook GLOBAL”)
- `GET` webhook global
- `POST` definir webhook por instância
- `GET` ver webhook
- endpoints de **Server-Side Events** para mensagens e chats

> Os caminhos exatos de alguns itens não apareceram integralmente nos trechos indexados; validar antes de implementar.

## 8.2 Enviar Mensagem
Exemplos observados na coleção:

- `POST /send/text`
- `POST /send/media`
- `POST /send/contact`
- `POST /send/location`
- `POST /send/presence`
- `POST /send/stories`
- `POST /send/menu`
- endpoint específico para carrossel de imagem
- endpoint para pedir localização

## 8.3 Ações na mensagem e Buscar
Exemplos observados:

- `POST /message/search` ou equivalente para buscar mensagens
- `POST /message/reaction`
- `POST /message/delete`
- `POST /message/read`
- `POST /message/download`

### Exemplo conhecido — baixar arquivo da mensagem
```http
POST /message/download
```

Body observado:
```json
{
  "id": "7EB0F01D7244B421048F0706368376E0",
  "transcribe": true,
  "openai_apikey": "sk-..."
}
```

Se `transcribe: true`, a própria documentação indica uso de Whisper/OpenAI para transcrição.

## 8.4 Chats, Contatos, Bloqueios e Etiquetas
Exemplos observados:

- buscar chat
- etiquetar chat
- fixar/desafixar
- mutar/desmutar
- arquivar/desarquivar
- marcar lido/não lido
- bloquear/desbloquear usuário
- listar bloqueados
- deletar chat
- editar etiqueta
- `GET /labels`
- buscar contatos
- pegar imagem e dados de perfil
- checar se número existe

## 8.5 Grupos e Comunidades
A coleção mostra endpoints para:

- criar grupo
- alterar imagem
- buscar grupos
- obter invite link
- obter detalhes
- alterar nome e descrição
- alterar bloqueios/admin-only
- resetar link de convite
- aprovar/modificar membros
- entrar em grupo
- sair de grupo
- criar comunidade
- adicionar/remover grupo em comunidade

Exemplo confirmado:

```http
POST /group/join
```

Body:
```json
{
  "inviteCode": "https://chat.whatsapp.com/IYnl5Zg9bUcJD32rJrDzO7"
}
```

## 8.6 Multiatendimento
A coleção lista itens como:

- editar lead
- `updateFieldsMap`
- criar/editar atendente
- listar atendentes
- criar/editar resposta rápida
- listar respostas rápidas

## 8.7 Mensagem em massa
A coleção mostra:

- envio simples
- envio avançado
- editar pasta de envio
- limpar envios realizados
- listar pastas
- listar mensagens de uma pasta
- apagar todos os envios

---

## 9) ChatBot e IA — bloco importante para Claude Code

A coleção expõe uma área forte de IA, que merece módulo próprio.

## 9.1 UpdateChatbotSettings

### Endpoint
```http
POST /instance/updatechatbotsettings
```

### Auth
```http
token: <INSTANCE_TOKEN>
```

### Campos explicados pela documentação
- `openai_apikey`: chave da OpenAI
- `chatbot_enabled`: habilita/desabilita chatbot
- `chatbot_ignoreGroups`: ignora grupos
- `chatbot_stopConversation`: palavra-chave para o usuário parar o chatbot
- `chatbot_stopMinutes`: minutos de pausa após o comando de parada
- `chatbot_stopWhenYouSendMsg`: minutos de pausa quando você envia mensagem fora da API; `0` desliga esse comportamento

### Observação
Mesmo o nome do campo mencionar OpenAI, a coleção também mostra suporte a múltiplos providers no módulo de agentes.

---

## 9.2 Agentes

### Listar agentes
```http
GET /agent/list
```

> O nome “Todos os agentes” aparece na coleção. O caminho exato não surgiu em todos os trechos indexados, mas o padrão sugere `/agent/list`.

### Criar/Editar agente
```http
POST /agent/edit
```

### Body parcialmente conhecido
```json
{
  "id": "",
  "delete": false,
  "agent": {
    "name": "uazabot",
    "provider": "openai",
    "apikey": "sk-...",
    "basePrompt": "Seu nome é Sara...",
    "model": "gpt-4o-mini",
    "maxTokens": 2000,
    "temperature": 70,
    "diversityLevel": 50
  }
}
```

### Providers vistos na doc
- `openai`
- `anthropic`
- `gemini`
- `deepseek`

### Modelos citados nos exemplos
- OpenAI: `gpt-4o-mini`, `o1-mini`
- Anthropic: `claude-3-opus-20240229`, `claude-3-sonnet-20240229`
- Gemini: `gemini-pro`
- DeepSeek: `deepseek-chat`

### Regra
Implementar provider como enum aberto/configurável, pois isso pode mudar.

---

## 9.3 Triggers

### Listar triggers
```http
GET /trigger/list
```

### Criar/Editar trigger
```http
POST /trigger/edit
```

### Body conhecido
```json
{
  "id": "",
  "delete": false,
  "trigger": {
    "active": true,
    "type": "agent",
    "agent_id": "ref2ed7ab21d4ea",
    "flow_id": "",
    "quickReply_id": "",
    "ignoreGroups": true,
    "lead_field": "lead_status",
    "lead_operator": "equals",
    "lead_value": "new",
    "priority": 1,
    "wordsToStart": "hello|hi|start",
    "responseDelay_seconds": 6
  }
}
```

### Leitura prática
Triggers parecem definir **quando** um agente ou automação deve iniciar.

---

## 9.4 Conhecimentos

### Listar conhecimentos
```http
GET /knowledge/list
```

### Criar/Editar conhecimento
```http
POST /knowledge/edit
```

### Body conhecido
```json
{
  "id": "",
  "delete": false,
  "knowledge": {
    "isActive": true,
    "tittle": "Informações sobre a uazapi",
    "content": "..."
  }
}
```

### Atenção
A chave aparece como `tittle` no trecho indexado, não `title`.

**Não corrigir automaticamente esse nome sem testar**, porque pode ser o nome real aceito pela API.

---

## 9.5 Funções API dos Agentes

### Listar funções
```http
GET /function/list
```

### Criar/Editar função
```http
POST /function/edit
```

### Capacidade observada
A função permite cadastrar chamadas externas que o agente poderá usar, incluindo:

- `name`
- `description`
- `isActive`
- `method`
- `endpoint`
- `headers`
- `body`
- `parameters`

### Exemplo de estrutura observada
```json
{
  "id": "",
  "delete": false,
  "function": {
    "name": "createProduct",
    "description": "Cria um novo produto no catálogo",
    "isActive": true,
    "method": "POST",
    "endpoint": "https://api.example.com/products",
    "headers": {
      "Authorization": "Bearer {{apiKey}}",
      "Content-Type": "application/json"
    },
    "body": {
      "name": "{{productName}}",
      "category": "{{category}}",
      "price": "{{price}}",
      "stock": "{{stockQuantity}}",
      "tags": "{{tags}}"
    },
    "parameters": [
      {
        "name": "apiKey",
        "type": "string",
        "description": "Chave de API para autenticação",
        "required": true
      }
    ]
  }
}
```

### Leitura arquitetural
Esse módulo é basicamente uma forma de **tool calling configurável** dentro da própria UAZAPI.

---

## 10) Inconsistências e cuidados obrigatórios

Este bloco é muito importante para Claude Code.

## 10.1 Não assumir consistência total da doc indexada
Foram observados sinais de inconsistência ou indexação parcial em pontos como:

- `privacy` apontando para `/instance/status`
- `config` aparecendo como `/chatwoot/config` dentro de `Instance Controller`
- presença de endpoints `test` e `teste2`
- alguns list endpoints aparecem no nome, mas o path completo nem sempre está explicitado nos trechos indexados

## 10.2 Estratégia segura de implementação
Sempre:

1. encapsular cada endpoint em adapter isolado
2. adicionar logging de request/response
3. suportar feature flags para endpoints incertos
4. validar shape da resposta em runtime
5. não apagar dados nem deletar instância sem confirmação explícita

---

## 11) Modelo de cliente recomendado

```ts
export interface UazapiConfig {
  baseUrl: string;
  adminToken?: string;
  instanceToken?: string;
  timeoutMs?: number;
}

export class UazapiClient {
  constructor(private readonly config: UazapiConfig) {}

  // Admin
  createInstance() {}
  listInstances() {}
  updateAdminFields() {}
  getGlobalErrors() {}

  // Instance
  connect() {}
  disconnect() {}
  getStatus() {}
  updateInstanceName() {}
  deleteInstance() {}
  getInstanceErrors() {}

  // AI
  updateChatbotSettings() {}
  listAgents() {}
  editAgent() {}
  listTriggers() {}
  editTrigger() {}
  listKnowledge() {}
  editKnowledge() {}
  listFunctions() {}
  editFunction() {}
}
```

---

## 12) Convenções sugeridas de implementação

## 12.1 Separar headers automaticamente

```ts
function withAdminToken(headers = {}) {
  return { ...headers, admintoken: process.env.UAZAPI_ADMIN_TOKEN };
}

function withInstanceToken(token: string, headers = {}) {
  return { ...headers, token };
}
```

## 12.2 Centralizar requests

```ts
async function request<T>(input: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<T> {
  // implementar com fetch/axios
}
```

## 12.3 Validar respostas
Usar Zod, Valibot ou schema próprio para:

- createInstance response
- status response
- error response
- ai config response

---

## 13) Ordem sugerida de implementação no Claude Code

### Fase 1 — essencial
- autenticação
- create instance
- list instances
- connect
- status
- disconnect
- update name
- errors

### Fase 2 — operação comercial
- webhooks
- send text
- send media
- contacts/chats
- groups

### Fase 3 — IA
- updateChatbotSettings
- agent edit/list
- trigger edit/list
- knowledge edit/list
- function edit/list

### Fase 4 — avançado
- campanhas/mensagem em massa
- multiatendimento
- integrações específicas como Chatwoot

---

## 14) Prompt de contexto curto para o Claude Code

Use este bloco caso queira colar diretamente como contexto inicial do Claude Code:

```md
Você está implementando integração com a UAZAPI v2.

Regras obrigatórias:
- Endpoints administrativos usam header `admintoken`.
- Endpoints de instância usam header `token`.
- O fluxo base é: criar instância -> salvar token -> conectar -> consultar status -> operar.
- `POST /instance/init` cria instância.
- `GET /instance/all` lista instâncias.
- `POST /instance/updateAdminFields` atualiza metadados administrativos.
- `POST /instance/connect` retorna QR code se não passar `phone`, ou pair code se passar `phone`.
- `GET /instance/status` consulta estado da instância.
- `POST /instance/disconnect` desconecta.
- `POST /instance/updateInstanceName` atualiza nome organizacional da instância.
- `DELETE /instance` deleta instância, mas trate com cautela.
- `GET /errors` existe tanto via `admintoken` quanto via `token`.
- Há inconsistências na documentação indexada em `privacy` e `config`; não assuma comportamento sem validação.
- Módulos de IA incluem `/instance/updatechatbotsettings`, `/agent/edit`, `/trigger/edit`, `/knowledge/edit`, `/function/edit` e endpoints de listagem correspondentes.
- Implemente adapters isolados, logging detalhado e validação de resposta em runtime.
```

---

## 15) Pendências de validação manual

Antes de colocar em produção, validar diretamente no ambiente real da UAZAPI:

- formato exato da resposta de `createInstance`
- shape real de `status`
- rotas reais de `privacy`
- rotas reais de `config`
- path confirmado de `GET /agent/list`
- comportamento real de `DELETE /instance`
- shape de erro com e sem header `convert: true`

---

## 16) Resumo executivo

Se Claude Code for implementar a integração hoje, o mais confiável é considerar que:

- a API é organizada por **instância de WhatsApp**
- o `admintoken` é usado para **gestão global**
- o `token` da instância é usado para **operações reais da sessão**
- há um módulo robusto de **ChatBot e IA** com agentes, triggers, conhecimento e functions
- a coleção pública do Postman complementa a documentação principal
- existem alguns sinais de inconsistência/experimentalismo, então a integração precisa ser **defensiva**

---

## 17) Fontes oficiais usadas para montar este guia

- Documentação oficial principal: `https://docs.uazapi.com/`
- Tag de administração: `https://docs.uazapi.com/tag/Admininstra%C3%A7%C3%A3o`
- Coleção pública oficial no Postman: `uazapiGO - WhatsApp API (v2.0)`




Dados da instância

Server URL: 
https://processai.uazapi.com

Instance Token:  
360088d2-12bf-420b-a4fa-121210dd03c1

Número conectado:
558520284195

Status:
connected

connected
360088d2-12bf-420b-a4fa-121210dd03c1

Webhooks
Habilitado
id: rd5ab150926a95d
POST
URL
https://e-finance-bot-485911123531.us-west1.run.app/webhook/whatsapp
addUrlEvents
addUrlTypesMessages
URL final
https://e-finance-bot-485911123531.us-west1.run.app/webhook/whatsapp
Escutar eventos
qrcodehistoryconnectionmessagesmessages_updatecallcontactspresencegroupslabelschatschat_labelsblocksleadssender
