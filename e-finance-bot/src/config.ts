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

  // Roteador de intent hibrido (baixo token)
  llmRouter: {
    enabled: process.env.LLM_ROUTER_ENABLED !== 'false',
    timeoutMs: parseInt(process.env.LLM_ROUTER_TIMEOUT_MS || '1200', 10),
    maxOutputTokens: parseInt(process.env.LLM_ROUTER_MAX_OUTPUT_TOKENS || '80', 10),
    maxInputChars: parseInt(process.env.LLM_ROUTER_MAX_INPUT_CHARS || '450', 10),
    historyItems: parseInt(process.env.LLM_ROUTER_HISTORY_ITEMS || '2', 10),
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

  // Persistencia de historico
  messagePersistence: {
    mode: (process.env.MESSAGE_PERSISTENCE_MODE === 'sync' ? 'sync' : 'hybrid') as 'sync' | 'hybrid',
    retryCount: parseInt(process.env.MESSAGE_PERSISTENCE_RETRY_COUNT || '2', 10),
    retryBaseMs: parseInt(process.env.MESSAGE_PERSISTENCE_RETRY_BASE_MS || '200', 10),
  },

  // Gerador de respostas naturais via LLM (agente real)
  llmResponse: {
    enabled: process.env.LLM_RESPONSE_ENABLED !== 'false',
    timeoutMs: parseInt(process.env.LLM_RESPONSE_TIMEOUT_MS || '1500', 10),
    maxOutputTokens: parseInt(process.env.LLM_RESPONSE_MAX_TOKENS || '120', 10),
  },
};
