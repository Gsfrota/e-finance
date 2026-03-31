import { z } from 'zod';
import {
  createContract,
  extractAmount,
  extractDebtorNameSimple,
  extractInstallments,
  extractRate,
  isValidCpf,
  normalizeCpf,
  parseContractTextWithMeta,
  type ContractDraft,
  type CreateContractResult,
} from '../../actions/admin-actions';
import { formatContractConfirmationMessage, formatContractCreatedMessage } from '../../tools/formatters';
import {
  buildStructuredResponse,
  type CapabilityDefinition,
  type CapabilityExecuteResult,
  type CapabilityResolveResult,
  type ConversationWorkingState,
} from '../contracts';

export interface CreateContractCapabilityInput {
  debtor_name?: string;
  debtor_cpf?: string;
  amount?: number;
  rate?: number;
  installments?: number;
  frequency?: string;
  due_day?: number;
  start_date?: string;
  weekday?: number;
  total_repayment?: number;
  rename_mode?: 'use_existing' | 'replace_existing';
  conflict_existing_name?: string;
  conflict_requested_name?: string;
}

interface CreateContractCapabilityOutput {
  result: Extract<CreateContractResult, { status: 'success' }>;
  draft: ContractDraft;
}

const CPF_REQUIRED_MSG =
  'Para criar contrato com segurança, preciso do *CPF do devedor* (11 dígitos).\n\n'
  + 'Exemplo: *529.982.247-25*';

const TRANSIENT_REASONS = new Set([
  'rpc_failed',
  'lookup_failed',
  'create_failed',
  'update_failed',
  'requery_failed',
  'unexpected_exception',
]);

const createContractInputSchema = z.object({
  debtor_name: z.string().min(1).optional(),
  debtor_cpf: z.string().min(11).optional(),
  amount: z.number().positive().optional(),
  rate: z.number().min(0).max(1000).optional(),
  installments: z.number().int().positive().optional(),
  frequency: z.string().min(1).optional(),
  due_day: z.number().int().min(1).max(31).optional(),
  start_date: z.string().min(1).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  total_repayment: z.number().positive().optional(),
  rename_mode: z.enum(['use_existing', 'replace_existing']).optional(),
}).passthrough();

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extractCpfFromText(text: string): string | null {
  const directMatch = text.match(/(?:cpf\s*[:\-]?\s*)?(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i);
  if (directMatch?.[1]) {
    return normalizeCpf(directMatch[1]);
  }

  const groupedMatch = text.match(/(?:cpf\s*[:\-]?\s*)?((?:\d[\s.-]?){11})/i);
  if (groupedMatch?.[1]) {
    return normalizeCpf(groupedMatch[1]);
  }

  const digits = text.replace(/\D/g, '');
  if (digits.length === 11) {
    return normalizeCpf(digits);
  }

  return null;
}

function extractSpokenCpfFromText(text: string): string | null {
  const normalized = normalizeText(text);
  const cpfSection = normalized.match(/cpf\s+([a-z0-9\s,-]+)/i)?.[1] || '';
  if (!cpfSection) return null;

  const spokenDigitMap: Record<string, string> = {
    zero: '0',
    um: '1',
    uma: '1',
    dois: '2',
    tres: '3',
    quatro: '4',
    cinco: '5',
    seis: '6',
    sete: '7',
    oito: '8',
    nove: '9',
  };

  const digits = (cpfSection.match(/\b(?:zero|um|uma|dois|tres|quatro|cinco|seis|sete|oito|nove|\d)\b/g) || [])
    .map(token => spokenDigitMap[token] || token)
    .join('');

  return digits.length >= 11 ? normalizeCpf(digits.slice(0, 11)) : null;
}

function extractContractFrequency(text: string): 'monthly' | 'weekly' | 'biweekly' | 'daily' | null {
  const normalized = normalizeText(text);

  if (/de\s*15\s*em\s*15|cada\s*quinze\s*dias|quinzenal|quinzena|15\s*dias/.test(normalized)) return 'biweekly';
  if (/todo\s*santo\s*dia|todo\s*dia|diaria|diario|daily/.test(normalized)) return 'daily';
  if (/semanal|weekly|toda\s*semana|cada\s*semana/.test(normalized)) return 'weekly';
  if (/mensal|monthly|todo\s*mes|cada\s*mes/.test(normalized)) return 'monthly';
  return null;
}

function extractContractStartDate(text: string): string | null {
  const dateMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!dateMatch) return null;

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const rawYear = Number(dateMatch[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractContractDueDay(text: string): number | null {
  const match = text.match(/(?:todo\s+dia|dia\s+de\s+vencimento|vence\s+todo\s+dia|dia)\s*(\d{1,2})/i);
  if (!match?.[1]) return null;
  const day = Number(match[1]);
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : null;
}

function extractWeekday(text: string): number | null {
  const normalized = normalizeText(text);
  const weekdayMap: Record<string, number> = {
    domingo: 0, dom: 0, '0': 0, '7': 0,
    segunda: 1, seg: 1, '1': 1,
    terca: 2, ter: 2, '2': 2,
    quarta: 3, qua: 3, '3': 3,
    quinta: 4, qui: 4, '4': 4,
    sexta: 5, sex: 5, '5': 5,
    sabado: 6, sab: 6, '6': 6,
  };

  for (const [label, value] of Object.entries(weekdayMap)) {
    if (new RegExp(`\\b${label}\\b`).test(normalized)) {
      return value;
    }
  }
  return null;
}

function parseRenameMode(text: string): CreateContractCapabilityInput['rename_mode'] | undefined {
  const normalized = normalizeText(text);
  if (/^(1|usar|usar\s+nome|manter|manter\s+nome|cadastrado|nome\s+cadastrado|usar\s+nome\s+cadastrado)$/.test(normalized)) {
    return 'use_existing';
  }
  if (/^(2|substituir|trocar|atualizar|atualiza|substitui|troca\s+nome)$/.test(normalized)) {
    return 'replace_existing';
  }
  return undefined;
}

function shouldAttemptFullParse(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length < 12) return false;
  if (/^(sim|nao|não|1|2|pular|pula|ok|confirmo)$/.test(normalized)) return false;
  return /(contrato|emprestim|parcel|cpf|juros|mensal|semanal|quinzenal|diari|devedor|reais|mil)/.test(normalized);
}

function mergeInput(
  base: CreateContractCapabilityInput,
  patch: Partial<CreateContractCapabilityInput>,
): CreateContractCapabilityInput {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function fillMissingInput(
  base: CreateContractCapabilityInput,
  patch: Partial<CreateContractCapabilityInput>,
): CreateContractCapabilityInput {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') continue;
    const currentValue = (merged as Record<string, unknown>)[key];
    if (currentValue === undefined || currentValue === null || currentValue === '') {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function buildPatchFromText(text: string): Partial<CreateContractCapabilityInput> {
  const patch: Partial<CreateContractCapabilityInput> = {};
  const debtorName = extractDebtorNameSimple(text);
  if (debtorName) patch.debtor_name = debtorName;

  const debtorCpf = extractCpfFromText(text) || extractSpokenCpfFromText(text);
  if (debtorCpf) patch.debtor_cpf = debtorCpf;

  const amount = extractAmount(text);
  if (amount !== null) patch.amount = amount;

  const rate = /sem\s+juros|s\/\s*juros/i.test(text) ? 0 : extractRate(text);
  if (rate !== null) patch.rate = rate;

  const installments = extractInstallments(text);
  if (installments !== null) patch.installments = installments;
  if (/^(pula|pular|uma|1|padrao|padrão)$/i.test(text.trim())) {
    patch.installments = patch.installments ?? 1;
  }

  const frequency = extractContractFrequency(text);
  if (frequency) patch.frequency = frequency;

  const dueDay = extractContractDueDay(text);
  if (dueDay !== null) patch.due_day = dueDay;

  const startDate = extractContractStartDate(text);
  if (startDate) patch.start_date = startDate;

  const weekday = extractWeekday(text);
  if (weekday !== null) patch.weekday = weekday;

  const renameMode = parseRenameMode(text);
  if (renameMode) patch.rename_mode = renameMode;

  return patch;
}

function buildFocusedPatchFromText(
  text: string,
  currentInput: CreateContractCapabilityInput,
): Partial<CreateContractCapabilityInput> {
  const missingField = getMissingFields(currentInput)[0];
  const trimmed = text.trim();
  const numeric = trimmed.match(/^(\d{1,4})(?:[.,](\d{1,2}))?$/);

  switch (missingField) {
    case 'rate':
      if (/^(pula|pular|sem juros|s\/\s*juros)$/i.test(trimmed)) return { rate: 0 };
      if (numeric?.[1]) return { rate: Number(`${numeric[1]}${numeric[2] ? `.${numeric[2]}` : ''}`) };
      return {};
    case 'installments':
      if (/^(pula|pular|uma|1|parcela unica|parcela única)$/i.test(trimmed)) return { installments: 1 };
      if (numeric?.[1]) return { installments: Number(numeric[1]) };
      return {};
    case 'due_day':
      if (numeric?.[1]) return { due_day: Number(numeric[1]) };
      return {};
    case 'weekday': {
      const weekday = extractWeekday(text);
      return weekday !== null ? { weekday } : {};
    }
    case 'start_date': {
      const startDate = extractContractStartDate(text);
      return startDate ? { start_date: startDate } : {};
    }
    case 'amount': {
      const amount = extractAmount(text);
      if (amount !== null) return { amount };
      if (numeric?.[1]) {
        const parsed = Number(`${numeric[1]}${numeric[2] ? `.${numeric[2]}` : ''}`);
        return parsed >= 100 ? { amount: parsed } : {};
      }
      return {};
    }
    case 'frequency': {
      const frequency = extractContractFrequency(text);
      return frequency ? { frequency } : {};
    }
    case 'rename_mode': {
      const renameMode = parseRenameMode(text);
      return renameMode ? { rename_mode: renameMode } : {};
    }
    default:
      return {};
  }
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

function normalizeDraftInput(input: CreateContractCapabilityInput): CreateContractCapabilityInput {
  const next = { ...input };
  next.debtor_name = next.debtor_name?.trim();
  next.frequency = next.frequency?.trim().toLowerCase();
  next.debtor_cpf = normalizeCpf(next.debtor_cpf);

  if (next.frequency === 'monthly' && next.due_day && !next.start_date) {
    next.start_date = suggestFirstInstallmentDate(next.due_day);
  }
  return next;
}

function getMissingFields(input: CreateContractCapabilityInput): string[] {
  // BR-BOT-010: ordem determinística — nome → valor → taxa → parcelas → CPF → frequência → vencimento
  if (!input.debtor_name) return ['debtor_name'];
  if (input.amount === undefined || input.amount === null) return ['amount'];
  if (input.rate === undefined || input.rate === null) return ['rate'];
  if (input.installments === undefined || input.installments === null) return ['installments'];
  if (!input.debtor_cpf || !isValidCpf(input.debtor_cpf)) return ['debtor_cpf'];
  if (!input.frequency) return ['frequency'];

  if (input.conflict_existing_name && input.conflict_requested_name && !input.rename_mode) {
    return ['rename_mode'];
  }

  if (input.frequency === 'monthly' && (input.due_day === undefined || input.due_day === null)) {
    return ['due_day'];
  }
  if (input.frequency === 'weekly' && (input.weekday === undefined || input.weekday === null)) {
    return ['weekday'];
  }
  if ((input.frequency === 'biweekly' || input.frequency === 'daily') && !input.start_date) {
    return ['start_date'];
  }

  return [];
}

function getClarificationMessage(input: CreateContractCapabilityInput, missingField: string): string {
  switch (missingField) {
    case 'debtor_name':
      return 'Qual é o *nome completo do devedor*?';
    case 'debtor_cpf':
      return CPF_REQUIRED_MSG;
    case 'amount':
      return 'Qual é o *valor principal* emprestado? (Ex: *R$ 5.000* ou *20 mil*)';
    case 'rate':
      return 'Qual é a *taxa de juros mensal* (% a.m.)? Se não houver juros, responda *pular*.';
    case 'installments':
      return 'Quantas *parcelas*? Se for uma parcela única, responda *pular*.';
    case 'frequency':
      return 'Qual a *modalidade de cobrança*? Responda com *mensal*, *semanal*, *quinzenal* ou *diária*.';
    case 'due_day':
      return 'Qual o *dia do mês* para cobrar? (1 a 31, ex: *5* ou *dia 10*)';
    case 'weekday':
      return 'Qual o *dia da semana*? (segunda, terça, quarta, quinta, sexta, sábado ou domingo)';
    case 'start_date':
      return 'Qual é a *data da primeira parcela*? (ex: *10/04/2026*)';
    case 'rename_mode':
      return `CPF já cadastrado para *${input.conflict_existing_name}*.\n\nDeseja:\n1) *Usar nome cadastrado*\n2) *Substituir para ${input.conflict_requested_name}*\n\nResponda com *1* ou *2*.`;
    default:
      return 'Ainda falta um dado para eu fechar o contrato com segurança.';
  }
}

function toDraft(input: CreateContractCapabilityInput): ContractDraft {
  return {
    debtor_name: String(input.debtor_name || '').trim(),
    debtor_cpf: String(normalizeCpf(input.debtor_cpf) || ''),
    amount: Number(input.amount || 0),
    rate: Number(input.rate ?? 0),
    installments: Math.max(1, Number(input.installments || 1)),
    frequency: String(input.frequency || 'monthly'),
    due_day: input.frequency === 'monthly'
      ? Number(input.due_day)
      : input.frequency === 'weekly'
        ? Number(input.weekday)
        : undefined,
    start_date: input.start_date,
    total_repayment: input.total_repayment,
  };
}

function stripConfirmationSuffix(message: string): string {
  return message
    .replace(/\n\nConfirma\? \(sim\/n[aã]o\)\s*$/i, '')
    .trim();
}

function textToStructuredResponse(message: string) {
  const lines = message.split('\n').map(line => line.trimEnd()).filter(Boolean);
  return buildStructuredResponse({
    status: 'ok',
    title: lines[0] || 'Resposta',
    facts: lines.slice(1),
    safePreview: message,
  });
}

function buildWorkingStatePatch(
  input: CreateContractCapabilityInput,
  missingSlots: string[],
): Partial<ConversationWorkingState> {
  return {
    pendingCapability: 'create_contract',
    pendingOperationInput: { ...input },
    missingSlots: [...missingSlots],
    pendingMissingFields: [...missingSlots],
    focusedEntity: input.debtor_name
      ? { type: 'debtor', label: input.debtor_name }
      : undefined,
    legacyPending: undefined,
  };
}

export const createContractCapability: CapabilityDefinition<CreateContractCapabilityInput, CreateContractCapabilityOutput> = {
  name: 'create_contract',
  kind: 'mutation',
  rolesAllowed: ['admin'],
  requiredArgs: [],
  optionalArgs: ['debtor_name', 'debtor_cpf', 'amount', 'rate', 'installments', 'frequency', 'due_day', 'start_date', 'weekday', 'total_repayment', 'rename_mode'],
  requiresConfirmation: true,
  idempotencyScope: 'mutation',
  inputSchema: createContractInputSchema,
  replyMode: 'rewrite',
  async resolve(ctx, input) {
    let merged = mergeInput(
      (ctx.workingState.pendingCapability === 'create_contract'
        ? ((ctx.workingState.pendingOperationInput || {}) as CreateContractCapabilityInput)
        : {}),
      input,
    );

    if (shouldAttemptFullParse(ctx.rawText)) {
      const parsed = await parseContractTextWithMeta(ctx.rawText);
      if (parsed.draft) {
        merged = mergeInput(merged, parsed.draft);
      }
    }

    merged = mergeInput(merged, buildFocusedPatchFromText(ctx.rawText, merged));
    merged = fillMissingInput(merged, buildPatchFromText(ctx.rawText));
    merged = normalizeDraftInput(merged);

    const missingFields = getMissingFields(merged);
    if (missingFields.length > 0) {
      return {
        status: 'needs_clarification',
        safeUserMessage: getClarificationMessage(merged, missingFields[0]),
        workingStatePatch: buildWorkingStatePatch(merged, missingFields),
      } satisfies CapabilityResolveResult<CreateContractCapabilityInput>;
    }

    const draft = toDraft(merged);
    return {
      status: 'ready',
      input: {
        ...merged,
        debtor_cpf: draft.debtor_cpf,
      },
      confirmationPreview: stripConfirmationSuffix(formatContractConfirmationMessage(draft)),
      workingStatePatch: buildWorkingStatePatch(merged, []),
    } satisfies CapabilityResolveResult<CreateContractCapabilityInput>;
  },
  authorize(ctx) {
    if (ctx.role !== 'admin') {
      throw new Error('role_forbidden');
    }
    if (!ctx.tenantId) {
      throw new Error('missing_tenant');
    }
    if (!ctx.profileId) {
      throw new Error('missing_profile');
    }
  },
  async execute(ctx, input) {
    const draft = toDraft(input);
    const result = await createContract(ctx.tenantId, ctx.profileId, draft, input.rename_mode || 'ask');

    if (result.status === 'conflict_name') {
      const nextInput: CreateContractCapabilityInput = {
        ...input,
        debtor_cpf: result.debtorCpf,
        conflict_existing_name: result.existingName,
        conflict_requested_name: result.requestedName,
        rename_mode: undefined,
      };
      return {
        status: 'needs_clarification',
        safeUserMessage: getClarificationMessage(nextInput, 'rename_mode'),
        workingStatePatch: buildWorkingStatePatch(nextInput, ['rename_mode']),
      } satisfies CapabilityExecuteResult<CreateContractCapabilityOutput>;
    }

    if (result.status !== 'success') {
      const retryHint = TRANSIENT_REASONS.has(result.reason)
        ? ' Houve instabilidade operacional; você pode repetir a confirmação para tentar novamente.'
        : '';
      return {
        status: 'error',
        safeUserMessage: `❌ Não foi possível criar o contrato agora.${retryHint}`,
        workingStatePatch: {
          pendingCapability: 'create_contract',
          pendingOperationInput: { ...input },
          legacyPending: undefined,
        },
      } satisfies CapabilityExecuteResult<CreateContractCapabilityOutput>;
    }

    return {
      status: 'ok',
      output: { result, draft },
      workingStatePatch: {
        pendingCapability: undefined,
        pendingOperationInput: undefined,
        pendingMissingFields: [],
        missingSlots: [],
        focusedEntity: { type: 'contract', id: String(result.id), label: `Contrato #${result.id}` },
        legacyPending: undefined,
      },
    } satisfies CapabilityExecuteResult<CreateContractCapabilityOutput>;
  },
  formatResult(output) {
    return textToStructuredResponse(formatContractCreatedMessage(output.result, output.draft));
  },
};
