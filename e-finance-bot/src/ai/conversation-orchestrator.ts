/**
 * Conversation Orchestrator (AI-S2) — núcleo LLM-first.
 *
 * Fluxo:
 *   fast-path? → se sim, resposta determinística (zero LLM)
 *   kill-switch global? → fallback pipeline antiga
 *   ai_enabled do tenant? → resposta fixa se desligado
 *   budget excedido? → resposta fixa (BR-BOT-008)
 *   monta system prompt (por tenant) → chama Gemini com tools do papel
 *     LLM responde texto → retorna
 *     LLM chama tool → valida role → executa handler → feed result back
 *     limite iteração 3 atingido → erro
 *     timeout 20s → erro
 *
 * Defense in depth:
 *   - prompt-guard ANTES do LLM (reforça BR-BOT-004)
 *   - policy-engine no tool execution (reforça BR-BOT-001)
 *   - budget-guard antes de cada chamada LLM (BR-BOT-008)
 */

import { config } from '../config';
import { getGeminiClient, hasGeminiClient } from '../infra/runtime-clients';
import { logStructuredMessage } from '../observability/logger';
import type { Session } from '../session/session-manager';
import type { ActionCapability } from '../assistant/contracts';
import {
  buildSystemPrompt,
  loadTenantAiConfig,
  type TenantAiConfig,
} from './system-prompt-builder';
import { matchFastPath, formatFastPathReply } from './fast-path';
import { t } from '../i18n/messages';
import {
  getFunctionDeclarationsByRole,
  getTool,
} from './tools/registry';
import type { ToolContext, ToolOutcome } from './tools/types';

// ─── Circuit-breaker por tool (P10) ─────────────────────────────────────────
const CB_MAX_FAILS = 5;
const CB_WINDOW_MS = 60_000;
interface CircuitState { fails: number; firstFailAt: number; openUntil: number }
const circuitState = new Map<string, CircuitState>();

function circuitKey(tenantId: string, toolName: string): string {
  return `${tenantId}:${toolName}`;
}

function isCircuitOpen(tenantId: string, toolName: string): boolean {
  const entry = circuitState.get(circuitKey(tenantId, toolName));
  if (!entry) return false;
  if (Date.now() < entry.openUntil) return true;
  if (Date.now() - entry.firstFailAt > CB_WINDOW_MS) {
    circuitState.delete(circuitKey(tenantId, toolName));
    return false;
  }
  return false;
}

function recordCircuitOutcome(tenantId: string, toolName: string, ok: boolean): void {
  const key = circuitKey(tenantId, toolName);
  const now = Date.now();
  if (ok) {
    circuitState.delete(key);
    return;
  }
  const entry = circuitState.get(key) || { fails: 0, firstFailAt: now, openUntil: 0 };
  if (now - entry.firstFailAt > CB_WINDOW_MS) {
    entry.fails = 1;
    entry.firstFailAt = now;
  } else {
    entry.fails += 1;
  }
  if (entry.fails >= CB_MAX_FAILS) {
    entry.openUntil = now + CB_WINDOW_MS;
    logStructuredMessage('ai_tool_circuit_open', { tenantId, toolName, openUntil: entry.openUntil });
  }
  circuitState.set(key, entry);
}

export function __resetCircuitBreakerForTests(): void {
  circuitState.clear();
}

export interface OrchestratorInput {
  session: Session;
  userMessage: string;
  history: Array<{ role: 'user' | 'model'; text: string }>;
  hasPendingConfirmation: boolean;
  turnId: string;
}

export interface OrchestratorResult {
  reply: string;
  source: 'fast_path' | 'llm' | 'budget_blocked' | 'ai_disabled' | 'kill_switch' | 'error';
  toolCalls: Array<{ name: ActionCapability; args: Record<string, unknown>; outcome: ToolOutcome }>;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  estimatedCostCents: number;
}

const MODEL_FLASH = 'gemini-2.5-flash';
const MODEL_PRO = 'gemini-2.5-pro';

// Parte 10 do plano — limites rígidos
// 600 (era 300, 2026-05-03): com 28 devedores list_collection_targets já usou
// 314 tokens; folga evita reply truncada que cai na resposta genérica de erro.
const MAX_OUTPUT_TOKENS = 600;
const MAX_TOOL_ITERATIONS = 3;
const TIMEOUT_MS = 20_000;
const MAX_HISTORY_MESSAGES = 8;

// Pricing per 1M tokens (USD) — Flash
const PRICE_FLASH_IN_PER_1M = 0.075;
const PRICE_FLASH_OUT_PER_1M = 0.30;
// Pro = 16x Flash (aproximado)
const PRICE_PRO_IN_PER_1M = 1.25;
const PRICE_PRO_OUT_PER_1M = 10.00;


export function isKillSwitchActive(): boolean {
  return process.env.AI_NATIVE_KILL_SWITCH === 'true';
}

export async function runConversation(input: OrchestratorInput): Promise<OrchestratorResult> {
  const started = Date.now();
  const empty: OrchestratorResult = {
    reply: '',
    source: 'error',
    toolCalls: [],
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
    estimatedCostCents: 0,
  };

  // 1) Kill switch global
  if (isKillSwitchActive()) {
    return { ...empty, reply: t('system.kill_switch'), source: 'kill_switch', latencyMs: Date.now() - started };
  }

  const tenantId = input.session.profile?.tenant_id;
  if (!tenantId) {
    return { ...empty, reply: t('system.generic_error'), latencyMs: Date.now() - started };
  }

  const tenantConfig = await loadTenantAiConfig(tenantId);

  // 2) AI desabilitada no tenant → fallback texto fixo
  if (!tenantConfig.aiEnabled) {
    return { ...empty, reply: t('system.ai_disabled', undefined, tenantConfig.messageOverrides), source: 'ai_disabled', latencyMs: Date.now() - started };
  }

  // 3) Fast-path (NÃO conta no budget)
  const role = input.session.profile?.role ?? 'debtor';
  const fp = matchFastPath(input.userMessage);
  if (fp.matched) {
    const firstName = input.session.profile?.name?.split(/\s+/)[0];
    const reply = formatFastPathReply(fp.hit, {
      personaName: tenantConfig.personaName,
      userFirstName: firstName,
      role,
      hasPendingConfirmation: input.hasPendingConfirmation,
    }, tenantConfig.messageOverrides);
    if (reply) {
      return {
        ...empty,
        reply,
        source: 'fast_path',
        latencyMs: Date.now() - started,
      };
    }
    // reply vazia = fast-path delega para caller resolver (confirm/deny com pending)
  }

  // 4) Budget guard (BR-BOT-008)
  if (tenantConfig.currentMonthCentsSpent >= tenantConfig.monthlyBudgetCents) {
    logStructuredMessage('ai_budget_exceeded', {
      tenantId,
      spent: tenantConfig.currentMonthCentsSpent,
      budget: tenantConfig.monthlyBudgetCents,
    });
    return { ...empty, reply: t('system.budget_exceeded', undefined, tenantConfig.messageOverrides), source: 'budget_blocked', latencyMs: Date.now() - started };
  }

  // 5) Gemini disponível?
  if (!hasGeminiClient()) {
    return { ...empty, reply: t('system.generic_error'), latencyMs: Date.now() - started };
  }

  // 6) Monta system prompt + history + tools
  const systemPrompt = buildSystemPrompt({
    session: input.session,
    userMessage: input.userMessage,
    tenantConfig,
    nowBrt: new Date(),
  });

  const functionDeclarations = getFunctionDeclarationsByRole(role);
  const model = tenantConfig.modelPreference === 'pro' ? MODEL_PRO : MODEL_FLASH;
  const history = input.history.slice(-MAX_HISTORY_MESSAGES);

  const result = await runWithTimeout(
    () => runLlmLoop({
      model,
      systemPrompt,
      history,
      userMessage: input.userMessage,
      functionDeclarations,
      input,
      tenantConfig,
    }),
    TIMEOUT_MS,
  );

  const latencyMs = Date.now() - started;

  if (!result) {
    // Distinguir timeout real (>=20s) de erro upstream Gemini (curto)
    const isLikelyUpstream = latencyMs < 10_000;
    logStructuredMessage(
      isLikelyUpstream ? 'ai_orchestrator_upstream_failure' : 'ai_orchestrator_timeout',
      { tenantId, turnId: input.turnId, latencyMs },
    );
    const reply = isLikelyUpstream
      ? 'Estou com instabilidade no motor de IA agora. Pode tentar de novo em alguns segundos?'
      : 'Meu processamento demorou muito. Pode repetir ou ser mais direto?';
    return {
      ...empty,
      reply,
      latencyMs,
    };
  }

  const estimatedCostCents = estimateCostCents(result.tokensIn, result.tokensOut, tenantConfig.modelPreference);

  return {
    reply: result.reply,
    source: 'llm',
    toolCalls: result.toolCalls,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs,
    estimatedCostCents,
  };
}

interface LlmLoopInput {
  model: string;
  systemPrompt: string;
  history: Array<{ role: 'user' | 'model'; text: string }>;
  userMessage: string;
  functionDeclarations: ReturnType<typeof getFunctionDeclarationsByRole>;
  input: OrchestratorInput;
  tenantConfig: TenantAiConfig;
}

interface LlmLoopOutput {
  reply: string;
  toolCalls: OrchestratorResult['toolCalls'];
  tokensIn: number;
  tokensOut: number;
}

async function runLlmLoop(args: LlmLoopInput): Promise<LlmLoopOutput> {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
    ...args.history.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: args.userMessage }] },
  ];

  const toolCalls: LlmLoopOutput['toolCalls'] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const response = await callGeminiWithRetry(args, contents);

    const usage = response.usageMetadata as Record<string, number> | undefined;
    tokensIn += usage?.promptTokenCount ?? 0;
    tokensOut += usage?.candidatesTokenCount ?? 0;

    const functionCalls = extractFunctionCalls(response);

    if (functionCalls.length === 0) {
      const text = (response.text ?? '').trim();
      if (!text) {
        const candidate = (response as { candidates?: Array<{ finishReason?: string }> }).candidates?.[0];
        logStructuredMessage('ai_orchestrator_empty_reply', {
          tenantId: args.tenantConfig.tenantId,
          model: args.model,
          finishReason: candidate?.finishReason ?? 'unknown',
          promptTokens: usage?.promptTokenCount ?? 0,
          candidateTokens: usage?.candidatesTokenCount ?? 0,
          thoughtsTokens: usage?.thoughtsTokenCount ?? 0,
          iter,
        });
        return { reply: t('system.generic_error'), toolCalls, tokensIn, tokensOut };
      }
      return { reply: text, toolCalls, tokensIn, tokensOut };
    }

    // P8: Serializar mutations (não pode haver race), paralelizar queries.
    const queryCalls: typeof functionCalls = [];
    const mutationCalls: typeof functionCalls = [];
    for (const call of functionCalls) {
      const def = getTool(call.name as ActionCapability);
      if (def && def.kind === 'mutation') {
        mutationCalls.push(call);
      } else {
        queryCalls.push(call);
      }
    }

    const queryResults = await Promise.all(
      queryCalls.map(async (call) => {
        const outcome = await executeTool(call.name, call.args, args.input);
        toolCalls.push({ name: call.name as ActionCapability, args: call.args, outcome });
        return { call, outcome };
      }),
    );
    const mutationResults: Array<{ call: { name: string; args: Record<string, unknown> }; outcome: ToolOutcome }> = [];
    for (const call of mutationCalls) {
      const outcome = await executeTool(call.name, call.args, args.input);
      toolCalls.push({ name: call.name as ActionCapability, args: call.args, outcome });
      mutationResults.push({ call, outcome });
    }

    const toolResults = [...queryResults, ...mutationResults];

    // P1: Se alguma tool retornou preview (confirmação pendente registrada) ou
    // mutation_applied, paramos imediatamente e devolvemos a resposta ao usuário.
    // O LLM NÃO deve seguir chamando tools depois de preview/mutation_applied.
    const previewResult = toolResults.find(r => r.outcome.kind === 'preview');
    if (previewResult && previewResult.outcome.kind === 'preview') {
      return { reply: previewResult.outcome.preview, toolCalls, tokensIn, tokensOut };
    }
    const mutationApplied = mutationResults.find(r => r.outcome.kind === 'mutation_applied');
    if (mutationApplied && mutationApplied.outcome.kind === 'mutation_applied') {
      return { reply: mutationApplied.outcome.summary, toolCalls, tokensIn, tokensOut };
    }

    // Adiciona ao histórico: resposta do modelo (function calls) + resultados
    contents.push({
      role: 'model',
      parts: functionCalls.map(c => ({ functionCall: { name: c.name, args: c.args } })),
    });
    contents.push({
      role: 'user',
      parts: toolResults.map(({ call, outcome }) => ({
        functionResponse: {
          name: call.name,
          response: serializeOutcome(outcome),
        },
      })),
    });
  }

  // Estourou MAX_TOOL_ITERATIONS
  logStructuredMessage('ai_orchestrator_max_iterations', {
    tenantId: args.tenantConfig.tenantId,
    turnId: args.input.turnId,
  });
  return {
    reply: 'Consegui algumas informações, mas preciso que você seja mais específico. O que exatamente você quer saber?',
    toolCalls,
    tokensIn,
    tokensOut,
  };
}

function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // 503 UNAVAILABLE, 429 RESOURCE_EXHAUSTED, 500 INTERNAL — transientes
  return /\b(503|429|500|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|high\s+demand|temporarily)\b/i.test(msg);
}

async function callGeminiWithRetry(
  args: LlmLoopInput,
  contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>,
): Promise<any> {
  const MAX_RETRIES = 2;
  const BASE_DELAY_MS = 800;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await getGeminiClient().models.generateContent({
        model: args.model,
        contents,
        config: {
          temperature: 0.3,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // 2026-05-03: gemini-2.5-flash em modo automático gasta thinking tokens
          // do MESMO budget de output, deixando 0 candidate tokens e caindo em
          // resposta genérica de erro. thinkingBudget=0 desliga reasoning silencioso.
          thinkingConfig: { thinkingBudget: 0 },
          systemInstruction: args.systemPrompt,
          tools: args.functionDeclarations.length > 0
            ? [{ functionDeclarations: args.functionDeclarations } as unknown as Record<string, unknown>]
            : undefined,
        },
      });
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isTransientGeminiError(err)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
        logStructuredMessage('ai_orchestrator_gemini_retry', {
          attempt: attempt + 1,
          delayMs: Math.round(delay),
          tenantId: args.tenantConfig.tenantId,
        });
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function extractFunctionCalls(
  response: unknown,
): Array<{ name: string; args: Record<string, unknown> }> {
  const r = response as { functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }> };
  if (!r?.functionCalls || !Array.isArray(r.functionCalls)) return [];
  return r.functionCalls
    .filter(c => typeof c.name === 'string')
    .map(c => ({ name: c.name as string, args: c.args ?? {} }));
}

async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  input: OrchestratorInput,
): Promise<ToolOutcome> {
  const tool = getTool(name as ActionCapability);
  if (!tool) {
    return { kind: 'error', message: `Tool ${name} não existe.`, retryable: false };
  }

  const role = input.session.profile?.role ?? 'debtor';
  if (!tool.rolesAllowed.includes(role)) {
    logStructuredMessage('ai_tool_denied_by_role', { tool: name, role, turnId: input.turnId });
    return { kind: 'error', message: 'Você não tem permissão para essa operação.', retryable: false };
  }

  const parsed = tool.inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      kind: 'error',
      message: `Argumentos inválidos para ${name}: ${parsed.error.message}`,
      retryable: false,
    };
  }

  const tenantId = input.session.profile?.tenant_id ?? '';

  // P10: Circuit-breaker — fail-fast se tool quebrou repetidamente
  if (isCircuitOpen(tenantId, name)) {
    logStructuredMessage('ai_tool_circuit_blocked', { tool: name, tenantId, turnId: input.turnId });
    return {
      kind: 'error',
      message: 'Operação temporariamente indisponível. Tente daqui a um minuto.',
      retryable: true,
    };
  }

  const ctx: ToolContext = {
    session: input.session,
    tenantId,
    userId: input.session.profile?.id,
    role,
    companyId: null,
    turnId: input.turnId,
    now: new Date(),
  };

  try {
    const outcome = await tool.handler(parsed.data, ctx);
    recordCircuitOutcome(tenantId, name, outcome.kind !== 'error');
    return outcome;
  } catch (err) {
    recordCircuitOutcome(tenantId, name, false);
    logStructuredMessage('ai_tool_execution_failed', {
      tool: name,
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'error', message: 'Problema ao executar a operação.', retryable: true };
  }
}

function serializeOutcome(outcome: ToolOutcome): Record<string, unknown> {
  switch (outcome.kind) {
    case 'text':
      return { status: 'ok', text: outcome.text };
    case 'data':
      return { status: 'ok', summary: outcome.summary, data: truncateData(outcome.data) };
    case 'preview':
      return {
        status: 'preview',
        preview: outcome.preview,
        confirmation_id: outcome.confirmationId,
        note: 'Pergunte ao usuário "Confirma?" antes de executar.',
      };
    case 'mutation_applied':
      return { status: 'applied', summary: outcome.summary };
    case 'error':
      return { status: 'error', message: outcome.message, retryable: outcome.retryable };
  }
}

function truncateData(data: unknown): unknown {
  if (Array.isArray(data)) return data.slice(0, 10);
  if (typeof data === 'string') return data.slice(0, 500);
  return data;
}

function estimateCostCents(tokensIn: number, tokensOut: number, pref: 'flash' | 'pro'): number {
  const pIn = pref === 'pro' ? PRICE_PRO_IN_PER_1M : PRICE_FLASH_IN_PER_1M;
  const pOut = pref === 'pro' ? PRICE_PRO_OUT_PER_1M : PRICE_FLASH_OUT_PER_1M;
  const usd = (tokensIn / 1_000_000) * pIn + (tokensOut / 1_000_000) * pOut;
  return Math.ceil(usd * 100 * 100) / 100; // cents, 2 casas decimais
}

function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    fn().then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          logStructuredMessage('ai_orchestrator_internal_error', {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
          });
          resolve(null);
        }
      },
    );
  });
}

// Silence unused import warning — config is reserved for future token limits
void config;
