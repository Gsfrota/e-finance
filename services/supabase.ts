
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from '../types';

const STORAGE_KEYS = {
  URL: 'EF_EXTERNAL_SUPABASE_URL',
  ANON_KEY: 'EF_EXTERNAL_SUPABASE_ANON_KEY',
  LEGACY_KEY: 'EF_EXTERNAL_SUPABASE_KEY',
};

const SYSTEM_DEFAULTS = {
  URL: '',
  KEY: '',
};

type RuntimeEnv = Record<string, string | undefined>;
type ProfileLookupMatch = 'auth_user_id' | 'id' | null;

interface ProfileLookupResult<T> {
  data: T | null;
  error: any;
  matchedBy: ProfileLookupMatch;
}

const getBrowserRuntimeEnv = (): RuntimeEnv => {
  if (typeof window === 'undefined') return {};
  return ((window as any)._env_ || {}) as RuntimeEnv;
};

const getViteEnv = (): RuntimeEnv => {
  try {
    const meta = import.meta as any;
    return (meta?.env || {}) as RuntimeEnv;
  } catch {
    return {};
  }
};

const canUseLocalStorage = (): boolean => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

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
  if (typeof window === 'undefined') return true;
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
  const allowLocalOverrides = !isProduction();
  const localUrl = allowLocalOverrides && canUseLocalStorage() ? localStorage.getItem(STORAGE_KEYS.URL) : null;
  const localKey = allowLocalOverrides && canUseLocalStorage()
    ? localStorage.getItem(STORAGE_KEYS.ANON_KEY) || localStorage.getItem(STORAGE_KEYS.LEGACY_KEY)
    : null;
  const runtimeEnv = getBrowserRuntimeEnv();
  const viteEnv = getViteEnv();
  const finalUrl = localUrl
    || runtimeEnv.SUPABASE_URL
    || viteEnv.VITE_SUPABASE_URL
    || viteEnv.SUPABASE_URL
    || SYSTEM_DEFAULTS.URL;
  const finalKey = localKey
    || runtimeEnv.SUPABASE_ANON_KEY
    || runtimeEnv.SUPABASE_KEY
    || viteEnv.VITE_SUPABASE_ANON_KEY
    || viteEnv.VITE_SUPABASE_KEY
    || SYSTEM_DEFAULTS.KEY;
  return { url: finalUrl, key: finalKey };
};

export async function fetchProfileByAuthUserId<T extends Record<string, any> = Profile>(
  supabase: SupabaseClient,
  authUserId: string,
  select = '*, tenants!profiles_tenant_id_fkey (*)'
): Promise<ProfileLookupResult<T>> {
  if (!authUserId) return { data: null, error: null, matchedBy: null };
  let lastError: any = null;

  for (const matchedBy of ['auth_user_id', 'id'] as const) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(select)
        .eq(matchedBy, authUserId)
        .maybeSingle();

      if (error) lastError = error;
      if (data) return { data: data as unknown as T, error: null, matchedBy };
    } catch (error) {
      lastError = error;
    }
  }

  return { data: null, error: lastError, matchedBy: null };
}

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
    if (isProduction()) {
      console.warn('[E-FINANCE] External Supabase overrides are disabled in production.');
      return;
    }
    if (!canUseLocalStorage()) return;
    localStorage.setItem(STORAGE_KEYS.URL, url.trim());
    localStorage.setItem(STORAGE_KEYS.ANON_KEY, key.trim());
    localStorage.removeItem(STORAGE_KEYS.LEGACY_KEY);
    window.location.reload();
};

export const clearExternalConfig = () => {
    if (!canUseLocalStorage()) return;
    localStorage.removeItem(STORAGE_KEYS.URL);
    localStorage.removeItem(STORAGE_KEYS.ANON_KEY);
    localStorage.removeItem(STORAGE_KEYS.LEGACY_KEY);
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
