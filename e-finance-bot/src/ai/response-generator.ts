import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

let _genai: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!_genai) _genai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return _genai;
}

const RESPONSE_MODEL = 'gemini-2.0-flash-lite';

const AGENT_SYSTEM_PROMPT = `Voce e o assistente do E-Finance, sistema de gestao de credito para investidores.
Responda em PT-BR coloquial, direto e profissional. Maximo 3 frases curtas.
Nao liste opcoes de menu. Nao use asteriscos em excesso. Seja humano e prestativo.
Se houver dados estruturados no contexto, use-os na resposta mas nao os reformate — apenas complemente com linguagem natural.`;

export type ResponseContext =
  | { type: 'success'; action: string; details?: string; userName?: string }
  | { type: 'error'; reason: string; suggestion?: string }
  | { type: 'not_found'; entity: string; query?: string }
  | { type: 'clarification'; options?: string }
  | { type: 'greeting'; userName?: string }
  | { type: 'list_intro'; count: number; entity: string }
  | { type: 'confirm_request'; action: string; details: string };

export async function generateAgentResponse(
  context: ResponseContext,
  userMessage: string,
): Promise<string | null> {
  if (!config.llmResponse.enabled) return null;

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
Mensagem original do usuario: "${userMessage}"

Gere uma resposta natural e concisa em PT-BR (maximo 3 frases):`;

  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), config.llmResponse.timeoutMs);
    });

    const llmPromise = ai().models.generateContent({
      model: RESPONSE_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        maxOutputTokens: config.llmResponse.maxOutputTokens,
      },
    }).then(result => result.text?.trim() || null);

    return await Promise.race([llmPromise, timeoutPromise]);
  } catch {
    return null;
  }
}
