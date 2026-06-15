import type { PendingPaymentFollowupItem } from './payment-followup';

export function normalizeBaixaText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export type BaixaSelection =
  | { kind: 'all' }
  | { kind: 'ok'; selected: PendingPaymentFollowupItem[] }
  | { kind: 'ambiguous'; message: string }
  | { kind: 'none' };

/**
 * Resolve a seleção de baixa a partir da resposta do admin ao alerta de fim de dia.
 * Número é o método PRIMÁRIO (confiável); nome é best-effort sobre a lista já exibida.
 * Qualquer ambiguidade cai no pedido de número — nunca baixa por palpite.
 */
export function resolveBaixaSelection(text: string, items: PendingPaymentFollowupItem[]): BaixaSelection {
  const normalized = normalizeBaixaText(text);

  if (/^(todos|todas|tudo|todos eles|todas elas)$/.test(normalized) || /\bbaixa(r)? (em )?(todos|todas|tudo)\b/.test(normalized)) {
    return { kind: 'all' };
  }

  // 1) Seleção por número (primária)
  const numbers = normalized.match(/\d+/g);
  if (numbers && numbers.length > 0) {
    const idxs = Array.from(new Set(numbers.map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= items.length)));
    if (idxs.length === 0) {
      return { kind: 'ambiguous', message: `Não encontrei esses números na lista. Responda com os números de *1* a *${items.length}*.` };
    }
    return { kind: 'ok', selected: idxs.map(i => items[i - 1]) };
  }

  // 2) Seleção por nome (best-effort)
  const cleaned = normalized
    .replace(/^(da|dar|registra|registrar|confirma|confirmar)?\s*(baixa(r)?|baixe|paguei|pagou|recebi|recebido)\s*(de|em|do|da|no|na|para|pra)?\s*/i, '')
    .replace(/\b(ja|tambem)\b/g, '')
    .trim();

  if (cleaned.length < 3) return { kind: 'none' };

  const tokens = cleaned
    .split(/\s*,\s*|\s+e\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 3);

  if (tokens.length === 0) return { kind: 'none' };

  const itemWords = items.map(it => normalizeBaixaText(it.debtorName).split(/\s+/).filter(Boolean));

  const selected: PendingPaymentFollowupItem[] = [];
  for (const token of tokens) {
    // casa se alguma PALAVRA do nome começa com o token (evita "ana" ⊂ "mariana"),
    // ou (para nomes compostos) se o nome completo contém o token como trecho
    const matchIdx: number[] = [];
    items.forEach((_, i) => {
      const words = itemWords[i];
      const fullName = normalizeBaixaText(items[i].debtorName);
      const wordMatch = words.some(w => w.startsWith(token) || token.startsWith(w));
      const phraseMatch = token.includes(' ') && fullName.includes(token);
      if (wordMatch || phraseMatch) matchIdx.push(i);
    });

    const uniqueMatches = Array.from(new Set(matchIdx));
    if (uniqueMatches.length === 0) {
      return {
        kind: 'ambiguous',
        message: `Não encontrei *${token}* na lista de hoje. Responda com o *número* da cobrança (1 a ${items.length}).`,
      };
    }
    if (uniqueMatches.length > 1) {
      return {
        kind: 'ambiguous',
        message: `*${token}* casa com mais de uma cobrança da lista. Pra não baixar no cliente errado, responda com o *número* (1 a ${items.length}).`,
      };
    }
    selected.push(items[uniqueMatches[0]]);
  }

  // dedup por id
  const deduped = Array.from(new Map(selected.map(s => [s.id, s])).values());
  return deduped.length > 0 ? { kind: 'ok', selected: deduped } : { kind: 'none' };
}

export function formatBaixaResult(
  paid: PendingPaymentFollowupItem[],
  alreadyPaid: PendingPaymentFollowupItem[],
  failed: PendingPaymentFollowupItem[],
): string {
  const lines: string[] = [];
  if (paid.length > 0) {
    lines.push(`✅ Baixa registrada em ${paid.length === 1 ? '*1* cobrança' : `*${paid.length}* cobranças`}.`);
  }
  if (alreadyPaid.length > 0) {
    lines.push(`ℹ️ ${alreadyPaid.length === 1 ? '1 já estava' : `${alreadyPaid.length} já estavam`} baixada${alreadyPaid.length > 1 ? 's' : ''} (nada a fazer).`);
  }
  if (failed.length > 0) {
    lines.push(`⚠️ ${failed.length === 1 ? '1 cobrança' : `${failed.length} cobranças`} não puderam ser baixadas — verifique o painel.`);
  }
  return lines.join('\n') || '✅ Concluído.';
}
