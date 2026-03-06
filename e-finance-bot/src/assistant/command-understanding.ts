import type { CommandUnderstanding, OperationalIntent } from './contracts';
import { routeIntent } from '../ai/intent-router';
import { inferTimeWindowFromText } from './time-window';

interface HistoryMessage {
  role: string;
  content: string;
}

interface CommandUnderstandingInput {
  text: string;
  tenantId: string;
  channel: 'telegram' | 'whatsapp';
  messageId: string;
  sessionId: string;
  loadHistory: () => Promise<HistoryMessage[]>;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectUtilityIntent(text: string): OperationalIntent | null {
  const normalized = normalizeText(text);
  if (/^(quem (e|é) voce|quem e vc|o que voce faz|qual seu papel)/.test(normalized)) {
    return 'smalltalk_identity';
  }
  if (/^(que dia e hoje|qual a data de hoje|hoje e que dia|que dia e hj)/.test(normalized)) {
    return 'smalltalk_datetime';
  }
  return null;
}

function detectWindowFamily(text: string): 'recebiveis_periodo' | 'cobrar_periodo' | null {
  const normalized = normalizeText(text);
  const hasMonths = /\bmes\b|\bmeses\b/.test(normalized);
  if (!hasMonths) return null;

  if (/(quanto|quais|recebiveis|receber).*(receber|recebiveis|vou receber)/.test(normalized)) {
    return 'recebiveis_periodo';
  }

  if (/(quem.*cobrar|quem.*deve|cobranca|cobrar)/.test(normalized)) {
    return 'cobrar_periodo';
  }

  return null;
}

function cleanDebtorNameCandidate(raw: string): string {
  return raw
    .replace(/[?!.;,]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:o|a|os|as|do|da|dos|das|de)\s+/i, '')
    .replace(/\b(?:me|mim|pra mim|para mim)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDebtorQuery(text: string): string | null {
  const patterns: RegExp[] = [
    /quanto(?:\s+que)?\s+(.+?)(?:\s+me)?\s+deve\b/i,
    /qual(?:\s+[ée])?\s+(?:a\s+)?(?:d[íi]vida|saldo(?:\s+devedor)?)\s+(?:de\s+)?(.+)$/i,
    /(?:buscar|consultar)\s+(?:devedor|usu[aá]rio|cliente)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const cleaned = cleanDebtorNameCandidate(match[1]);
    if (cleaned.length >= 2) return cleaned;
  }

  return null;
}

export async function understandCommand(
  input: CommandUnderstandingInput,
): Promise<CommandUnderstanding> {
  const utilityIntent = detectUtilityIntent(input.text);
  if (utilityIntent) {
    return {
      intent: utilityIntent,
      source: 'rule',
      confidence: 'high',
      dependsOnContext: false,
      normalizedEntities: {},
    };
  }

  const directWindow = inferTimeWindowFromText(input.text);
  const directWindowFamily = detectWindowFamily(input.text);
  if (directWindow && directWindowFamily) {
    return {
      intent: directWindowFamily,
      source: 'rule',
      confidence: 'high',
      dependsOnContext: false,
      normalizedEntities: {
        time_window: directWindow,
        months_ahead: directWindow.mode === 'relative_months' ? directWindow.amount : undefined,
        days_ahead: directWindow.mode === 'relative_days' ? directWindow.amount : undefined,
        window_start: directWindow.windowStart,
      },
    };
  }

  let routed = await routeIntent(input.text, [], {
    cacheScope: input.tenantId,
    channel: input.channel,
    messageId: input.messageId,
    sessionId: input.sessionId,
    mode: 'fast',
  });

  if (routed.intent === 'desconhecido' || routed.confidence !== 'high' || routed.source !== 'rule') {
    const history = await input.loadHistory();
    routed = await routeIntent(input.text, history, {
      cacheScope: input.tenantId,
      channel: input.channel,
      messageId: input.messageId,
      sessionId: input.sessionId,
      mode: 'full',
    });
  }

  const normalizedEntities = {
    ...routed.normalizedEntities,
  } as CommandUnderstanding['normalizedEntities'];

  const parsedWindow = inferTimeWindowFromText(input.text);
  if (parsedWindow) {
    normalizedEntities.time_window = parsedWindow;
    if (parsedWindow.mode === 'relative_months') {
      normalizedEntities.months_ahead = parsedWindow.amount;
    }
    if (parsedWindow.mode === 'relative_days') {
      normalizedEntities.days_ahead = parsedWindow.amount;
      normalizedEntities.window_start = parsedWindow.windowStart;
    }
  }

  if (routed.intent === 'buscar_usuario' && !normalizedEntities.debtor_name) {
    const debtorQuery = extractDebtorQuery(input.text);
    if (debtorQuery) normalizedEntities.debtor_name = debtorQuery;
  }

  return {
    intent: routed.intent,
    source: routed.source,
    confidence: routed.confidence,
    dependsOnContext: false,
    normalizedEntities,
    candidates: routed.candidates,
    fallbackReason: routed.fallbackReason,
  };
}
