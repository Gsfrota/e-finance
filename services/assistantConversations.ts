/**
 * Histórico de conversas do Assistente (BR-BOT-012).
 *
 * Uma linha por conversa em `assistant_conversations`, mensagens em `jsonb`.
 * A conversa é pessoal: a RLS já restringe ao admin dono, então aqui não há
 * filtro de segurança — só o `user_id` no INSERT, que a policy confere.
 */

import { getSupabase, parseSupabaseError } from './supabase';
import type { ReplyDetails } from '../utils/assistantTypes';

/** Mensagem como ela vai para o banco — mesmo formato que o chat renderiza. */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  details?: ReplyDetails;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface Conversation extends ConversationSummary {
  messages: StoredMessage[];
}

/** Quantas conversas a lista mostra — passou disso, o cliente usa a busca da tela. */
const LIMITE_LISTA = 30;

/** Conversa longa demais vira lenta de carregar; o começo é o que menos importa. */
const MAX_MENSAGENS = 200;

const TITULO_MAX = 48;

/** Título da conversa: a primeira pergunta, cortada em palavra inteira. */
export function tituloDaConversa(mensagens: StoredMessage[]): string {
  const primeira = mensagens.find(m => m.role === 'user')?.content?.trim();
  if (!primeira) return 'Nova conversa';
  const limpa = primeira.replace(/\s+/g, ' ');
  if (limpa.length <= TITULO_MAX) return limpa;
  const corte = limpa.slice(0, TITULO_MAX);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > 20 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/** Só o que a lista precisa — não traz as mensagens, que podem ser grandes. */
export async function listarConversas(tenantId: string, userId: string): Promise<ConversationSummary[]> {
  const { data, error } = await getSupabase()
    .from('assistant_conversations')
    .select('id, title, updated_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(LIMITE_LISTA);
  if (error) throw new Error(parseSupabaseError(error));

  return (data ?? []).map((row: any) => ({
    id: String(row.id),
    title: String(row.title ?? 'Nova conversa'),
    updatedAt: String(row.updated_at ?? ''),
  }));
}

export async function carregarConversa(id: string): Promise<Conversation | null> {
  const { data, error } = await getSupabase()
    .from('assistant_conversations')
    .select('id, title, updated_at, messages')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(parseSupabaseError(error));
  if (!data) return null;

  const row = data as any;
  return {
    id: String(row.id),
    title: String(row.title ?? 'Nova conversa'),
    updatedAt: String(row.updated_at ?? ''),
    // jsonb pode voltar qualquer coisa se alguém editar a linha na mão
    messages: Array.isArray(row.messages) ? (row.messages as StoredMessage[]) : [],
  };
}

/**
 * Grava a conversa. Sem `id` cria e devolve o novo; com `id` atualiza.
 * O título é recalculado sempre: a primeira pergunta não muda depois da primeira gravação.
 */
export async function salvarConversa(args: {
  id: string | null;
  tenantId: string;
  userId: string;
  messages: StoredMessage[];
}): Promise<ConversationSummary> {
  const supabase = getSupabase();
  const messages = args.messages.slice(-MAX_MENSAGENS);
  const title = tituloDaConversa(messages);

  if (args.id) {
    const { data, error } = await supabase
      .from('assistant_conversations')
      .update({ messages, title, updated_at: new Date().toISOString() })
      .eq('id', args.id)
      .select('id, title, updated_at')
      .single();
    if (error) throw new Error(parseSupabaseError(error));
    const row = data as any;
    return { id: String(row.id), title: String(row.title), updatedAt: String(row.updated_at) };
  }

  const { data, error } = await supabase
    .from('assistant_conversations')
    .insert({ tenant_id: args.tenantId, user_id: args.userId, messages, title })
    .select('id, title, updated_at')
    .single();
  if (error) throw new Error(parseSupabaseError(error));
  const row = data as any;
  return { id: String(row.id), title: String(row.title), updatedAt: String(row.updated_at) };
}

export async function apagarConversa(id: string): Promise<void> {
  const { error } = await getSupabase().from('assistant_conversations').delete().eq('id', id);
  if (error) throw new Error(parseSupabaseError(error));
}
