export interface PromptGuardResult {
  blocked: boolean;
  matches: string[];
}

const GUARD_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'instruction_override',
    pattern: /\b(ignore|ignora|desconsidere|esque[çc]a|bypass)\b.{0,80}\b(instru|regras?|prompt|sistema|system|developer|seguran[çc]a)\b/i,
  },
  {
    name: 'prompt_exfiltration',
    pattern: /\b(reveal|mostre|exiba|vaze|leak|imprima|dump)\b.{0,100}\b(prompt|system|developer|token|senha|secret|api\s*key|credencial|vari[aá]veis?\s+de\s+ambiente|env)\b/i,
  },
  {
    name: 'role_jailbreak',
    pattern: /\b(jailbreak|act as|finja ser|agora voc[eê]\s+[ée]|modo desenvolvedor|developer mode|root mode|god mode)\b/i,
  },
  {
    name: 'tool_abuse',
    pattern: /\b(execute|executar|rode|run|shell|terminal|sql|consulta\s+direta)\b.{0,80}\b(segred|credencial|token|senha|api\s*key|prompt)\b/i,
  },
  {
    name: 'data_exfiltration_ptbr',
    pattern: /\b(me\s+mostra|retorne|exporte|copie)\b.{0,100}\b(todos\s+os\s+dados|todos\s+os\s+clientes|cpfs?|cart[oõ]es?|senhas?|tokens?)\b/i,
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
  const matches = GUARD_PATTERNS
    .filter(item => item.pattern.test(normalized))
    .map(item => item.name);

  return {
    blocked: matches.length > 0,
    matches,
  };
}
