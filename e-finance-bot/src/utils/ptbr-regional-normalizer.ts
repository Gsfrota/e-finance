const LEADING_FILLERS = /^(?:(?:oxe|oxente|vixe|eita|macho|rapaz|visse|pois|pronto|ei|viu)\b[\s,!.?]*)+/i;
const TRAILING_FILLERS = /(?:[\s,!.?]+(?:visse|viu|macho|pois|pronto))+\s*$/i;

const REGIONAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bnaum\b/gi, 'não'],
  [/\bnum\b/gi, 'não'],
  [/\bjan[eê]ro\b/gi, 'janeiro'],
  [/\bfev[eê]rero\b/gi, 'fevereiro'],
  [/\bfev[eê]ro\b/gi, 'fevereiro'],
  [/\bmarco\b/gi, 'março'],
  [/\babr[ií]u?\b/gi, 'abril'],
  [/\bsetembo\b/gi, 'setembro'],
  [/\boutubo\b/gi, 'outubro'],
  [/\bnovembo\b/gi, 'novembro'],
  [/\bdezembo\b/gi, 'dezembro'],
];

export function normalizePtBrRegionalText(text: string): string {
  let normalized = text
    .replace(LEADING_FILLERS, '')
    .replace(TRAILING_FILLERS, '')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [pattern, replacement] of REGIONAL_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(/\s+/g, ' ')
    .trim();
}
