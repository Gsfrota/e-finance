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

  llmCallCount?: number;
  tokensInput?: number;
  tokensOutput?: number;
  llmModels?: string[];
  llmSkipped?: boolean;
  estimatedCostUsd?: number;

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

  inputText?: string;
  responseText?: string;
  extractedArgs?: string;

  [key: string]: unknown;
}

const SENSITIVE_TEXT_FIELDS = new Set([
  'inputText',
  'responseText',
  'extractedArgs',
  'error',
  'reason',
  'fallbackReason',
  'contractParseFailedReason',
  'policyResult',
  'actionCapability',
  'confirmationState',
]);

function sanitizeLogText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const sanitized = normalized
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[redacted-cpf]')
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[redacted-cnpj]')
    .replace(/R\$\s*[\d.,]+/gi, '[redacted-value]')
    .replace(/\$\s*[\d.,]+/g, '[redacted-value]')
    .replace(/\b\d{4,}\b/g, '[redacted-number]');

  return sanitized.length > 180 ? `${sanitized.slice(0, 177)}...` : sanitized;
}

function sanitizePayload(payload: MessageLogPayload): MessageLogPayload {
  const sanitized: MessageLogPayload = { ...payload };

  for (const key of SENSITIVE_TEXT_FIELDS) {
    const value = sanitized[key];
    if (typeof value === 'string' && value.trim()) {
      sanitized[key] = sanitizeLogText(value);
    }
  }

  return sanitized;
}

export function logStructuredMessage(event: string, payload: MessageLogPayload): void {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...sanitizePayload(payload),
  }));
}
