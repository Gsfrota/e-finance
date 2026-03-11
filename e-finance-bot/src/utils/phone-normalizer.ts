export type KnownCountry =
  | 'BR' | 'US' | 'AR' | 'MX' | 'CO' | 'PE' | 'CL' | 'PY' | 'UY' | 'BO'
  | 'PT' | 'ES' | 'GB' | 'FR' | 'DE' | 'IT'
  | 'unknown';

export interface NormalizedPhone {
  /** Dígitos puros E.164 sem '+'. Ex: "5585991318582" */
  e164Digits: string;
  country: KnownCountry;
  /** true quando o código de país foi inferido, não explicitamente fornecido */
  wasInferred: boolean;
}

interface CountryPrefix {
  code: string;
  country: KnownCountry;
  lengths: number[];
}

// Ordenados do mais longo para o mais curto para evitar ambiguidade
const COUNTRY_PREFIXES: CountryPrefix[] = [
  // 3 dígitos
  { code: '351', country: 'PT', lengths: [12] },
  { code: '598', country: 'UY', lengths: [11] },
  { code: '591', country: 'BO', lengths: [11] },
  { code: '595', country: 'PY', lengths: [12] },
  // 2 dígitos
  { code: '55', country: 'BR', lengths: [12, 13] },
  { code: '54', country: 'AR', lengths: [13] },
  { code: '52', country: 'MX', lengths: [12] },
  { code: '57', country: 'CO', lengths: [12] },
  { code: '51', country: 'PE', lengths: [11] },
  { code: '56', country: 'CL', lengths: [11] },
  { code: '44', country: 'GB', lengths: [12, 13] },
  { code: '34', country: 'ES', lengths: [11] },
  { code: '33', country: 'FR', lengths: [11] },
  { code: '49', country: 'DE', lengths: [12, 13, 14] },
  { code: '39', country: 'IT', lengths: [11, 12] },
  // 1 dígito
  { code: '1', country: 'US', lengths: [11] },
];

function applyCountryFix(digits: string, country: KnownCountry): string {
  if (country === 'BR' && digits.length === 12) {
    // Inserir '9' após código do país (55) + DDD (2 dígitos) = posição 4
    return digits.slice(0, 4) + '9' + digits.slice(4);
  }
  return digits;
}

export function normalizePhone(raw: string): NormalizedPhone | null {
  // Limpar: strip +, 00 inicial (discagem internacional), não-dígitos
  const digits = raw
    .replace(/^\+/, '')
    .replace(/^00/, '')
    .replace(/\D/g, '');

  if (digits.length < 7) return null;

  // Tentar detectar country code (do mais longo para o mais curto)
  for (const { code, country, lengths } of COUNTRY_PREFIXES) {
    if (digits.startsWith(code) && lengths.includes(digits.length)) {
      const e164Digits = applyCountryFix(digits, country);
      return { e164Digits, country, wasInferred: false };
    }
  }

  // Número curto sem código de país detectado → inferir Brasil
  if (digits.length >= 8 && digits.length <= 11) {
    const withBR = '55' + digits;
    const fixed = applyCountryFix(withBR, 'BR');
    return { e164Digits: fixed, country: 'BR', wasInferred: true };
  }

  // Comprimento não reconhecido → preservar, country unknown
  return { e164Digits: digits, country: 'unknown', wasInferred: true };
}

/**
 * Verifica se um telefone está em uma whitelist.
 * Normaliza o phone e cada entrada da lista antes de comparar.
 */
export function isPhoneInWhitelist(phone: string, whitelist: string[]): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;

  for (const entry of whitelist) {
    const normalizedEntry = normalizePhone(entry);
    if (normalizedEntry && normalizedEntry.e164Digits === normalized.e164Digits) {
      return true;
    }
  }
  return false;
}
