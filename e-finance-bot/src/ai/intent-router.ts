import {
  ClassifiedIntent,
  Intent,
  classifyIntentCompact,
  normalizeEntities,
  inferInstallmentMonth,
  inferDaysWindow,
} from './intent-classifier';
import { detectPromptInjectionAttempt } from '../security/prompt-guard';
import { config } from '../config';
import { logStructuredMessage } from '../observability/logger';

export interface RoutedIntent extends ClassifiedIntent {
  source: 'rule' | 'llm';
  decisionPath?: 'rule_strong' | 'rule_weak_llm' | 'llm' | 'fallback';
  candidates?: Intent[];
  fallbackReason?: string;
}

interface RouteOptions {
  cacheScope?: string;
  channel?: 'whatsapp' | 'telegram';
  messageId?: string;
  sessionId?: string;
  mode?: 'fast' | 'full';
}

interface Rule {
  intent: Intent;
  pattern: RegExp;
  entities?: Record<string, string | number>;
}

interface ContractSignal {
  score: number;
  isStrong: boolean;
  hasMoney: boolean;
  hasInstallments: boolean;
  hasPorPattern: boolean;
  hasDueDay: boolean;
}

interface ReceivablesSignal {
  score: number;
  isStrong: boolean;
}

interface CacheEntry {
  expiresAt: number;
  value: RoutedIntent;
}

const llmRouterCache = new Map<string, CacheEntry>();

const RULES: Rule[] = [
  { intent: 'ajuda', pattern: /^(\/help|\/ajuda|ajuda|menu|comandos?|oi|olá|ola|bom dia|boa tarde|boa noite)$/i },
  { intent: 'ver_dashboard', pattern: /^(\/dashboard|dashboard|resumo|status|como\s+t[aá]\s+o\s+m[eê]s|como\s+est[aá]\s+o\s+m[eê]s|1)$/i },
  { intent: 'listar_recebiveis', pattern: /^(\/recebiveis|\/recebíveis|recebiveis|recebíveis)$/i, entities: { filter: 'pending' } },
  { intent: 'listar_recebiveis', pattern: /^(2)$/i, entities: { filter: 'pending' } },
  { intent: 'listar_recebiveis', pattern: /(quem\s+t[aá]\s+atrasad|quem\s+est[aá]\s+atrasad|quem\s+ta\s+atrasad)/i, entities: { filter: 'late' } },

  { intent: 'recebiveis_periodo', pattern: /((quanto|quais?)\s+.*(vou|irei|devo)?\s*receber.*(pr[oó]xim|\d+\s*dias|amanh[ãa]))|(receb[ií]veis?.*(pr[oó]xim|\d+\s*dias|amanh[ãa]))/i },
  { intent: 'cobrar_periodo', pattern: /((quem\s+.*devo\s+cobrar|quem\s+tenho\s+que\s+cobrar|quem\s+me\s+deve).*(pr[oó]xim|\d+\s*dias|amanh[ãa]))|((cobrar|cobran[cç]a).*(pr[oó]xim|\d+\s*dias|amanh[ãa]))/i },

  { intent: 'criar_contrato', pattern: /^(\/contrato|\/criarcontrato|contrato)$/i },
  { intent: 'criar_contrato', pattern: /^(3)$/i },
  { intent: 'marcar_pagamento', pattern: /^(\/pagamento|pagamento)$/i },
  { intent: 'marcar_pagamento', pattern: /^(4)$/i },

  { intent: 'recebiveis_hoje', pattern: /(receb[ií]veis?\s+de\s+hoje|vence\s+hoje|vencimentos?\s+de\s+hoje|parcelas?\s+de\s+hoje|o\s+que\s+vence\s+hoje)/i },
  { intent: 'cobrar_hoje', pattern: /(quem\s+tenho\s+que\s+cobrar\s+hoje|cobrar\s+hoje|lista\s+de\s+cobran[cç]a\s+de\s+hoje|quem\s+(t[aá]|est[aá])\s+me\s+devendo\s+hoje|quem\s+me\s+deve\s+hoje|quem\s+(t[aá]|est[aá])\s+devendo\s+hoje)/i },

  { intent: 'criar_contrato', pattern: /(criar?\s+contrato|novo\s+contrato|registrar\s+contrato|cadastrar\s+contrato|empr[eé]stimo\s+para)/i },
  { intent: 'marcar_pagamento', pattern: /(marcar\s+pagamento|dar\s+baixa|registrar\s+pagamento|parcela\s+paga|baixar\s+contrato|quitar\s+parcela|baixar\s+pagamento|pagamento\s+do\s+m[eê]s\s+de|parcela\s+do\s+m[eê]s\s+de)/i },
  { intent: 'gerar_relatorio', pattern: /(gerar\s+relat[oó]rio|relat[oó]rio\s+mensal|resumo\s+completo|me\s+d[aá]\s+um\s+relat[oó]rio|pedir\s+relat[oó]rio)/i },
  { intent: 'gerar_convite', pattern: /(gerar\s+convite|gera\s+um\s+convite|novo\s+c[oó]digo\s+de\s+convite|link\s+de\s+convite)/i },
  { intent: 'buscar_usuario', pattern: /(buscar\s+usu[aá]rio|buscar\s+devedor|consultar\s+usu[aá]rio|quanto\s+.*\s+deve|ver\s+devedor|me\s+fala\s+da\s+d[íi]vida|qual\s+(a\s+)?d[íi]vida\s+de)/i },
  { intent: 'desconectar', pattern: /^(\/desconectar|desconectar|desvincular|sair\s+da\s+conta)$/i },
  { intent: 'confirmar', pattern: /^(sim|confirmo|ok|pode|isso|s)$/i },
  { intent: 'cancelar', pattern: /^(n[aã]o|nao|cancela|cancelar|para|sair)$/i },
];

function clampDaysAhead(value?: number): number {
  if (!Number.isFinite(value || NaN)) return 7;
  return Math.max(1, Math.min(60, Math.trunc(value as number)));
}

function inferPeriodEntities(text: string): Record<string, string | number> {
  const inferred = inferDaysWindow(text);
  return {
    days_ahead: clampDaysAhead(inferred.daysAhead),
    window_start: inferred.windowStart || 'today',
  };
}

function inferFilter(text: string): 'pending' | 'late' | 'week' | 'all' | undefined {
  const normalized = text.toLowerCase();
  if (/atrasad|vencid|inadimpl|devendo/.test(normalized)) return 'late';
  if (/semana|7\s*dias/.test(normalized)) return 'week';
  if (/todos|todas|geral|completo/.test(normalized)) return 'all';
  if (/pendente|aberto/.test(normalized)) return 'pending';
  return undefined;
}

function cleanDebtorNameCandidate(raw: string): string {
  let cleaned = raw
    .replace(/[?!.;,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned
    .replace(/^(?:o|a|os|as|do|da|dos|das|de)\s+/i, '')
    .replace(/\b(?:me|mim|pra mim|para mim)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\b(?:deve|devendo|d[íi]vida|saldo)\b/i.test(cleaned)) {
    cleaned = cleaned
      .replace(/\b(?:deve|devendo|d[íi]vida|saldo)\b.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return cleaned;
}

function inferUserSearchEntity(text: string): Record<string, string> {
  const candidatePatterns: RegExp[] = [
    /(?:devedor|usu[aá]rio|cliente|investidor)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{1,80})/i,
    /quanto(?:\s+que)?\s+(.+?)(?:\s+me)?\s+deve\b/i,
    /qual(?:\s+[ée])?\s+(?:a\s+)?(?:d[íi]vida|saldo(?:\s+devedor)?)\s+(?:de\s+)?(.+)$/i,
    /(?:devo|deve)\s+receber\s+de\s+(.+)$/i,
  ];

  for (const pattern of candidatePatterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const cleaned = cleanDebtorNameCandidate(match[1]);
    if (!cleaned || cleaned.length < 2) continue;
    return { debtor_name: cleaned };
  }

  return {};
}

function inferPaymentByContractEntities(text: string): Record<string, string | number> | null {
  const trimmed = text.trim();
  if (!/(baixar|dar\s+baixa|pagar|pagamento|marcar\s+pagamento|registrar\s+pagamento|quitar)/i.test(trimmed)) {
    return null;
  }

  const contractMatch = trimmed.match(/contrato\s*#?\s*(\d+)/i);
  if (!contractMatch?.[1]) return null;

  const contractId = Number(contractMatch[1]);
  if (!Number.isFinite(contractId) || contractId <= 0) return null;

  let installmentNumber: number | undefined;
  const installmentMatch = trimmed.match(/parcela\s*#?\s*(\d+)/i);
  if (installmentMatch?.[1]) {
    const parsed = Number(installmentMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) installmentNumber = parsed;
  }

  const monthInfo = inferInstallmentMonth(trimmed);

  return {
    contract_id: contractId,
    ...(installmentNumber ? { installment_number: installmentNumber } : {}),
    ...(monthInfo.month ? { installment_month: monthInfo.month } : {}),
    ...(monthInfo.year ? { installment_year: monthInfo.year } : {}),
  };
}

function detectContractSignal(text: string): ContractSignal {
  const normalized = text.toLowerCase();

  const hasMoney = /r\$\s*\d|\b\d+[\d.,]*\s*(reais?|real)\b|\b\d+[\d.,]*\s*(mil|k)\b/.test(normalized);
  const hasInstallments = /\b\d+\s*(parcelas?|x|vezes?)\b|parcelas?/.test(normalized);
  const hasPorPattern = /\b\d+[\d.,]*\s*(mil|k)?\s*(reais?|real|r\$)?\s*por\s*\d+[\d.,]*/.test(normalized);
  const hasDueDay = /todo\s+dia\s*\d{1,2}|vence\s+todo\s+dia\s*\d{1,2}|dia\s+\d{1,2}\b/.test(normalized);

  let score = 0;

  if (/empr[eé]stimo|emprestimo|contrato|juros|total\s+a\s+pagar|vai\s+pagar|devedor/.test(normalized)) score += 2;
  if (hasPorPattern) score += 3;
  if (hasMoney && hasInstallments) score += 3;
  if (hasDueDay) score += 2;
  if (/primeira\s+parcela|parcelas?\s+mensais?/.test(normalized)) score += 1;

  if (/receb[ií]veis?|atrasad|vencid|pendente|inadimpl/.test(normalized)) score -= 2;

  return {
    score,
    isStrong: score >= 4 && (hasPorPattern || (hasMoney && hasInstallments) || hasDueDay),
    hasMoney,
    hasInstallments,
    hasPorPattern,
    hasDueDay,
  };
}

function detectReceivablesSignal(text: string): ReceivablesSignal {
  const normalized = text.toLowerCase();
  let score = 0;

  if (/receb[ií]veis?|listar\s+parcelas?|status\s+de\s+cobran[cç]a/.test(normalized)) score += 2;
  if (/atrasad|vencid|pendente|inadimpl|em\s+aberto/.test(normalized)) score += 2;
  if (/quem\s+deve|devedores?\s+em\s+atraso|cobrar/.test(normalized)) score += 1;

  if (/empr[eé]stimo\s+para|criar\s+contrato|novo\s+contrato/.test(normalized)) score -= 2;

  return {
    score,
    isStrong: score >= 3,
  };
}

function inferRuleIntent(text: string): RoutedIntent | null {
  const trimmed = text.trim();

  const paymentByContract = inferPaymentByContractEntities(trimmed);
  if (paymentByContract) {
    return {
      intent: 'marcar_pagamento',
      entities: paymentByContract,
      normalizedEntities: normalizeEntities(paymentByContract),
      confidence: 'high',
      source: 'rule',
      decisionPath: 'rule_strong',
    };
  }

  for (const rule of RULES) {
    if (!rule.pattern.test(trimmed)) continue;

    const entities: Record<string, string | number> = {
      ...(rule.entities || {}),
    };

    if (rule.intent === 'listar_recebiveis') {
      const inferredFilter = inferFilter(trimmed);
      if (inferredFilter) entities.filter = inferredFilter;
    }

    if (rule.intent === 'buscar_usuario') {
      const inferredUser = inferUserSearchEntity(trimmed);
      if (Object.keys(inferredUser).length === 0 && /\bquanto\b.*\bdeve\b/i.test(trimmed)) {
        return null;
      }
      Object.assign(entities, inferredUser);
    }

    if (rule.intent === 'recebiveis_periodo' || rule.intent === 'cobrar_periodo') {
      Object.assign(entities, inferPeriodEntities(trimmed));
    }

    return {
      intent: rule.intent,
      entities,
      normalizedEntities: normalizeEntities(entities),
      confidence: 'high',
      source: 'rule',
      decisionPath: 'rule_strong',
    };
  }

  return null;
}

function estimateTokenClass(inputChars: number, historyChars: number): 'low' | 'medium' | 'high' {
  const total = inputChars + historyChars;
  if (total <= 550) return 'low';
  if (total <= 1200) return 'medium';
  return 'high';
}

function countHistoryChars(history: Array<{ role: string; content: string }>): number {
  return history.reduce((acc, item) => acc + (item.content || '').length, 0);
}

function buildCacheKey(scope: string, text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${scope}:${normalized}`;
}

function getCache(cacheKey: string): RoutedIntent | null {
  const now = Date.now();
  const entry = llmRouterCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    llmRouterCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function setCache(cacheKey: string, value: RoutedIntent): void {
  llmRouterCache.set(cacheKey, {
    expiresAt: Date.now() + Math.max(1000, config.llmRouter.cacheTtlMs),
    value,
  });
}

function fallbackUnknown(candidates: Intent[] = [], reason = 'fallback_unknown'): RoutedIntent {
  return {
    intent: 'desconhecido',
    entities: {},
    normalizedEntities: {},
    confidence: 'low',
    source: 'rule',
    decisionPath: 'fallback',
    candidates,
    fallbackReason: reason,
    meta: {
      fallbackReason: reason,
    },
  };
}

function buildTraceBase(
  text: string,
  history: Array<{ role: string; content: string }>,
  options?: RouteOptions,
) {
  const inputChars = text.length;
  const historyChars = countHistoryChars(history);
  return {
    channel: options?.channel,
    messageId: options?.messageId,
    sessionId: options?.sessionId,
    inputChars,
    historyChars,
    maxOutputTokens: config.llmRouter.maxOutputTokens,
    estimatedTokenClass: estimateTokenClass(inputChars, historyChars),
  };
}

function applyPeriodDefaults(routed: RoutedIntent, text: string): RoutedIntent {
  if (routed.intent !== 'recebiveis_periodo' && routed.intent !== 'cobrar_periodo') {
    return routed;
  }

  const normalized = { ...(routed.normalizedEntities || {}) };
  const inferred = inferDaysWindow(text);

  if (!normalized.days_ahead) {
    normalized.days_ahead = clampDaysAhead(inferred.daysAhead);
  } else {
    normalized.days_ahead = clampDaysAhead(normalized.days_ahead);
  }

  if (!normalized.window_start) {
    normalized.window_start = inferred.windowStart || 'today';
  }

  return {
    ...routed,
    normalizedEntities: normalized,
    entities: {
      ...(routed.entities || {}),
      days_ahead: normalized.days_ahead,
      window_start: normalized.window_start,
    },
  };
}

export async function routeIntent(
  text: string,
  history: Array<{ role: string; content: string }>,
  options: RouteOptions = {}
): Promise<RoutedIntent> {
  const trimmed = text.trim();
  const traceBase = buildTraceBase(trimmed, history, options);
  const routeMode = options.mode || 'full';

  if (!trimmed) {
    const result = fallbackUnknown([], 'empty_message');
    logStructuredMessage('llm_router_skipped', {
      ...traceBase,
      routeSource: 'rule',
      result: 'skipped',
      fallbackReason: 'empty_message',
    });
    logStructuredMessage('router_decision_trace', {
      ...traceBase,
      routeSource: result.source,
      intent: result.intent,
      confidence: result.confidence,
      result: result.decisionPath,
      fallbackReason: result.fallbackReason,
    });
    return result;
  }

  const guard = detectPromptInjectionAttempt(trimmed);
  if (guard.blocked) {
    const result = fallbackUnknown([], 'guardrail_prompt_injection');
    logStructuredMessage('llm_router_skipped', {
      ...traceBase,
      routeSource: 'rule',
      result: 'blocked',
      fallbackReason: 'guardrail_prompt_injection',
      reason: guard.matches.join(','),
    });
    logStructuredMessage('router_decision_trace', {
      ...traceBase,
      routeSource: result.source,
      intent: result.intent,
      confidence: result.confidence,
      result: result.decisionPath,
      fallbackReason: result.fallbackReason,
    });
    return result;
  }

  const ruleMatch = inferRuleIntent(trimmed);
  if (ruleMatch) {
    const withDefaults = applyPeriodDefaults(ruleMatch, trimmed);
    logStructuredMessage('llm_router_skipped', {
      ...traceBase,
      routeSource: 'rule',
      intent: withDefaults.intent,
      confidence: withDefaults.confidence,
      result: 'skipped',
      fallbackReason: 'rule_strong',
    });
    logStructuredMessage('router_decision_trace', {
      ...traceBase,
      routeSource: withDefaults.source,
      intent: withDefaults.intent,
      confidence: withDefaults.confidence,
      result: withDefaults.decisionPath,
      fallbackReason: 'rule_strong',
    });
    return withDefaults;
  }

  const contractSignal = detectContractSignal(trimmed);
  const receivablesSignal = detectReceivablesSignal(trimmed);
  const inferredFilter = inferFilter(trimmed);

  if (contractSignal.isStrong) {
    const entities: Record<string, string | number> = {};
    if (inferredFilter && /atrasad|pendente|vencid|inadimpl/.test(trimmed.toLowerCase())) {
      entities.filter = inferredFilter;
    }

    const result: RoutedIntent = {
      intent: 'criar_contrato',
      entities,
      normalizedEntities: normalizeEntities(entities),
      confidence: 'high',
      source: 'rule',
      decisionPath: 'rule_strong',
    };

    logStructuredMessage('llm_router_skipped', {
      ...traceBase,
      routeSource: 'rule',
      intent: result.intent,
      confidence: result.confidence,
      result: 'skipped',
      fallbackReason: 'contract_natural_rule',
    });
    logStructuredMessage('router_decision_trace', {
      ...traceBase,
      routeSource: result.source,
      intent: result.intent,
      confidence: result.confidence,
      result: result.decisionPath,
      fallbackReason: 'contract_natural_rule',
    });
    return result;
  }

  if (receivablesSignal.isStrong && contractSignal.score <= 1) {
    const entities: Record<string, string | number> = {};
    if (inferredFilter) entities.filter = inferredFilter;

    const result: RoutedIntent = {
      intent: 'listar_recebiveis',
      entities,
      normalizedEntities: normalizeEntities(entities),
      confidence: 'high',
      source: 'rule',
      decisionPath: 'rule_strong',
    };

    logStructuredMessage('llm_router_skipped', {
      ...traceBase,
      routeSource: 'rule',
      intent: result.intent,
      confidence: result.confidence,
      result: 'skipped',
      fallbackReason: 'receivables_explicit_rule',
    });
    logStructuredMessage('router_decision_trace', {
      ...traceBase,
      routeSource: result.source,
      intent: result.intent,
      confidence: result.confidence,
      result: result.decisionPath,
      fallbackReason: 'receivables_explicit_rule',
    });
    return result;
  }

  const ambiguousContractVsReceivables = contractSignal.score >= 2 && receivablesSignal.score >= 2;
  const candidates: Intent[] = ambiguousContractVsReceivables
    ? ['criar_contrato', 'listar_recebiveis']
    : contractSignal.score >= 2
      ? ['criar_contrato']
      : receivablesSignal.score >= 2
        ? ['listar_recebiveis']
        : [];

  if (routeMode === 'fast') {
    const result = fallbackUnknown(candidates, 'fast_mode_requires_full_route');
    logStructuredMessage('llm_router_skipped', {
      ...traceBase,
      routeSource: 'rule',
      result: 'skipped',
      fallbackReason: 'fast_mode_requires_full_route',
    });
    logStructuredMessage('router_decision_trace', {
      ...traceBase,
      routeSource: result.source,
      intent: result.intent,
      confidence: result.confidence,
      result: result.decisionPath,
      fallbackReason: result.fallbackReason,
    });
    return result;
  }

  const likelyNaturalSentence = /\s/.test(trimmed) && trimmed.length >= 12;
  const shouldCallLlm = config.llmRouter.enabled && (
    likelyNaturalSentence
    || contractSignal.score > 0
    || receivablesSignal.score > 0
  );

  if (!shouldCallLlm) {
    const result = fallbackUnknown(candidates, 'rule_insufficient_no_llm');
    logStructuredMessage('llm_router_skipped', {
      ...traceBase,
      routeSource: 'rule',
      result: 'skipped',
      fallbackReason: 'rule_insufficient_no_llm',
    });
    logStructuredMessage('router_decision_trace', {
      ...traceBase,
      routeSource: result.source,
      intent: result.intent,
      confidence: result.confidence,
      result: result.decisionPath,
      fallbackReason: result.fallbackReason,
    });
    return result;
  }

  const cacheScope = options.cacheScope || 'global';
  const cacheKey = buildCacheKey(cacheScope, trimmed);
  const cached = getCache(cacheKey);
  if (cached) {
    const withDefaults = applyPeriodDefaults(cached, trimmed);
    logStructuredMessage('llm_router_skipped', {
      ...traceBase,
      routeSource: withDefaults.source,
      intent: withDefaults.intent,
      confidence: withDefaults.confidence,
      result: 'cache_hit',
      fallbackReason: 'cache_hit',
    });
    logStructuredMessage('router_decision_trace', {
      ...traceBase,
      routeSource: withDefaults.source,
      intent: withDefaults.intent,
      confidence: withDefaults.confidence,
      result: withDefaults.decisionPath || 'llm',
      fallbackReason: 'cache_hit',
    });
    return withDefaults;
  }

  const llmStartedAt = Date.now();
  let didTimeout = false;

  const timeoutPromise = new Promise<ClassifiedIntent>((resolve) => {
    setTimeout(() => {
      didTimeout = true;
      resolve({
        intent: 'desconhecido',
        entities: {},
        normalizedEntities: {},
        confidence: 'low',
        meta: {
          model: 'gemini-2.5-flash-lite',
          timeout: true,
          fallbackReason: 'timeout',
        },
      });
    }, Math.max(400, config.llmRouter.timeoutMs));
  });

  const classified = await Promise.race([
    classifyIntentCompact(trimmed, history, {
      maxInputChars: config.llmRouter.maxInputChars,
      maxHistoryItems: config.llmRouter.historyItems,
      maxHistoryChars: config.llmRouter.historyChars,
      maxOutputTokens: config.llmRouter.maxOutputTokens,
    }),
    timeoutPromise,
  ]);

  const durationMs = Date.now() - llmStartedAt;

  if (didTimeout) {
    logStructuredMessage('llm_router_timeout', {
      ...traceBase,
      routeSource: 'rule',
      result: 'timeout',
      durationMs,
      fallbackReason: 'timeout',
    });
  }

  let routed: RoutedIntent = {
    ...classified,
    source: didTimeout ? 'rule' : 'llm',
    decisionPath: didTimeout ? 'fallback' : (candidates.length > 0 ? 'rule_weak_llm' : 'llm'),
    candidates: classified.intent === 'desconhecido' ? candidates : [],
    fallbackReason: didTimeout ? 'llm_timeout' : classified.meta?.fallbackReason,
  };

  if (routed.intent === 'desconhecido' && candidates.length > 0) {
    routed.confidence = 'low';
  }

  if (didTimeout && candidates.length === 1) {
    routed.intent = candidates[0];
    routed.confidence = 'medium';
    routed.entities = {};
    routed.normalizedEntities = {};
  }

  routed = applyPeriodDefaults(routed, trimmed);

  logStructuredMessage('llm_router_called', {
    ...traceBase,
    routeSource: routed.source,
    intent: routed.intent,
    confidence: routed.confidence,
    result: didTimeout ? 'timeout' : 'success',
    durationMs,
    fallbackReason: routed.fallbackReason,
  });

  logStructuredMessage('router_decision_trace', {
    ...traceBase,
    routeSource: routed.source,
    intent: routed.intent,
    confidence: routed.confidence,
    result: routed.decisionPath,
    fallbackReason: routed.fallbackReason,
  });

  if (!didTimeout) {
    setCache(cacheKey, routed);
  }

  return routed;
}
