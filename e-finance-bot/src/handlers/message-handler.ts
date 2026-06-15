import { analyzeImage, NormalizedEntities, detectComplaintFallback } from '../ai/intent-classifier';
import { t } from '../i18n/messages';
import { AudioTranscriptResult, transcribeAudioDetailed } from '../ai/audio-pipeline';
import {
  getOrCreateSession, updateSessionContext, clearSessionContext,
  linkProfileToSession, saveMessage, getRecentMessages, Session,
  syncSessionProfileFromChannelBinding, getProfileByChannelBinding,
} from '../session/session-manager';
import {
  getDashboardSummary, getInstallments, getInstallmentsToday, getDebtorsToCollectToday,
  getInstallmentsInWindow, getDebtorsToCollectInWindow, buildDateWindow,
  generateMonthlyReport,
  searchUser, getUserDebtDetails, generateInvite,
  validateLinkCode, disconnectBot, formatCurrency, formatDate,
  getContractOpenInstallments, normalizeCpf,
  listCompaniesByTenant,
} from '../actions/admin-actions';
import { logStructuredMessage } from '../observability/logger';
import { estimateCostUsd } from '../observability/cost-estimator';
import { beginTraceInPlace, getActiveTrace, enqueueTracePersist, flushTrace } from '../observability/turn-tracer';
import { config } from '../config';
import type { LinkValidationResult, ContractOpenInstallment, CompanyOption } from '../actions/admin-actions';
import { detectPromptInjectionAttempt, sanitizeUserText } from '../security/prompt-guard';
import { renderConversationalReply, generateGreeting } from '../ai/response-generator';
import { getFollowupFromTenantConfig } from '../assistant/followup-question-generator';
import { getBotTenantConfig, checkWhitelistBlock, upsertBotTenantConfig } from '../actions/bot-config-actions';
import { confirmPendingPaymentFollowup, type PendingPaymentFollowupItem } from '../scheduler/payment-followup';
import { understandCommand } from '../assistant/command-understanding';
import { createActionPlan } from '../assistant/action-planner';
import { resolveFollowup } from '../assistant/followup-resolver';
import { buildContextPack, resolveReferences } from '../assistant/reference-resolver';
import { getWorkingState, patchWorkingState } from '../assistant/working-state-store';
import { clearPendingConfirmation, getPendingConfirmationState, parseConfirmationReply } from '../assistant/confirmation-store';
import { executeActionPlan } from '../assistant/tool-executor';
import { runPolicyCheck } from '../assistant/policy-engine';
import type { ActionPlan, CommandUnderstanding, StructuredResponse } from '../assistant/contracts';
import { formatCobrancaList, formatReceivablesList, formatRelatorioCompleto } from '../tools/formatters';
import { runConversation } from '../ai/conversation-orchestrator';
import { mapErrorToUserMessage } from '../errors/bot-error';

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

function getAudioPreview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const preview = compact.length > config.audio.previewChars
    ? `${compact.slice(0, config.audio.previewChars).trimEnd()}...`
    : compact;
  return `Entendi do áudio: "${preview}"`;
}

function shouldPrependAudioPreview(response: string): boolean {
  // P6: cobrir todas operações com side-effect/confirmação E queries
  // disambíguas (escolha de devedor, parcela, empresa) — onde o usuário
  // precisa ver o que foi transcrito antes de tomar decisão.
  return /Novo contrato — confirmar/i.test(response)
    || /Baixar parcela — confirmar/i.test(response)
    || /Desconectar este chat/i.test(response)
    || /Confirma\?\s*\(sim\/n[aã]o\)/i.test(response)
    || /Responda \*sim\*/i.test(response)
    || /Encontrei mais de um/i.test(response)
    || /Encontrei estas parcelas/i.test(response)
    || /Encontrei \d+ parcelas/i.test(response)
    || /Qual deles\?/i.test(response)
    || /Empresas dispon[ií]veis:/i.test(response)
    || /taxa de juros|CPF do devedor|data da primeira parcela|dia do mês|dia da semana/i.test(response);
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

function extractLinkCodeCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[A-Za-z0-9]{6}$/.test(trimmed)) return null;

  const hasDigit = /[0-9]/.test(trimmed);
  const isAllUpper = trimmed === trimmed.toUpperCase();
  if (!hasDigit && !isAllUpper) return null;

  return trimmed.toUpperCase();
}

function maskCpf(cpf?: string): string {
  const normalized = normalizeCpf(cpf);
  if (!normalized) return '***.***.***-**';
  return `***.***.***-${normalized.slice(-2)}`;
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

function normalizeCompanyMatch(raw: string): string {
  return normalizeSearchTerm(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const COMPANY_GENERIC_TERMS = new Set([
  'empresa',
  'grupo',
  'ltda',
  'limitada',
  'sa',
  's.a',
  'me',
  'mei',
  'eireli',
  'holding',
]);

const COMPANY_INDEX_WORDS: Record<string, number> = {
  primeira: 1,
  primeiro: 1,
  um: 1,
  uma: 1,
  segunda: 2,
  segundo: 2,
  dois: 2,
  terceira: 3,
  terceiro: 3,
  tres: 3,
  quarta: 4,
  quarto: 4,
  quatro: 4,
  quinta: 5,
  quinto: 5,
  cinco: 5,
};

type CompanySelectionResult =
  | { kind: 'selected'; company: CompanyOption; matchedText?: string }
  | { kind: 'ambiguous'; candidates: CompanyOption[]; query: string }
  | { kind: 'none' };

function buildCompanyAliases(company: CompanyOption, index: number): Set<string> {
  const normalizedName = normalizeCompanyMatch(company.name);
  const aliases = new Set<string>([normalizedName]);
  const cleanedTokens = normalizedName
    .split(/\s+/)
    .filter(token => token.length >= 3 && !COMPANY_GENERIC_TERMS.has(token));

  if (cleanedTokens.length > 0) {
    aliases.add(cleanedTokens.join(' '));
    if (cleanedTokens.length === 1) {
      aliases.add(cleanedTokens[0]);
    } else {
      aliases.add(cleanedTokens[0]);
      aliases.add(cleanedTokens[cleanedTokens.length - 1]);
    }
  }

  aliases.add(`empresa ${index + 1}`);
  aliases.add(`${index + 1}`);

  if (company.isPrimary) {
    aliases.add('matriz');
    aliases.add('principal');
    aliases.add('sede');
  } else {
    aliases.add('filial');
    aliases.add('secundaria');
    aliases.add(`filial ${index + 1}`);
  }

  return aliases;
}

function getCompanyIndexHint(text: string): number | null {
  const normalized = normalizeCompanyMatch(text);
  const digitMatch = normalized.match(/\b(?:empresa|filial)?\s*(\d{1,2})\b/);
  if (digitMatch?.[1]) {
    const parsed = Number(digitMatch[1]);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
  }

  for (const [word, index] of Object.entries(COMPANY_INDEX_WORDS)) {
    if (new RegExp(`\\b(?:empresa|filial)?\\s*${word}\\b|\\b${word}\\s+empresa\\b`).test(normalized)) {
      return index;
    }
  }

  return null;
}

function resolveCompanySelectionDetailed(text: string, companies: CompanyOption[]): CompanySelectionResult {
  const trimmed = text.trim();
  const directIndex = getCompanyIndexHint(trimmed);
  if (directIndex && directIndex >= 1 && directIndex <= companies.length) {
    return { kind: 'selected', company: companies[directIndex - 1], matchedText: String(directIndex) };
  }

  const explicitName = trimmed
    .replace(/^(usar|selecionar|trocar\s+para|mudar\s+para|focar\s+na?|operar\s+na?)\s+empresa\s+/i, '')
    .replace(/^empresa\s+/i, '')
    .trim();

  const normalizedQuery = normalizeCompanyMatch(explicitName || trimmed);
  if (!normalizedQuery) return { kind: 'none' };

  const exactAliasMatches = companies.filter((company, index) => buildCompanyAliases(company, index).has(normalizedQuery));
  if (exactAliasMatches.length === 1) {
    return { kind: 'selected', company: exactAliasMatches[0], matchedText: normalizedQuery };
  }
  if (exactAliasMatches.length > 1) {
    return { kind: 'ambiguous', candidates: exactAliasMatches, query: explicitName || trimmed };
  }

  if (normalizedQuery.length < 3) return { kind: 'none' };

  const containmentMatches = companies.filter((company, index) => {
    const aliases = Array.from(buildCompanyAliases(company, index)).filter(alias => alias.length >= 3);
    return aliases.some(alias => normalizedQuery.includes(alias) || alias.includes(normalizedQuery));
  });

  if (containmentMatches.length === 1) {
    return { kind: 'selected', company: containmentMatches[0], matchedText: normalizedQuery };
  }
  if (containmentMatches.length > 1) {
    return { kind: 'ambiguous', candidates: containmentMatches, query: explicitName || trimmed };
  }

  return { kind: 'none' };
}

function isCompanyListCommand(text: string): boolean {
  return /^(quais|minhas|listar|lista|mostrar)\s+empresas\b|^empresas\b/i.test(text.trim());
}

function isCompanyClearCommand(text: string): boolean {
  return /^(todas?\s+as?\s+empresas|todas?\s+empresas|vis[aã]o\s+geral|sem\s+filtro\s+de\s+empresa)$/i.test(text.trim());
}

function isExplicitCompanySelectionCommand(text: string): boolean {
  return /^(usar|selecionar|trocar\s+para|mudar\s+para|focar\s+na?|operar\s+na?)\s+empresa\b/i.test(text.trim());
}

function formatCompanyOptions(companies: CompanyOption[], activeCompanyId?: string | null): string {
  if (companies.length === 0) {
    return 'Não encontrei empresas disponíveis para este tenant.';
  }

  const lines = companies.map((company, index) => {
    const active = company.id === activeCompanyId ? ' — *ativa*' : '';
    const primary = company.isPrimary ? ' — principal' : '';
    return `${index + 1}. *${company.name}*${active}${primary}`;
  });

  return `Empresas disponíveis:\n\n${lines.join('\n')}\n\nResponda com *usar empresa NOME* ou só o *número* para ativar. Para voltar ao consolidado do tenant, envie *todas empresas*.`;
}

function shouldAcceptCompanyCandidateReply(text: string, companies: CompanyOption[]): boolean {
  if (companies.length === 0) return false;
  if (/^\d{1,2}$/.test(text.trim())) return true;
  if (isExplicitCompanySelectionCommand(text)) return true;
  return resolveCompanySelectionDetailed(text, companies).kind !== 'none';
}

function formatCompanySelectionClarification(
  query: string,
  candidates: CompanyOption[],
  activeCompanyId?: string | null,
): string {
  return `Encontrei mais de uma empresa compatível com *${query.trim()}*.\n\n${formatCompanyOptions(candidates, activeCompanyId)}`;
}

function hasOperationalQuerySignal(text: string): boolean {
  return /(dashboard|resumo|receb[ií]veis?|receber|cobrar|cobran[cç]a|relat[oó]rio|atrasad|vence|vencimento)/i.test(text);
}

function detectInlineCompanyContext(
  text: string,
  companies: CompanyOption[],
): { mode: 'set'; company: CompanyOption; matchedText?: string } | { mode: 'clear' } | { mode: 'ambiguous'; candidates: CompanyOption[]; query: string } | null {
  const trimmed = text.trim();
  if (!hasOperationalQuerySignal(trimmed)) return null;

  if (/\b(?:de|da|do|na|no|para|em)?\s*todas?\s+as?\s+empresas\b/i.test(trimmed)) {
    return { mode: 'clear' };
  }

  const resolved = resolveCompanySelectionDetailed(trimmed, companies);
  if (resolved.kind === 'selected') {
    return { mode: 'set', company: resolved.company, matchedText: resolved.matchedText };
  }
  if (resolved.kind === 'ambiguous') {
    return { mode: 'ambiguous', candidates: resolved.candidates, query: resolved.query };
  }

  return null;
}

function stripInlineCompanyContext(
  text: string,
  selection: { mode: 'set'; company: CompanyOption; matchedText?: string } | { mode: 'clear' } | { mode: 'ambiguous'; candidates: CompanyOption[]; query: string } | null,
): string {
  if (!selection) return text;

  let stripped = text;
  if (selection.mode === 'clear') {
    stripped = stripped.replace(/\b(?:de|da|do|na|no|para|em)?\s*todas?\s+as?\s+empresas\b/gi, ' ');
  } else if (selection.mode === 'set') {
    const escapedName = selection.company.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    stripped = stripped.replace(new RegExp(`\\b(?:de|da|do|na|no|para|em)?\\s*empresa\\s+${escapedName}\\b`, 'gi'), ' ');
    if (selection.matchedText) {
      const escapedMatch = selection.matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      stripped = stripped.replace(new RegExp(`\\b(?:de|da|do|na|no|para|em)?\\s*${escapedMatch}\\b`, 'gi'), ' ');
    }
  }

  return stripped.replace(/\s+/g, ' ').trim() || text;
}

function withActiveCompanyLabel(message: string, activeCompanyLabel?: string | null): string {
  if (!activeCompanyLabel) return message;
  return `🏢 Empresa ativa: *${activeCompanyLabel}*\n\n${message}`;
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
  if ((plan.decision === 'ask_clarification' || plan.decision === 'reject') && plan.userFacingQuestion) return plan.userFacingQuestion;
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

  if (plan.confidenceLabel === 'low') {
    const capabilityLabel = CAPABILITY_LABELS[plan.capability] || 'seguir com essa ação';
    return understanding?.intent === 'desconhecido'
      ? 'Ainda não fechei sua ação com segurança. Me diga em uma frase o que você quer fazer no Juros Certo.'
      : `Ainda não fechei isso com segurança. Você quer ${capabilityLabel}?`;
  }

  return null;
}

function shouldSkipConversationalLayer(action: string): boolean {
  // Greet and help already produce conversational text — no need for a second LLM rewrite pass
  return action === 'prompt_injection_blocked'
    || action === 'capability:greet'
    || action === 'capability:help';
}

function shouldTryAiNative(tenantId: string | null | undefined): boolean {
  if (!tenantId) return false;
  if (config.aiNative.killSwitch) return false;
  if (!config.aiNative.enabled) return false;
  const allowlist = config.aiNative.tenantAllowlist;
  if (allowlist.length > 0 && !allowlist.includes(tenantId)) return false;
  return true;
}

function isPendingOperationCancel(text: string): boolean {
  return /^(não|nao|cancela|cancelar|para|sair)$/i.test(text.trim());
}

function isPendingOperationEscape(text: string): boolean {
  return /cobrar\s+(?:hoje|amanhã|amanha)|quem\s+(?:devo\s+cobrar|me\s+deve|tenho\s+que\s+cobrar)|receb[ií]veis|quanto\s+(?:vou\s+)?receber|dashboard|resumo|ver\s+relat[oó]rio|quem\s+est[aá]\s+atrasad/i.test(text.trim());
}

export async function handleMessage(msg: IncomingMessage): Promise<OutgoingMessage> {
  const startedAt = Date.now();
  const trace = beginTraceInPlace({
    channel: msg.channel,
    channel_user_id: msg.channelUserId,
    message_id: msg.messageId,
    media_type: msg.audioBuffer ? 'audio' : msg.imageBuffer ? 'image' : 'text',
    user_text: msg.text || null,
  });
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
    opts: { skipLlm?: boolean; structuredResponse?: StructuredResponse } = {},
  ): Promise<OutgoingMessage> => {
    Object.assign(telemetry, patch);

    const baseText = (text || '').trim() || 'Nao consegui montar uma resposta agora.';
    if (shouldSkipConversationalLayer(String(telemetry.action || '')) || opts.skipLlm) {
      responseTextForLog = baseText.slice(0, 300);
      getActiveTrace()?.setField('reply_text', responseTextForLog);
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
      structuredResponse: opts.structuredResponse,
    });
    const naturalizeElapsed = Date.now() - naturalizeStartedAt;
    latencyBreakdown.naturalizeMs += naturalizeElapsed;
    latencyBreakdown.llmMs += naturalizeElapsed;

    if (reply.text) {
      llmUsage.callCount += 1;
      llmUsage.tokensIn += reply.tokensIn;
      llmUsage.tokensOut += reply.tokensOut;
    }

    // BR-BOT-009: quando LLM habilitado falha/timeout, prefixar resposta crua com aviso informativo
    const llmFailed = reply.text === null && config.llmResponse.enabled;
    const finalText = reply.text
      ?? (llmFailed && baseText ? `_Estou mais lento agora, mas aqui vai:_\n\n${baseText}` : baseText);
    responseTextForLog = finalText.slice(0, 300);
    getActiveTrace()?.setField('reply_text', responseTextForLog);
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

    // Gate de whitelist (V21) — escopo por tenant para evitar bloqueio cross-tenant
    if (msg.channel === 'whatsapp') {
      const tenantId = session.profile?.tenant_id;
      const whitelistCheck = await checkWhitelistBlock(msg.channelUserId, tenantId);
      if (whitelistCheck.blocked) {
        logStructuredMessage('whitelist_blocked', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          result: 'dropped',
          reason: whitelistCheck.reason,
        });
        return { text: '' }; // silent drop — index.ts não envia respostas com text vazio
      }
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
        responseTextForLog = weakReply.slice(0, 300);
        getActiveTrace()?.setField('reply_text', responseTextForLog);
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
      return finalize(t('handler.not_understood_repeat'), { action: 'empty_message' });
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
    let workingState = getWorkingState(session.context);
    getActiveTrace()?.patch({ tenant_id: tenantId, session_id: session.id });

    // ─── AI-native gate (BR-BOT-007/008) — rollout canário ─────────────────
    // Se AI_NATIVE_ENABLED=true e tenantId permitido, tenta responder via
    // conversation-orchestrator. Se desabilitado/kill/error → fallback legado.
    // V44c — Quando há pendingConfirmation registrada (preview de mutation aguardando "sim/não"),
    // NÃO entrar no AI-native: o fluxo legacy (linha ~1552+) já sabe executar a tool com os
    // args salvos. Sem este bypass, o LLM era invocado de novo e chamava create_contract com
    // pendingContractDraft → preview duplicado → loop infinito (Guilherme 04/05 16:00 BRT).
    const earlyPending = getPendingConfirmationState(session);
    const earlyConfirmReply = earlyPending ? parseConfirmationReply(textToProcess) : null;
    const skipAiNativeForConfirmation = earlyPending && earlyConfirmReply !== null;

    if (skipAiNativeForConfirmation) {
      logStructuredMessage('ai_native_skipped_for_confirmation', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        capability: earlyPending!.capability,
        reply: earlyConfirmReply,
      });
    }

    if (shouldTryAiNative(tenantId) && !skipAiNativeForConfirmation) {
      const aiStartedAt = Date.now();
      try {
        const pending = earlyPending;
        const history = await timed('dbReadMs', async () => {
          try {
            const rows = await withTimeout(
              () => getRecentMessages(session.id, 8),
              config.assistant.historyReadTimeoutMs,
              'ai_history_timeout',
            );
            return rows
              .filter(r => typeof r.content === 'string' && r.content.length > 0)
              .map(r => ({
                role: (r.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
                text: r.content,
              }));
          } catch {
            return [] as Array<{ role: 'user' | 'model'; text: string }>;
          }
        });

        // V44b — Reinjeta draft de create_contract se aberto há <30min.
        // Sem isso, args extraídos pelo LLM (cpf, valor, parcelas, taxa) somem
        // entre turnos, porque o histórico só guarda texto — não tool calls.
        const draft = (session.context as { pendingContractDraft?: { args: Record<string, unknown>; updatedAt: string } } | undefined)?.pendingContractDraft;
        if (draft && Date.now() - new Date(draft.updatedAt).getTime() < 30 * 60 * 1000) {
          const argsLine = Object.entries(draft.args)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
            .join(', ');
          if (argsLine) {
            history.push({
              role: 'model',
              text: `[memória interna: você está coletando dados para create_contract. Já capturado: ${argsLine}. Use estes valores no próximo create_contract a menos que o usuário corrija explicitamente. NÃO peça de novo o que já está aí.]`,
            });
          }
        }

        const result = await runConversation({
          session,
          userMessage: textToProcess,
          history,
          hasPendingConfirmation: !!pending,
          turnId: msg.messageId,
        });

        // V44b — Atualiza/limpa o draft com base no outcome do create_contract
        const ccCall = result.toolCalls.find(tc => tc.name === 'create_contract');
        if (ccCall) {
          if (ccCall.outcome.kind === 'mutation_applied') {
            await updateSessionContext(session.id, { ...session.context, pendingContractDraft: undefined });
          } else if (ccCall.outcome.kind === 'error' || ccCall.outcome.kind === 'preview') {
            const merged = { ...(draft?.args ?? {}), ...ccCall.args };
            await updateSessionContext(session.id, {
              ...session.context,
              pendingContractDraft: { args: merged, updatedAt: new Date().toISOString() },
            });
          }
        }

        const aiLatency = Date.now() - aiStartedAt;
        logStructuredMessage('ai_native_turn', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          tenantId,
          source: result.source,
          reply_len: result.reply.length,
          tool_calls: result.toolCalls.length,
          tokens_in: result.tokensIn,
          tokens_out: result.tokensOut,
          cost_cents: result.estimatedCostCents,
          latency_ms: aiLatency,
        });

        getActiveTrace()?.patch({
          source: 'ai_native',
          ai_native_source: result.source,
          tool_calls: result.toolCalls.map(tc => {
            const outcome = tc.outcome;
            const summary = outcome.kind === 'text' ? outcome.text
              : outcome.kind === 'data' ? outcome.summary
              : outcome.kind === 'preview' ? outcome.preview
              : outcome.kind === 'mutation_applied' ? outcome.summary
              : outcome.kind === 'error' ? outcome.message
              : '';
            return {
              name: tc.name,
              args: tc.args,
              outcome_kind: outcome.kind,
              outcome_summary: summary ? summary.slice(0, 200) : undefined,
            };
          }),
          tokens_in: result.tokensIn || null,
          tokens_out: result.tokensOut || null,
          cost_cents: result.estimatedCostCents ?? null,
        });

        // Handled pela pipeline nova
        if (result.reply && (result.source === 'fast_path' || result.source === 'llm' || result.source === 'budget_blocked')) {
          await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, `ai:${result.source}`);
          await saveMessageTimed(session.id, 'assistant', result.reply, 'text', `ai:${result.source}`);
          responseTextForLog = result.reply.slice(0, 300);
          getActiveTrace()?.setField('reply_text', responseTextForLog);
          return { text: result.reply };
        }
        // Caso 'ai_disabled', 'kill_switch', 'error' → fallthrough para pipeline antiga
      } catch (err) {
        logStructuredMessage('ai_native_error', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
        getActiveTrace()?.patch({
          source: 'ai_native',
          ai_native_source: 'error',
          error_message: err instanceof Error ? err.message : String(err),
        });
        // fallthrough
      }
    }

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
    const legacyPendingAction = session.context.workingStateV2?.legacyPending?.action || session.context.pendingAction;
    if (pendingConfirmation && !legacyPendingAction) {
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
        decision: 'execute',
        intent: 'desconhecido',
        capability: pendingConfirmation.capability,
        confidence: 0.95,
        confidenceLabel: 'high',
        source: 'followup',
        args: pendingConfirmation.argsSnapshot,
        missingArgs: [],
        missingFields: [],
        evidence: ['pending_confirmation'],
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

      // V44c — limpa draft de contrato quando a confirmação executa (mutation aplicada).
      if (confirmedPlan.capability === 'create_contract' && (session.context as { pendingContractDraft?: unknown }).pendingContractDraft) {
        await updateSessionContext(session.id, { ...session.context, pendingContractDraft: undefined });
      }

      const execution = await timed('executorMs', () => executeActionPlan(
        confirmedPlan,
        {
          session,
          tenantId,
          profileId,
          role,
          requestId: msg.messageId,
          channel: msg.channel,
          rawText: textToProcess,
          confirmed: true,
          idempotencyKey: pendingConfirmation.idempotencyKey,
          confirmationId: pendingConfirmation.confirmationId,
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
      }, { structuredResponse: execution.structuredResponse });
    }

    if (legacyPendingAction) {
      const pendingActionName = legacyPendingAction;
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType);
      let pendingResponse = await handlePendingAction(session, textToProcess, tenantId);
      if (pendingResponse === null) {
        // Wizard escape: clear context already done inside handlePendingAction, fall through to normal pipeline
        // Re-read updated session context (pendingAction cleared)
        session.context.pendingAction = undefined;
      } else {
        pendingResponse = prependAudioPreview(pendingResponse, audioTranscript?.text);
        await saveMessageTimed(session.id, 'assistant', pendingResponse);
        return finalize(pendingResponse, { action: `pending:${pendingActionName}` }, { skipLlm: true });
      }
    }

    if (
      !pendingConfirmation
      && !legacyPendingAction
      && (workingState.pendingCapability === 'create_contract' || workingState.pendingCapability === 'mark_installment_paid')
    ) {
      if (isPendingOperationCancel(textToProcess)) {
        await timed('dbWriteMs', () => patchWorkingState(session, {
          pendingCapability: undefined,
          pendingOperationInput: undefined,
          pendingMissingFields: [],
          missingSlots: [],
          candidateSets: undefined,
          focusedEntity: undefined,
          legacyPending: undefined,
        }));
        const cancelReply = 'Ação cancelada. Pode me pedir outra coisa.';
        await saveMessageTimed(session.id, 'assistant', cancelReply);
        return finalize(cancelReply, { action: `cancel:${workingState.pendingCapability}`, result: 'clarification' }, { skipLlm: true });
      }

      if (isPendingOperationEscape(textToProcess)) {
        await timed('dbWriteMs', () => patchWorkingState(session, {
          pendingCapability: undefined,
          pendingOperationInput: undefined,
          pendingMissingFields: [],
          missingSlots: [],
          candidateSets: undefined,
          focusedEntity: undefined,
          legacyPending: undefined,
        }));
        workingState = getWorkingState(session.context);
      }
    }

    const adminCompanies = role === 'admin'
      ? await timed('dbReadMs', () => listCompaniesByTenant(tenantId))
      : [];

    if (role === 'admin' && isCompanyListCommand(textToProcess)) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, 'listar_empresas');
      await timed('dbWriteMs', () => patchWorkingState(session, {
        lastCompanyCandidates: adminCompanies.map(company => ({ id: company.id, label: company.name })),
        pendingCompanySelection: true,
        pendingCapability: undefined,
        pendingMissingFields: [],
      }));
      logStructuredMessage('company_context_changed', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        tenantId,
        companyId: workingState.activeCompany?.id,
        companyLabel: workingState.activeCompany?.label,
        companySelectionMode: 'list',
        companyCandidateCount: adminCompanies.length,
        result: 'success',
      });
      const companyReply = formatCompanyOptions(adminCompanies, workingState.activeCompany?.id);
      await saveMessageTimed(session.id, 'assistant', companyReply);
      return finalize(companyReply, { action: 'admin:list_companies', result: 'success' }, { skipLlm: true });
    }

    if (role === 'admin' && isCompanyClearCommand(textToProcess)) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, 'limpar_empresa_ativa');
      await timed('dbWriteMs', () => patchWorkingState(session, {
        activeCompany: undefined,
        pendingCompanySelection: false,
        pendingCapability: undefined,
        pendingMissingFields: [],
      }));
      workingState = getWorkingState(session.context);
      logStructuredMessage('company_context_changed', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        tenantId,
        companySelectionMode: 'clear',
        result: 'success',
      });
      const clearedReply = 'Certo. Voltei para a visão consolidada de *todas as empresas* do tenant.';
      await saveMessageTimed(session.id, 'assistant', clearedReply);
      return finalize(clearedReply, { action: 'admin:clear_active_company', result: 'success' }, { skipLlm: true });
    }

    // Uma seleção de empresa pendente NÃO pode sequestrar um número que pertence
    // a um fluxo de capability ativo (ex.: escolher a parcela numa baixa, ou um
    // slot numérico na criação de contrato). O comando explícito "usar empresa X"
    // continua tendo prioridade — só a resposta numérica/implícita é diferida.
    const awaitingCapabilityInput = Boolean(workingState.pendingCapability);
    const candidateCompanyReply = role === 'admin'
      && workingState.pendingCompanySelection
      && !awaitingCapabilityInput
      && shouldAcceptCompanyCandidateReply(textToProcess, adminCompanies);
    const explicitCompanySelection = role === 'admin' && isExplicitCompanySelectionCommand(textToProcess);

    if (role === 'admin' && (explicitCompanySelection || candidateCompanyReply)) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, 'selecionar_empresa');
      const companySelection = resolveCompanySelectionDetailed(textToProcess, adminCompanies);
      if (companySelection.kind === 'ambiguous') {
        await timed('dbWriteMs', () => patchWorkingState(session, {
          lastCompanyCandidates: companySelection.candidates.map(company => ({ id: company.id, label: company.name })),
          pendingCompanySelection: true,
        }));
        logStructuredMessage('company_context_changed', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          tenantId,
          companySelectionMode: 'clarify',
          companyCandidateCount: companySelection.candidates.length,
          result: 'clarification',
        });
        const companyReply = formatCompanySelectionClarification(
          companySelection.query,
          companySelection.candidates,
          workingState.activeCompany?.id,
        );
        await saveMessageTimed(session.id, 'assistant', companyReply);
        return finalize(companyReply, { action: 'admin:select_company_retry', result: 'clarification' }, { skipLlm: true });
      }

      const selectedCompany = companySelection.kind === 'selected' ? companySelection.company : null;
      if (!selectedCompany) {
        const numericHint = textToProcess.trim().match(/^\d{1,2}$/);
        const prefix = numericHint
          ? `Não existe empresa número *${numericHint[0]}* na lista (são ${adminCompanies.length}). `
          : '';
        const companyReply = prefix + formatCompanyOptions(adminCompanies, workingState.activeCompany?.id);
        await saveMessageTimed(session.id, 'assistant', companyReply);
        return finalize(companyReply, { action: 'admin:select_company_retry', result: 'clarification' }, { skipLlm: true });
      }

      await timed('dbWriteMs', () => patchWorkingState(session, {
        activeCompany: { id: selectedCompany.id, label: selectedCompany.name },
        lastCompanyCandidates: adminCompanies.map(company => ({ id: company.id, label: company.name })),
        pendingCompanySelection: false,
        pendingCapability: undefined,
        pendingMissingFields: [],
      }));
      workingState = getWorkingState(session.context);
      logStructuredMessage('company_context_changed', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        tenantId,
        companyId: selectedCompany.id,
        companyLabel: selectedCompany.name,
        companySelectionMode: 'set',
        result: 'success',
      });
      const companySelectedReply = `Certo. Vou considerar a empresa *${selectedCompany.name}* nas próximas consultas administrativas deste chat.`;
      await saveMessageTimed(session.id, 'assistant', companySelectedReply);
      return finalize(companySelectedReply, { action: 'admin:set_active_company', result: 'success' }, { skipLlm: true });
    }

    const inlineCompanyContext = role === 'admin'
      ? detectInlineCompanyContext(textToProcess, adminCompanies)
      : null;

    if (role === 'admin' && inlineCompanyContext) {
      if (inlineCompanyContext.mode === 'ambiguous') {
        const clarificationReply = formatCompanySelectionClarification(
          inlineCompanyContext.query,
          inlineCompanyContext.candidates,
          workingState.activeCompany?.id,
        );
        await timed('dbWriteMs', () => patchWorkingState(session, {
          lastCompanyCandidates: inlineCompanyContext.candidates.map(company => ({ id: company.id, label: company.name })),
          pendingCompanySelection: true,
        }));
        logStructuredMessage('company_context_changed', {
          channel: msg.channel,
          messageId: msg.messageId,
          sessionId: session.id,
          tenantId,
          companySelectionMode: 'clarify',
          companyCandidateCount: inlineCompanyContext.candidates.length,
          result: 'clarification',
        });
        await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, 'selecionar_empresa_inline');
        await saveMessageTimed(session.id, 'assistant', clarificationReply);
        return finalize(clarificationReply, { action: 'admin:select_company_inline_retry', result: 'clarification' }, { skipLlm: true });
      }

      await timed('dbWriteMs', () => patchWorkingState(session, inlineCompanyContext.mode === 'clear'
        ? {
            activeCompany: undefined,
            pendingCompanySelection: false,
          }
        : {
            activeCompany: { id: inlineCompanyContext.company.id, label: inlineCompanyContext.company.name },
            pendingCompanySelection: false,
          }));
      workingState = getWorkingState(session.context);
      logStructuredMessage('company_context_changed', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        tenantId,
        companyId: inlineCompanyContext.mode === 'set' ? inlineCompanyContext.company.id : undefined,
        companyLabel: inlineCompanyContext.mode === 'set' ? inlineCompanyContext.company.name : undefined,
        companySelectionMode: inlineCompanyContext.mode === 'set' ? 'inline_set' : 'inline_clear',
        result: 'success',
      });
      textToProcess = stripInlineCompanyContext(textToProcess, inlineCompanyContext);
    }

    const followupPlan = await timed('followupMs', async () => resolveFollowup(textToProcess, workingState));

    let understanding: CommandUnderstanding | undefined;
    let actionPlan = followupPlan;

    if (followupPlan) {
      telemetry.intent = `followup:${followupPlan.capability}`;
      telemetry.confidence = followupPlan.confidenceLabel;
      telemetry.routeSource = followupPlan.source;
      telemetry.fallbackReason = 'n/a';
      logStructuredMessage('followup_resolved', {
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        tenantId,
        companyId: workingState.activeCompany?.id,
        companyLabel: workingState.activeCompany?.label,
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

      const referenceResolution = resolveReferences(
        textToProcess,
        understanding,
        workingState,
        buildContextPack(workingState, role),
      );
      understanding = {
        ...understanding,
        normalizedEntities: {
          ...understanding.normalizedEntities,
          ...referenceResolution.normalizedEntities,
        },
      };

      actionPlan = createActionPlan(understanding, textToProcess, role, referenceResolution.evidence);

      // Fallback híbrido de reclamação (FB-001): só quando a intenção não foi
      // identificada — evita custo/latência e falso-positivo no caminho feliz.
      // Confiança 'high' ao re-planejar: o detector já é um sinal positivo
      // confiante; sem isso, getPlanClarificationMessage barraria o plano por
      // baixa confiança e a reclamação nunca chegaria ao executor.
      if (understanding.intent === 'desconhecido' && await detectComplaintFallback(textToProcess)) {
        understanding = { ...understanding, intent: 'reportar_problema', confidence: 'high' };
        actionPlan = createActionPlan(understanding, textToProcess, role, referenceResolution.evidence);
        telemetry.fallbackReason = 'complaint_detected';
      }

      telemetry.intent = understanding.intent;
      telemetry.confidence = understanding.confidence;
      telemetry.routeSource = understanding.source;
      telemetry.fallbackReason = telemetry.fallbackReason || understanding.fallbackReason || 'n/a';
    }

    await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, telemetry.intent);

    extractedArgsForLog = JSON.stringify(actionPlan.args || {}).slice(0, 200);

    logStructuredMessage('action_plan_created', {
      channel: msg.channel,
      messageId: msg.messageId,
      sessionId: session.id,
      tenantId,
      companyId: workingState.activeCompany?.id,
      companyLabel: workingState.activeCompany?.label,
      capability: actionPlan.capability,
      confidence: actionPlan.confidenceLabel,
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
      }, { skipLlm: true });
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
      tenantId,
      companyId: workingState.activeCompany?.id,
      companyLabel: workingState.activeCompany?.label,
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
        rawText: textToProcess,
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
      tenantId,
      companyId: workingState.activeCompany?.id,
      companyLabel: workingState.activeCompany?.label,
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

    // Skip response LLM only when capability already produced a rich structuredResponse
    const skipResponseLlm = !!execution.structuredResponse
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
    }, { skipLlm: skipResponseLlm, structuredResponse: execution.structuredResponse });
  } catch (err) {
    console.error('[handleMessage error]', err);
    telemetry.result = 'error';
    const message = mapErrorToUserMessage(err);
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

    // BR-BOT-009: flush do trace por turno (fire-and-forget, fila por sessão).
    // Reusa sanitizeLogText via logStructuredMessage events; campos top-level
    // são populados ao longo do pipeline via getActiveTrace()?.setField(...).
    // reply_text é setado direto nos pontos de retorno (finalize + AI-native +
    // audio-weak); aqui só preenchemos se nenhum desses caminhos cobriu.
    try {
      trace.patch({
        intent: telemetry.intent !== 'n/a' ? telemetry.intent : null,
        intent_confidence: telemetry.confidence !== 'n/a' ? telemetry.confidence : null,
        intent_route_source: telemetry.routeSource !== 'n/a' ? telemetry.routeSource : null,
        capability: telemetry.action !== 'none' ? telemetry.action : null,
        result: telemetry.result === 'success' ? 'success'
          : telemetry.result === 'error' ? 'error'
          : telemetry.result === 'blocked' ? 'blocked'
          : telemetry.result === 'clarification' ? 'clarification' : null,
        total_ms: totalMs,
        latency_breakdown: { ...latencyBreakdown },
        tokens_in: llmUsage.tokensIn || null,
        tokens_out: llmUsage.tokensOut || null,
        cost_cents: (llmUsage.tokensIn > 0 || llmUsage.tokensOut > 0)
          ? Math.round(estimateCostUsd(llmUsage.tokensIn, llmUsage.tokensOut) * 100 * 100) / 100
          : null,
        session_id: telemetry.sessionId || null,
      });
      // Fallback: se nenhum return path setou reply_text via setField, usa
      // responseTextForLog do closure (defesa contra novos return paths).
      if (responseTextForLog) {
        trace.patch({ reply_text: responseTextForLog });
      }
      const queueKey = telemetry.sessionId || `${msg.channel}:${msg.channelUserId}`;
      enqueueTracePersist(queueKey, () => flushTrace(trace));
    } catch (err) {
      logStructuredMessage('turn_trace_finalize_failed', {
        sessionId: telemetry.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function listContractOpenInstallmentsReadOnly(
  tenantId: string,
  contractId: number,
): Promise<string> {
  const pageData = await getContractOpenInstallments(tenantId, contractId, 0, 50);
  if (pageData.items.length === 0) {
    return `✅ Nenhuma parcela em aberto no *Contrato #${contractId}*.`;
  }

  return formatInstallmentsForContractReadOnly(contractId, pageData.items);
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
  const activeAdminCompany = role === 'admin' ? getWorkingState(session.context).activeCompany : undefined;
  const activeCompanyId = activeAdminCompany?.id;
  const activeCompanyLabel = activeAdminCompany?.label;

  switch (intent) {
    case 'saudacao': {
      const userName = (session.profile?.name || 'você').trim() || 'você';
      const greetRole = role || 'admin';
      const greeting = await generateGreeting(userName, greetRole, originalText);
      return (greeting.text || '').trim() || `Oi, ${userName}! Como posso ajudar hoje?`;
    }

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
        tenantId,
        companyId: activeCompanyId,
        companyLabel: activeCompanyLabel,
        action: 'dashboard',
        result: 'direct_sql',
      });
      const summary = await getDashboardSummary(tenantId, activeCompanyId);
      logStructuredMessage('dashboard_values_computed', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        tenantId,
        companyId: activeCompanyId,
        companyLabel: activeCompanyLabel,
        action: 'dashboard',
        result: 'success',
        receivedByPaymentMonth: summary.receivedByPaymentMonth,
        receivedByDueMonth: summary.receivedByDueMonth,
        expectedMonth: summary.expectedMonth,
        totalOverdue: summary.totalOverdue,
      });
      return withActiveCompanyLabel(formatDashboard(summary), activeCompanyLabel);
    }

    case 'listar_recebiveis': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      if (entities.contract_id) {
        return withActiveCompanyLabel(
          await listContractOpenInstallmentsReadOnly(tenantId, Number(entities.contract_id)),
          activeCompanyLabel,
        );
      }
      const resolvedFilter: 'pending' | 'late' | 'week' | 'all' = entities.filter || 'pending';
      const installments = await getInstallments(tenantId, resolvedFilter, activeCompanyId);
      return withActiveCompanyLabel(formatInstallments(installments), activeCompanyLabel);
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
      const installments = await getInstallmentsInWindow(tenantId, daysAhead, windowStart, activeCompanyId);

      logStructuredMessage('receivables_window_computed', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        tenantId,
        companyId: activeCompanyId,
        companyLabel: activeCompanyLabel,
        daysAhead,
        windowStart,
        startDate: window.startDate,
        endDate: window.endDate,
        result: 'success',
      });

      if (installments.length === 0) {
        return `✅ Nenhum recebivel em aberto no periodo *${formatDateWindow(daysAhead, windowStart)}*.`;
      }

      return withActiveCompanyLabel(formatReceivablesList(installments, formatDateWindow(daysAhead, windowStart)), activeCompanyLabel);
    }

    case 'cobrar_periodo': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const daysAhead = resolveDaysAhead(entities.days_ahead);
      const windowStart = resolveWindowStart(entities.window_start);
      const window = buildDateWindow(daysAhead, windowStart);
      const debtors = await getDebtorsToCollectInWindow(tenantId, daysAhead, windowStart, activeCompanyId);

      logStructuredMessage('collection_window_computed', {
        channel: session.channel,
        messageId,
        sessionId: session.id,
        tenantId,
        companyId: activeCompanyId,
        companyLabel: activeCompanyLabel,
        daysAhead,
        windowStart,
        startDate: window.startDate,
        endDate: window.endDate,
        result: 'success',
      });

      if (debtors.length === 0) {
        return `✅ Nenhum devedor para cobranca no periodo *${formatDateWindow(daysAhead, windowStart)}*.`;
      }

      return withActiveCompanyLabel(formatCobrancaList(debtors, formatDateWindow(daysAhead, windowStart)), activeCompanyLabel);
    }

    case 'recebiveis_hoje': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const hoje = await getInstallmentsToday(tenantId, activeCompanyId);
      if (hoje.length === 0) {
        return withActiveCompanyLabel('✅ Nenhuma parcela vence hoje.', activeCompanyLabel);
      }
      return withActiveCompanyLabel(formatReceivablesList(hoje, 'hoje'), activeCompanyLabel);
    }

    case 'cobrar_hoje': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const devedores = await getDebtorsToCollectToday(tenantId, activeCompanyId);
      if (devedores.length === 0) {
        return withActiveCompanyLabel('✅ Nenhum devedor com vencimento hoje.', activeCompanyLabel);
      }
      return withActiveCompanyLabel(formatCobrancaList(devedores, 'hoje'), activeCompanyLabel);
    }

    case 'gerar_relatorio': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const report = await generateMonthlyReport(tenantId, activeCompanyId);
      const month = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return withActiveCompanyLabel(formatRelatorioCompleto(report, month), activeCompanyLabel);
    }

    case 'desconectar': {
      const ok = await disconnectBot(session.channel, session.channel_user_id);
      return ok
        ? '✅ Conta desvinculada com sucesso. Até logo!\n\nPara reconectar, gere um novo código no dashboard web → Configurações → Assistente de Bolso.'
        : '❌ Erro ao desvincular. Tente novamente.';
    }

    default: {
      return t('handler.not_understood_help');
    }
  }
}

async function handlePendingAction(
  session: Session,
  text: string,
  tenantId: string
): Promise<string | null> {
  const { pendingAction, pendingData, pendingActionAt } = session.context;

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

  // Camada 2 — Escape por intent alternativo para todos os wizards legados restantes
  {
    const trimmed = text.trim();
    const isEscapeIntent = /cobrar\s+(?:hoje|amanhã|amanha)|quem\s+(?:devo\s+cobrar|me\s+deve|tenho\s+que\s+cobrar)|receb[ií]veis|quanto\s+(?:vou\s+)?receber|dashboard|resumo|ver\s+relat[oó]rio|quem\s+est[aá]\s+atrasad/i.test(trimmed);
    if (isEscapeIntent) {
      await clearSessionContext(session.id);
      return null;
    }
  }

  // V44 — Promoção de feature EOD: tenant respondeu sim/não ao convite proativo
  if (pendingAction === 'ativar_eod_alert') {
    const normalized = text.trim().toLowerCase();
    const isYes = /^(s|sim|si|claro|pode|ativa|ativar|ok|positivo)$/i.test(normalized);
    const isNo = /^(n|nao|não|nope|negativo|cancela|cancelar|deixa)$/i.test(normalized);

    if (!isYes && !isNo) {
      return 'Quer ativar o aviso de fim de dia? Responda *sim* ou *não*.';
    }

    await clearSessionContext(session.id);

    if (isYes) {
      try {
        await upsertBotTenantConfig(tenantId, { eod_alert_enabled: true, eod_alert_time: '17:00' });
        return '✅ Pronto! Todo dia às *17:00* eu te aviso sobre cobranças do dia que ainda não tiveram baixa. Se quiser mudar o horário, é só me dizer (ex.: *me avise às 16h*).';
      } catch (err) {
        logStructuredMessage('eod_alert_activate_failed', { tenantId, error: err instanceof Error ? err.message : String(err) });
        return 'Não consegui salvar agora. Tenta de novo daqui a pouco.';
      }
    }

    return 'Combinado, deixei desligado. Se mudar de ideia, é só pedir.';
  }

  // V44 — Captura sim/não/lista pra resposta do alerta de fim de dia
  if (pendingAction === 'confirmar_baixas_pendentes') {
    const items = (pendingData?.items as PendingPaymentFollowupItem[] | undefined) || [];
    const followupTenantId = String((pendingData as any)?.tenantId || tenantId);
    if (items.length === 0) {
      await clearSessionContext(session.id);
      return null;
    }

    const normalized = text.trim().toLowerCase();
    const sayAll = /^(s|sim|todos|tudo|todas|pode|ok|confirma|confirmar|baixa)$/i.test(normalized);
    const sayNone = /^(n|nao|não|nenhum|nenhuma|cancela|cancelar|nada)$/i.test(normalized);
    const numbersMatch = normalized.match(/\d+/g);
    const keepOpenIdx = numbersMatch
      ? Array.from(new Set(numbersMatch.map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= items.length)))
      : [];

    if (!sayAll && !sayNone && keepOpenIdx.length === 0) {
      return t('handler.not_understood_baixas');
    }

    await clearSessionContext(session.id);

    if (sayNone) {
      return 'Combinado. Marquei como ainda em aberto.';
    }

    const toPay = sayAll
      ? items
      : items.filter((_, i) => !keepOpenIdx.includes(i + 1));

    if (toPay.length === 0) {
      return 'Combinado. Mantive todas em aberto.';
    }

    try {
      const { paid, failed } = await confirmPendingPaymentFollowup(followupTenantId, toPay);
      const lines: string[] = [];
      if (paid.length > 0) {
        lines.push(`✅ Baixa registrada em ${paid.length === 1 ? '*1* cobrança' : `*${paid.length}* cobranças`}.`);
      }
      if (failed.length > 0) {
        lines.push(`⚠️ ${failed.length === 1 ? '1 cobrança' : `${failed.length} cobranças`} não puderam ser baixadas — verifique o painel.`);
      }
      return lines.join('\n') || '✅ Concluído.';
    } catch (err) {
      logStructuredMessage('eod_followup_confirm_failed', { tenantId: followupTenantId, error: err instanceof Error ? err.message : String(err) });
      return 'Não consegui registrar a baixa agora. Tenta de novo daqui a pouco.';
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

function formatInstallmentsForContractReadOnly(
  contractId: number,
  installments: ContractOpenInstallment[],
): string {
  const lines = installments.map((item) =>
    `• Parcela ${item.number} — ${item.debtorName} — ${formatCurrency(item.amount)} — vence ${formatDate(item.dueDate)} — ${item.status}`
  );

  return `📄 *Contrato #${contractId}* — parcelas em aberto:\n\n${lines.join('\n')}`;
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
