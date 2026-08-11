import { useCallback, useEffect, useRef, useState } from 'react';
import {
  OFFLINE_FINANCIAL_CHANGE_EVENT,
  OFFLINE_QUEUE_STORAGE_KEY,
  listOfflineIntents,
  markOfflineIntentApplied,
  markOfflineIntentRejected,
  subscribeOfflineQueue,
  type OfflinePaymentIntent,
} from '../services/offlineQueue';
import { clearAllCache } from '../services/cache';
import { getSupabase, parseSupabaseError } from '../services/supabase';

interface SubmitOfflineResult {
  status: 'pending' | 'applied' | 'rejected' | 'resolved';
  duplicada?: boolean;
  erro?: string;
}

export type OfflineIntentSubmitter = (intent: OfflinePaymentIntent) => Promise<SubmitOfflineResult>;

export interface OfflineSyncResult {
  applied: number;
  rejected: number;
  remaining: number;
  interrupted: boolean;
}

const TRANSIENT_SQLSTATES = new Set(['40001', '40P01', '55P03', '57014']);

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code ?? '').toUpperCase();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error ?? '');
}

export function isTransientOfflineSyncError(error: unknown): boolean {
  if (TRANSIENT_SQLSTATES.has(errorCode(error))) return true;
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('tempo limite') ||
    message.includes('load failed') ||
    message.includes('fetch failed')
  );
}

export async function submitOfflineIntent(intent: OfflinePaymentIntent): Promise<SubmitOfflineResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Conexão com o servidor indisponível.');

  const { data, error } = await supabase.rpc('submit_offline_payment', {
    p_intent_id: intent.id,
    p_installment_id: intent.installmentId,
    p_amount: intent.amount,
    p_paid_at: intent.paidAt,
  });
  if (error) throw error;
  return data as SubmitOfflineResult;
}

/**
 * Esvazia apenas itens `pending`, rigorosamente em série. Uma falha transitória
 * interrompe o lote para preservar a ordem; uma recusa definitiva vira item da
 * caixa de pendências e permite que o próximo recebimento seja processado.
 */
export async function syncPendingOfflineIntents(
  tenantId: string,
  submitter: OfflineIntentSubmitter = submitOfflineIntent
): Promise<OfflineSyncResult> {
  const pending = listOfflineIntents(tenantId).filter((intent) => intent.status === 'pending');
  let applied = 0;
  let rejected = 0;
  let interrupted = false;

  for (const intent of pending) {
    try {
      const result = await submitter(intent);
      if (result.status === 'applied' || result.status === 'resolved') {
        markOfflineIntentApplied(intent.id);
        applied += 1;
        continue;
      }
      if (result.status === 'rejected') {
        markOfflineIntentRejected(
          intent.id,
          result.erro
            ? parseSupabaseError({ message: result.erro })
            : 'O servidor recusou esta baixa.'
        );
        rejected += 1;
        continue;
      }

      // `pending` não é confirmação. Conserva e tenta de novo no próximo gatilho.
      interrupted = true;
      break;
    } catch (error) {
      if (isTransientOfflineSyncError(error)) {
        interrupted = true;
        break;
      }
      markOfflineIntentRejected(intent.id, parseSupabaseError(error));
      rejected += 1;
    }
  }

  return {
    applied,
    rejected,
    remaining: listOfflineIntents(tenantId).filter((intent) => intent.status === 'pending').length,
    interrupted,
  };
}

export interface OfflineSyncState {
  intents: OfflinePaymentIntent[];
  syncing: boolean;
  error: string | null;
  syncNow: () => Promise<void>;
  refresh: () => void;
}

/** Dispara sync ao montar, no evento online e ao voltar do background. */
export function useOfflineSync(tenantId?: string | null, enabled = true): OfflineSyncState {
  const [intents, setIntents] = useState<OfflinePaymentIntent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (!tenantId || !enabled) {
      setIntents([]);
      return;
    }
    try {
      setIntents(listOfflineIntents(tenantId));
      setError(null);
    } catch (queueError) {
      setIntents([]);
      setError(errorMessage(queueError));
    }
  }, [enabled, tenantId]);

  const syncNow = useCallback(async () => {
    if (!tenantId || !enabled) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      refresh();
      return;
    }
    if (runningRef.current) return runningRef.current;

    const run = (async () => {
      setSyncing(true);
      setError(null);
      let finalError: string | null = null;
      try {
        const result = await syncPendingOfflineIntents(tenantId);
        if (result.applied > 0) {
          clearAllCache();
          window.dispatchEvent(new Event(OFFLINE_FINANCIAL_CHANGE_EVENT));
        }
        if (result.interrupted && typeof navigator !== 'undefined' && navigator.onLine !== false) {
          finalError = 'Não foi possível concluir a sincronização. As baixas continuam salvas neste aparelho.';
        }
      } catch (syncError) {
        finalError = errorMessage(syncError);
      } finally {
        refresh();
        if (finalError) setError(finalError);
        setSyncing(false);
        runningRef.current = null;
      }
    })();

    runningRef.current = run;
    return run;
  }, [enabled, refresh, tenantId]);

  useEffect(() => {
    refresh();
    if (!tenantId || !enabled) return;

    const unsubscribe = subscribeOfflineQueue(refresh);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === OFFLINE_QUEUE_STORAGE_KEY) refresh();
    };
    const handleOnline = () => { void syncNow(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    void syncNow();

    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, refresh, syncNow, tenantId]);

  return { intents, syncing, error, syncNow, refresh };
}
