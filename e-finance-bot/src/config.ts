export const config = {
  port: parseInt(process.env.PORT || '8080', 10),

  // WhatsApp - UazAPI
  uazapi: {
    serverUrl: process.env.UAZAPI_SERVER_URL || 'https://processai.uazapi.com',
    instanceToken: process.env.UAZAPI_INSTANCE_TOKEN || '',
  },

  // Telegram
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    get apiBase() {
      return `https://api.telegram.org/bot${this.botToken}`;
    },
  },

  // Supabase (service role para queries privilegiadas)
  supabase: {
    url: process.env.SUPABASE_URL || 'https://SUPABASE_PROJECT_URL_REMOVED',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  // Gemini
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '',
  },

  // Audio inbound (transcrição + UX)
  audio: {
    maxDurationSec: parseInt(process.env.AUDIO_MAX_DURATION_SEC || '90', 10),
    inlineMaxBytes: parseInt(process.env.AUDIO_INLINE_MAX_BYTES || '2000000', 10),
    transcribeTimeoutMs: parseInt(process.env.AUDIO_TRANSCRIBE_TIMEOUT_MS || '6000', 10),
    previewChars: parseInt(process.env.AUDIO_PREVIEW_CHARS || '120', 10),
  },

  // Roteador de intent hibrido (baixo token)
  llmRouter: {
    enabled: process.env.LLM_ROUTER_ENABLED !== 'false',
    timeoutMs: parseInt(process.env.LLM_ROUTER_TIMEOUT_MS || '2000', 10),
    maxOutputTokens: parseInt(process.env.LLM_ROUTER_MAX_OUTPUT_TOKENS || '80', 10),
    maxInputChars: parseInt(process.env.LLM_ROUTER_MAX_INPUT_CHARS || '600', 10),
    historyItems: parseInt(process.env.LLM_ROUTER_HISTORY_ITEMS || '3', 10),
    historyChars: parseInt(process.env.LLM_ROUTER_HISTORY_CHARS || '140', 10),
    cacheTtlMs: parseInt(process.env.LLM_ROUTER_CACHE_TTL_MS || '30000', 10),
  },

  // Presenca conversacional (Telegram + WhatsApp)
  presence: {
    enabled: process.env.PRESENCE_ENABLED !== 'false',
    startDelayMs: parseInt(process.env.PRESENCE_START_DELAY_MS || '3000', 10),
    minVisibleMs: parseInt(process.env.PRESENCE_MIN_VISIBLE_MS || '1000', 10),
    telegramPulseMs: parseInt(process.env.PRESENCE_TELEGRAM_PULSE_MS || '4000', 10),
    whatsappUseInstancePresence: process.env.PRESENCE_WHATSAPP_INSTANCE !== 'false',
    whatsappSlowOnly: process.env.PRESENCE_WHATSAPP_SLOW_ONLY !== 'false',
    whatsappSlowThresholdMs: parseInt(process.env.PRESENCE_WHATSAPP_SLOW_THRESHOLD_MS || '2500', 10),
  },

  // Buffer adaptativo de mensagens inbound
  inboundBuffer: {
    enabled: process.env.INBOUND_BUFFER_ENABLED !== 'false',
    debounceMs: parseInt(process.env.INBOUND_BUFFER_DEBOUNCE_MS || '3500', 10),
    maxWindowMs: parseInt(process.env.INBOUND_BUFFER_MAX_WINDOW_MS || '12000', 10),
    maxMessages: parseInt(process.env.INBOUND_BUFFER_MAX_MESSAGES || '5', 10),
  },

  // Persistencia de historico
  messagePersistence: {
    mode: (process.env.MESSAGE_PERSISTENCE_MODE === 'sync' ? 'sync' : 'hybrid') as 'sync' | 'hybrid',
    retryCount: parseInt(process.env.MESSAGE_PERSISTENCE_RETRY_COUNT || '2', 10),
    retryBaseMs: parseInt(process.env.MESSAGE_PERSISTENCE_RETRY_BASE_MS || '200', 10),
  },

  // Camada operacional do assistente
  assistant: {
    workingStateTtlMs: parseInt(process.env.ASSISTANT_WORKING_STATE_TTL_MS || '1800000', 10),
    confirmationTtlMs: parseInt(process.env.ASSISTANT_CONFIRMATION_TTL_MS || '600000', 10),
    sessionReadTimeoutMs: parseInt(process.env.ASSISTANT_SESSION_READ_TIMEOUT_MS || '15000', 10),
    historyReadTimeoutMs: parseInt(process.env.ASSISTANT_HISTORY_READ_TIMEOUT_MS || '1200', 10),
  },

  // Gerador de respostas naturais via LLM (agente real)
  llmResponse: {
    enabled: process.env.LLM_RESPONSE_ENABLED !== 'false',
    timeoutMs: parseInt(process.env.LLM_RESPONSE_TIMEOUT_MS || '2200', 10),
    maxOutputTokens: parseInt(process.env.LLM_RESPONSE_MAX_TOKENS || '80', 10),
  },

  // Scheduler de automações (Cloud Scheduler → HTTP)
  scheduler: {
    secret: process.env.SCHEDULER_SECRET || '',
    followupEnabledDefault: process.env.FOLLOWUP_ENABLED_DEFAULT !== 'false',
  },
};
