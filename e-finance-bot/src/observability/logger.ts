export interface MessageLogPayload {
  channel?: 'whatsapp' | 'telegram';
  messageId?: string;
  sessionId?: string;
  tenantId?: string;
  intent?: string;
  confidence?: string;
  routeSource?: string;
  action?: string;
  result?: string;
  reason?: string;
  oldProfileId?: string | null;
  newProfileId?: string | null;
  durationMs?: number;

  dashboardQueryMode?: string;
  dashboardValuesComputed?: boolean;
  receivedByPaymentMonth?: number;
  receivedByDueMonth?: number;
  expectedMonth?: number;
  totalOverdue?: number;

  contractParseMode?: 'deterministic' | 'llm_fallback' | 'failed';
  contractParseFailedReason?: string;

  mimeType?: string;
  audioKind?: 'voice_note' | 'audio_file';
  durationSec?: number;
  sizeBytes?: number;
  usedFilesApi?: boolean;
  transcriptionMs?: number;
  transcriptChars?: number;

  inputChars?: number;
  historyChars?: number;
  maxOutputTokens?: number;
  fallbackReason?: string;
  estimatedTokenClass?: 'low' | 'medium' | 'high';

  routeMs?: number;
  followupMs?: number;
  policyMs?: number;
  executorMs?: number;
  naturalizeMs?: number;
  dbReadMs?: number;
  dbWriteMs?: number;
  llmMs?: number;
  presenceWaitMs?: number;
  totalMs?: number;
  presenceMode?: 'telegram_strict' | 'whatsapp_slow_only' | 'whatsapp_strict' | 'disabled';
  messagePersistMode?: 'sync' | 'hybrid';

  bufferedCount?: number;
  bufferWindowMs?: number;
  daysAhead?: number;
  windowStart?: 'today' | 'tomorrow';
  startDate?: string;
  endDate?: string;
  error?: string;
  capability?: string;
  actionCapability?: string;
  policyResult?: string;
  confirmationState?: string;
  idempotencyKey?: string;

  [key: string]: unknown;
}

export function logStructuredMessage(event: string, payload: MessageLogPayload): void {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...payload,
  }));
}
