import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

let _genai: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!_genai) _genai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return _genai;
}

const RESPONSE_MODEL = 'gemini-2.5-flash-lite';

const AGENT_SYSTEM_PROMPT = `Voce e o assistente do E-Finance, sistema de gestao de credito para investidores.
Responda em PT-BR coloquial, direto e profissional.
Nao use menu numerado nem respostas roboticas.`;

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

async function generateWithTimeout(
  prompt: string,
  maxOutputTokens: number,
  timeoutMs: number,
): Promise<string | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  const llmPromise = ai().models.generateContent({
    model: RESPONSE_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.2,
      maxOutputTokens,
    },
  }).then(result => result.text?.trim() || null);

  return Promise.race([llmPromise, timeoutPromise]);
}

export async function renderConversationalReply(
  context: ConversationalReplyContext,
): Promise<string | null> {
  if (!config.llmResponse.enabled || !hasApiKey()) return null;

  const baseText = (context.baseText || '').trim();
  if (!baseText) return null;

  const action = truncate(context.action || 'resposta', 60);
  const userMessage = truncate(context.userMessage || '', 180);
  const result = context.result || 'success';
  const structured = looksStructuredReply(baseText);

  try {
    if (structured) {
      const prompt = `${AGENT_SYSTEM_PROMPT}
Tarefa: gerar apenas UMA frase curta para abrir a resposta do bot.
Regras:
- Ate 16 palavras.
- Sem lista numerada.
- Sem repetir os dados estruturados que virao depois.
- Tom humano e objetivo.

Contexto:
- resultado: ${result}
- acao: ${action}
- mensagem do usuario: "${userMessage}"

Retorne somente a frase final.`;

      const preface = await generateWithTimeout(
        prompt,
        Math.min(config.llmResponse.maxOutputTokens, 40),
        config.llmResponse.timeoutMs,
      );

      if (!preface) return null;
      return `${preface}\n\n${baseText}`;
    }

    const prompt = `${AGENT_SYSTEM_PROMPT}
Tarefa: reescrever a resposta base para soar natural e humana.
Regras:
- Ate 2 frases curtas.
- Nao inventar dados.
- Manter o mesmo objetivo da resposta base.
- Sem menu numerado.

Contexto:
- resultado: ${result}
- acao: ${action}
- mensagem do usuario: "${userMessage}"
- resposta base: "${truncate(baseText, 420)}"

Retorne somente o texto final.`;

    return await generateWithTimeout(
      prompt,
      Math.min(config.llmResponse.maxOutputTokens, 80),
      config.llmResponse.timeoutMs,
    );
  } catch {
    return null;
  }
}

export async function generateAgentResponse(
  context: ResponseContext,
  userMessage: string,
): Promise<string | null> {
  if (!config.llmResponse.enabled || !hasApiKey()) return null;

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
    return null;
  }
}
