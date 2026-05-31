import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import type { StructuredResponse } from '../assistant/contracts';

let _genai: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!_genai) _genai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return _genai;
}

const RESPONSE_MODEL = 'gemini-2.5-flash-lite';

const AGENT_SYSTEM_PROMPT = `Você é Salomão, assistente financeiro do Juros Certo — plataforma de gestão de contratos de crédito.
Seu tom é coloquial, direto e profissional em PT-BR. Você ajuda admins a monitorar carteiras, cobrar devedores e registrar pagamentos; investidores a acompanhar seus recebíveis; e devedores a consultar suas parcelas.
Regras absolutas: não invente fatos, não altere valores, datas ou nomes, não reinterprete a operação executada, não liste menus, não ultrapasse 2 frases quando não solicitado.
Quando houver erro ou dado ausente, reconheça de forma humana sem entrar em detalhes técnicos.`;

export type ResponseContext =
  | { type: 'success'; action: string; details?: string; userName?: string }
  | { type: 'error'; reason: string; suggestion?: string }
  | { type: 'not_found'; entity: string; query?: string }
  | { type: 'clarification'; options?: string }
  | { type: 'greeting'; userName?: string }
  | { type: 'list_intro'; count: number; entity: string }
  | { type: 'confirm_request'; action: string; details: string };

export interface ConversationalReplyContext {
  userMessage: string;
  baseText: string;
  action?: string;
  result?: 'success' | 'clarification' | 'error' | 'blocked';
  structuredResponse?: StructuredResponse;
}

export interface ReplyResult {
  text: string | null;
  tokensIn: number;
  tokensOut: number;
}

function hasApiKey(): boolean {
  return !!config.gemini.apiKey;
}

function truncate(text: string, maxChars: number): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}...`;
}

function looksStructuredReply(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  const lines = normalized.split('\n').length;
  if (lines >= 5) return true;
  if (/\n\d+\./.test(normalized)) return true;
  if (/[📊📅🔴💰📋👤⚠️✅❌]/.test(normalized) && lines >= 3) return true;
  return normalized.length >= 260;
}

function structuredResponseToText(response: StructuredResponse): string {
  const lines = [response.title, ...response.facts];
  if (response.nextActions?.length) {
    lines.push(...response.nextActions);
  }
  return lines.filter(Boolean).join('\n');
}

// Regex para extrair "fatos" (valores que não podem mudar entre baseText e rewrite).
// MONEY_RE captura formato BR completo (R$ 1.234,56) sem incluir pontuação final
// da frase: termina sempre em dígito.
const MONEY_RE = /R\$\s*\d[\d.,]*\d|R\$\s*\d/g;
const DATE_RE = /\b\d{2}\/\d{2}\/\d{2,4}\b/g;
const CPF_MASK_RE = /\*{3}\.\*{3}\.\*{3}-\d{2}/g;
const PERCENT_RE = /\b\d+(?:[.,]\d+)?\s*%/g;

function normalizeFact(s: string): string {
  // Remove espaço/NBSP entre R$ e dígitos para que "R$ 100" e "R$100" colidam no Set.
  return s.replace(/\s+/g, '').replace(/\u00A0/g, '');
}

function extractFacts(text: string): Set<string> {
  const facts = new Set<string>();
  for (const re of [MONEY_RE, DATE_RE, CPF_MASK_RE, PERCENT_RE]) {
    const matches = text.match(re);
    if (matches) for (const m of matches) facts.add(normalizeFact(m));
  }
  return facts;
}

/**
 * P5: Garante que valores/datas/CPFs do `baseText` não sumiram nem mudaram em `rewritten`.
 * Retorna `true` se rewritten preserva todos os fatos numéricos/temporais do base.
 */
export function preservesAllFacts(baseText: string, rewritten: string): boolean {
  const baseFacts = extractFacts(baseText);
  if (baseFacts.size === 0) return true;
  const rewrittenFacts = extractFacts(rewritten);
  for (const fact of baseFacts) {
    if (!rewrittenFacts.has(fact)) return false;
  }
  return true;
}

async function generateWithTimeout(
  prompt: string,
  maxOutputTokens: number,
  timeoutMs: number,
): Promise<ReplyResult> {
  const timeoutPromise = new Promise<ReplyResult>((resolve) => {
    setTimeout(() => resolve({ text: null, tokensIn: 0, tokensOut: 0 }), timeoutMs);
  });

  const llmPromise = ai().models.generateContent({
    model: RESPONSE_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.2,
      maxOutputTokens,
    },
  }).then(result => ({
    text: result.text?.trim() || null,
    tokensIn: (result.usageMetadata as Record<string, number> | undefined)?.promptTokenCount ?? 0,
    tokensOut: (result.usageMetadata as Record<string, number> | undefined)?.candidatesTokenCount ?? 0,
  }));

  return Promise.race([llmPromise, timeoutPromise]);
}

export async function renderConversationalReply(
  context: ConversationalReplyContext,
): Promise<ReplyResult> {
  const empty: ReplyResult = { text: null, tokensIn: 0, tokensOut: 0 };
  if (!config.llmResponse.enabled || !hasApiKey()) return empty;

  const baseText = (context.baseText
    || (context.structuredResponse ? structuredResponseToText(context.structuredResponse) : '')).trim();
  if (!baseText) return empty;

  const action = truncate(context.action || 'resposta', 60);
  const userMessage = truncate(context.userMessage || '', 180);
  const result = context.result || 'success';
  const structured = !!context.structuredResponse || looksStructuredReply(baseText);

  try {
    if (structured) {
      const sr = context.structuredResponse;
      // Use safePreview when available; otherwise strip CPF/amounts from baseText before sending to LLM
      const safePreviewText = sr?.safePreview
        || baseText.replace(/\b\d{3}[\.\s]?\d{3}[\.\s]?\d{3}[-\s]?\d{2}\b/g, '[CPF]')
                   .replace(/R\$\s*[\d.,]+/g, '[valor]');
      const prompt = `${AGENT_SYSTEM_PROMPT}
Tarefa: gerar apenas UMA frase curta para abrir a resposta do bot.
Regras:
- Ate 14 palavras.
- Sem repetir fatos, valores ou datas.
- Sem mudar o significado do bloco estruturado.
- Sem menus.

Contexto:
- resultado: ${result}
- acao: ${action}
- mensagem do usuario: "${userMessage}"
- titulo: "${truncate(sr?.title || '', 80)}"
- preview seguro: "${truncate(safePreviewText, 180)}"

Retorne somente a frase final.`;

      const reply = await generateWithTimeout(
        prompt,
        Math.min(config.llmResponse.maxOutputTokens, 32),
        config.llmResponse.timeoutMs,
      );

      if (!reply.text) return empty;
      return { text: `${reply.text}\n\n${baseText}`, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut };
    }

    const prompt = `${AGENT_SYSTEM_PROMPT}
Tarefa: reescrever a resposta base para soar natural e humana.
Regras:
- Ate 2 frases curtas.
- Nao inventar dados.
- Nao alterar valores, datas, nomes, capacidade executada ou escopo.
- Manter o mesmo objetivo da resposta base.
- Sem menu numerado.

Contexto:
- resultado: ${result}
- acao: ${action}
- mensagem do usuario: "${userMessage}"
- resposta base: "${truncate(baseText, 420)}"

Retorne somente o texto final.`;

    const rewrite = await generateWithTimeout(
      prompt,
      Math.min(config.llmResponse.maxOutputTokens, 80),
      config.llmResponse.timeoutMs,
    );

    // P5: Se a reescrita perdeu/alterou algum fato numérico, descartamos e
    // devolvemos o baseText original. Preferir ser literal a inventar.
    if (rewrite.text && !preservesAllFacts(baseText, rewrite.text)) {
      return { text: baseText, tokensIn: rewrite.tokensIn, tokensOut: rewrite.tokensOut };
    }
    return rewrite;
  } catch {
    return empty;
  }
}

export async function generateGreeting(
  userName: string,
  role: string,
  userMessage: string,
): Promise<ReplyResult> {
  const empty: ReplyResult = { text: null, tokensIn: 0, tokensOut: 0 };
  if (!config.llmResponse.enabled || !hasApiKey()) return empty;

  const roleContext: Record<string, string> = {
    admin: 'Você pode ajudar com dashboard, cobranças do dia, recebíveis, criar contratos ou marcar pagamentos.',
    investor: 'Você pode mostrar o portfólio, recebíveis e contratos do investidor.',
    debtor: 'Você pode mostrar as parcelas, saldo devedor e próximas datas de vencimento.',
  };

  const prompt = `Você é Salomão, assistente financeiro do Juros Certo. Responda em PT-BR coloquial, direto e amigável.
O usuário ${truncate(userName, 40)} acabou de te mandar: "${truncate(userMessage, 60)}"
Responda com uma saudação natural e curta (máximo 2 frases). NÃO liste comandos ou menus. Mencione de forma natural UMA coisa que você pode fazer por ele agora.
Contexto do perfil: ${roleContext[role] || roleContext['admin']}
Retorne apenas o texto da resposta.`;

  try {
    return await generateWithTimeout(prompt, 100, config.llmResponse.timeoutMs);
  } catch {
    return empty;
  }
}

export async function generateAgentResponse(
  context: ResponseContext,
  userMessage: string,
): Promise<ReplyResult> {
  const empty: ReplyResult = { text: null, tokensIn: 0, tokensOut: 0 };
  if (!config.llmResponse.enabled || !hasApiKey()) return empty;

  let contextDescription: string;
  switch (context.type) {
    case 'success':
      contextDescription = `Acao realizada com sucesso: ${context.action}.${context.details ? ' Detalhes: ' + context.details : ''}${context.userName ? ' Usuario: ' + context.userName : ''}`;
      break;
    case 'error':
      contextDescription = `Erro ao executar: ${context.reason}.${context.suggestion ? ' Sugestao: ' + context.suggestion : ''}`;
      break;
    case 'not_found':
      contextDescription = `Nao encontrado: ${context.entity}.${context.query ? ' Busca: ' + context.query : ''}`;
      break;
    case 'clarification':
      contextDescription = `Precisando de esclarecimento do usuario.${context.options ? ' Opcoes: ' + context.options : ''}`;
      break;
    case 'greeting':
      contextDescription = `Saudacao inicial.${context.userName ? ' Nome: ' + context.userName : ''}`;
      break;
    case 'list_intro':
      contextDescription = `Exibindo lista: ${context.count} ${context.entity} encontrados.`;
      break;
    case 'confirm_request':
      contextDescription = `Solicitando confirmacao para: ${context.action}. Detalhes: ${context.details}`;
      break;
  }

  const prompt = `${AGENT_SYSTEM_PROMPT}

Contexto da acao: ${contextDescription}
Mensagem original do usuario: "${truncate(userMessage, 180)}"

Gere uma resposta natural e concisa em PT-BR (maximo 2 frases):`;

  try {
    return await generateWithTimeout(
      prompt,
      Math.min(config.llmResponse.maxOutputTokens, 80),
      config.llmResponse.timeoutMs,
    );
  } catch {
    return empty;
  }
}
