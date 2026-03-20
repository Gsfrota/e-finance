
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_KEYS = {
  URL: 'EF_EXTERNAL_SUPABASE_URL',
  KEY: 'EF_EXTERNAL_SUPABASE_KEY'
};

// Configure via localStorage: EF_EXTERNAL_SUPABASE_URL e EF_EXTERNAL_SUPABASE_KEY
const SYSTEM_DEFAULTS = {
    URL: '',
    KEY: ''
};

/**
 * Valida CPF (Algoritmo de dígitos verificadores)
 */
export const isValidCPF = (cpf: string): boolean => {
    const clean = cpf.replace(/\D/g, '');
    if (clean.length !== 11 || !!clean.match(/(\d)\1{10}/)) return false;
    let s = 0;
    for (let i = 1; i <= 9; i++) s += parseInt(clean.substring(i - 1, i)) * (11 - i);
    let r = (s * 10) % 11;
    if (r === 10 || r === 11) r = 0;
    if (r !== parseInt(clean.substring(9, 10))) return false;
    s = 0;
    for (let i = 1; i <= 10; i++) s += parseInt(clean.substring(i - 1, i)) * (12 - i);
    r = (s * 10) % 11;
    if (r === 10 || r === 11) r = 0;
    if (r !== parseInt(clean.substring(10, 11))) return false;
    return true;
};

/**
 * Remove qualquer caractere não numérico
 */
export const cleanNumbers = (val: string) => val.replace(/\D/g, '');

export const isProduction = () => {
  return window.location.hostname !== 'localhost' && 
         window.location.hostname !== '127.0.0.1' && 
         !window.location.hostname.includes('.preview.app');
};

export const parseSupabaseError = (error: any): string => {
    if (!error) return "Erro desconhecido.";
    const code = error.code;
    const msg = error.message || "";
    if (code === '23505') return "Este registro (e-mail ou CPF) já existe no sistema.";
    if (code === '23503') return "Erro de integridade: Um registro relacionado não foi encontrado.";
    if (code === '42P01') return "Tabela não encontrada. Você executou o script SQL?";
    if (code === 'PGRST116') return "Nenhum resultado encontrado para esta consulta.";
    if (msg.includes("Database error saving new user")) return "Erro Crítico no Banco (Trigger): Falha ao processar o Perfil/Tenant.";
    if (msg.includes("Invalid login credentials")) return "E-mail ou senha incorretos. Verifique suas credenciais.";
    if (msg.includes("Email not confirmed")) return "E-mail não confirmado. Verifique sua caixa de entrada.";
    if (msg.includes("User already registered")) return "Este e-mail já está cadastrado no sistema.";
    return msg || `Erro técnico: ${code || 'Sem código'}`;
};

export const logError = (context: string, error: any) => {
    console.error(`[E-FINANCE ERROR] @ ${context}:`, {
        message: error?.message || error,
        details: error?.details || 'N/A',
        code: error?.code || 'N/A'
    });
};

const getSupabaseConfig = () => {
  // 1. localStorage (manual override pelo usuário)
  const localUrl = localStorage.getItem(STORAGE_KEYS.URL);
  const localKey = localStorage.getItem(STORAGE_KEYS.KEY);
  // 2. window._env_ (injetado pelo docker-entrypoint.sh com secrets do Cloud Run)
  const envConfig = (window as any)._env_ || {};
  const runtimeUrl = envConfig.SUPABASE_URL;
  const runtimeKey = envConfig.SUPABASE_KEY;
  // 3. build-time (Vite define) → fallback
  const finalUrl = localUrl || runtimeUrl || process.env.SUPABASE_URL || SYSTEM_DEFAULTS.URL;
  const finalKey = localKey || runtimeKey || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || SYSTEM_DEFAULTS.KEY;
  return { url: finalUrl, key: finalKey };
};

let supabase: SupabaseClient | null = null;
const config = getSupabaseConfig();

if (config.url && config.key && config.url.startsWith('http')) {
  try {
    supabase = createClient(config.url, config.key, {
      auth: {
        flowType: 'pkce',
        storageKey: isProduction() ? 'ef_prod_session' : 'ef_dev_session',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  } catch (e) {
    logError("Supabase Init", e);
  }
}

export const getSupabase = () => supabase;

export const getStatelessSupabase = () => {
    const cfg = getSupabaseConfig();
    return createClient(cfg.url, cfg.key, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
};

export const saveExternalConfig = (url: string, key: string) => {
    localStorage.setItem(STORAGE_KEYS.URL, url.trim());
    localStorage.setItem(STORAGE_KEYS.KEY, key.trim());
    window.location.reload();
};

export const clearExternalConfig = () => {
    localStorage.removeItem(STORAGE_KEYS.URL);
    localStorage.removeItem(STORAGE_KEYS.KEY);
    window.location.reload();
};

export const isSupabaseConfigured = () => {
    const current = getSupabaseConfig();
    return !!(current.url && current.key && current.url.startsWith('http'));
};

/**
 * Executa fn com retry automático e timeout por tentativa.
 * Backoff exponencial: 1s → 2s → 4s.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts = { retries: 3, timeoutMs: 10000, backoffMs: 1000 }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < opts.retries; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout após ${opts.timeoutMs}ms`)), opts.timeoutMs)
      );
      const result = await Promise.race([fn(), timeoutPromise]);
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < opts.retries - 1) {
        await new Promise(r => setTimeout(r, opts.backoffMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}
