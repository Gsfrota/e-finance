import { analyzeImage, NormalizedEntities, transcribeAudio, inferInstallmentMonth } from '../ai/intent-classifier';
import { routeIntent } from '../ai/intent-router';
import {
  getOrCreateSession, updateSessionContext, clearSessionContext,
  linkProfileToSession, saveMessage, getRecentMessages, Session,
  syncSessionProfileFromChannelBinding,
} from '../session/session-manager';
import {
  getDashboardSummary, getInstallments, getInstallmentsToday, getDebtorsToCollectToday,
  generateMonthlyReport, parseContractTextWithMeta, createContract,
  markInstallmentPaid, searchUser, getUserDebtDetails, generateInvite,
  validateLinkCode, disconnectBot, formatCurrency, formatDate,
  ContractDraft, DebtorToCollect, getContractOpenInstallments,
  getContractOpenInstallmentByNumber, normalizeCpf, isValidCpf,
  getInstallmentByDebtorAndMonth,
} from '../actions/admin-actions';
import { logStructuredMessage } from '../observability/logger';
import { config } from '../config';
import type { LinkValidationResult, ContractOpenInstallment } from '../actions/admin-actions';
import { detectPromptInjectionAttempt, sanitizeUserText } from '../security/prompt-guard';
import { generateAgentResponse } from '../ai/response-generator';

export interface IncomingMessage {
  messageId: string;
  channel: 'whatsapp' | 'telegram';
  channelUserId: string;
  senderName: string;
  text?: string;
  audioBuffer?: Buffer;
  audioMimeType?: string;
  imageBuffer?: Buffer;
  imageMimeType?: string;
}

export interface OutgoingMessage {
  text: string;
}

const WELCOME_MSG = (name: string) => `Olá ${name}! 👋 Sou o assistente *e-finance*.

Posso te ajudar com:
• *Dashboard* — resumo do mês
• *Recebíveis* — parcelas pendentes e atrasadas
• *Criar contrato* — novo contrato por descrição ou voz
• *Marcar pagamento* — registrar recebimento
• *Buscar usuário* — consultar devedor

Pode falar naturalmente ou enviar áudio. O que precisa?`;

const NOT_LINKED_MSG = `Olá! 👋 Para usar o assistente e-finance, preciso vincular sua conta.

Acesse o *dashboard web → Configurações → Conectar WhatsApp/Telegram* e me envie o código gerado.

Ou envie seu código agora se já tiver um.`;

const PROMPT_INJECTION_BLOCK_MSG =
  'Por segurança, não posso seguir comandos para ignorar regras, revelar prompts ou acessar segredos.\n\n'
  + 'Posso ajudar com ações do e-finance: *dashboard*, *recebíveis*, *criar contrato*, *marcar pagamento*, *relatório* e *convite*.\n\n'
  + 'Me diga o que você precisa fazer no sistema.';

const CPF_REQUIRED_MSG =
  'Para criar contrato com segurança, preciso do *CPF do devedor* (11 dígitos).\n\n'
  + 'Exemplo: *529.982.247-25*';

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
  criar_contrato: '*criar contrato*',
  marcar_pagamento: '*marcar pagamento*',
  desconectar: '*desconectar*',
};

const INTENT_REPLY_HINT: Record<string, string> = {
  ver_dashboard: '/dashboard',
  listar_recebiveis: '/recebiveis',
  criar_contrato: 'criar contrato',
  marcar_pagamento: 'marcar pagamento',
  desconectar: '/desconectar',
};

function getCandidateClarification(candidates: string[]): string | null {
  const normalized = Array.from(new Set(candidates.filter(c => !!INTENT_LABELS[c]).slice(0, 3)));
  if (normalized.length === 0) return null;

  if (normalized.length === 1) {
    const key = normalized[0];
    return `Para evitar erro, confirma se você quer ${INTENT_LABELS[key]}?\n\nSe sim, responda com *${INTENT_REPLY_HINT[key] || key}*.`;
  }

  if (normalized.length === 2) {
    const first = normalized[0];
    const second = normalized[1];
    return `Para evitar erro, preciso confirmar: você quer ${INTENT_LABELS[first]} ou ${INTENT_LABELS[second]}?\n\nResponda com *${INTENT_REPLY_HINT[first] || first}* ou *${INTENT_REPLY_HINT[second] || second}*.`;
  }

  return 'Para evitar erro, preciso confirmar o que você quer fazer.\n\nVocê quer:\n1) Ver *dashboard*\n2) Listar *recebíveis*\n3) *Criar contrato*\n\nResponda com o número ou descreva de novo em uma frase curta.';
}

export function getClarificationMessage(
  intent: string,
  confidence: 'high' | 'medium' | 'low',
  candidates: string[] = []
): string | null {
  const candidateFirst = getCandidateClarification(candidates);

  if (intent === 'desconhecido' || confidence === 'low') {
    return candidateFirst || 'Para evitar erro, preciso confirmar o que você quer fazer.\n\nVocê quer:\n1) Ver *dashboard*\n2) Listar *recebíveis*\n3) *Criar contrato*\n4) *Marcar pagamento*\n\nResponda com o número ou descreva de novo em uma frase curta.';
  }

  if (SENSITIVE_INTENTS.has(intent) && confidence !== 'high') {
    return candidateFirst || `Para evitar erro, confirma se você quer ${INTENT_LABELS[intent] || intent}?\n\nSe sim, responda com *${INTENT_REPLY_HINT[intent] || intent}*.`;
  }

  return null;
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

  const finalize = (text: string, patch: Partial<typeof telemetry> = {}): OutgoingMessage => {
    Object.assign(telemetry, patch);
    return { text };
  };

  try {
    let session = await timed('dbReadMs', () => getOrCreateSession(msg.channel, msg.channelUserId));

    const syncResult = await timed('dbReadMs', () => syncSessionProfileFromChannelBinding(session));
    session = syncResult.session;
    telemetry.sessionId = session.id;

    if (syncResult.changed) {
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

    let textToProcess = sanitizeUserText(msg.text || '');

    if (msg.audioBuffer && msg.audioMimeType) {
      const transcribed = await transcribeAudio(msg.audioBuffer, msg.audioMimeType);
      if (transcribed) {
        textToProcess = sanitizeUserText(transcribed);
      } else {
        telemetry.result = 'clarification';
        telemetry.action = 'transcription_failed';
        return finalize('Não consegui transcrever o áudio. Pode escrever a mensagem?');
      }
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
      return finalize('Não entendi. Pode repetir?', { action: 'empty_message' });
    }

    const userMediaType = msg.audioBuffer ? 'audio' : 'text';

    if (/^\/start$/i.test(textToProcess.trim())) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType);
      if (!session.profile) {
        await saveMessageTimed(session.id, 'assistant', NOT_LINKED_MSG);
        return finalize(NOT_LINKED_MSG, { action: 'start_not_linked' });
      }
      const welcome = WELCOME_MSG(session.profile.name || 'Usuário');
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

    if (/^(\/desconectar|desconectar|desvincular|sair da conta)$/i.test(textToProcess.trim())) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, 'desconectar');
      if (!session.profile) {
        await saveMessageTimed(session.id, 'assistant', NOT_LINKED_MSG);
        return finalize(NOT_LINKED_MSG, { action: 'disconnect_not_linked' });
      }
      const ok = await disconnectBot(msg.channel, msg.channelUserId);
      const reply = ok
        ? '✅ Conta desvinculada com sucesso. Até logo!\n\nPara reconectar, gere um novo código no dashboard web → Configurações → Assistente de Bolso.'
        : '❌ Erro ao desvincular. Tente novamente.';
      await saveMessageTimed(session.id, 'assistant', reply);
      return finalize(reply, { action: 'disconnect', result: ok ? 'success' : 'error' });
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

        const response = WELCOME_MSG(linkResult.name);
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

    if (session.context.pendingAction) {
      await saveMessageTimed(session.id, 'user', textToProcess, userMediaType);
      const pendingResponse = await handlePendingAction(session, textToProcess, tenantId, profileId, msg.messageId);
      await saveMessageTimed(session.id, 'assistant', pendingResponse);
      return finalize(pendingResponse, { action: `pending:${session.context.pendingAction}` });
    }

    const runRoute = async (
      mode: 'fast' | 'full',
      history: Array<{ role: string; content: string }>,
    ) => {
      const routeStartedAt = Date.now();
      const routed = await routeIntent(textToProcess, history, {
        cacheScope: tenantId,
        channel: msg.channel,
        messageId: msg.messageId,
        sessionId: session.id,
        mode,
      });
      const routeElapsed = Date.now() - routeStartedAt;
      latencyBreakdown.routeMs += routeElapsed;
      if (routed.source === 'llm') latencyBreakdown.llmMs += routeElapsed;
      return routed;
    };

    let routed = await runRoute('fast', []);

    if (routed.intent === 'desconhecido' || routed.confidence !== 'high' || routed.source !== 'rule') {
      const historyTimeoutMs = 1200;
      const history = await timed('dbReadMs', async () => Promise.race([
        getRecentMessages(session.id, 8),
        new Promise<Array<{ role: string; content: string }>>(resolve => {
          setTimeout(() => resolve([]), historyTimeoutMs);
        }),
      ]));

      routed = await runRoute('full', history);
    }

    telemetry.intent = routed.intent;
    telemetry.confidence = routed.confidence;
    telemetry.routeSource = routed.source;
    telemetry.fallbackReason = routed.fallbackReason || 'n/a';

    await saveMessageTimed(session.id, 'user', textToProcess, userMediaType, routed.intent);

    const clarification = getClarificationMessage(routed.intent, routed.confidence, routed.candidates || []);
    if (clarification) {
      await saveMessageTimed(session.id, 'assistant', clarification);
      return finalize(clarification, {
        action: `clarification:${routed.intent}`,
        result: 'clarification',
      });
    }

    const response = await dispatchIntent(
      routed.intent,
      routed.normalizedEntities,
      session,
      tenantId,
      profileId,
      role,
      msg.messageId,
      textToProcess
    );

    await saveMessageTimed(session.id, 'assistant', response);

    return finalize(response, { action: `intent:${routed.intent}` });
  } catch (err) {
    console.error('[handleMessage error]', err);
    telemetry.result = 'error';
    return finalize('❌ Ocorreu um erro ao processar sua mensagem. Tente novamente em instantes.', {
      action: 'internal_error',
    });
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
      dbReadMs: latencyBreakdown.dbReadMs,
      dbWriteMs: latencyBreakdown.dbWriteMs,
      llmMs: latencyBreakdown.llmMs,
      presenceWaitMs: latencyBreakdown.presenceWaitMs,
      presenceMode,
      messagePersistMode: config.messagePersistence.mode,
      durationMs: totalMs,
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
    pendingStep: 2,
    pendingData: { selectedInstallment: selected } as unknown as Record<string, unknown>,
  });

  return formatPaymentConfirmation(selected, selected.contractId);
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
            pendingStep: 11,
            pendingData: draft as unknown as Record<string, unknown>,
          });
          return CPF_REQUIRED_MSG;
        }

        await updateSessionContext(session.id, {
          pendingAction: 'criar_contrato',
          pendingStep: 2,
          pendingData: draft as unknown as Record<string, unknown>,
        });
        return formatContractConfirmation(draft);
      }

      await updateSessionContext(session.id, { pendingAction: 'criar_contrato', pendingStep: 1 });
      return 'Claro! Me informe os dados do contrato:\n\nExemplo: *"João Silva, CPF 52998224725, R$ 5.000, 3% ao mês, 12 parcelas mensais"*\n\nOu pode enviar um áudio descrevendo.';
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

    case 'recebiveis_hoje': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const hoje = await getInstallmentsToday(tenantId);
      if (hoje.length === 0) {
        const naturalReply = await generateAgentResponse(
          { type: 'success', action: 'recebiveis_hoje', details: 'Nenhuma parcela vence hoje.' },
          originalText,
        );
        return naturalReply || '✅ Nenhuma parcela vence hoje.';
      }
      const total = hoje.reduce((s, i) => s + i.amount, 0);
      const lines = hoje.map((i, idx) => `${idx + 1}. ${i.debtorName} — ${formatCurrency(i.amount)}`);
      const dataBlock = `📅 *Vencimentos de hoje:*\n\n${lines.join('\n')}\n\n💰 Total: *${formatCurrency(total)}*`;
      const introReply = await generateAgentResponse(
        { type: 'list_intro', count: hoje.length, entity: 'vencimentos hoje' },
        originalText,
      );
      return introReply ? `${introReply}\n\n${dataBlock}` : dataBlock;
    }

    case 'cobrar_hoje': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const devedores = await getDebtorsToCollectToday(tenantId);
      if (devedores.length === 0) {
        const naturalReply = await generateAgentResponse(
          { type: 'success', action: 'cobrar_hoje', details: 'Nenhum devedor com vencimento hoje.' },
          originalText,
        );
        return naturalReply || '✅ Nenhum devedor com vencimento hoje.';
      }
      const total = devedores.reduce((s, d) => s + d.totalDue, 0);
      const lines = devedores.map((d, idx) => {
        const atraso = d.daysLate > 0 ? ` *(${d.daysLate}d atrasado)*` : '';
        const parcelas = d.installmentCount > 1 ? ` — ${d.installmentCount} parcelas` : '';
        return `${idx + 1}. ${d.name} — ${formatCurrency(d.totalDue)}${parcelas}${atraso}`;
      });
      const dataBlock = `🔴 *Lista de cobrança:*\n\n${lines.join('\n')}\n\n💰 Total em aberto: *${formatCurrency(total)}*`;
      const introReply = await generateAgentResponse(
        { type: 'list_intro', count: devedores.length, entity: 'devedores para cobrar hoje' },
        originalText,
      );
      return introReply ? `${introReply}\n\n${dataBlock}` : dataBlock;
    }

    case 'gerar_relatorio': {
      if (role !== 'admin') return 'Essa função é apenas para administradores.';
      const report = await generateMonthlyReport(tenantId);
      const { dashboard: d } = report;
      const month = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const receivedByPaymentMonth = d.receivedByPaymentMonth ?? d.receivedMonth;
      const receivedByDueMonth = d.receivedByDueMonth ?? d.receivedMonth;

      let text = `📊 *Relatório — ${month}*\n\n`;
      text += `💰 Recebido (pagamento no mês): *${formatCurrency(receivedByPaymentMonth)}*\n`;
      text += `🗓️ Recebido (vencimento no mês): *${formatCurrency(receivedByDueMonth)}*\n`;
      text += `📅 Esperado: *${formatCurrency(d.expectedMonth)}*\n`;
      text += `⚠️ Em atraso: *${formatCurrency(d.totalOverdue)}*\n`;
      text += `📋 Contratos ativos: *${d.activeContracts}*\n\n`;

      if (report.todayInstallments.length > 0) {
        text += `📅 *Vence hoje (${report.todayInstallments.length}):*\n`;
        report.todayInstallments.slice(0, 3).forEach(i => {
          text += `• ${i.debtorName} — ${formatCurrency(i.amount)}\n`;
        });
        text += '\n';
      }

      if (report.overdueDebtors.length > 0) {
        text += `🔴 *Em atraso (${report.overdueDebtors.length} devedores):*\n`;
        report.overdueDebtors.slice(0, 5).forEach((d: DebtorToCollect) => {
          text += `• ${d.name} — ${formatCurrency(d.totalDue)} (${d.daysLate}d)\n`;
        });
        text += '\n';
      }

      if (report.topDebtors.length > 0) {
        text += '👥 *Maiores devedores:*\n';
        report.topDebtors.forEach(d => {
          text += `• ${d.name} — ${formatCurrency(d.totalDebt)}\n`;
        });
      }

      return text.trim();
    }

    case 'desconectar': {
      const ok = await disconnectBot(session.channel, session.channel_user_id);
      return ok
        ? '✅ Conta desvinculada com sucesso. Até logo!\n\nPara reconectar, gere um novo código no dashboard web → Configurações → Assistente de Bolso.'
        : '❌ Erro ao desvincular. Tente novamente.';
    }

    default: {
      const naturalReply = await generateAgentResponse(
        { type: 'clarification', options: 'dashboard, recebiveis, criar contrato, marcar pagamento' },
        originalText,
      );
      return naturalReply || 'Não entendi bem o que precisa. Digite *ajuda* para ver o que posso fazer.';
    }
  }
}

async function handlePendingAction(
  session: Session,
  text: string,
  tenantId: string,
  profileId: string,
  messageId: string
): Promise<string> {
  const { pendingAction, pendingStep, pendingData } = session.context;

  if (/^(não|nao|cancela|cancelar|para|sair)$/i.test(text.trim())) {
    await clearSessionContext(session.id);
    return 'Ação cancelada. Pode me pedir outra coisa.';
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

    return `✅ *Contrato criado com sucesso!*\n\nContrato #${result.id}\nDevedor: ${result.debtorName}\nCPF: ${maskCpf(result.debtorCpf)}\nPrimeira parcela: ${result.firstInstallment}\n\nPara baixar, diga: *baixar contrato ${result.id}*`;
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
        return 'Ainda não consegui fechar os dados do contrato.\n\nMe diga em uma frase com: *nome do devedor + CPF + valor principal + total a pagar ou taxa + parcelas*.\nEx: *"Ícaro Soares, CPF 52998224725, 1000 por 2000, 10 parcelas, todo dia 5"*.';
      }

      const draft: ContractDraft = { ...parsed.draft };
      const normalizedCpf = normalizeCpf(draft.debtor_cpf);

      if (!normalizedCpf || !isValidCpf(normalizedCpf)) {
        await updateSessionContext(session.id, {
          pendingAction: 'criar_contrato',
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
        pendingStep: 2,
        pendingData: draft as unknown as Record<string, unknown>,
      });
      return formatContractConfirmation(draft);
    }

    if (pendingStep === 11) {
      const draft = (pendingData as unknown as ContractDraft) || null;
      if (!draft || !draft.debtor_name || !draft.amount) {
        await clearSessionContext(session.id);
        return 'Contexto expirado. Pode começar de novo.';
      }

      const extractedCpf = extractCpfFromText(text);
      if (!extractedCpf) return 'CPF não reconhecido. Envie o CPF com 11 dígitos (com ou sem máscara).';
      if (!isValidCpf(extractedCpf)) return 'CPF inválido. Verifique os dígitos e envie novamente.';

      draft.debtor_cpf = extractedCpf;
      if (draft.due_day && !draft.start_date) {
        draft.start_date = suggestFirstInstallmentDate(draft.due_day);
      }

      await updateSessionContext(session.id, {
        pendingAction: 'criar_contrato',
        pendingStep: 2,
        pendingData: draft as unknown as Record<string, unknown>,
      });

      return formatContractConfirmation(draft);
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

        return `✅ *Contrato criado com sucesso!*

Contrato #${result.id}
Devedor: ${result.debtorName}
CPF: ${maskCpf(result.debtorCpf)}
Primeira parcela: ${result.firstInstallment}

Para baixar, diga: *baixar contrato ${result.id}*`;
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

      return `✅ Parcela *${selected.number}* do *Contrato #${contractId}* marcada como *paga* (${formatCurrency(selected.amount)}).`;
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
      return `✅ Parcela de *${selected.debtorName}* (${formatCurrency(selected.amount)}) marcada como *paga*!`;
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

      const naturalReply = await generateAgentResponse(
        { type: 'success', action: 'marcar_pagamento', details: `Parcela de ${selected.debtorName}, ${formatCurrency(selected.amount)}, contrato #${selected.contractId}` },
        text,
      );
      return naturalReply || `✅ Parcela de *${selected.debtorName}* (${formatCurrency(selected.amount)}) marcada como *paga*!`;
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

function formatContractConfirmation(draft: ContractDraft): string {
  const freqMap: Record<string, string> = { monthly: 'mensal', weekly: 'semanal', biweekly: 'quinzenal' };
  const rateLabel = draft.derived_rate_source === 'period_total'
    ? `${draft.rate}% (taxa total do período)`
    : `${draft.rate}% a.m.`;
  const totalRepaymentLine = draft.total_repayment
    ? `\n🧾 Total a pagar: *${formatCurrency(draft.total_repayment)}*`
    : '';
  const dueDayLine = draft.due_day
    ? `\n🗓️ Vence todo dia: *${draft.due_day}*`
    : '';
  const firstDateLine = draft.start_date
    ? `\n📌 Primeira parcela sugerida: *${formatDate(draft.start_date)}*`
    : '';
  const cpfLine = draft.debtor_cpf
    ? `\n🪪 CPF: *${maskCpf(draft.debtor_cpf)}*`
    : '';

  return `Vou criar o seguinte contrato:\n\n👤 Devedor: *${draft.debtor_name}*${cpfLine}\n💰 Valor principal: *${formatCurrency(draft.amount)}*${totalRepaymentLine}\n📈 Taxa: *${rateLabel}*\n📅 Parcelas: *${draft.installments}x ${freqMap[draft.frequency] || draft.frequency}*${dueDayLine}${firstDateLine}\n\nConfirma? (sim/não)`;
}

function getHelpText(role: string): string {
  if (role === 'admin') {
    return `🤖 *Assistente e-finance — Comandos:*

📊 *Dashboard* — "como tá o mês?" / "resumo"
📋 *Relatório completo* — "gerar relatório"
📅 *Vence hoje* — "recebíveis de hoje"
🔴 *Cobrar hoje* — "quem tenho que cobrar hoje?"
📋 *Recebíveis* — "parcelas pendentes" / "quem tá atrasado"
📝 *Criar contrato* — "cria contrato pra João, CPF 52998224725, R$5.000, 3%, 12x"
✅ *Marcar pago* — "marcar pagamento" ou "baixar contrato 123 parcela 2"
🔍 *Buscar usuário* — "quanto o Carlos deve?"
🎫 *Gerar convite* — "gera um convite"
🚪 *Desconectar* — "desconectar" ou /desconectar

Pode falar normalmente ou enviar áudio! 🎤`;
  }
  return '🤖 *Assistente e-finance*\n\nPosso te ajudar a consultar seus dados. Tente perguntar naturalmente!';
}
