export interface PromptGuardResult {
  blocked: boolean;
  matches: string[];
}

function detectEncodedPayload(text: string): boolean {
  const trimmed = text.trim();
  // Long base64-like strings (likely an encoded payload)
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(trimmed)) return true;
  // Explicit decode/encoding references
  if (/\b(atob|btoa|base64|hex2bin|urldecode|decode)\b/i.test(text)) return true;
  return false;
}

const GUARD_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'instruction_override',
    pattern: /\b(ignore|ignora|desconsidere|esque[çc]a|bypass)\b.{0,30}\b(instru|regras?|prompt|sistema|system|developer|seguran[çc]a)\b/i,
  },
  {
    name: 'prompt_exfiltration',
    pattern: /\b(reveal|mostre|exiba|vaze|leak|imprima|dump|liste|listar)\b.{0,30}\b(prompts?|system|developer|tokens?|senha|senhas|secrets?|api\s*keys?|credencial|credenciais|vari[aá]veis?\s+de\s+ambiente|env)\b/i,
  },
  {
    name: 'role_jailbreak',
    pattern: /\b(jailbreak|act as|finja ser|agora voc[eê]\s+[ée]|modo desenvolvedor|developer mode|root mode|god mode)\b/i,
  },
  {
    name: 'tool_abuse',
    pattern: /\b(execute|executar|rode|run|shell|terminal|sql|consulta\s+direta)\b.{0,30}\b(segred|credencial|token|senha|api\s*key|prompt)\b/i,
  },
  {
    name: 'data_exfiltration_ptbr',
    pattern: /\b(me\s+mostra|retorne|exporte|copie|liste|listar)\b.{0,30}\b(todos\s+os\s+dados|todos\s+os\s+clientes|clientes|cpfs?|cart[oõ]es?|senhas?|tokens?)\b/i,
  },
  {
    name: 'sql_injection',
    pattern: /\b(select|insert|drop|delete|update|truncate)\b.{0,30}\b(from|into|table|where|database)\b/i,
  },
];

export function sanitizeUserText(text: string): string {
  return text
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectPromptInjectionAttempt(text: string): PromptGuardResult {
  const normalized = sanitizeUserText(text);

  if (detectEncodedPayload(normalized)) {
    return { blocked: true, matches: ['encoded_payload'] };
  }

  const matches = GUARD_PATTERNS
    .filter(item => item.pattern.test(normalized))
    .map(item => item.name);

  return {
    blocked: matches.length > 0,
    matches,
  };
}
