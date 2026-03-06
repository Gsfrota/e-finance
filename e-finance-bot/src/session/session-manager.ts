import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logStructuredMessage } from '../observability/logger';
import type { ConversationWorkingState } from '../assistant/contracts';

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_supabase) _supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  return _supabase;
}

function touchSessionLastActive(sessionId: string): void {
  void (async () => {
    const { error } = await db()
      .from('bot_sessions')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', sessionId);

    if (error) {
      logStructuredMessage('session_touch_failed', {
        sessionId,
        error: error.message,
      });
    }
  })().catch((error: unknown) => {
    logStructuredMessage('session_touch_failed', {
      sessionId,
      error: normalizeError(error),
    });
  });
}

export interface SessionContext {
  pendingAction?: string;
  pendingStep?: number;
  pendingData?: Record<string, unknown>;
  lastIntent?: string;
  workingState?: ConversationWorkingState;
}

export interface Session {
  id: string;
  profile_id: string | null;
  channel: 'whatsapp' | 'telegram';
  channel_user_id: string;
  context: SessionContext;
  profile?: {
    id: string;
    name: string;
    role: 'admin' | 'investor' | 'debtor';
    tenant_id: string;
  } | null;
}

export interface SessionSyncResult {
  session: Session;
  changed: boolean;
  oldProfileId: string | null;
  newProfileId: string | null;
  reason: 'matched' | 'rebound' | 'no_channel_binding';
}

interface SaveMessageOptions {
  forceSync?: boolean;
}

let messagePersistQueues = new Map<string, Promise<void>>();

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isEphemeralSessionId(sessionId: string): boolean {
  return sessionId.startsWith('ephemeral:');
}

function mapProfile(profileRow: any): Session['profile'] {
  if (!profileRow) return null;
  return {
    id: profileRow.id,
    name: profileRow.full_name,
    role: profileRow.role,
    tenant_id: profileRow.tenant_id,
  };
}

export async function getProfileByChannelBinding(
  channel: 'whatsapp' | 'telegram',
  channelUserId: string,
): Promise<Session['profile']> {
  const field = channel === 'whatsapp' ? 'whatsapp_phone' : 'telegram_chat_id';
  const { data, error } = await db()
    .from('profiles')
    .select('id, full_name, role, tenant_id')
    .eq(field, channelUserId)
    .maybeSingle();

  if (error) return null;
  return mapProfile(data);
}

async function clearSessionHistory(sessionId: string): Promise<void> {
  await db()
    .from('bot_messages')
    .delete()
    .eq('session_id', sessionId);
}

async function persistMessageWithRetry(payload: {
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  media_type: 'text' | 'audio' | 'image' | 'document';
  intent?: string;
}): Promise<void> {
  const retryCount = Math.max(0, config.messagePersistence.retryCount);
  const retryBaseMs = Math.max(50, config.messagePersistence.retryBaseMs);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const { error } = await db().from('bot_messages').insert(payload);
    if (!error) return;

    lastError = error;
    if (attempt < retryCount) {
      await wait(retryBaseMs * (attempt + 1));
    }
  }

  throw lastError;
}

function enqueueMessagePersist(sessionId: string, task: () => Promise<void>): void {
  const previous = messagePersistQueues.get(sessionId) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (messagePersistQueues.get(sessionId) === next) {
        messagePersistQueues.delete(sessionId);
      }
    });

  messagePersistQueues.set(sessionId, next);
}

export async function getOrCreateSession(
  channel: 'whatsapp' | 'telegram',
  channelUserId: string,
): Promise<Session> {
  const { data: existing, error: existingError } = await db()
    .from('bot_sessions')
    .select('id, profile_id, context')
    .eq('channel', channel)
    .eq('channel_user_id', channelUserId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    touchSessionLastActive(existing.id);

    return {
      id: existing.id,
      profile_id: existing.profile_id,
      channel,
      channel_user_id: channelUserId,
      context: (existing.context as SessionContext) || {},
      profile: null,
    };
  }

  const { data: created, error: createError } = await db()
    .from('bot_sessions')
    .insert({ channel, channel_user_id: channelUserId, context: {} })
    .select('id')
    .single();

  if (createError || !created) {
    throw createError || new Error('session_create_failed');
  }

  return {
    id: created.id,
    profile_id: null,
    channel,
    channel_user_id: channelUserId,
    context: {},
    profile: null,
  };
}

export async function syncSessionProfileFromChannelBinding(session: Session): Promise<SessionSyncResult> {
  const oldProfileId = session.profile_id;
  const bindingProfile = await getProfileByChannelBinding(session.channel, session.channel_user_id);

  if (!bindingProfile) {
    const hasProfile = !!session.profile_id;
    const hasContext = !!session.context && Object.keys(session.context).length > 0;

    if (hasProfile || hasContext || session.profile) {
      await db()
        .from('bot_sessions')
        .update({
          profile_id: null,
          context: {},
          last_active_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      await clearSessionHistory(session.id);

      return {
        session: {
          ...session,
          profile_id: null,
          profile: null,
          context: {},
        },
        changed: true,
        oldProfileId,
        newProfileId: null,
        reason: 'no_channel_binding',
      };
    }

    return {
      session: {
        ...session,
        profile_id: null,
        profile: null,
      },
      changed: false,
      oldProfileId,
      newProfileId: null,
      reason: 'matched',
    };
  }

  const newProfileId = bindingProfile.id;

  if (session.profile_id !== newProfileId) {
    await db()
      .from('bot_sessions')
      .update({
        profile_id: newProfileId,
        context: {},
        last_active_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    await clearSessionHistory(session.id);

    return {
      session: {
        ...session,
        profile_id: newProfileId,
        profile: bindingProfile,
        context: {},
      },
      changed: true,
      oldProfileId,
      newProfileId,
      reason: 'rebound',
    };
  }

  return {
    session: {
      ...session,
      profile_id: newProfileId,
      profile: bindingProfile,
    },
    changed: false,
    oldProfileId,
    newProfileId,
    reason: 'matched',
  };
}

export async function updateSessionContext(sessionId: string, context: SessionContext): Promise<void> {
  if (isEphemeralSessionId(sessionId)) return;
  await db()
    .from('bot_sessions')
    .update({ context, last_active_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function clearSessionContext(sessionId: string): Promise<void> {
  if (isEphemeralSessionId(sessionId)) return;
  await db()
    .from('bot_sessions')
    .update({ context: {}, last_active_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function linkProfileToSession(
  sessionId: string,
  profileId: string,
): Promise<void> {
  if (isEphemeralSessionId(sessionId)) return;
  await db()
    .from('bot_sessions')
    .update({ profile_id: profileId, context: {}, last_active_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  mediaType: 'text' | 'audio' | 'image' | 'document' = 'text',
  intent?: string,
  options: SaveMessageOptions = {},
): Promise<void> {
  if (isEphemeralSessionId(sessionId)) return;
  const payload = {
    session_id: sessionId,
    role,
    content,
    media_type: mediaType,
    intent,
  };

  const syncMode = config.messagePersistence.mode === 'sync' || options.forceSync;
  if (syncMode) {
    await persistMessageWithRetry(payload);
    return;
  }

  enqueueMessagePersist(sessionId, async () => {
    try {
      await persistMessageWithRetry(payload);
    } catch (error) {
      logStructuredMessage('message_persist_failed', {
        sessionId,
        result: 'error',
        reason: 'bot_messages_insert_failed',
        role,
        mediaType,
        intent,
        error: normalizeError(error),
      });
    }
  });
}

export async function getRecentMessages(sessionId: string, limit = 6): Promise<Array<{ role: string; content: string }>> {
  if (isEphemeralSessionId(sessionId)) return [];
  const { data } = await db()
    .from('bot_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || []).reverse();
}

export function __resetSessionManagerStateForTests(): void {
  messagePersistQueues = new Map();
}
