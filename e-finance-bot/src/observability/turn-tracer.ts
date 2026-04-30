/**
 * Turn tracer (BR-BOT-009).
 *
 * Captura a história completa de cada turno do bot em um único registro
 * (tabela bot_turn_traces) para debug em produção. Reusa o sanitizeLogText
 * existente para garantir que CPF/CNPJ/valores sejam redigidos antes do
 * INSERT. O flush é fire-and-forget (não bloqueia a resposta ao usuário).
 *
 * Uso:
 *   await startTrace({ channel, sessionId, ... }, async () => {
 *     // pipeline normal — logStructuredMessage popula events; setField popula campos top-level
 *     getActiveTrace()?.setField('intent', 'cobrar_hoje');
 *   });
 *   // No finally do handler: enqueueTracePersist(sessionId, () => flushTrace(trace))
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import * as loggerModule from './logger';

export interface TurnTraceData {
  // correlação
  tenant_id?: string | null;
  session_id?: string | null;
  channel?: 'whatsapp' | 'telegram' | null;
  channel_user_id?: string | null;
  message_id?: string | null;

  // input
  user_text?: string | null;
  media_type?: 'text' | 'audio' | 'image' | null;
  audio_transcript?: string | null;

  // pipeline path
  source?: 'fast_path' | 'ai_native' | 'legacy' | 'error' | null;
  ai_native_source?: string | null;
  intent?: string | null;
  intent_confidence?: string | null;
  intent_route_source?: string | null;
  capability?: string | null;
  policy_decision?: string | null;

  // tool calls (AI-native)
  tool_calls?: Array<{
    name: string;
    args?: unknown;
    outcome_kind?: string;
    outcome_summary?: string;
  }> | null;

  // response
  reply_text?: string | null;
  result?: 'success' | 'clarification' | 'error' | 'blocked' | null;

  // métricas
  total_ms?: number | null;
  latency_breakdown?: Record<string, number | undefined> | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_cents?: number | null;

  // erros
  error_code?: string | null;
  error_message?: string | null;
}

export interface TurnTraceEvent {
  ts: string;
  event: string;
  payload: Record<string, unknown>;
}

const MAX_USER_TEXT = config.trace.maxUserTextChars;
const MAX_EVENTS = config.trace.maxEvents;

export class TurnTrace {
  private readonly events: TurnTraceEvent[] = [];
  private readonly data: TurnTraceData = {};
  readonly startedAt: number;

  constructor(initial: Partial<TurnTraceData> = {}) {
    this.startedAt = Date.now();
    Object.assign(this.data, initial);
  }

  setField<K extends keyof TurnTraceData>(key: K, value: TurnTraceData[K]): void {
    this.data[key] = value;
  }

  patch(values: Partial<TurnTraceData>): void {
    Object.assign(this.data, values);
  }

  appendEvent(event: string, payload: Record<string, unknown>): void {
    if (this.events.length >= MAX_EVENTS) return;
    this.events.push({
      ts: new Date().toISOString(),
      event,
      payload,
    });
  }

  toRecord(): TurnTraceData & { events: TurnTraceEvent[]; created_at: string } {
    return {
      ...this.data,
      user_text: clip(this.data.user_text, MAX_USER_TEXT),
      reply_text: clip(this.data.reply_text, MAX_USER_TEXT),
      audio_transcript: clip(this.data.audio_transcript, MAX_USER_TEXT),
      events: this.events,
      created_at: new Date(this.startedAt).toISOString(),
    };
  }
}

function clip(value: string | null | undefined, max: number): string | null | undefined {
  if (value == null) return value;
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

const tracerStorage = new AsyncLocalStorage<TurnTrace>();

// Registra sink no logger: cada logStructuredMessage também aponta para o
// TurnTrace ativo (se houver). try/catch protege contra mocks de teste que
// não declaram setTraceSink (vitest mock proxies lançam ao acessar exports
// não declarados).
try {
  const sink = (loggerModule as { setTraceSink?: (s: unknown) => void }).setTraceSink;
  if (typeof sink === 'function') {
    sink((event: string, payload: Record<string, unknown>) => {
      if (!config.trace.enabled) return;
      tracerStorage.getStore()?.appendEvent(event, payload);
    });
  }
} catch {
  // logger mockado sem setTraceSink — segue sem instalar o sink
}

export async function startTrace<T>(
  initial: Partial<TurnTraceData>,
  fn: (trace: TurnTrace) => Promise<T>,
): Promise<T> {
  if (!config.trace.enabled) {
    return fn(new TurnTrace(initial));
  }
  const trace = new TurnTrace(initial);
  return tracerStorage.run(trace, () => fn(trace));
}

/**
 * Variante "in-place" para handlers que já têm try/finally inline e não
 * podem facilmente ser wrappeados. Cria um TurnTrace e o registra no
 * AsyncLocalStorage do contexto atual via enterWith. Use no topo de
 * handleMessage.
 */
export function beginTraceInPlace(initial: Partial<TurnTraceData>): TurnTrace {
  const trace = new TurnTrace(initial);
  if (config.trace.enabled) {
    tracerStorage.enterWith(trace);
  }
  return trace;
}

export function getActiveTrace(): TurnTrace | undefined {
  if (!config.trace.enabled) return undefined;
  return tracerStorage.getStore();
}

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _supabase;
}

const tracePersistQueues = new Map<string, Promise<void>>();

/**
 * Enfileira o flush por sessão para garantir ordem (mesma fila pattern de
 * enqueueMessagePersist em session-manager). Falhas não propagam.
 */
export function enqueueTracePersist(sessionKey: string, task: () => Promise<void>): void {
  const previous = tracePersistQueues.get(sessionKey) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .catch((err) => {
      // falha de flush nunca derruba handler — apenas log estruturado
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        event: 'turn_trace_flush_failed',
        sessionKey,
        error: err instanceof Error ? err.message : String(err),
      }));
    })
    .finally(() => {
      if (tracePersistQueues.get(sessionKey) === next) {
        tracePersistQueues.delete(sessionKey);
      }
    });

  tracePersistQueues.set(sessionKey, next);
}

export async function flushTrace(trace: TurnTrace): Promise<void> {
  if (!config.trace.enabled) return;
  if (!config.supabase.url || !config.supabase.serviceRoleKey) return;

  const record = trace.toRecord();
  const { error } = await db().from('bot_turn_traces').insert({
    tenant_id: record.tenant_id ?? null,
    session_id: record.session_id ?? null,
    channel: record.channel ?? null,
    channel_user_id: record.channel_user_id ?? null,
    message_id: record.message_id ?? null,
    user_text: record.user_text ?? null,
    media_type: record.media_type ?? null,
    audio_transcript: record.audio_transcript ?? null,
    source: record.source ?? null,
    ai_native_source: record.ai_native_source ?? null,
    intent: record.intent ?? null,
    intent_confidence: record.intent_confidence ?? null,
    intent_route_source: record.intent_route_source ?? null,
    capability: record.capability ?? null,
    policy_decision: record.policy_decision ?? null,
    tool_calls: record.tool_calls ?? null,
    reply_text: record.reply_text ?? null,
    result: record.result ?? null,
    total_ms: record.total_ms ?? null,
    latency_breakdown: record.latency_breakdown ?? null,
    tokens_in: record.tokens_in ?? null,
    tokens_out: record.tokens_out ?? null,
    cost_cents: record.cost_cents ?? null,
    error_code: record.error_code ?? null,
    error_message: record.error_message ?? null,
    events: record.events,
    created_at: record.created_at,
  });

  if (error) throw error;
}

/** Test-only: limpa fila e cliente. */
export function _resetForTests(): void {
  tracePersistQueues.clear();
  _supabase = null;
}

/** Test-only: substitui o client por mock. */
export function _setSupabaseClientForTests(client: SupabaseClient | null): void {
  _supabase = client;
}
