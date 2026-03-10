import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

let _genai: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!_genai) _genai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return _genai;
}

export type Intent =
  | 'ver_dashboard'
  | 'listar_recebiveis'
  | 'recebiveis_hoje'
  | 'cobrar_hoje'
  | 'recebiveis_periodo'
  | 'cobrar_periodo'
  | 'criar_contrato'
  | 'marcar_pagamento'
  | 'buscar_usuario'
  | 'gerar_convite'
  | 'gerar_relatorio'
  | 'desconectar'
  | 'confirmar'
  | 'cancelar'
  | 'ajuda'
  | 'ver_minhas_parcelas'
  | 'ver_meu_saldo_devedor'
  | 'ver_meu_portfolio'
  | 'desconhecido';

export interface NormalizedEntities {
  debtor_name?: string;
  debtor_cpf?: string;
  amount?: number;
  rate?: number;
  installments?: number;
  frequency?: 'monthly' | 'weekly' | 'biweekly';
  installment_id?: string;
  filter?: 'pending' | 'late' | 'week' | 'all';
  contract_id?: number;
  installment_number?: number;
  installment_month?: number;
  installment_year?: number;
  days_ahead?: number;
  window_start?: 'today' | 'tomorrow';
}

export interface ClassifiedIntent {
  intent: Intent;
  entities: Record<string, string | number>;
  normalizedEntities: NormalizedEntities;
  confidence: 'high' | 'medium' | 'low';
  usage?: { tokensInput: number; tokensOutput: number };
  meta?: {
    model?: string;
    timeout?: boolean;
    fallbackReason?: string;
  };
}

interface ClassifyCompactOptions {
  maxInputChars?: number;
  maxHistoryItems?: number;
  maxHistoryChars?: number;
  maxOutputTokens?: number;
}

const CLASSIFIER_MODEL = 'gemini-2.5-flash-lite';

const INTENT_SYSTEM_PROMPT = `Você é um classificador de intenções para um sistema financeiro de contratos de crédito (Juros Certo).
Classifique a mensagem do usuário em uma das intenções disponíveis e extraia as entidades relevantes.

Intenções disponíveis:
- ver_dashboard
- listar_recebiveis
- recebiveis_hoje
- cobrar_hoje
- recebiveis_periodo
- cobrar_periodo
- criar_contrato
- marcar_pagamento
- buscar_usuario
- gerar_convite
- gerar_relatorio
- desconectar
- confirmar
- cancelar
- ajuda
- ver_minhas_parcelas
- ver_meu_saldo_devedor
- ver_meu_portfolio
- desconhecido

Responda APENAS com JSON válido no formato:
{
  "intent": "<nome_da_intencao>",
  "entities": {
    "debtor_name": "<nome do devedor se mencionado>",
    "debtor_cpf": "<cpf do devedor com ou sem máscara>",
    "amount": <valor numerico>,
    "rate": <taxa em %>,
    "installments": <numero de parcelas>,
    "frequency": "<monthly|weekly|biweekly>",
    "installment_id": "<id da parcela>",
    "filter": "<pending|late|week|all>",
    "contract_id": <id numérico do contrato>,
    "installment_number": <número da parcela>,
    "installment_month": <mês da parcela 1..12>,
    "installment_year": <ano da parcela 4 dígitos>,
    "days_ahead": <janela em dias 1..60>,
    "window_start": "<today|tomorrow>"
  },
  "confidence": "<high|medium|low>"
}`;

const INTENT_COMPACT_PROMPT = `Classifique intenção financeira em PT-BR coloquial e extraia entidades.
Use APENAS:
intent: ver_dashboard|listar_recebiveis|recebiveis_hoje|cobrar_hoje|recebiveis_periodo|cobrar_periodo|criar_contrato|marcar_pagamento|buscar_usuario|gerar_convite|gerar_relatorio|desconectar|confirmar|cancelar|ajuda|ver_minhas_parcelas|ver_meu_saldo_devedor|ver_meu_portfolio|desconhecido
confidence: high|medium|low
entities: debtor_name, debtor_cpf, amount, rate, installments, frequency, installment_id, filter, contract_id, installment_number, installment_month (1-12 se mes mencionado), installment_year (4 digitos se ano mencionado), days_ahead (1..60), window_start (today|tomorrow)

Exemplos por intencao:
- cobrar_hoje: "quem ta me devendo hoje", "quem devo cobrar hoje", "quem me deve hoje", "quem eu cobro hoje"
- cobrar_periodo: "quem devo cobrar nos próximos 7 dias", "a partir de amanhã, quem devo cobrar nos próximos 3 dias"
- recebiveis_periodo: "quanto vou receber nos próximos 15 dias", "recebíveis dos próximos 7 dias"
- marcar_pagamento: "dar baixa na parcela de janeiro de X", "registrar pagamento do mes de fevereiro de Y", "quitar parcela de marco do Joao", "baixar pagamento de X"
- buscar_usuario: "quanto X deve", "qual a divida de X", "me fala da divida do Joao"
- listar_recebiveis: "quem ta atrasado", "quem ta devendo", "parcelas em aberto"
- ver_minhas_parcelas: "minhas parcelas", "quando vence minha parcela", "meus vencimentos"
- ver_meu_saldo_devedor: "quanto devo", "minha dívida", "saldo devedor meu"
- ver_meu_portfolio: "meus contratos", "minha carteira", "meus recebíveis"

Para marcar_pagamento com mes: extraia debtor_name e installment_month (jan=1, fev=2, mar=3, abr=4, mai=5, jun=6, jul=7, ago=8, set=9, out=10, nov=11, dez=12).
Retorne SOMENTE JSON valido.`;

const INTENT_SET = new Set<Intent>([
  'ver_dashboard',
  'listar_recebiveis',
  'recebiveis_hoje',
  'cobrar_hoje',
  'recebiveis_periodo',
  'cobrar_periodo',
  'criar_contrato',
  'marcar_pagamento',
  'buscar_usuario',
  'gerar_convite',
  'gerar_relatorio',
  'desconectar',
  'confirmar',
  'cancelar',
  'ajuda',
  'ver_minhas_parcelas',
  'ver_meu_saldo_devedor',
  'ver_meu_portfolio',
  'desconhecido',
]);

const CONFIDENCE_SET = new Set(['high', 'medium', 'low']);

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value
    .toLowerCase()
    .replace(/r\$/g, '')
    .replace(/\s+/g, '')
    .replace(/mil/g, '000')
    .replace(/k/g, '000')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');

  const n = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function toPositiveInt(value: unknown): number | undefined {
  const n = toNumber(value);
  if (n === undefined) return undefined;
  const rounded = Math.round(n);
  if (!Number.isFinite(rounded) || rounded <= 0) return undefined;
  return rounded;
}

function normalizeCpfEntity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return undefined;
  return digits;
}

const MONTH_MAP: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, março: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

export function inferInstallmentMonth(text: string): { month?: number; year?: number } {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const now = new Date();

  if (/mes\s+passado|ultimo\s+mes/.test(normalized)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  }
  if (/este\s+mes|mes\s+atual|esse\s+mes/.test(normalized)) {
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  }

  const patterns = [
    /(?:parcela|mes|pagamento|vencimento|referente\s+a(?:o)?)\s+(?:de\s+)?(\w+)(?:\s+(?:de\s+)?(\d{4}))?/i,
    /(?:de|do|da)\s+mes\s+(?:de\s+)?(\w+)(?:\s+(?:de\s+)?(\d{4}))?/i,
    /(\w+)(?:\s+(?:de\s+)?(\d{4}))?(?:\s+do\s+|\s+de\s+|\s+da\s+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const monthCandidate = match[1]?.toLowerCase();
    if (!monthCandidate) continue;
    const month = MONTH_MAP[monthCandidate];
    if (!month) continue;
    const year = match[2] ? parseInt(match[2], 10) : undefined;
    return { month, year };
  }

  for (const [name, num] of Object.entries(MONTH_MAP)) {
    const regex = new RegExp(`\\b${name}\\b`);
    if (regex.test(normalized)) {
      const yearMatch = normalized.match(/\b(20\d{2})\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
      return { month: num, year };
    }
  }

  return {};
}

export function inferDaysWindow(text: string): { daysAhead?: number; windowStart?: 'today' | 'tomorrow' } {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const windowStart: 'today' | 'tomorrow' = /(a partir de amanha|comecando amanha|desde amanha|de amanha em diante|amanha)/.test(normalized)
    ? 'tomorrow'
    : 'today';

  const explicitDays = [
    normalized.match(/proxim(?:o|os|a|as)\s+(\d{1,2})\s+dias?/),
    normalized.match(/(\d{1,2})\s+dias?\s+(?:a\s+frente|adiante|seguintes)/),
    normalized.match(/janela\s+de\s+(\d{1,2})\s+dias?/),
  ].find(Boolean);

  if (explicitDays?.[1]) {
    const days = Number(explicitDays[1]);
    if (Number.isFinite(days) && days >= 1 && days <= 60) {
      return { daysAhead: days, windowStart };
    }
  }

  if (/proxim(?:a|o)\s+semana|7\s*dias/.test(normalized)) {
    return { daysAhead: 7, windowStart };
  }

  if (/proxim(?:os|as)\s+dias/.test(normalized)) {
    return { daysAhead: 7, windowStart };
  }

  return { windowStart };
}

export function normalizeFrequency(value: unknown): NormalizedEntities['frequency'] {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();

  if (normalized === 'monthly' || /mensal/.test(normalized)) return 'monthly';
  if (normalized === 'weekly' || /semanal|semana/.test(normalized)) return 'weekly';
  if (normalized === 'biweekly' || /quinzenal|quinzena/.test(normalized)) return 'biweekly';

  return undefined;
}

export function normalizeFilter(value: unknown): NormalizedEntities['filter'] {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();

  if (normalized === 'pending' || /pendente|aberto/.test(normalized)) return 'pending';
  if (normalized === 'late' || /atrasad|vencid|inadimpl|devendo/.test(normalized)) return 'late';
  if (normalized === 'week' || /semana|7\s*dias/.test(normalized)) return 'week';
  if (normalized === 'all' || /todos|todas|geral|completo/.test(normalized)) return 'all';

  return undefined;
}

function normalizeWindowStart(value: unknown): NormalizedEntities['window_start'] {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (normalized === 'tomorrow' || /amanha/.test(normalized)) return 'tomorrow';
  if (normalized === 'today' || /hoje/.test(normalized)) return 'today';
  return undefined;
}

export function normalizeEntities(
  entities: Record<string, unknown> = {}
): NormalizedEntities {
  const normalized: NormalizedEntities = {};

  const debtor = entities.debtor_name;
  if (typeof debtor === 'string' && debtor.trim()) {
    normalized.debtor_name = debtor.trim();
  }

  const debtorCpf = normalizeCpfEntity(entities.debtor_cpf ?? entities.cpf);
  if (debtorCpf) normalized.debtor_cpf = debtorCpf;

  const amount = toNumber(entities.amount);
  if (amount !== undefined) normalized.amount = amount;

  const rate = toNumber(entities.rate);
  if (rate !== undefined) normalized.rate = rate;

  const installments = toPositiveInt(entities.installments);
  if (installments !== undefined) normalized.installments = installments;

  const frequency = normalizeFrequency(entities.frequency);
  if (frequency) normalized.frequency = frequency;

  if (typeof entities.installment_id === 'string' && entities.installment_id.trim()) {
    normalized.installment_id = entities.installment_id.trim();
  }

  const filter = normalizeFilter(entities.filter);
  if (filter) normalized.filter = filter;

  const contractId = toPositiveInt(entities.contract_id);
  if (contractId !== undefined) normalized.contract_id = contractId;

  const installmentNumber = toPositiveInt(entities.installment_number);
  if (installmentNumber !== undefined) normalized.installment_number = installmentNumber;

  const installmentMonth = toPositiveInt(entities.installment_month);
  if (installmentMonth !== undefined && installmentMonth >= 1 && installmentMonth <= 12) {
    normalized.installment_month = installmentMonth;
  }

  const installmentYear = toPositiveInt(entities.installment_year);
  if (installmentYear !== undefined && installmentYear >= 2020 && installmentYear <= 2099) {
    normalized.installment_year = installmentYear;
  }

  const daysAhead = toPositiveInt(entities.days_ahead ?? entities.days ?? entities.period_days);
  if (daysAhead !== undefined && daysAhead >= 1 && daysAhead <= 60) {
    normalized.days_ahead = daysAhead;
  }

  const windowStart = normalizeWindowStart(entities.window_start ?? entities.start_from);
  if (windowStart) {
    normalized.window_start = windowStart;
  }

  return normalized;
}

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return cleaned.slice(start, end + 1);
  }

  return '{}';
}

function fallbackClassification(reason: string, timeout = false): ClassifiedIntent {
  return {
    intent: 'desconhecido',
    entities: {},
    normalizedEntities: {},
    confidence: 'low',
    meta: {
      model: CLASSIFIER_MODEL,
      timeout,
      fallbackReason: reason,
    },
  };
}

function parseClassificationResult(rawText: string): ClassifiedIntent {
  const parsed = JSON.parse(extractJson(rawText || '{}'));
  const intent = INTENT_SET.has(parsed.intent) ? parsed.intent : 'desconhecido';
  const entities = (parsed.entities && typeof parsed.entities === 'object') ? parsed.entities : {};
  const confidence = CONFIDENCE_SET.has(parsed.confidence) ? parsed.confidence : 'low';

  return {
    intent,
    entities,
    normalizedEntities: normalizeEntities(entities),
    confidence,
    meta: {
      model: CLASSIFIER_MODEL,
    },
  };
}

function buildPrompt(
  systemPrompt: string,
  text: string,
  conversationHistory: Array<{ role: string; content: string }>
): string {
  const historyText = conversationHistory.length > 0
    ? `\nHistórico recente:\n${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}\n`
    : '';

  return `${systemPrompt}\n${historyText}Mensagem atual do usuário: "${text}"`;
}

export function compactConversationHistory(
  conversationHistory: Array<{ role: string; content: string }>,
  maxItems = 6,
  maxCharsPerMessage = 220
): Array<{ role: string; content: string }> {
  const compacted: Array<{ role: string; content: string }> = [];
  const seen = new Set<string>();

  for (let i = conversationHistory.length - 1; i >= 0; i -= 1) {
    const item = conversationHistory[i];
    const role = item.role === 'assistant' ? 'assistant' : 'user';
    const content = (item.content || '').replace(/\s+/g, ' ').trim();
    if (!content) continue;

    const truncated = content.length > maxCharsPerMessage
      ? `${content.slice(0, maxCharsPerMessage)}...`
      : content;

    const dedupeKey = `${role}:${truncated.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    compacted.push({ role, content: truncated });
    if (compacted.length >= maxItems) break;
  }

  return compacted.reverse();
}

async function classifyWithPrompt(
  prompt: string,
  maxOutputTokens: number,
): Promise<ClassifiedIntent> {
  const result = await ai().models.generateContent({
    model: CLASSIFIER_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0,
      maxOutputTokens,
      responseMimeType: 'application/json',
    },
  });

  const classified = parseClassificationResult(result.text?.trim() || '{}');
  const tokensInput = (result.usageMetadata as Record<string, number> | undefined)?.promptTokenCount ?? 0;
  const tokensOutput = (result.usageMetadata as Record<string, number> | undefined)?.candidatesTokenCount ?? 0;
  if (tokensInput > 0 || tokensOutput > 0) {
    classified.usage = { tokensInput, tokensOutput };
  }
  return classified;
}

export async function classifyIntent(
  text: string,
  conversationHistory: Array<{ role: string; content: string }> = []
): Promise<ClassifiedIntent> {
  try {
    const compactedHistory = compactConversationHistory(conversationHistory, 6, 220);
    const prompt = buildPrompt(INTENT_SYSTEM_PROMPT, text.slice(0, 1200), compactedHistory);
    return await classifyWithPrompt(prompt, 180);
  } catch {
    return fallbackClassification('classifier_exception');
  }
}

export async function classifyIntentCompact(
  text: string,
  conversationHistory: Array<{ role: string; content: string }> = [],
  options: ClassifyCompactOptions = {}
): Promise<ClassifiedIntent> {
  const maxInputChars = options.maxInputChars ?? config.llmRouter.maxInputChars;
  const maxHistoryItems = options.maxHistoryItems ?? config.llmRouter.historyItems;
  const maxHistoryChars = options.maxHistoryChars ?? config.llmRouter.historyChars;
  const maxOutputTokens = options.maxOutputTokens ?? config.llmRouter.maxOutputTokens;

  try {
    const compactedHistory = compactConversationHistory(conversationHistory, maxHistoryItems, maxHistoryChars);
    const prompt = buildPrompt(INTENT_COMPACT_PROMPT, text.slice(0, maxInputChars), compactedHistory);
    return await classifyWithPrompt(prompt, maxOutputTokens);
  } catch {
    return fallbackClassification('classifier_compact_exception');
  }
}

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  try {
    const base64 = audioBuffer.toString('base64');
    const result = await ai().models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: 'Transcreva este áudio em português brasileiro. Retorne apenas o texto transcrito, sem comentários.' },
          ],
        },
      ],
    });
    return result.text?.trim() || '';
  } catch {
    return '';
  }
}

export async function analyzeImage(imageBuffer: Buffer, mimeType: string): Promise<string> {
  try {
    const base64 = imageBuffer.toString('base64');
    const result = await ai().models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: 'Descreva esta imagem em português brasileiro, focando em dados financeiros, números, nomes e datas que pareçam úteis para registrar no sistema.' },
          ],
        },
      ],
    });

    return result.text?.trim() || 'Não consegui analisar a imagem.';
  } catch {
    return 'Não consegui analisar a imagem.';
  }
}
