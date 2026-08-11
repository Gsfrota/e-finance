# PWA Offline — Cobrança em Campo Sem Rede

**Data:** 2026-08-11
**Frente:** B (de A→B→C: Renovação → Offline → Polimento)
**Status:** aprovado para plano de implementação

## Problema

Metade da carteira é cobrança de rua. Em produção, **228 dos 459 contratos são `daily`** — trabalho de campo, tocando campainha, em lugar onde o sinal cai. O e-finance é uma SPA que fala com o Supabase a cada ação: sem rede, ele não faz nada.

Os concorrentes diretos do nicho (CobrApp, Cobrança Diária, Prestapp) são apps nativos justamente por isso, e funcionam offline. Essa é hoje a única desvantagem estrutural do produto contra eles — e apareceu como condição de compra de um cliente.

## Contexto medido

Números de produção levantados em 2026-08-11, que dimensionam o problema para baixo:

| Medida | Valor | Consequência no desenho |
|---|---|---|
| Admins por tenant | **Máximo 1.** Dos 21 tenants que têm admin, nenhum tem mais de um | Não há dois cobradores disputando a mesma parcela. O risco não é conflito de merge, é **baixa duplicada** |
| Carteira em janela de ±30 dias | **1.326 parcelas, 216 kB** (todos os tenants somados) | Cabe inteira no celular. Não precisa sync incremental, paginação nem seleção de rota |
| Maior carteira | 447 parcelas abertas (Md veículos) | Pequeno para qualquer estratégia |

Isso elimina a parte cara do offline — CRDT, resolução de conflito, sync parcial. Sobra a parte perigosa: escrita de dinheiro.

## Decisões do usuário (2026-08-11)

1. **Offline lê e dá baixa.** Nenhuma outra escrita: contrato novo, edição de parcela, estorno, renovação e avulso continuam exigindo rede.
2. **A baixa offline não mostra saldo.** O app confirma o recebimento ("R$50 registrado") e nada mais. Nenhum cálculo financeiro é replicado no cliente — o servidor continua sendo a única autoridade sobre saldo, multa e imputação.
3. **Baixa recusada vira pendência para decisão humana.** O sistema nunca resolve dinheiro que não bate sozinho.
4. **Android e iPhone.** O desenho assume o pior caso (iOS) e trata as limitações como escopo.

Uma decisão tomada sem consulta, por só haver uma resposta correta: **a baixa vale a data em que o dinheiro foi recebido em campo**, não a do sync. `pay_installment` já recebe `timestamptz`. Sincronizar dois dias depois não pode gerar multa de dois dias.

## Fase 0 — cortar as dependências de CDN

**Pré-requisito absoluto.** O `index.html` (e o build em `dist/`) carrega três recursos externos:

```
https://cdn.tailwindcss.com     ← todo o CSS, compilado em runtime no navegador
https://fonts.googleapis.com
https://fonts.gstatic.com
```

Sem rede, o Tailwind não carrega e **o app não tem estilo nenhum**. Cachear dados é inútil se a interface não pinta. Além disso, o CDN do Tailwind compila classes em runtime — o próprio Tailwind desaconselha em produção.

- Trazer o Tailwind para o build (plugin do Vite / PostCSS), gerando CSS estático.
- Auto-hospedar as fontes, ou aceitar o fallback do sistema.

Ganho colateral, independente de offline: some um ponto de falha de terceiro que hoje afeta todos os clientes.

## 1. Banco — a peça que falta

`pay_installment(p_installment_id uuid, p_amount_paid numeric, p_paid_at timestamptz)` **não tem chave de idempotência**, e não existe tabela onde ancorar uma. Sem isso, um sync que repete cobra o devedor duas vezes.

Uma tabela e uma RPC resolvem três problemas de uma vez — idempotência, caixa de pendências e trilha de auditoria:

```sql
create table offline_payment_intents (
  id             uuid primary key,      -- gerado no CELULAR, antes de haver rede
  tenant_id      uuid not null,
  installment_id uuid not null,
  amount         numeric not null,
  paid_at        timestamptz not null,  -- quando o dinheiro entrou em campo
  status         text not null default 'pending',  -- pending|applied|rejected|resolved
  error_message  text,
  created_by     uuid,
  submitted_at   timestamptz default now(),
  resolved_at    timestamptz
);
```

**A chave primária é a idempotência.** O `id` nasce no celular via `crypto.randomUUID()`. Sincronizou duas vezes, deu timeout e reenviou, o cobrador apertou o botão em pânico — o segundo INSERT bate em `unique_violation` e a RPC devolve o status já existente, sem tocar em dinheiro.

`submit_offline_payment(p_intent_id, p_installment_id, p_amount, p_paid_at)`:

1. Insere a intenção. Se já existe → devolve o status atual e **para**.
2. Tenta `pay_installment(...)` com o `paid_at` de campo.
3. Sucesso → `status = 'applied'`.
4. Exceção → captura em bloco `EXCEPTION`, grava `status = 'rejected'` com `SQLERRM`, e **a intenção sobrevive**.

O passo 4 é o que faz o desenho funcionar. Sem o bloco `EXCEPTION`, a falha de `pay_installment` daria rollback no INSERT junto, e a pendência sumiria exatamente no caso em que ela importa. Em plpgsql, `EXCEPTION WHEN OTHERS` abre savepoint — o `UPDATE` de rejeição persiste.

RLS por `tenant_id`, no mesmo padrão das demais tabelas. A RPC é `SECURITY DEFINER` com a guarda de tenant que a v46 padronizou.

## 2. Cliente

| Peça | Responsabilidade |
|---|---|
| **Service Worker** | Cacheia o app (Cache API). Precisa ser **reescrito** — ver seção 5 |
| **IndexedDB `snapshot`** | Carteira do tenant + `fetchedAt`. Dezenas de kB — 216 kB é o total dos 6 tenants ativos somados |
| **IndexedDB `outbox`** | Fila de intenções, cada uma com UUID gerado localmente |
| **Sync** | Dispara em `online`, ao abrir o app, ao voltar do background, e a cada poucos minutos com o app aberto. Envia em série |
| **Indicador de idade** | "Atualizado há 3h", fixo na tela de cobrança. Vermelho passando do limite |
| **Badge de pendências** | Itens no outbox + itens `rejected` aguardando decisão |

Dependência nova: nenhuma, ou `idb` (~1 kB) como conveniência sobre IndexedDB.

## 3. Fluxo

**Com rede:** nada muda. As telas seguem chamando os mesmos RPCs; o snapshot é atualizado em background.

**Sem rede:** a tela de cobrança lê do snapshot e exibe a idade do dado. Dar baixa grava no outbox e confirma apenas o recebimento — sem recalcular saldo. O cobrador ainda enxerga o saldo do último sync, então não fica cego: ele não promete número novo.

**Rede voltou:** o outbox esvazia contra `submit_offline_payment`. Aplicadas somem da fila. Rejeitadas viram lista com motivo em português ("parcela já estava paga"), e o dono decide: lançar como avulso, estornar a outra baixa, ou descartar. Nenhuma das três é automática.

## 4. Falhas

| Falha | Comportamento |
|---|---|
| Rede cai no meio do sync | Intenção fica `pending`, é reenviada. Seguro por construção |
| Resposta perdida (timeout) | Idem. O celular não sabe se aplicou; o servidor sabe. Reenviar é a resposta certa |
| Parcela já paga / contrato quitado | `rejected` + motivo → caixa de pendências |
| Snapshot velho | Indicador de idade em vermelho |
| Deploy novo com fila pendente | Ver seção 5 |

## 5. Service Worker e a regra dura

O SW atual (`public/service-worker.js`, 37 linhas) é resíduo do Google AI Studio: no `activate` ele **apaga todos os caches**, e intercepta chamadas ao Gemini redirecionando para `/api-proxy/`. Esse proxy é **órfão** — só existe no `nginx.conf`, que por sua vez é resíduo do Cloud Run desativado. Nenhum código do app chama. Pode sair junto.

**A regra dura:** o Service Worker pode limpar o cache do app (Cache API) à vontade, mas **nunca pode tocar em IndexedDB**. Se essa lógica encostar no storage de dados, uma atualização de versão apaga baixas de dinheiro que ainda não subiram. O `outbox` precisa de schema versionado e migração, não de reset.

### Interação com o `[AppRecovery]`

O `index.html` tem um mecanismo de recuperação de tela branca: se o React não montar em **15 segundos**, aparece *"Não foi possível abrir o sistema — uma versão antiga pode ter ficado salva neste aparelho. Limpe o cache do aplicativo"*, com um botão que limpa caches e desregistra os service workers.

Duas coisas boas: o gatilho é **manual** (o usuário clica) e o recovery **não toca em IndexedDB** — a fila sobreviveria.

Mas o risco é direto: um cobrador sem sinal que veja essa tela vai clicar, e fica sem app no meio da rua. Escopo desta frente:

- O boot precisa montar **do cache do SW**, sem depender da rede, bem abaixo dos 15s.
- A tela de erro precisa distinguir **sem rede** de **app quebrado**. Offline não é falha: em vez de sugerir limpar cache, deve oferecer o modo offline.
- "Recovery não toca em IndexedDB" deixa de ser acidente e vira invariante coberta por teste.

## 6. iOS — o que se promete e o que não

Não há como eliminar o risco, então o desenho o assume:

- **`navigator.storage.persist()`** é chamado. No Android segura; no iOS é pedido educado.
- **Sync agressivo.** No iPhone não existe Background Sync — o envio só acontece com o app aberto. Quanto menos tempo a fila fica parada, menor a janela de perda.
- **Alarme de pendência velha.** Passando de ~12h com item na fila, banner fixo, não badge discreto.
- **Exportar pendências** em texto (WhatsApp, Telegram, print) — o paraquedas manual caso o Safari limpe o storage.

O Safari pode apagar o storage do site após ~7 dias sem uso, e um PWA não tem como impedir. Isso não torna o iOS confiável; torna a perda **visível antes** de acontecer, que é o máximo honesto. Deve constar do que se promete ao cliente.

## Testes

- **Unit** — a fila: enfileirar, marcar aplicada, marcar rejeitada, retry não duplica.
- **Contrato de banco** (`e2e/contract-db/*.dbspec.ts`, padrão já existente): a mesma intenção enviada duas vezes gera **um** pagamento; rejeição preserva a intenção em vez de sumir com ela; `paid_at` de campo é respeitado e não gera multa do dia do sync.
- **E2E** — `context.setOffline(true)` no Playwright: derrubar a rede, dar baixa, religar, conferir que subiu e que o saldo bateu. É este que prova a feature; os outros provam as peças.
- **Invariante** — acionar o `[AppRecovery]` com fila pendente e verificar que o `outbox` sobrevive.

Gate obrigatório antes de push: `npx tsc --noEmit`.

## Fora de escopo

- **Múltiplos cobradores simultâneos.** Hoje é 1 admin por tenant. Se isso mudar, o desenho volta para a mesa — a premissa de "sem conflito" cai.
- Qualquer escrita offline além da baixa.
- Push notification.
- APK empacotado (TWA/Capacitor). O PWA instalado já vira ícone na tela; a loja fica para depois, se houver razão comercial.
- Rollover de saldo e demais itens herdados da Frente A.

## Riscos

| Risco | Mitigação |
|---|---|
| Safari apagar o storage e perder baixas | Sync agressivo, alarme de pendência antiga, exportação manual. Risco residual **assumido e comunicado ao cliente** |
| Cobrador clicar em "limpar cache" na tela de erro | Boot offline abaixo de 15s e tela que distingue sem-rede de app-quebrado |
| Atualização de versão apagar a fila | IndexedDB fora do alcance do SW; schema versionado com migração |
| Replicar cálculo financeiro no cliente por pressão de UX | A decisão 2 é explícita: a baixa offline não mostra saldo. Qualquer pedido de "mostrar quanto falta" offline reabre esta spec |
| Tailwind via CDN deixar o app sem estilo offline | Fase 0, pré-requisito de tudo |
