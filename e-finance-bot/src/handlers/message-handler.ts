import { analyzeImage, NormalizedEntities, inferInstallmentMonth } from '../ai/intent-classifier';
import { AudioTranscriptResult, transcribeAudioDetailed } from '../ai/audio-pipeline';
import {
  getOrCreateSession, updateSessionContext, clearSessionContext,
  linkProfileToSession, saveMessage, getRecentMessages, Session,
  syncSessionProfileFromChannelBinding, getProfileByChannelBinding,
} from '../session/session-manager';
import {
  getDashboardSummary, getInstallments, getInstallmentsToday, getDebtorsToCollectToday,
  getInstallmentsInWindow, getDebtorsToCollectInWindow, buildDateWindow,
  generateMonthlyReport, parseContractTextWithMeta, createContract,
  markInstallmentPaid, searchUser, getUserDebtDetails, generateInvite,
  validateLinkCode, disconnectBot, formatCurrency, formatDate,
  ContractDraft, DebtorToCollect, getContractOpenInstallments,
  getContractOpenInstallmentByNumber, normalizeCpf, isValidCpf,
  getInstallmentByDebtorAndMonth, extractDebtorNameSimple,
  extractAmount, extractRate, extractInstallments,
} from '../actions/admin-actions';
import { logStructuredMessage } from '../observability/logger';
import { estimateCostUsd } from '../observability/cost-estimator';
import { config } from '../config';
import type { LinkValidationResult, ContractOpenInstallment } from '../actions/admin-actions';
import { detectPromptInjectionAttempt, sanitizeUserText } from '../security/prompt-guard';
import { renderConversationalReply } from '../ai/response-generator';
import { getFollowupFromTenantConfig } from '../assistant/followup-question-generator';
import { getBotTenantConfig, checkWhitelistBlock } from '../actions/bot-config-actions';
import { understandCommand } from '../assistant/command-understanding';
import { createActionPlan } from '../assistant/action-planner';
import { resolveFollowup } from '../assistant/followup-resolver';
import { getWorkingState, patchWorkingState } from '../assistant/working-state-store';
import { clearPendingConfirmation, getPendingConfirmationState, parseConfirmationReply } from '../assistant/confirmation-store';
import { executeActionPlan } from '../assistant/tool-executor';
import { runPolicyCheck } from '../assistant/policy-engine';
import type { ActionPlan, CommandUnderstanding } from '../assistant/contracts';
import { formatCobrancaList, formatReceivablesList, formatComprovante, formatRelatorioCompleto, formatContractConfirmationMessage, formatContractCreatedMessage } from '../tools/formatters';

export interface IncomingMessage {
  messageId: string;
  messageIds?: string[];
  channel: 'whatsapp' | 'telegram';
  channelUserId: string;
  senderName: string;
  text?: string;
  audioBuffer?: Buffer;
  audioMimeType?: string;
  audioDurationSec?: number;
  audioSizeBytes?: number;
  audioKind?: 'voice_note' | 'audio_file';
  imageBuffer?: Buffer;
  imageMimeType?: string;
}

export interface OutgoingMessage {
  text: string;
}

function getWelcomeMessage(name: string, role: string): string {
  if (role === 'debtor') {
    return `Oi ${name}! Sou o Salomão, seu assistente financeiro.\n\nPosso mostrar suas *parcelas*, *saldo devedor* e *proximos vencimentos*.\n\nO que deseja saber?`;
  }
  if (role === 'investor') {
    return `Oi ${name}! Sou o Salomão, seu assistente de carteira.\n\nPosso mostrar seus *contratos*, *recebiveis* e *rendimentos*.\n\nO que deseja saber?`;
  }
  return `Oi ${name}! Sou o Salomão, assistente do Juros Certo.\n\nPode falar comigo naturalmente para ver dashboard, recebiveis, criar contrato, baixar pagamento, buscar cliente ou pedir relatorio.\n\nMe conta o que voce precisa agora.`;
}

const NOT_LINKED_MSG = `Para te atender com seus dados, preciso vincular este chat a sua conta no Juros Certo.

Gere o codigo em Dashboard web -> Configuracoes -> Conectar WhatsApp/Telegram e me envie aqui.`;

const PROMPT_INJECTION_BLOCK_MSG =
  'Por segurança, não posso seguir comandos para ignorar regras, revelar prompts ou acessar segredos.\n\n'
  + 'Posso ajudar com ações do Juros Certo: *dashboard*, *recebíveis*, *criar contrato*, *marcar pagamento*, *relatório* e *convite*.\n\n'
  + 'Me diga o que você precisa fazer no sistema.';

const CPF_REQUIRED_MSG =
  'Para criar contrato com segurança, preciso do *CPF do devedor* (11 dígitos).\n\n'
  + 'Exemplo: *529.982.247-25*';

function getAudioPreview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const preview = compact.length > config.audio.previewChars
    ? `${compact.slice(0, config.audio.previewChars).trimEnd()}...`
    : compact;
  return `Entendi do áudio: "${preview}"`;
}

function shouldPrependAudioPreview(response: string): boolean {
  return /^Vou criar o seguinte contrato:/i.test(response)
    || /^Confirma a baixa desta parcela\?/i.test(response)
    || /Confirma\?\s*\(sim\/n[aã]o\)/i.test(response);
}

function prependAudioPreview(response: string, transcript?: string): string {
  if (!transcript || !shouldPrependAudioPreview(response)) return response;
  return `${getAudioPreview(transcript)}\n\n${response}`;
}

async function withTimeout<T>(task: () => Promise<T>, timeoutMs: number, errorCode: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
  });

  try {
    return await Promise.race([task(), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getGlobalUtilityReply(text: string): { text: string; action: string } | null {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (!normalized) return null;

  if (/^(quem (e|é) voce|quem (e|é) vc)( agora)?\??$/.test(normalized)) {
    return {
      text: 'Sou o Salomão, assistente operacional do Juros Certo. Posso consultar dashboard, recebíveis, cobranças, clientes, contratos, pagamentos, relatórios e convite.',
      action: 'utility:identity',
    };
  }

  if (/^(que dia (e|é) hoje|qual (e|é) a data de hoje)( agora)?\??$/.test(normalized)) {
    const today = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Fortaleza',
    }).format(new Date());

    return {
      text: `Hoje é ${today}.`,
      action: 'utility:datetime',
    };
  }

  if (/^(me ajuda|ajuda|o que voce faz|o que vc faz|quais comandos voce faz|quais comandos vc faz)\??$/.test(normalized)) {
    return {
      text: 'Posso te ajudar com dashboard, recebíveis, cobranças do dia ou período, busca de cliente, criação de contrato, baixa de pagamento, relatório, convite e desconexão do bot.',
      action: 'utility:help',
    };
  }

  return null;
}

function getAudioValidationMessage(result: AudioTranscriptResult): string {
  if (result.quality === 'too_long') {
    return `Seu áudio passou de *${config.audio.maxDurationSec}s*.\n\nEnvie um áudio mais curto ou escreva só a ação principal com os dados mais importantes.`;
  }

  if (result.quality === 'unsupported') {
    return 'Não consegui abrir esse formato de áudio.\n\nEnvie como *nota de voz*, *OGG*, *MP3*, *M4A* ou *WAV*.';
  }

  if (result.quality === 'timeout') {
    return `O áudio demorou demais para processar.\n\nTente um áudio mais curto (até *${config.audio.maxDurationSec}s*) ou escreva só o dado principal.`;
  }

  return 'O áudio ficou pouco claro. Se preferir, envie um áudio mais curto ou escreva a ação principal.';
}

function getWeakAudioClarification(transcript: string, fallback: string): string {
  const normalized = transcript.toLowerCase();

  if (/(emprest|contrato|parcelas|todo dia|por\s+\d+)/i.test(normalized)) {
    return 'O áudio ficou parcial.\n\nPara criar o contrato, me diga só: *nome do devedor + CPF + valor principal + parcelas*.';
  }

  if (/(baixa|pagamento|parcela|quitar|janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i.test(normalized)) {
    return 'O áudio ficou parcial.\n\nPara baixar um pagamento, me diga só: *nome do devedor + mês ou número da parcela*.';
  }

  if (/(quanto|deve|d[íi]vida|saldo)/i.test(normalized)) {
    return 'O áudio ficou parcial.\n\nMe diga só o *nome* ou *CPF* do cliente que você quer consultar.';
  }

  return fallback;
}

function getLinkConflictMessage(currentProfileName: string): string {
  return 'Este chat já está vinculado à conta de *' + currentProfileName + '*.\n\n'
    + 'Para trocar de conta com segurança, desconecte primeiro no dashboard ou envie */desconectar*.';
}

function getInvalidLinkCodeMessage(): string {
  return 'Código de vinculação inválido ou expirado. Gere um novo código no dashboard web → Configurações → Assistente de Bolso.';
}

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function extractDebtorFromPaymentText(text: string): string | null {
  const normalized = text.trim();

  // "parcela de janeiro de [nome]", "de março do [nome]"
  const afterMonthMatch = normalized.match(
    /(?:janeiro|jan|fevereiro|fev|mar[cç]o|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez)\s+d[eo]s?\s+(.+?)(?:\?|!|\.)?$/i
  );
  if (afterMonthMatch?.[1]) {
    const cleaned = normalizeSearchTerm(afterMonthMatch[1]);
    if (cleaned && cleaned.length >= 2) return cleaned;
  }

  // "de [nome]" at end of text (not a month/date word)
  if (/(dar\s+baixa|registrar\s+pagamento|quitar|marcar\s+pagamento|baixar\s+pagamento)/i.test(normalized)) {
    const endMatch = normalized.match(/\bde\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{2,}?)(?:\?|!|\.)?$/i);
    if (endMatch?.[1]) {
      const candidate = endMatch[1].trim();
      if (!/^(hoje|amanha|ontem|janeiro|fevereiro|marco|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i.test(candidate)) {
        const cleaned = normalizeSearchTerm(candidate);
        if (cleaned && cleaned.length >= 2) return cleaned;
      }
    }
  }

  return null;
}

function extractLinkCodeCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[A-Za-z0-9]{6}$/.test(trimmed)) return null;

  const hasDigit = /[0-9]/.test(trimmed);
  const isAllUpper = trimmed === trimmed.toUpperCase();
  if (!hasDigit && !isAllUpper) return null;

  return trimmed.toUpperCase();
}

function extractCpfFromText(text: string): string | null {
  const directMatch = text.match(/(?:cpf\s*[:\-]?\s*)?(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i);
  if (directMatch?.[1]) {
    return normalizeCpf(directMatch[1]);
  }

  const digits = text.replace(/\D/g, '');
  if (digits.length === 11) {
    return normalizeCpf(digits);
  }

  return null;
}

interface PartialContractEntities {
  debtor_name?: string;
  debtor_cpf?: string;
  amount?: number;
  rate?: number;
  installments?: number;
}

function extractAllContractEntities(text: string): PartialContractEntities {
  const result: PartialContractEntities = {};
  const name = extractDebtorNameSimple(text);
  if (name) result.debtor_name = name;
  const cpf = extractCpfFromText(text);
  if (cpf && isValidCpf(cpf)) result.debtor_cpf = cpf;
  const amount = extractAmount(text);
  if (amount !== null) result.amount = amount;
  const rate = extractRate(text);
  if (rate !== null) result.rate = rate;
  const inst = extractInstallments(text);
  if (inst !== null) result.installments = inst;
  return result;
}

function mergeContractEntities(
  existing: Record<string, unknown>,
  incoming: PartialContractEntities,
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined && (merged[key] === undefined || merged[key] === null || merged[key] === '')) {
      merged[key] = value;
    }
  }
  return merged;
}

function getNextMissingStep(draft: Record<string, unknown>): number {
  if (!draft.debtor_name) return 1;
  if (!draft.debtor_cpf) return 11;
  if (draft.amount === undefined || draft.amount === null) return 12;
  if (draft.rate === undefined || draft.rate === null) return 13;
  if (draft.installments === undefined || draft.installments === null) return 14;
  return 2;
}

function getStepPrompt(step: number, draft: Record<string, unknown>): string {
  switch (step) {
    case 1: return 'Qual é o *nome completo do devedor*?';
    case 11: return draft.debtor_name
      ? `Certo, *${draft.debtor_name}*. Qual é o *CPF* do devedor?`
      : 'Qual é o *CPF* do devedor?';
    case 12: return 'Qual é o *valor principal* emprestado? (Ex: *R$ 5.000* ou *20 mil*)';
    case 13: return 'Qual é a *taxa de juros mensal* (% a.m.)? Se não houver juros, responda *pular*.';
    case 14: return 'Quantas *parcelas mensais*? Se for uma parcela única, responda *pular*.';
    default: return '';
  }
}

function maskCpf(cpf?: string): string {
  const normalized = normalizeCpf(cpf);
  if (!normalized) return '***.***.***-**';
  return `***.***.***-${normalized.slice(-2)}`;
}

function extractInstallmentNumberFromText(text: string): number | null {
  const installmentMatch = text.match(/parcela\s*#?\s*(\d+)/i);
  if (installmentMatch?.[1]) {
    const parsed = Number(installmentMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const onlyNumber = text.trim().match(/^(\d{1,4})$/);
  if (onlyNumber?.[1]) {
    const parsed = Number(onlyNumber[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function isShowMoreCommand(text: string): boolean {
  return /^mostrar(\s+mais)?$/i.test(text.trim());
}

interface UserSelectionCandidate {
  id: string;
  full_name: string;
  role: 'admin' | 'investor' | 'debtor';
  cpf?: string | null;
}

function normalizeSearchTerm(raw: string): string {
  return raw
    .replace(/[?!.;,]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:o|a|os|as|do|da|dos|das|de)\s+/i, '')
    .replace(/\b(?:me|mim|pra mim|para mim)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDebtorQueryFromText(text: string): string | null {
  const trimmed = text.trim();
  const patterns: RegExp[] = [
    /quanto(?:\s+que)?\s+(.+?)(?:\s+me)?\s+deve\b/i,
    /qual(?:\s+[ée])?\s+(?:a\s+)?(?:d[íi]vida|saldo(?:\s+devedor)?)\s+(?:de\s+)?(.+)$/i,
    /(?:buscar|consultar)\s+(?:devedor|usu[aá]rio|cliente)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match?.[1]) continue;
    const normalized = normalizeSearchTerm(match[1]);
    if (normalized.length >= 2) return normalized;
  }

  return null;
}

function isDebtLookupText(text: string): boolean {
  return /(quanto|d[íi]vida|saldo).*(deve|devedor)|deve\b/i.test(text);
}

function formatCandidateList(query: string, candidates: UserSelectionCandidate[]): string {
  const lines = candidates.map((candidate, index) => {
    const roleLabel = candidate.role === 'debtor' ? 'devedor' : candidate.role;
    const cpfLabel = candidate.cpf ? ` — CPF ${maskCpf(candidate.cpf)}` : '';
    return `${index + 1}. *${candidate.full_name}* (${roleLabel})${cpfLabel}`;
  });

  return `Encontrei mais de um cliente com nome parecido com *${query}*.\n\nQual deles?\n${lines.join('\n')}\n\nResponda com o *número* ou o *CPF*.`;
}

function selectCandidateFromInput(
  text: string,
  candidates: UserSelectionCandidate[]
): UserSelectionCandidate | 'ambiguous' | null {
  const trimmed = text.trim();
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= candidates.length) {
    return candidates[asNumber - 1];
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 4) {
    const byCpf = candidates.filter(candidate => {
      const normalizedCpf = normalizeCpf(candidate.cpf || '');
      if (!normalizedCpf) return false;
      if (digits.length === 11) return normalizedCpf === digits;
      return normalizedCpf.endsWith(digits);
    });

    if (byCpf.length === 1) return byCpf[0];
    if (byCpf.length > 1) return 'ambiguous';
  }

  const normalizedInput = normalizeSearchTerm(trimmed).toLowerCase();
  if (normalizedInput.length >= 2) {
    const byName = candidates.filter(candidate =>
      candidate.full_name.toLowerCase().includes(normalizedInput)
    );
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) return 'ambiguous';
  }

  return null;
}

function formatDebtorDebtMessage(
  name: string,
  debt: {
    totalDebt: number;
    pendingInstallments: number;
    nextDueDate: string | null;
    nextDueAmount: number;
    activeContracts: number;
  }
): string {
  if (debt.totalDebt <= 0 || debt.pendingInstallments <= 0) {
    return `Cliente *${name}* não possui parcelas em aberto.`;
  }

  const parcelasLabel = debt.pendingInstallments === 1 ? 'parcela pendente' : 'parcelas pendentes';
  const contratosLabel = debt.activeContracts === 1 ? 'contrato ativo' : 'contratos ativos';
  const nextInstallment = debt.nextDueDate
    ? `\nPróxima parcela: *${formatDate(debt.nextDueDate)}* (${formatCurrency(debt.nextDueAmount)})`
    : '';

  return `Cliente *${name}* tem um débito de *${formatCurrency(debt.totalDebt)}* em *${debt.pendingInstallments} ${parcelasLabel}*.` +
    `\n${debt.activeContracts} ${contratosLabel}.${nextInstallment}`;
}

const SENSITIVE_INTENTS = new Set(['criar_contrato', 'marcar_pagamento', 'desconectar']);

const INTENT_LABELS: Record<string, string> = {
  ver_dashboard: 'ver *dashboard*',
  listar_recebiveis: 'listar *recebíveis*',
  recebiveis_periodo: 'consultar *recebíveis nos próximos dias*',
  cobrar_periodo: 'consultar *cobrança nos próximos dias*',
  criar_contrato: '*criar contrato*',
  marcar_pagamento: '*marcar pagamento*',
  desconectar: '*desconectar*',
};

const INTENT_REPLY_HINT: Record<string, string> = {
  ver_dashboard: '/dashboard',
  listar_recebiveis: '/recebiveis',
  recebiveis_periodo: 'quanto vou receber nos próximos 7 dias',
  cobrar_periodo: 'quem devo cobrar nos próximos 7 dias',
  criar_contrato: 'criar contrato',
  marcar_pagamento: 'marcar pagamento',
  desconectar: '/desconectar',
};

function getCandidateClarification(candidates: string[]): string | null {
  const normalized = Array.from(new Set(candidates.filter(c => !!INTENT_LABELS[c]).slice(0, 3)));
  if (normalized.length === 0) return null;

  if (normalized.length === 1) {
    const key = normalized[0];
    return `Antes de continuar, confirma se voce quer ${INTENT_LABELS[key]}? Se for isso, pode responder *${INTENT_REPLY_HINT[key] || key}*.`;
  }

  if (normalized.length === 2) {
    const first = normalized[0];
    const second = normalized[1];
    return `Fiquei entre ${INTENT_LABELS[first]} e ${INTENT_LABELS[second]}. Qual dos dois voce quer agora?`;
  }

  return `Quero confirmar para nao executar algo errado. Voce quer ${INTENT_LABELS[normalized[0]]}, ${INTENT_LABELS[normalized[1]]} ou ${INTENT_LABELS[normalized[2]]}?`;
}

export function getClarificationMessage(
  intent: string,
  confidence: 'high' | 'medium' | 'low',
  candidates: string[] = []
): string | null {
  const candidateFirst = getCandidateClarification(candidates);

  if (intent === 'desconhecido' || confidence === 'low') {
    return candidateFirst || 'Ainda nao peguei sua intencao com seguranca. Me diga em uma frase curta o que voce quer fazer agora.';
  }

  if (SENSITIVE_INTENTS.has(intent) && confidence !== 'high') {
    return candidateFirst || `Antes de seguir, confirma se voce quer ${INTENT_LABELS[intent] || intent}?`;
  }

  return null;
}

const CAPABILITY_LABELS: Record<string, string> = {
  show_dashboard: 'ver o dashboard',
  list_receivables: 'listar recebíveis',
  query_receivables_window: 'consultar recebíveis por período',
  query_collection_window: 'consultar cobrança por período',
  query_debtor_balance: 'consultar a dívida de um cliente',
  create_contract: 'criar um contrato',
  mark_installment_paid: 'registrar um pagamento',
  disconnect_bot: 'desconectar este chat',
  help: 'ajuda',
  smalltalk_identity: 'saber quem eu sou',
  smalltalk_datetime: 'saber a data de hoje',
};

function getPlanClarificationMessage(plan: ActionPlan, understanding?: CommandUnderstanding): string | null {
  if (plan.ambiguity?.type === 'intent' && plan.ambiguity.candidates.length > 0) {
    const labels = plan.ambiguity.candidates
      .slice(0, 3)
      .map(candidate => INTENT_LABELS[candidate.id] || candidate.label);

    if (labels.length === 1) return `Quero confirmar antes de seguir. Você quer ${labels[0]}?`;
    if (labels.length === 2) return `Fiquei entre ${labels[0]} e ${labels[1]}. Qual dos dois você quer agora?`;
    return `Fiquei entre ${labels[0]}, ${labels[1]} ou ${labels[2]}. Qual caminho você quer seguir?`;
  }

  if (plan.capability === 'query_debtor_balance' && plan.missingFields.includes('debtor_name')) {
    return 'Me diga o nome ou o CPF do cliente que você quer consultar.';
  }

  if ((plan.capability === 'query_receivables_window' || plan.capability === 'query_collection_window')
    && !plan.args.time_window) {
    return 'Me diga o período que você quer consultar. Ex.: hoje, amanhã, próximos 7 dias ou próximos 2 meses.';
  }

  if (plan.confidence === 'low') {
    const capabilityLabel = CAPABILITY_LABELS[plan.capability] || 'seguir com essa ação';
    return understanding?.intent === 'desconhecido'
      ? 'Ainda não fechei sua ação com segurança. Me diga em uma frase o que você quer fazer no Juros Certo.'
      : `Ainda não fechei isso com segurança. Você quer ${capabilityLabel}?`;
  }

  return null;
}

function shouldSkipConversationalLayer(action: string): boolean {
  return action === 'prompt_injection_blocked';
}

export async function handleMessage(msg: IncomingMessage): Promise<OutgoingMessage> {
  const startedAt = Date.now();
  const telemetry = {
    channel: msg.channel,
    messageId: msg.messageId,
    sessionId: '',
    intent: 'n/a',
    confidence: 'n/a',
    routeSource: 'n/a',
    fallbackReason: 'n/a',
    action: 'none',
    result: 'success',
  };

  const latencyBreakdown = {
    routeMs: 0,
    followupMs: 0,
    policyMs: 0,
    executorMs: 0,
    naturalizeMs: 0,
    dbReadMs: 0,
    dbWriteMs: 0,
    llmMs: 0,
    presenceWaitMs: 0,
  };

  const timed = async <T>(bucket: keyof typeof latencyBreakdown, task: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      return await task();
    } finally {
      latencyBreakdown[bucket] += Date.now() - started;
    }
  };

  const saveMessageTimed = (
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    mediaType: 'text' | 'audio' | 'image' | 'document' = 'text',
    intent?: string,
  ) => timed('dbWriteMs', () => saveMessage(sessionId, role, content, mediaType, intent));

  const buildEphemeralSession = async (): Promise<Session> => {
    const profile = await timed('dbReadMs', () => withTimeout(
      () => getProfileByChannelBinding(msg.channel, msg.channelUserId),
      Math.max(3000, Math.floor(config.assistant.sessionReadTimeoutMs / 2)),
      'channel_binding_timeout',
    ));

    return {
      id: `ephemeral:${msg.channel}:${msg.channelUserId}`,
      profile_id: profile?.id || null,
      channel: msg.channel,
      channel_user_id: msg.channelUserId,
      context: {},
      profile: profile || null,
    };
  };

  const originalUserText = sanitizeUserText(msg.text || '');
  let textToProcess = originalUserText;

  const inputTextForLog = (msg.text || '').slice(0, 200);
  let responseTextForLog = '';
  let extractedArgsForLog = '';

  const llmUsage = { callCount: 0, tokensIn: 0, tokensOut: 0 };

  const finalize = async (
    text: string,
    patch: Partial<typeof telemetry> = {},
    opts: { skipLlm?: boolean } = {},
  ): Promise<OutgoingMessage> => {
    Object.assign(telemetry, patch);

    const baseText = (text || '').trim() || 'Nao consegui montar uma resposta agora.';
    if (shouldSkipConversationalLayer(String(telemetry.action || '')) || opts.skipLlm) {
      responseTextForLog = baseText.slice(0, 300);
      return { text: baseText };
    }

    const resultType = telemetry.result === 'error'
      ? 'error'
      : telemetry.result === 'clarification' || telemetry.result === 'blocked'
        ? 'clarification'
        : 'success';

    const naturalizeStartedAt = Date.now();
    const reply = await renderConversationalReply({
      userMessage: textToProcess || originalUserText || '',
      baseText,
      action: String(telemetry.action || patch.action || 'resposta'),
      result: resultType,
    });
    const naturalizeElapsed = Date.now() - naturalizeStartedAt;
    latencyBreakdown.naturalizeMs += naturalizeElapsed;
    latencyBreakdown.llmMs += naturalizeElapsed;

    if (reply.text) {
      llmUsage.callCount += 1;
      llmUsage.tokensIn += reply.tokensIn;
      llmUsage.tokensOut += reply.tokensOut;
    }

    const finalText = reply.text || baseText;
    responseTextForLog = finalText.slice(0, 300);
    return { text: finalText };
  };

  if (!msg.audioBuffer && !msg.imageBuffer) {
    const globalUtilityReply = getGlobalUtilityReply(textToProcess || originalUserText);
    if (globalUtilityReply) {
      return finalize(globalUtilityReply.text, {
        action: globalUtilityReply.action,
        result: 'success',
      });
    }
  }

  // Gate de whitelist (V21) — apenas WhatsApp (Telegram usa chat IDs numéricos)
  if (msg.channel === 'whatsapp') {
    const whitelistCheck = await checkWhitelistBlock(msg.channelUserId);
    if (whitelistCheck.blocked) {
      logStructuredMessage('whitelist_blocked', {
        channel: msg.channel,
        messageId: msg.messageId,
        result: 'dropped',
        reason: whitelistCheck.reason,
      });
      return finalize('', { action: 'whitelist_blocked', result: 'blocked' });
    }
  }

  try {
    let session: Session;
    let syncResult: Awaited<ReturnType<typeof syncSessionProfileFromChannelBinding>> | null = null;
    let sessionMode: 'persistent' | 'ephemeral' = 'persistent';

    try {
      let lastSessionError: Error | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          session = await timed('dbReadMs', () => withTimeout(
            () => getOrCreateSession(msg.channel, msg.channelUserId),
            config.assistant.sessionReadTimeoutMs,
            'session_get_timeout',
          ));
          lastSessionError = null;
          break;
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'session_get_timeout') throw error;
          lastSessionError = error;
          logStructuredMessage('session_get_retry', {
            channel: msg.channel,
            messageId: msg.messageId,
            result: attempt === 0 ? 'retrying' : 'failed',
            reason: error.message,
          });
          if (attempt === 0) {
            await wait(250);
            continue;
          }
        }
      }

      if (lastSessionError) {
        throw lastSessionError;
      }

      syncResult = await timed('dbReadMs', () => withTimeout(
        () => syncSessionProfileFromChannelBinding(session),
        config.assistant.sessionReadTimeoutMs,
        'session_sync_timeout',
      ));
      session = syncResult.session;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'session_get_timeout') throw error;
      session = await buildEphemeralSession();
      sessionMode = 'ephemeral';
      logStructuredMessage('session_fallback_activated', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        reason: 'session_get_timeout',
        result: session.profile ? 'profile_resolved' : 'unlinked',
      });
    }

    telemetry.sessionId = session.id;

    if (syncResult?.changed) {
      logStructuredMessage('session_profile_sync', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        oldProfileId: syncResult.oldProfileId,
        newProfileId: syncResult.newProfileId,
        reason: syncResult.reason,
        result: 'success',
      });
    }

    if (sessionMode === 'ephemeral') {
      logStructuredMessage('session_mode_selected', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        result: 'ephemeral',
      });
    }

    let audioTranscript: AudioTranscriptResult | null = null;
    if (msg.audioBuffer && msg.audioMimeType) {
      const audioSizeBytes = msg.audioSizeBytes || msg.audioBuffer.length;
      logStructuredMessage('audio_received', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        mimeType: msg.audioMimeType,
        audioKind: msg.audioKind,
        durationSec: msg.audioDurationSec,
        sizeBytes: audioSizeBytes,
        result: 'received',
      });

      logStructuredMessage('audio_transcription_started', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        mimeType: msg.audioMimeType,
        audioKind: msg.audioKind,
        durationSec: msg.audioDurationSec,
        sizeBytes: audioSizeBytes,
        result: 'started',
      });

      audioTranscript = await timed('llmMs', () => transcribeAudioDetailed({
        audioBuffer: msg.audioBuffer!,
        mimeType: msg.audioMimeType!,
        durationSec: msg.audioDurationSec,
        sizeBytes: audioSizeBytes,
        audioKind: msg.audioKind,
      }));

      if (audioTranscript.quality === 'too_long' || audioTranscript.quality === 'unsupported') {
        telemetry.result = 'clarification';
        telemetry.action = 'audio_validation_rejected';
        logStructuredMessage('audio_validation_rejected', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          mimeType: msg.audioMimeType,
          audioKind: msg.audioKind,
          durationSec: msg.audioDurationSec,
          sizeBytes: audioSizeBytes,
          usedFilesApi: audioTranscript.usedFilesApi,
          transcriptionMs: audioTranscript.durationMs,
          result: audioTranscript.quality,
          reason: audioTranscript.reason,
        });
        return finalize(getAudioValidationMessage(audioTranscript), {
          action: 'audio_validation_rejected',
          result: 'clarification',
        });
      }

      if (audioTranscript.quality === 'timeout') {
        telemetry.result = 'clarification';
        telemetry.action = 'audio_transcription_timeout';
        logStructuredMessage('audio_transcription_failed', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          mimeType: msg.audioMimeType,
          audioKind: msg.audioKind,
          durationSec: msg.audioDurationSec,
          sizeBytes: audioSizeBytes,
          usedFilesApi: audioTranscript.usedFilesApi,
          transcriptionMs: audioTranscript.durationMs,
          result: 'timeout',
          reason: audioTranscript.reason,
        });
        return finalize(getAudioValidationMessage(audioTranscript), {
          action: 'audio_transcription_timeout',
          result: 'clarification',
        });
      }

      if (!audioTranscript.text.trim()) {
        telemetry.result = 'clarification';
        telemetry.action = 'transcription_failed';
        logStructuredMessage('audio_transcription_failed', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          mimeType: msg.audioMimeType,
          audioKind: msg.audioKind,
          durationSec: msg.audioDurationSec,
          sizeBytes: audioSizeBytes,
          usedFilesApi: audioTranscript.usedFilesApi,
          transcriptionMs: audioTranscript.durationMs,
          transcriptChars: 0,
          result: audioTranscript.quality,
          reason: audioTranscript.reason,
        });
        return finalize(getAudioValidationMessage(audioTranscript), {
          action: 'transcription_failed',
          result: 'clarification',
        });
      }

      if (audioTranscript.quality === 'weak') {
        const weakReply = getWeakAudioClarification(
          audioTranscript.text,
          'Não consegui entender o áudio com clareza. Pode digitar ou enviar novamente?',
        );
        logStructuredMessage('audio_weak_quality', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          mimeType: msg.audioMimeType,
          audioKind: msg.audioKind,
          result: 'weak',
        });
        await saveMessageTimed(session.id, 'user', `[áudio fraco] ${audioTranscript.text.slice(0, 60)}`, 'audio');
        await saveMessageTimed(session.id, 'assistant', weakReply);
        return { text: weakReply };
      }

      textToProcess = sanitizeUserText(audioTranscript.text);
      logStructuredMessage('audio_transcription_completed', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        mimeType: msg.audioMimeType,
        audioKind: msg.audioKind,
        durationSec: msg.audioDurationSec,
        sizeBytes: audioSizeBytes,
        usedFilesApi: audioTranscript.usedFilesApi,
        transcriptionMs: audioTranscript.durationMs,
        transcriptChars: textToProcess.length,
        result: audioTranscript.quality,
        reason: audioTranscript.reason,
      });
    }

    if (msg.imageBuffer && msg.imageMimeType) {
      const analysis = await analyzeImage(msg.imageBuffer, msg.imageMimeType);
      await saveMessageTimed(session.id, 'user', `[Imagem] ${analysis}`, 'image');
      const imageReply = `📸 *Imagem recebida:*\n\n${analysis}\n\nDeseja registrar alguma ação com base nisso?`;
      await saveMessageTimed(session.id, 'assistant', imageReply);
      return finalize(imageReply, { action: 'analyze_image' });
    }

    if (!textToProcess.trim()) {
      telemetry.result = 'clarification';
      if (audioTranscript) {
        return finalize(getAudioValidationMessage(audioTranscript), { action: 'empty_audio_message' });
      }
      return finalize('Não entendi. Pode repetir?', { action: 'empty_message' });
    }

    const userMediaType = msg.audioBuffer ? 'audio' : 'text';

    if (/^\/start$/i.test(textToProcess.trim())) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType);
      if (!session.profile) {
        await saveMessageTimed(session.id, 'assistant', NOT_LINKED_MSG);
        return finalize(NOT_LINKED_MSG, { action: 'start_not_linked' });
      }
      const welcome = getWelcomeMessage(session.profile.name || 'Usuário', session.profile.role);
      await saveMessageTimed(session.id, 'assistant', welcome);
      return finalize(welcome, { action: 'start_welcome' });
    }

    const promptGuard = detectPromptInjectionAttempt(textToProcess);
    if (promptGuard.blocked) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, 'desconhecido');
      await saveMessageTimed(session.id, 'assistant', PROMPT_INJECTION_BLOCK_MSG);
      return finalize(PROMPT_INJECTION_BLOCK_MSG, {
        action: 'guardrail:prompt_injection',
        result: 'blocked',
      });
    }

    const linkCodeCandidate = extractLinkCodeCandidate(textToProcess);
    if (linkCodeCandidate) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, 'vincular_conta');

      const linkResult: LinkValidationResult = await validateLinkCode(
        linkCodeCandidate,
        msg.channel,
        msg.channelUserId
      );

      if (linkResult.status === 'success') {
        await linkProfileToSession(session.id, linkResult.profileId);
        const resynced = await syncSessionProfileFromChannelBinding(session);
        session = resynced.session;

        const response = getWelcomeMessage(linkResult.name, session.profile?.role || 'admin');
        await saveMessageTimed(session.id, 'assistant', response);
        logStructuredMessage('link_code_success', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          action: 'link_code',
          result: 'success',
        });
        return finalize(response, { action: 'link_success', result: 'success' });
      }

      if (linkResult.status === 'already_linked_to_other_profile') {
        const response = getLinkConflictMessage(linkResult.currentProfileName);
        await saveMessageTimed(session.id, 'assistant', response);
        logStructuredMessage('link_code_conflict', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          oldProfileId: linkResult.currentProfileId,
          newProfileId: linkResult.codeProfileId,
          action: 'link_code',
          result: 'blocked',
          reason: 'already_linked_to_other_profile',
        });
        return finalize(response, { action: 'link_conflict', result: 'blocked' });
      }

      const response = linkResult.status === 'invalid_or_expired'
        ? getInvalidLinkCodeMessage()
        : '❌ Não foi possível concluir o vínculo agora. Tente novamente em instantes.';

      await saveMessageTimed(session.id, 'assistant', response);
      logStructuredMessage('link_code_failed', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        action: 'link_code',
        result: 'error',
        reason: linkResult.status === 'db_error' ? linkResult.reason : linkResult.status,
      });
      return finalize(response, {
        action: linkResult.status === 'invalid_or_expired' ? 'link_invalid' : 'link_error',
        result: linkResult.status === 'invalid_or_expired' ? 'clarification' : 'error',
      });
    }

    if (!session.profile) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType);
      await saveMessageTimed(session.id, 'assistant', NOT_LINKED_MSG);
      return finalize(NOT_LINKED_MSG, { action: 'not_linked' });
    }

    const role = session.profile.role;
    const tenantId = session.profile.tenant_id;
    const profileId = session.profile.id;
    const workingState = getWorkingState(session.context);

    const legacyExecuteIntent = async (legacyIntent: string, args: Record<string, unknown>): Promise<string> => (
      dispatchIntent(
        legacyIntent,
        args as NormalizedEntities,
        session,
        tenantId,
        profileId,
        role,
        msg.messageId,
        textToProcess,
      )
    );

    const pendingConfirmation = getPendingConfirmationState(session);
    if (pendingConfirmation && !session.context.pendingAction) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, pendingConfirmation.capability);

      const confirmationReply = parseConfirmationReply(textToProcess);
      if (confirmationReply === 'cancel') {
        await timed('dbWriteMs', () => clearPendingConfirmation(session));
        const cancelReply = 'Tudo certo, mantive como estava. Se quiser, pode me pedir outra ação.';
        await saveMessageTimed(session.id, 'assistant', cancelReply);
        return finalize(cancelReply, {
          action: `confirmation_cancelled:${pendingConfirmation.capability}`,
          result: 'clarification',
        });
      }

      if (confirmationReply !== 'confirm') {
        const waitReply = 'Se quiser seguir, responda *sim*. Se preferir parar, responda *não*.';
        await saveMessageTimed(session.id, 'assistant', waitReply);
        return finalize(waitReply, {
          action: `confirmation_wait:${pendingConfirmation.capability}`,
          result: 'clarification',
        });
      }

      const confirmedPlan: ActionPlan = {
        capability: pendingConfirmation.capability,
        confidence: 'high',
        source: 'followup',
        args: pendingConfirmation.argsSnapshot,
        missingFields: [],
        dependsOnContext: true,
        requiresConfirmation: false,
      };

      const policyResult = await timed('policyMs', async () => runPolicyCheck({
        tenantId,
        profileId,
        role,
        requestId: msg.messageId,
        channel: msg.channel,
        capability: confirmedPlan.capability,
        args: confirmedPlan.args,
        confirmed: true,
      }));

      logStructuredMessage('policy_check', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        capability: confirmedPlan.capability,
        policyResult: policyResult.allowed ? 'allowed' : 'forbidden',
        confirmationState: 'confirmed',
        idempotencyKey: policyResult.idempotencyKey,
        result: policyResult.allowed ? 'success' : 'blocked',
        reason: policyResult.reason,
      });

      await timed('dbWriteMs', () => clearPendingConfirmation(session));

      const execution = await timed('executorMs', () => executeActionPlan(
        confirmedPlan,
        {
          session,
          tenantId,
          profileId,
          role,
          requestId: msg.messageId,
          channel: msg.channel,
          confirmed: true,
        },
        { executeLegacyIntent: legacyExecuteIntent }
      ));

      if (execution.workingStatePatch && execution.audit.executor !== 'legacy-dispatch') {
        await timed('dbWriteMs', () => patchWorkingState(session, execution.workingStatePatch));
      }

      let confirmationResponse = execution.safeUserMessage;
      confirmationResponse = prependAudioPreview(confirmationResponse, audioTranscript?.text);
      await saveMessageTimed(session.id, 'assistant', confirmationResponse);
      return finalize(confirmationResponse, {
        action: `capability:${confirmedPlan.capability}`,
        result: execution.status === 'error'
          ? 'error'
          : execution.status === 'forbidden'
            ? 'blocked'
            : execution.status === 'ok'
              ? 'success'
              : 'clarification',
      });
    }

    if (session.context.pendingAction) {
      const pendingActionName = session.context.pendingAction;
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType);
      let pendingResponse = await handlePendingAction(session, textToProcess, tenantId, profileId, msg.messageId);
      if (pendingResponse === null) {
        // Wizard escape: clear context already done inside handlePendingAction, fall through to normal pipeline
        // Re-read updated session context (pendingAction cleared)
        session.context.pendingAction = undefined;
      } else {
        pendingResponse = prependAudioPreview(pendingResponse, audioTranscript?.text);
        await saveMessageTimed(session.id, 'assistant', pendingResponse);
        return finalize(pendingResponse, { action: `pending:${pendingActionName}` });
      }
    }

    const followupPlan = await timed('followupMs', async () => resolveFollowup(textToProcess, workingState));

    let understanding: CommandUnderstanding | undefined;
    let actionPlan = followupPlan;

    if (followupPlan) {
      telemetry.intent = `followup:${followupPlan.capability}`;
      telemetry.confidence = followupPlan.confidence;
      telemetry.routeSource = followupPlan.source;
      telemetry.fallbackReason = 'n/a';
      logStructuredMessage('followup_resolved', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        capability: followupPlan.capability,
        result: 'success',
      });
    } else {
      understanding = await timed('routeMs', () => understandCommand({
        text: textToProcess,
        tenantId,
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        loadHistory: async () => timed('dbReadMs', async () => {
          try {
            return await withTimeout(
              () => getRecentMessages(session.id, 8),
              config.assistant.historyReadTimeoutMs,
              'history_timeout',
            );
          } catch {
            return [];
          }
        }),
      }));

      actionPlan = createActionPlan(understanding, textToProcess, role);
      telemetry.intent = understanding.intent;
      telemetry.confidence = understanding.confidence;
      telemetry.routeSource = understanding.source;
      telemetry.fallbackReason = understanding.fallbackReason || 'n/a';
    }

    await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, telemetry.intent);

    extractedArgsForLog = JSON.stringify(actionPlan.args || {}).slice(0, 200);

    logStructuredMessage('action_plan_created', {
      channel: msg.channel,
      messageId: msg.messageId,
      sessionId: session.id,
      capability: actionPlan.capability,
      confidence: actionPlan.confidence,
      routeSource: actionPlan.source,
      result: actionPlan.missingFields.length > 0 ? 'needs_clarification' : 'ready',
    });

    const clarification = getPlanClarificationMessage(actionPlan, understanding);
    if (clarification) {
      const clarificationText = audioTranscript?.quality === 'weak'
        ? getWeakAudioClarification(textToProcess, clarification)
        : clarification;
      await timed('dbWriteMs', () => patchWorkingState(session, {
        lastAction: actionPlan.capability,
        pendingCapability: actionPlan.capability,
        pendingMissingFields: actionPlan.missingFields,
      }));
      await saveMessageTimed(session.id, 'assistant', clarificationText);
      return finalize(clarificationText, {
        action: `clarification:${actionPlan.capability}`,
        result: 'clarification',
      });
    }

    const policyResult = await timed('policyMs', async () => runPolicyCheck({
      tenantId,
      profileId,
      role,
      requestId: msg.messageId,
      channel: msg.channel,
      capability: actionPlan.capability,
      args: actionPlan.args,
      confirmed: false,
    }));

    logStructuredMessage('policy_check', {
      channel: msg.channel,
      messageId: msg.messageId,
      sessionId: session.id,
      capability: actionPlan.capability,
      policyResult: policyResult.allowed ? 'allowed' : 'forbidden',
      confirmationState: policyResult.requiresConfirmation ? 'pending' : 'not_required',
      idempotencyKey: policyResult.idempotencyKey,
      result: policyResult.allowed ? 'success' : 'blocked',
      reason: policyResult.reason,
    });

    const execution = await timed('executorMs', () => executeActionPlan(
      actionPlan,
      {
        session,
        tenantId,
        profileId,
        role,
        requestId: msg.messageId,
        channel: msg.channel,
        confirmed: false,
      },
      { executeLegacyIntent: legacyExecuteIntent }
    ));

    if (execution.workingStatePatch && execution.audit.executor !== 'legacy-dispatch') {
      await timed('dbWriteMs', () => patchWorkingState(session, execution.workingStatePatch));
    }

    logStructuredMessage('tool_execution', {
      channel: msg.channel,
      messageId: msg.messageId,
      sessionId: session.id,
      capability: actionPlan.capability,
      result: execution.status,
      actionCapability: execution.audit.capability,
    });

    let response = execution.safeUserMessage;
    response = prependAudioPreview(response, audioTranscript?.text);

    // Injetar pergunta de acompanhamento ao final (quando execução bem-sucedida)
    if (execution.status === 'ok' && session.profile?.tenant_id) {
      try {
        const tenantBotConfig = await getBotTenantConfig(session.profile.tenant_id);
        const followup = getFollowupFromTenantConfig(actionPlan.capability, tenantBotConfig);
        if (followup) {
          response = `${response}\n\n${followup}`;
        }
      } catch {
        // Não bloquear resposta por falha no follow-up
      }
    }

    await saveMessageTimed(session.id, 'assistant', response);

    // Skip response LLM for high-confidence rule-based plans with structured output
    const skipResponseLlm = actionPlan.confidence === 'high'
      && actionPlan.source === 'rule'
      && execution.status === 'ok';

    return finalize(response, {
      action: `capability:${actionPlan.capability}`,
      result: execution.status === 'error'
        ? 'error'
        : execution.status === 'forbidden'
          ? 'blocked'
          : execution.status === 'ok'
            ? 'success'
            : 'clarification',
    }, { skipLlm: skipResponseLlm });
  } catch (err) {
    console.error('[handleMessage error]', err);
    telemetry.result = 'error';
    const message = err instanceof Error && err.message === 'session_get_timeout'
      ? 'A abertura da sua sessão demorou mais do que o esperado. Tente novamente em instantes.'
      : err instanceof Error && err.message === 'session_sync_timeout'
        ? 'A validação do vínculo deste chat demorou demais. Tente novamente em instantes.'
        : '❌ Ocorreu um erro ao processar sua mensagem. Tente novamente em instantes.';
    return finalize(message, { action: 'internal_error' });
  } finally {
    const totalMs = Date.now() - startedAt;
    const presenceMode = !config.presence.enabled
      ? 'disabled'
      : msg.channel === 'telegram'
        ? 'telegram_strict'
        : (config.presence.whatsappSlowOnly ? 'whatsapp_slow_only' : 'whatsapp_strict');

    logStructuredMessage('latency_breakdown', {
      channel: telemetry.channel,
      messageId: telemetry.messageId,
      sessionId: telemetry.sessionId,
      routeMs: latencyBreakdown.routeMs,
      followupMs: latencyBreakdown.followupMs,
      policyMs: latencyBreakdown.policyMs,
      executorMs: latencyBreakdown.executorMs,
      naturalizeMs: latencyBreakdown.naturalizeMs,
      dbReadMs: latencyBreakdown.dbReadMs,
      dbWriteMs: latencyBreakdown.dbWriteMs,
      llmMs: latencyBreakdown.llmMs,
      presenceWaitMs: latencyBreakdown.presenceWaitMs,
      totalMs,
      presenceMode,
      messagePersistMode: config.messagePersistence.mode,
      result: telemetry.result,
    });

    logStructuredMessage('bot_message_processed', {
      channel: telemetry.channel,
      messageId: telemetry.messageId,
      sessionId: telemetry.sessionId,
      intent: telemetry.intent,
      confidence: telemetry.confidence,
      routeSource: telemetry.routeSource,
      fallbackReason: telemetry.fallbackReason,
      action: telemetry.action,
      result: telemetry.result,
      routeMs: latencyBreakdown.routeMs,
      followupMs: latencyBreakdown.followupMs,
      policyMs: latencyBreakdown.policyMs,
      executorMs: latencyBreakdown.executorMs,
      naturalizeMs: latencyBreakdown.naturalizeMs,
      dbReadMs: latencyBreakdown.dbReadMs,
      dbWriteMs: latencyBreakdown.dbWriteMs,
      llmMs: latencyBreakdown.llmMs,
      presenceWaitMs: latencyBreakdown.presenceWaitMs,
      presenceMode,
      messagePersistMode: config.messagePersistence.mode,
      durationMs: totalMs,
      llmCallCount: llmUsage.callCount,
      tokensInput: llmUsage.tokensIn || undefined,
      tokensOutput: llmUsage.tokensOut || undefined,
      llmModels: llmUsage.callCount > 0 ? ['gemini-2.5-flash-lite'] : undefined,
      llmSkipped: llmUsage.callCount === 0,
      estimatedCostUsd: llmUsage.tokensIn > 0 || llmUsage.tokensOut > 0
        ? estimateCostUsd(llmUsage.tokensIn, llmUsage.tokensOut)
        : undefined,
      inputText: inputTextForLog || undefined,
      responseText: responseTextForLog || undefined,
      extractedArgs: extractedArgsForLog || undefined,
    });
  }
}

async function startPaymentByContractFlow(
  session: Session,
  tenantId: string,
  messageId: string,
  contractId: number,
  installmentNumber?: number
): Promise<string> {
  logStructuredMessage('payment_by_contract_started', {
    channel: session.channel,
    messageId,
    sessionId: session.id,
    tenantId,
    contractId,
    action: 'marcar_pagamento_contrato',
    result: 'started',
  });

  if (installmentNumber) {
    const selected = await getContractOpenInstallmentByNumber(tenantId, contractId, installmentNumber);
    if (!selected) {
      return `Não encontrei parcela aberta *${installmentNumber}* no *Contrato #${contractId}*.`;
    }

    await updateSessionContext(session.id, {
      pendingAction: 'marcar_pagamento_contrato',
      pendingActionAt: new Date().toISOString(),
      pendingStep: 2,
      pendingData: {
        contractId,
        selectedInstallment: selected,
      } as unknown as Record<string, unknown>,
    });

    return formatPaymentConfirmation(selected, contractId);
  }

  const pageData = await getContractOpenInstallments(tenantId, contractId, 0, 3);
  if (pageData.items.length === 0) {
    return `✅ Nenhuma parcela em aberto no *Contrato #${contractId}*.`;
  }

  await updateSessionContext(session.id, {
    pendingAction: 'marcar_pagamento_contrato',
    pendingActionAt: new Date().toISOString(),
    pendingStep: 1,
    pendingData: {
      contractId,
      page: pageData.page,
      pageSize: pageData.pageSize,
      total: pageData.total,
      hasMore: pageData.hasMore,
      installmentsPreview: pageData.items,
    } as unknown as Record<string, unknown>,
  });

  logStructuredMessage('payment_by_contract_page', {
    channel: session.channel,
    messageId,
    sessionId: session.id,
    tenantId,
    contractId,
    result: 'success',
    page: pageData.page,
    pageSize: pageData.pageSize,
    total: pageData.total,
  });

  return formatInstallmentsForContractSelection(contractId, pageData.items, pageData.hasMore);
}

async function startPaymentByDebtorMonthFlow(
  session: Session,
  tenantId: string,
  messageId: string,
  debtorName: string,
  month: number,
  year?: number,
): Promise<string> {
  const monthLabel = MONTH_NAMES[month - 1] || String(month);

  logStructuredMessage('payment_by_debtor_month_started', {
    channel: session.channel,
    messageId,
    sessionId: session.id,
    tenantId,
    debtorName,
    month,
    year,
    action: 'marcar_pagamento_por_mes',
    result: 'started',
  });

  const result = await getInstallmentByDebtorAndMonth(tenantId, debtorName, month, year);

  if (!result) {
    return `Não encontrei parcela de *${monthLabel}* para "${debtorName}". Verifique o nome ou o mês e tente novamente.`;
  }

  if (result.installments.length > 1) {
    const lines = result.installments.map((i, idx) =>
      `${idx + 1}. Contrato #${i.contractId} — ${formatCurrency(i.amount)} — ${formatDate(i.dueDate)}`
    );
    await updateSessionContext(session.id, {
      pendingAction: 'marcar_pagamento_por_mes',
      pendingActionAt: new Date().toISOString(),
      pendingStep: 1,
      pendingData: {
        debtorName: result.debtorName,
        installments: result.installments,
      } as unknown as Record<string, unknown>,
    });
    return `Encontrei ${result.installments.length} parcelas de *${monthLabel}* para *${result.debtorName}*:\n\n${lines.join('\n')}\n\nDigite o número para escolher qual baixar.`;
  }

  const selected = result.installments[0];
  await updateSessionContext(session.id, {
    pendingAction: 'marcar_pagamento_por_mes',
    pendingActionAt: new Date().toISOString(),
    pendingStep: 2,
    pendingData: { selectedInstallment: selected } as unknown as Record<string, unknown>,
  });

  return formatPaymentConfirmation(selected, selected.contractId);
}

function resolveDaysAhead(value?: number): number {
  if (!Number.isFinite(value || NaN)) return 7;
  return Math.max(1, Math.min(60, Math.trunc(value as number)));
}

function resolveWindowStart(value?: string): 'today' | 'tomorrow' {
  return value === 'tomorrow' ? 'tomorrow' : 'today';
}

function formatDateWindow(daysAhead: number, windowStart: 'today' | 'tomorrow'): string {
  const window = buildDateWindow(daysAhead, windowStart);
  return `${formatDate(window.startDate)} a ${formatDate(window.endDate)}`;
}
async function dispatchIntent(
  intent: string,
  entities: NormalizedEntities,
  session: Session,
  tenantId: string,
  profileId: string,
  role: string,
  messageId: string,
  originalText: string
): Promise<string> {
  switch (intent) {
    case 'ajuda':
      return getHelpText(role);

    case 'confirmar':
    case 'cancelar':
      return 'Não há nenhuma ação pendente para confirmar agora. Se quiser, me peça *dashboard*, *recebíveis*, *relatório* ou *criar contrato*.';

    case 'ver_dashboard': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      logStructuredMessage('dashboard_query_mode', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        action: 'dashboard',
        result: 'direct_sql',
      });
      const summary = await getDashboardSummary(tenantId);
      logStructuredMessage('dashboard_values_computed', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        action: 'dashboard',
        result: 'success',
        receivedByPaymentMonth: summary.receivedByPaymentMonth,
        receivedByDueMonth: summary.receivedByDueMonth,
        expectedMonth: summary.expectedMonth,
        totalOverdue: summary.totalOverdue,
      });
      return formatDashboard(summary);
    }

    case 'listar_recebiveis': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const resolvedFilter: 'pending' | 'late' | 'week' | 'all' = entities.filter || 'pending';
      const installments = await getInstallments(tenantId, resolvedFilter);
      return formatInstallments(installments);
    }

    case 'criar_contrato': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';

      if (entities.debtor_name && entities.amount) {
        const draft: ContractDraft = {
          debtor_name: String(entities.debtor_name),
          debtor_cpf: normalizeCpf(entities.debtor_cpf),
          amount: Number(entities.amount),
          rate: Number(entities.rate || 0),
          installments: Number(entities.installments || 1),
          frequency: String(entities.frequency || 'monthly'),
        };

        if (!draft.debtor_cpf || !isValidCpf(draft.debtor_cpf)) {
          await updateSessionContext(session.id, {
            pendingAction: 'criar_contrato',
            pendingActionAt: new Date().toISOString(),
            pendingStep: 11,
            pendingData: draft as unknown as Record<string, unknown>,
          });
          return CPF_REQUIRED_MSG;
        }

        await updateSessionContext(session.id, {
          pendingAction: 'criar_contrato',
          pendingActionAt: new Date().toISOString(),
          pendingStep: 2,
          pendingData: draft as unknown as Record<string, unknown>,
        });
        return formatContractConfirmationMessage(draft);
      }

      // Extrai entidades do texto original para capturar dados fora de ordem
      const initialEntities = extractAllContractEntities(originalText);
      const pendingData = mergeContractEntities({}, initialEntities);
      const nextStep = getNextMissingStep(pendingData);

      if (nextStep === 2) {
        // Tudo preenchido — confirmação
        const draft: ContractDraft = {
          debtor_name: String(pendingData.debtor_name),
          debtor_cpf: String(pendingData.debtor_cpf),
          amount: Number(pendingData.amount),
          rate: Number(pendingData.rate ?? 0),
          installments: Number(pendingData.installments ?? 1),
          frequency: 'monthly',
        };
        await updateSessionContext(session.id, {
          pendingAction: 'criar_contrato',
          pendingActionAt: new Date().toISOString(),
          pendingStep: 2,
          pendingData: draft as unknown as Record<string, unknown>,
        });
        return formatContractConfirmationMessage(draft);
      }

      await updateSessionContext(session.id, {
        pendingAction: 'criar_contrato',
        pendingActionAt: new Date().toISOString(),
        pendingStep: nextStep,
        pendingData: pendingData as Record<string, unknown>,
      });
      return Object.keys(pendingData).length > 0
        ? getStepPrompt(nextStep, pendingData)
        : `Claro! ${getStepPrompt(nextStep, pendingData)}`;
    }

    case 'marcar_pagamento': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';

      if (entities.contract_id) {
        return startPaymentByContractFlow(
          session,
          tenantId,
          messageId,
          entities.contract_id,
          entities.installment_number
        );
      }

      // Fluxo por nome do devedor + mês (linguagem natural)
      const debtorNameFromText = entities.debtor_name || extractDebtorFromPaymentText(originalText);
      const monthInfo = entities.installment_month
        ? { month: entities.installment_month, year: entities.installment_year }
        : inferInstallmentMonth(originalText);

      if (debtorNameFromText && monthInfo.month) {
        return startPaymentByDebtorMonthFlow(
          session,
          tenantId,
          messageId,
          debtorNameFromText,
          monthInfo.month,
          monthInfo.year,
        );
      }

      const installments = await getInstallments(tenantId, 'pending');
      if (installments.length === 0) return 'Nenhuma parcela pendente encontrada.';
      await updateSessionContext(session.id, {
        pendingAction: 'marcar_pagamento',
        pendingActionAt: new Date().toISOString(),
        pendingStep: 1,
        pendingData: { installments: installments.slice(0, 5) as unknown as Record<string, unknown> },
      });
      return formatInstallmentsForSelection(installments.slice(0, 5));
    }

    case 'buscar_usuario': {
      const query = String(entities.debtor_name || extractDebtorQueryFromText(originalText) || '').trim();
      if (!query) return 'Qual o nome do usuário que deseja buscar?';

      const users = await searchUser(tenantId, query);
      if (users.length === 0) return `Nenhum usuário encontrado com "${query}".`;

      const debtLookup = isDebtLookupText(originalText);
      const candidates = users.map(user => ({
        id: String(user.id),
        full_name: String(user.full_name || 'Desconhecido'),
        role: user.role as UserSelectionCandidate['role'],
        cpf: (user as any).cpf || null,
      }));

      if (candidates.length > 1) {
        await updateSessionContext(session.id, {
          pendingAction: 'buscar_usuario_selecao',
          pendingActionAt: new Date().toISOString(),
          pendingStep: 1,
          pendingData: {
            query,
            candidates,
          } as unknown as Record<string, unknown>,
        });

        return formatCandidateList(query, candidates);
      }

      const selected = candidates[0];
      if (selected.role !== 'debtor') {
        return `Encontrei: 👤 *${selected.full_name}* (${selected.role}).`;
      }

      const debtDetails = await getUserDebtDetails(tenantId, selected.id);
      if (!debtLookup && debtDetails.totalDebt <= 0) {
        return `Encontrei: 👤 *${selected.full_name}* (devedor).`;
      }

      return formatDebtorDebtMessage(selected.full_name, debtDetails);
    }

    case 'gerar_convite': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const code = await generateInvite(tenantId);
      if (!code) return 'Não foi possível gerar o convite. Tente novamente.';
      return `✅ Convite gerado!\n\nCódigo: *${code}*\n\nVálido por 7 dias. Compartilhe com o novo usuário para que ele acesse o dashboard e faça o cadastro.`;
    }

    case 'recebiveis_periodo': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const daysAhead = resolveDaysAhead(entities.days_ahead);
      const windowStart = resolveWindowStart(entities.window_start);
      const window = buildDateWindow(daysAhead, windowStart);
      const installments = await getInstallmentsInWindow(tenantId, daysAhead, windowStart);

      logStructuredMessage('receivables_window_computed', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        tenantId,
        daysAhead,
        windowStart,
        startDate: window.startDate,
        endDate: window.endDate,
        result: 'success',
      });

      if (installments.length === 0) {
        return `✅ Nenhum recebivel em aberto no periodo *${formatDateWindow(daysAhead, windowStart)}*.`;
      }

      return formatReceivablesList(installments, formatDateWindow(daysAhead, windowStart));
    }

    case 'cobrar_periodo': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const daysAhead = resolveDaysAhead(entities.days_ahead);
      const windowStart = resolveWindowStart(entities.window_start);
      const window = buildDateWindow(daysAhead, windowStart);
      const debtors = await getDebtorsToCollectInWindow(tenantId, daysAhead, windowStart);

      logStructuredMessage('collection_window_computed', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        tenantId,
        daysAhead,
        windowStart,
        startDate: window.startDate,
        endDate: window.endDate,
        result: 'success',
      });

      if (debtors.length === 0) {
        return `✅ Nenhum devedor para cobranca no periodo *${formatDateWindow(daysAhead, windowStart)}*.`;
      }

      return formatCobrancaList(debtors, formatDateWindow(daysAhead, windowStart));
    }

    case 'recebiveis_hoje': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const hoje = await getInstallmentsToday(tenantId);
      if (hoje.length === 0) {
        return '✅ Nenhuma parcela vence hoje.';
      }
      return formatReceivablesList(hoje, 'hoje');
    }

    case 'cobrar_hoje': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const devedores = await getDebtorsToCollectToday(tenantId);
      if (devedores.length === 0) {
        return '✅ Nenhum devedor com vencimento hoje.';
      }
      return formatCobrancaList(devedores, 'hoje');
    }

    case 'gerar_relatorio': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const report = await generateMonthlyReport(tenantId);
      const month = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return formatRelatorioCompleto(report, month);
    }

    case 'desconectar': {
      const ok = await disconnectBot(session.channel, session.channel_user_id);
      return ok
        ? '✅ Conta desvinculada com sucesso. Até logo!\n\nPara reconectar, gere um novo código no dashboard web → Configurações → Assistente de Bolso.'
        : '❌ Erro ao desvincular. Tente novamente.';
    }

    default: {
      return 'Nao entendi com seguranca. Me diz de novo em uma frase curta o que voce quer fazer.';
    }
  }
}

async function handlePendingAction(
  session: Session,
  text: string,
  tenantId: string,
  profileId: string,
  messageId: string
): Promise<string | null> {
  const { pendingAction, pendingStep, pendingData, pendingActionAt } = session.context;

  // Camada 3 — Timeout automático: wizard travado há mais de 30 minutos
  if (pendingActionAt) {
    const ageMs = Date.now() - new Date(pendingActionAt).getTime();
    if (ageMs > 30 * 60 * 1000) {
      await clearSessionContext(session.id);
      return 'Sua ação anterior expirou. Pode começar de novo.';
    }
  }

  // Camada 1a — Cancelamento explícito
  if (/^(não|nao|cancela|cancelar|para|sair)$/i.test(text.trim())) {
    await clearSessionContext(session.id);
    return 'Ação cancelada. Pode me pedir outra coisa.';
  }

  // Camada 1b — Saudações e comandos universais: limpa wizard e cai no pipeline normal
  if (/^(oi(?:[^a-zA-Z].*)?|ol[aá](?:[^a-zA-Z].*)?|bom dia(?:[^a-zA-Z].*)?|boa tarde(?:[^a-zA-Z].*)?|boa noite(?:[^a-zA-Z].*)?|menu|ajuda|\/help|\/ajuda|\/start|\/dashboard|dashboard|resumo)$/i.test(text.trim())) {
    await clearSessionContext(session.id);
    return null; // cai no pipeline normal
  }

  // Camada 2 — Escape por intent alternativo para todos os wizards (exceto etapa de confirmação)
  const isConfirmationStep = pendingAction === 'criar_contrato' && pendingStep === 2;
  if (!isConfirmationStep) {
    const trimmed = text.trim();
    const isEscapeIntent = /cobrar\s+(?:hoje|amanhã|amanha)|quem\s+(?:devo\s+cobrar|me\s+deve|tenho\s+que\s+cobrar)|receb[ií]veis|quanto\s+(?:vou\s+)?receber|dashboard|resumo|ver\s+relat[oó]rio|quem\s+est[aá]\s+atrasad/i.test(trimmed);
    if (isEscapeIntent) {
      await clearSessionContext(session.id);
      return null;
    }
  }

  if (pendingAction === 'buscar_usuario_selecao') {
    const query = String((pendingData as any)?.query || '').trim();
    const candidates = (((pendingData as any)?.candidates || []) as UserSelectionCandidate[])
      .filter(candidate => candidate?.id && candidate?.full_name);

    if (!query || candidates.length === 0) {
      await clearSessionContext(session.id);
      return 'Contexto expirado. Pode buscar o cliente novamente.';
    }

    const selected = selectCandidateFromInput(text, candidates);
    if (selected === 'ambiguous') {
      return 'Encontrei mais de um cliente com esse nome/CPF parcial. Responda com o *número* da lista.';
    }

    if (!selected) {
      return formatCandidateList(query, candidates);
    }

    await clearSessionContext(session.id);

    if (selected.role !== 'debtor') {
      return `Encontrei: 👤 *${selected.full_name}* (${selected.role}).`;
    }

    const debtDetails = await getUserDebtDetails(tenantId, selected.id);
    return formatDebtorDebtMessage(selected.full_name, debtDetails);
  }

  if (pendingAction === 'resolver_nome_cpf') {
    const draft = pendingData?.draft as ContractDraft | undefined;
    const conflict = pendingData?.conflict as {
      existingName?: string;
      requestedName?: string;
      debtorCpf?: string;
    } | undefined;

    if (!draft || !conflict?.existingName || !conflict?.requestedName || !conflict?.debtorCpf) {
      await clearSessionContext(session.id);
      return 'Contexto expirado. Pode começar de novo.';
    }

    const normalizedText = text.trim().toLowerCase();
    const useExisting = /^(1|usar|usar\s+nome|manter|manter\s+nome|cadastrado|nome\s+cadastrado|usar\s+nome\s+cadastrado)$/i.test(normalizedText);
    const replaceName = /^(2|substituir|trocar|atualizar|atualiza|substitui|troca\s+nome)$/i.test(normalizedText);

    if (!useExisting && !replaceName) {
      return `CPF já cadastrado para *${conflict.existingName}*.\n\nDeseja:\n1) *Usar nome cadastrado*\n2) *Substituir para ${conflict.requestedName}*\n\nResponda com *1* ou *2*.`;
    }

    const renameMode = useExisting ? 'use_existing' : 'replace_existing';

    logStructuredMessage('debtor_resolution_started', {
      channel: session.channel,
      messageId,
      sessionId: session.id,
      tenantId,
      result: renameMode,
      reason: 'resolver_nome_cpf',
      debtorCpf: maskCpf(conflict.debtorCpf),
    });

    const result = await createContract(tenantId, profileId, draft, renameMode);

    if (result.status === 'conflict_name') {
      logStructuredMessage('debtor_resolution_conflict_name', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        tenantId,
        result: 'conflict',
        reason: 'resolver_nome_cpf_still_conflict',
        debtorCpf: maskCpf(result.debtorCpf),
      });
      return `Ainda há conflito de nome para o CPF informado.\n\nCPF: *${maskCpf(result.debtorCpf)}*\nNome cadastrado: *${result.existingName}*\nNome informado: *${result.requestedName}*\n\nResponda com *1* para usar o nome cadastrado ou *2* para substituir.`;
    }

    if (result.status !== 'success') {
      await clearSessionContext(session.id);
      return '❌ Erro ao criar contrato. Verifique os dados e tente novamente.';
    }

    await clearSessionContext(session.id);

    logStructuredMessage(result.debtorResolution === 'created' ? 'debtor_resolution_created' : 'debtor_resolution_reused', {
      channel: session.channel,
      messageId,
      sessionId: session.id,
      tenantId,
      result: 'success',
      debtorCpf: maskCpf(result.debtorCpf),
      renameApplied: result.renameApplied || false,
    });

    return formatContractCreatedMessage(result, draft);
  }

  if (pendingAction === 'criar_contrato') {
    if (pendingStep === 1) {
      const parsed = await parseContractTextWithMeta(text);
      logStructuredMessage('contract_parse_mode', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        action: 'criar_contrato',
        result: parsed.mode,
      });

      if (!parsed.draft) {
        logStructuredMessage('contract_parse_failed_reason', {
          channel: session.channel,
          messageId,
          sessionId: session.id,
          action: 'criar_contrato',
          result: 'failed',
          reason: parsed.reason || 'unknown',
        });
        // Extrai todos os campos possíveis do texto
        const extracted = extractAllContractEntities(text);
        const existingData = (pendingData as Record<string, unknown>) || {};
        const merged = mergeContractEntities(existingData, extracted);

        if (Object.keys(extracted).length > 0) {
          const nextStep = getNextMissingStep(merged);
          if (nextStep === 2) {
            const draft: ContractDraft = {
              debtor_name: String(merged.debtor_name),
              debtor_cpf: String(merged.debtor_cpf),
              amount: Number(merged.amount),
              rate: Number(merged.rate ?? 0),
              installments: Number(merged.installments ?? 1),
              frequency: 'monthly',
            };
            await updateSessionContext(session.id, {
              pendingAction: 'criar_contrato',
              pendingActionAt: new Date().toISOString(),
              pendingStep: 2,
              pendingData: draft as unknown as Record<string, unknown>,
            });
            return formatContractConfirmationMessage(draft);
          }
          await updateSessionContext(session.id, {
            pendingAction: 'criar_contrato',
            pendingActionAt: new Date().toISOString(),
            pendingStep: nextStep,
            pendingData: merged as Record<string, unknown>,
          });
          return getStepPrompt(nextStep, merged);
        }
        return 'Qual é o *nome completo do devedor*?';
      }

      const draft: ContractDraft = { ...parsed.draft };
      const normalizedCpf = normalizeCpf(draft.debtor_cpf);

      if (!normalizedCpf || !isValidCpf(normalizedCpf)) {
        await updateSessionContext(session.id, {
          pendingAction: 'criar_contrato',
          pendingActionAt: new Date().toISOString(),
          pendingStep: 11,
          pendingData: draft as unknown as Record<string, unknown>,
        });
        return CPF_REQUIRED_MSG;
      }

      draft.debtor_cpf = normalizedCpf;
      if (draft.due_day && !draft.start_date) {
        draft.start_date = suggestFirstInstallmentDate(draft.due_day);
      }

      await updateSessionContext(session.id, {
        pendingAction: 'criar_contrato',
        pendingActionAt: new Date().toISOString(),
        pendingStep: 2,
        pendingData: draft as unknown as Record<string, unknown>,
      });
      return formatContractConfirmationMessage(draft);
    }

    if (pendingStep === 11) {
      const partialDraft = (pendingData as any) || {};
      if (Object.keys(partialDraft).length === 0) {
        await clearSessionContext(session.id);
        return 'Contexto expirado. Pode começar de novo.';
      }

      const extractedCpf = extractCpfFromText(text);
      if (!extractedCpf || !isValidCpf(extractedCpf)) {
        // No valid CPF — accumulate any other fields provided (amount, rate, installments)
        // but protect debtor_name if already set (F7)
        const otherEntities = extractAllContractEntities(text);
        delete otherEntities.debtor_cpf; // don't store invalid CPF
        if (partialDraft.debtor_name) delete otherEntities.debtor_name; // protect existing name
        const mergedPartial = mergeContractEntities({ ...partialDraft }, otherEntities);
        const acknowledgeMsg = Object.keys(otherEntities).length > 0
          ? ` Anotei os outros dados fornecidos.`
          : '';
        await updateSessionContext(session.id, {
          pendingAction: 'criar_contrato',
          pendingActionAt: new Date().toISOString(),
          pendingStep: 11,
          pendingData: mergedPartial as Record<string, unknown>,
        });
        const cpfMsg = !extractedCpf
          ? 'CPF não reconhecido. Envie o CPF com 11 dígitos (com ou sem máscara).'
          : 'CPF inválido. Verifique os dígitos e envie novamente.';
        return `${cpfMsg}${acknowledgeMsg}`;
      }

      // Extrai campos bônus do texto
      const bonusEntities = extractAllContractEntities(text);
      const merged = mergeContractEntities({ ...partialDraft, debtor_cpf: extractedCpf }, bonusEntities);
      const nextStep = getNextMissingStep(merged);

      if (nextStep === 2) {
        const draft: ContractDraft = {
          debtor_name: String(merged.debtor_name),
          debtor_cpf: String(merged.debtor_cpf),
          amount: Number(merged.amount),
          rate: Number(merged.rate ?? 0),
          installments: Number(merged.installments ?? 1),
          frequency: 'monthly',
        };
        if ((merged as any).due_day && !draft.start_date) {
          draft.start_date = suggestFirstInstallmentDate((merged as any).due_day);
        }
        await updateSessionContext(session.id, {
          pendingAction: 'criar_contrato',
          pendingActionAt: new Date().toISOString(),
          pendingStep: 2,
          pendingData: draft as unknown as Record<string, unknown>,
        });
        return formatContractConfirmationMessage(draft);
      }

      await updateSessionContext(session.id, {
        pendingAction: 'criar_contrato',
        pendingActionAt: new Date().toISOString(),
        pendingStep: nextStep,
        pendingData: merged as Record<string, unknown>,
      });
      return getStepPrompt(nextStep, merged);
    }

    if (pendingStep === 12) {
      const partialDraft = (pendingData as any) || {};
      if (Object.keys(partialDraft).length === 0) {
        await clearSessionContext(session.id);
        return 'Contexto expirado. Pode começar de novo.';
      }

      const amountRaw = text.replace(/\s+/g, '').toLowerCase();
      const amountMatch = amountRaw.match(/r?\$?([0-9]+(?:[.,][0-9]+)?)(mil|k)?/);
      let amount: number | null = null;
      if (amountMatch) {
        const n = parseFloat(amountMatch[1].replace(',', '.'));
        const multiplier = /mil|k/.test(amountMatch[2] || '') ? 1000 : 1;
        if (Number.isFinite(n) && n > 0) amount = n * multiplier;
      }

      if (!amount) return 'Não reconheci o valor. Tente: *R$ 5.000*, *20 mil* ou *5000*.';

      // Extrai campos bônus do texto
      const bonusEntities12 = extractAllContractEntities(text);
      const merged12 = mergeContractEntities({ ...partialDraft, amount }, bonusEntities12);
      const nextStep12 = getNextMissingStep(merged12);

      if (nextStep12 === 2) {
        const draft: ContractDraft = {
          debtor_name: String(merged12.debtor_name),
          debtor_cpf: String(merged12.debtor_cpf),
          amount: Number(merged12.amount),
          rate: Number(merged12.rate ?? 0),
          installments: Number(merged12.installments ?? 1),
          frequency: 'monthly',
        };
        await updateSessionContext(session.id, {
          pendingAction: 'criar_contrato',
          pendingActionAt: new Date().toISOString(),
          pendingStep: 2,
          pendingData: draft as unknown as Record<string, unknown>,
        });
        return formatContractConfirmationMessage(draft);
      }

      await updateSessionContext(session.id, {
        pendingAction: 'criar_contrato',
        pendingActionAt: new Date().toISOString(),
        pendingStep: nextStep12,
        pendingData: merged12 as Record<string, unknown>,
      });
      return getStepPrompt(nextStep12, merged12);
    }

    if (pendingStep === 13) {
      const partialDraft = (pendingData as any) || {};
      if (Object.keys(partialDraft).length === 0) {
        await clearSessionContext(session.id);
        return 'Contexto expirado. Pode começar de novo.';
      }

      let rate = 0;
      const skipRate = /^(pula|pular|sem\s*taxa|nao|não|padrao|padrão|0)$/i.test(text.trim());
      if (!skipRate) {
        const rateMatch = text.match(/(\d+(?:[.,]\d+)?)\s*%/)
          || text.match(/(\d+(?:[.,]\d+)?)\s*(?:por\s*cento|porcento)/i)
          || text.match(/^(\d+(?:[.,]\d+)?)$/);
        if (rateMatch?.[1]) {
          const parsed = parseFloat(rateMatch[1].replace(',', '.'));
          if (Number.isFinite(parsed) && parsed >= 0) rate = parsed;
        }
      }

      // Extrai campos bônus do texto
      const bonusEntities13 = extractAllContractEntities(text);
      const merged13 = mergeContractEntities({ ...partialDraft, rate }, bonusEntities13);
      const nextStep13 = getNextMissingStep(merged13);

      if (nextStep13 === 2) {
        const draft: ContractDraft = {
          debtor_name: String(merged13.debtor_name),
          debtor_cpf: String(merged13.debtor_cpf),
          amount: Number(merged13.amount),
          rate: Number(merged13.rate ?? 0),
          installments: Number(merged13.installments ?? 1),
          frequency: 'monthly',
        };
        await updateSessionContext(session.id, {
          pendingAction: 'criar_contrato',
          pendingActionAt: new Date().toISOString(),
          pendingStep: 2,
          pendingData: draft as unknown as Record<string, unknown>,
        });
        return formatContractConfirmationMessage(draft);
      }

      await updateSessionContext(session.id, {
        pendingAction: 'criar_contrato',
        pendingActionAt: new Date().toISOString(),
        pendingStep: nextStep13,
        pendingData: merged13 as Record<string, unknown>,
      });
      return getStepPrompt(nextStep13, merged13);
    }

    if (pendingStep === 14) {
      const partialDraft = (pendingData as any) || {};
      if (Object.keys(partialDraft).length === 0) {
        await clearSessionContext(session.id);
        return 'Contexto expirado. Pode começar de novo.';
      }

      let installments = 1;
      const skipInstallments = /^(pula|pular|uma|1|padrao|padrão)$/i.test(text.trim());
      if (!skipInstallments) {
        const installMatch = text.match(/(\d{1,3})\s*(?:x|parcelas?|vezes?)?/);
        if (installMatch?.[1]) {
          const n = parseInt(installMatch[1], 10);
          if (Number.isFinite(n) && n >= 1) installments = n;
        }
      }

      // Extrai campos bônus do texto
      const bonusEntities14 = extractAllContractEntities(text);
      const merged14 = mergeContractEntities({ ...partialDraft, installments }, bonusEntities14);

      const draft: ContractDraft = {
        debtor_name: String(merged14.debtor_name),
        debtor_cpf: String(merged14.debtor_cpf || ''),
        amount: Number(merged14.amount),
        rate: Number(merged14.rate ?? 0),
        installments: Number(merged14.installments ?? 1),
        frequency: 'monthly',
      };

      await updateSessionContext(session.id, {
        pendingAction: 'criar_contrato',
        pendingActionAt: new Date().toISOString(),
        pendingStep: 2,
        pendingData: draft as unknown as Record<string, unknown>,
      });
      return formatContractConfirmationMessage(draft);
    }

    if (pendingStep === 2) {
      if (/^(sim|confirmo|ok|pode|isso|cria|criar|s)$/i.test(text.trim())) {
        const rawPendingDraft = (pendingData as any) || {};
        const retryCount = Number(rawPendingDraft.retryCount || 0);
        const draft = { ...rawPendingDraft } as ContractDraft;
        delete (draft as any).retryCount;

        logStructuredMessage('debtor_resolution_started', {
          channel: session.channel,
          messageId,
          sessionId: session.id,
          tenantId,
          result: 'started',
          reason: 'criar_contrato',
          debtorCpf: maskCpf(draft.debtor_cpf),
        });

        const result = await createContract(tenantId, profileId, draft, 'ask');

        if (result.status === 'conflict_name') {
          await updateSessionContext(session.id, {
            pendingAction: 'resolver_nome_cpf',
            pendingActionAt: new Date().toISOString(),
            pendingStep: 1,
            pendingData: {
              draft,
              conflict: {
                existingName: result.existingName,
                requestedName: result.requestedName,
                debtorCpf: result.debtorCpf,
              },
            } as unknown as Record<string, unknown>,
          });

          logStructuredMessage('debtor_resolution_conflict_name', {
            channel: session.channel,
            messageId,
            sessionId: session.id,
            tenantId,
            result: 'conflict',
            reason: 'cpf_name_mismatch',
            debtorCpf: maskCpf(result.debtorCpf),
          });

          return `CPF já cadastrado para *${result.existingName}*.

Deseja:
1) *Usar nome cadastrado*
2) *Substituir para ${result.requestedName}*

Responda com *1* ou *2*.`;
        }

        if (result.status !== 'success') {
          if (result.reason === 'missing_cpf' || result.reason === 'invalid_cpf') {
            await clearSessionContext(session.id);
            return '❌ Não foi possível criar contrato sem CPF válido. Recomece informando o CPF do devedor.';
          }

          const transientReasons = new Set([
            'rpc_failed',
            'lookup_failed',
            'create_failed',
            'update_failed',
            'requery_failed',
            'unexpected_exception',
          ]);
          const isTransient = transientReasons.has(result.reason);

          if (isTransient && retryCount < 1) {
            await updateSessionContext(session.id, {
              pendingAction: 'criar_contrato',
              pendingActionAt: new Date().toISOString(),
              pendingStep: 2,
              pendingData: {
                ...draft,
                retryCount: retryCount + 1,
              } as unknown as Record<string, unknown>,
            });

            return '❌ Falhou por instabilidade. Quer tentar criar o mesmo contrato agora? (sim/não)';
          }

          await clearSessionContext(session.id);
          return '❌ Erro ao criar contrato. Verifique os dados e tente novamente.';
        }

        await clearSessionContext(session.id);

        logStructuredMessage(result.debtorResolution === 'created' ? 'debtor_resolution_created' : 'debtor_resolution_reused', {
          channel: session.channel,
          messageId,
          sessionId: session.id,
          tenantId,
          result: 'success',
          debtorCpf: maskCpf(result.debtorCpf),
          renameApplied: result.renameApplied || false,
        });

        return formatContractCreatedMessage(result, pendingData as unknown as ContractDraft);
      }
      await clearSessionContext(session.id);
      return 'Criação cancelada. Pode me pedir outro contrato quando quiser.';
    }
  }

  if (pendingAction === 'marcar_pagamento_contrato') {
    const contractId = Number((pendingData as any)?.contractId || 0);
    const page = Number((pendingData as any)?.page || 0);
    const pageSize = Number((pendingData as any)?.pageSize || 3);
    const preview = ((pendingData as any)?.installmentsPreview || []) as ContractOpenInstallment[];

    if (!Number.isFinite(contractId) || contractId <= 0) {
      await clearSessionContext(session.id);
      return 'Contexto expirado. Pode começar de novo.';
    }

    if (pendingStep === 1) {
      if (isShowMoreCommand(text)) {
        const nextPage = page + 1;
        const next = await getContractOpenInstallments(tenantId, contractId, nextPage, pageSize);
        if (next.items.length === 0) {
          return 'Não há mais parcelas em aberto para mostrar. Digite o número da parcela que deseja baixar.';
        }

        await updateSessionContext(session.id, {
          pendingAction: 'marcar_pagamento_contrato',
          pendingActionAt: new Date().toISOString(),
          pendingStep: 1,
          pendingData: {
            contractId,
            page: next.page,
            pageSize: next.pageSize,
            total: next.total,
            hasMore: next.hasMore,
            installmentsPreview: next.items,
          } as unknown as Record<string, unknown>,
        });

        logStructuredMessage('payment_by_contract_page', {
          channel: session.channel,
          messageId,
          sessionId: session.id,
          tenantId,
          contractId,
          result: 'success',
          page: next.page,
          pageSize: next.pageSize,
          total: next.total,
        });

        return formatInstallmentsForContractSelection(contractId, next.items, next.hasMore);
      }

      const installmentNumber = extractInstallmentNumberFromText(text);
      if (!installmentNumber) {
        return 'Digite o *número da parcela* (ex: 2), ou *mostrar mais* para ver as próximas.';
      }

      const fromPreview = preview.find(item => item.number === installmentNumber);
      const selected = fromPreview || await getContractOpenInstallmentByNumber(tenantId, contractId, installmentNumber);
      if (!selected) {
        return `Não encontrei a parcela *${installmentNumber}* em aberto no *Contrato #${contractId}*.`;
      }

      await updateSessionContext(session.id, {
        pendingAction: 'marcar_pagamento_contrato',
        pendingActionAt: new Date().toISOString(),
        pendingStep: 2,
        pendingData: {
          contractId,
          selectedInstallment: selected,
        } as unknown as Record<string, unknown>,
      });

      return formatPaymentConfirmation(selected, contractId);
    }

    if (pendingStep === 2) {
      if (!/^(sim|confirmo|ok|pode|isso|s)$/i.test(text.trim())) {
        return 'Responda *sim* para confirmar ou *não* para cancelar.';
      }

      const selected = (pendingData as any)?.selectedInstallment as ContractOpenInstallment | undefined;
      if (!selected?.id) {
        await clearSessionContext(session.id);
        return 'Contexto expirado. Pode começar de novo.';
      }

      const success = await markInstallmentPaid(selected.id, tenantId);
      await clearSessionContext(session.id);
      if (!success) return '❌ Não foi possível marcar como pago. Tente novamente.';

      logStructuredMessage('payment_by_contract_confirmed', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        tenantId,
        contractId,
        result: 'success',
      });

      return formatComprovante({
        debtorName: selected.debtorName,
        amount: selected.amount,
        dueDate: selected.dueDate,
        paidAt: new Date().toISOString(),
        installmentNumber: selected.number,
        contractId,
      });
    }
  }

  if (pendingAction === 'marcar_pagamento') {
    if (pendingStep === 1) {
      const num = parseInt(text.trim(), 10);
      const installments = (pendingData?.installments as unknown as Array<{ id: string; debtorName: string; amount: number; dueDate?: string }>) || [];
      if (isNaN(num) || num < 1 || num > installments.length) {
        return `Digite o número da parcela (1 a ${installments.length}) ou *cancelar*.`;
      }

      const selected = installments[num - 1];
      await updateSessionContext(session.id, {
        pendingAction: 'marcar_pagamento',
        pendingActionAt: new Date().toISOString(),
        pendingStep: 2,
        pendingData: { selectedInstallment: selected } as unknown as Record<string, unknown>,
      });

      return formatPaymentConfirmation(selected);
    }

    if (pendingStep === 2) {
      if (!/^(sim|confirmo|ok|pode|isso|s)$/i.test(text.trim())) {
        return 'Responda *sim* para confirmar ou *não* para cancelar.';
      }

      const selected = pendingData?.selectedInstallment as unknown as { id?: string; debtorName?: string; amount?: number };
      if (!selected?.id || !selected.debtorName || selected.amount === undefined) {
        await clearSessionContext(session.id);
        return 'Contexto expirado. Pode começar de novo.';
      }

      const success = await markInstallmentPaid(selected.id, tenantId);
      await clearSessionContext(session.id);
      if (!success) return '❌ Não foi possível marcar como pago. Tente novamente.';
      return formatComprovante({
        debtorName: selected.debtorName ?? '',
        amount: selected.amount ?? 0,
        dueDate: (selected as any).dueDate,
        paidAt: new Date().toISOString(),
      });
    }
  }

  if (pendingAction === 'marcar_pagamento_por_mes') {
    if (pendingStep === 1) {
      const installments = ((pendingData as any)?.installments || []) as ContractOpenInstallment[];
      const num = parseInt(text.trim(), 10);
      if (isNaN(num) || num < 1 || num > installments.length) {
        return `Digite o número (1 a ${installments.length}) ou *cancelar*.`;
      }
      const selected = installments[num - 1];
      await updateSessionContext(session.id, {
        pendingAction: 'marcar_pagamento_por_mes',
        pendingActionAt: new Date().toISOString(),
        pendingStep: 2,
        pendingData: { selectedInstallment: selected } as unknown as Record<string, unknown>,
      });
      return formatPaymentConfirmation(selected, selected.contractId);
    }

    if (pendingStep === 2) {
      if (!/^(sim|confirmo|ok|pode|isso|s)$/i.test(text.trim())) {
        return 'Responda *sim* para confirmar ou *não* para cancelar.';
      }
      const selected = (pendingData as any)?.selectedInstallment as ContractOpenInstallment | undefined;
      if (!selected?.id) {
        await clearSessionContext(session.id);
        return 'Contexto expirado. Pode começar de novo.';
      }
      const success = await markInstallmentPaid(selected.id, tenantId);
      await clearSessionContext(session.id);
      if (!success) return '❌ Não foi possível marcar como pago. Tente novamente.';

      return formatComprovante({
        debtorName: selected.debtorName,
        amount: selected.amount,
        dueDate: selected.dueDate,
        paidAt: new Date().toISOString(),
        installmentNumber: selected.number,
        contractId: selected.contractId,
      });
    }
  }

  await clearSessionContext(session.id);
  return 'Contexto expirado. Pode começar de novo.';
}

// ─── Formatadores ─────────────────────────────────────────────────────────────

function formatDashboard(s: ReturnType<typeof getDashboardSummary> extends Promise<infer T> ? T : never): string {
  const receivedByPaymentMonth = s.receivedByPaymentMonth ?? s.receivedMonth;
  const receivedByDueMonth = s.receivedByDueMonth ?? s.receivedMonth;

  return `📊 *Dashboard — ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}*

💰 Recebido (pagamento no mês): *${formatCurrency(receivedByPaymentMonth)}*
🗓️ Recebido (vencimento no mês): *${formatCurrency(receivedByDueMonth)}*
📅 Esperado no mês: *${formatCurrency(s.expectedMonth)}*
⚠️ Em atraso: *${formatCurrency(s.totalOverdue)}*

📋 Contratos ativos: *${s.activeContracts}*
🔴 Com atraso: *${s.overdueContracts}*`;
}

function formatInstallments(installments: Array<{ debtorName: string; amount: number; dueDate: string; status: string; daysLate: number }>): string {
  if (installments.length === 0) return '✅ Nenhuma parcela pendente encontrada.';
  const lines = installments.map((i, idx) => {
    const late = i.daysLate > 0 ? ` *(${i.daysLate}d atrasado)*` : '';
    return `${idx + 1}. ${i.debtorName} — ${formatCurrency(i.amount)} — ${formatDate(i.dueDate)}${late}`;
  });
  return `📋 *Parcelas pendentes:*\n\n${lines.join('\n')}`;
}

function formatInstallmentsForSelection(installments: Array<{ debtorName: string; amount: number; dueDate: string }>): string {
  const lines = installments.map((i, idx) =>
    `${idx + 1}. ${i.debtorName} — ${formatCurrency(i.amount)} — ${formatDate(i.dueDate)}`
  );
  return `Qual parcela deseja marcar como paga?\n\n${lines.join('\n')}\n\nDigite o número ou *cancelar*. Depois eu peço confirmação antes de concluir.`;
}

function formatInstallmentsForContractSelection(
  contractId: number,
  installments: ContractOpenInstallment[],
  hasMore: boolean
): string {
  const lines = installments.map((item) =>
    `• Parcela ${item.number} — ${formatCurrency(item.amount)} — vence ${formatDate(item.dueDate)}`
  );

  let text = `📄 *Contrato #${contractId}* — parcelas em aberto:\n\n${lines.join('\n')}`;
  if (hasMore) {
    text += '\n\nDigite *mostrar mais* para ver as próximas.';
  }
  text += '\n\nDigite o número da parcela (ex: *2*) para escolher uma e confirmar a baixa.';
  return text;
}

function formatPaymentConfirmation(
  installment: { debtorName?: string; amount: number; dueDate?: string; number?: number },
  contractId?: number
): string {
  const dueDateLine = installment.dueDate
    ? `\n📅 Vencimento: *${formatDate(installment.dueDate)}*`
    : '';
  const contractLine = contractId ? `\n📄 Contrato: *#${contractId}*` : '';
  const installmentLine = installment.number ? `\n🔢 Parcela: *${installment.number}*` : '';

  return `Confirma a baixa desta parcela?\n\n👤 Devedor: *${installment.debtorName || 'Desconhecido'}*${contractLine}${installmentLine}\n💰 Valor: *${formatCurrency(installment.amount)}*${dueDateLine}\n\nResponda *sim* para confirmar ou *não* para cancelar.`;
}

function suggestFirstInstallmentDate(dueDay: number, baseDate: Date = new Date()): string {
  const normalizedDay = Math.max(1, Math.min(31, Math.trunc(dueDay)));

  const buildDate = (year: number, month: number) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(normalizedDay, lastDay));
  };

  const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  let candidate = buildDate(today.getFullYear(), today.getMonth());

  if (candidate <= today) {
    const nextMonth = today.getMonth() + 1;
    candidate = buildDate(today.getFullYear() + Math.floor(nextMonth / 12), nextMonth % 12);
  }

  return candidate.toISOString().split('T')[0];
}


function getHelpText(role: string): string {
  if (role === 'admin') {
    return `🤖 *Assistente Juros Certo — Comandos:*

📊 *Dashboard* — "como tá o mês?" / "resumo"
📋 *Relatório completo* — "gerar relatório"
📅 *Vence hoje* — "recebíveis de hoje"
🔴 *Cobrar hoje* — "quem tenho que cobrar hoje?"
📆 *Receber próximos dias* — "quanto vou receber nos próximos 7 dias"
📌 *Cobrar próximos dias* — "quem devo cobrar nos próximos 7 dias"
📋 *Recebíveis* — "parcelas pendentes" / "quem tá atrasado"
📝 *Criar contrato* — "cria contrato pra João, CPF 52998224725, R$5.000, 3%, 12x"
✅ *Marcar pago* — "marcar pagamento" ou "baixar contrato 123 parcela 2"
🔍 *Buscar usuário* — "quanto o Carlos deve?"
🎫 *Gerar convite* — "gera um convite"
🚪 *Desconectar* — "desconectar" ou /desconectar

Pode falar normalmente ou enviar áudio! 🎤`;
  }
  return '🤖 *Assistente Juros Certo*\n\nPosso te ajudar a consultar seus dados. Tente perguntar naturalmente!';
}
