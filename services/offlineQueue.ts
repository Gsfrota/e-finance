const STORAGE_KEY = 'EF_OFFLINE_PAYMENT_QUEUE';
const SCHEMA_VERSION = 1;
export const OFFLINE_FINANCIAL_CHANGE_EVENT = 'ef:offline-financial-change';

export type OfflineIntentStatus = 'pending' | 'rejected';

export interface OfflinePaymentIntent {
  id: string;
  tenantId: string;
  installmentId: string;
  investmentId: number;
  companyId: string | null;
  installmentNumber: number;
  debtorName: string;
  contractName: string;
  amount: number;
  paidAt: string;
  createdAt: string;
  status: OfflineIntentStatus;
  errorMessage: string | null;
}

export interface EnqueueOfflinePaymentInput {
  tenantId: string;
  installmentId: string;
  investmentId: number;
  companyId?: string | null;
  installmentNumber: number;
  debtorName?: string;
  contractName?: string;
  amount: number;
  paidAt: string;
}

interface StoredQueue {
  version: number;
  intents: OfflinePaymentIntent[];
}

type QueueListener = () => void;
const listeners = new Set<QueueListener>();

function storage(): Storage {
  if (typeof localStorage === 'undefined') {
    throw new Error('Armazenamento local indisponível neste dispositivo.');
  }
  return localStorage;
}

function isIntent(value: unknown): value is OfflinePaymentIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<OfflinePaymentIntent>;
  return (
    typeof intent.id === 'string' &&
    typeof intent.tenantId === 'string' &&
    typeof intent.installmentId === 'string' &&
    typeof intent.investmentId === 'number' &&
    (intent.companyId === null || typeof intent.companyId === 'string') &&
    typeof intent.installmentNumber === 'number' &&
    typeof intent.debtorName === 'string' &&
    typeof intent.contractName === 'string' &&
    typeof intent.amount === 'number' &&
    typeof intent.paidAt === 'string' &&
    typeof intent.createdAt === 'string' &&
    (intent.status === 'pending' || intent.status === 'rejected') &&
    (intent.errorMessage === null || typeof intent.errorMessage === 'string')
  );
}

function readQueue(): StoredQueue {
  const raw = storage().getItem(STORAGE_KEY);
  if (!raw) return { version: SCHEMA_VERSION, intents: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('A fila de baixas está corrompida. Não registre outra baixa neste aparelho.');
  }

  const queue = parsed as Partial<StoredQueue>;
  if (queue.version !== SCHEMA_VERSION || !Array.isArray(queue.intents) || !queue.intents.every(isIntent)) {
    throw new Error('A versão local da fila de baixas é incompatível. Atualize o aplicativo antes de continuar.');
  }
  return { version: SCHEMA_VERSION, intents: queue.intents };
}

function writeQueue(intents: OfflinePaymentIntent[]): void {
  storage().setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, intents } satisfies StoredQueue));
  listeners.forEach((listener) => {
    try { listener(); } catch { /* o dado já persistiu; listener de UI não pode revertê-lo */ }
  });
}

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Este navegador não consegue gerar o identificador seguro da baixa.');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function enqueueOfflinePayment(input: EnqueueOfflinePaymentInput): OfflinePaymentIntent {
  if (!input.tenantId || !input.installmentId || !Number.isInteger(input.investmentId)) {
    throw new Error('A parcela não tem identificação suficiente para registrar a baixa offline.');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('O valor da baixa deve ser maior que zero.');
  }
  if (!input.paidAt || Number.isNaN(Date.parse(input.paidAt))) {
    throw new Error('A data do pagamento é inválida.');
  }

  const intent: OfflinePaymentIntent = {
    id: createUuid(),
    tenantId: input.tenantId,
    installmentId: input.installmentId,
    investmentId: input.investmentId,
    companyId: input.companyId ?? null,
    installmentNumber: input.installmentNumber,
    debtorName: input.debtorName?.trim() || 'Cliente',
    contractName: input.contractName?.trim() || 'Contrato',
    amount: input.amount,
    paidAt: input.paidAt,
    createdAt: new Date().toISOString(),
    status: 'pending',
    errorMessage: null,
  };

  const queue = readQueue();
  writeQueue([...queue.intents, intent]);
  return intent;
}

export function listOfflineIntents(tenantId?: string): OfflinePaymentIntent[] {
  const intents = readQueue().intents
    .filter((intent) => !tenantId || intent.tenantId === tenantId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return intents.map((intent) => ({ ...intent }));
}

export function markOfflineIntentApplied(id: string): void {
  const queue = readQueue();
  writeQueue(queue.intents.filter((intent) => intent.id !== id));
}

export function markOfflineIntentRejected(id: string, errorMessage: string): void {
  const queue = readQueue();
  let found = false;
  const intents = queue.intents.map((intent) => {
    if (intent.id !== id) return intent;
    found = true;
    return {
      ...intent,
      status: 'rejected' as const,
      errorMessage: errorMessage.trim() || 'O servidor recusou esta baixa.',
    };
  });
  if (!found) throw new Error('Intenção de baixa não encontrada na fila local.');
  writeQueue(intents);
}

export function markOfflineIntentPending(id: string): void {
  const queue = readQueue();
  let found = false;
  const intents = queue.intents.map((intent) => {
    if (intent.id !== id) return intent;
    found = true;
    return { ...intent, status: 'pending' as const, errorMessage: null };
  });
  if (!found) throw new Error('Intenção de baixa não encontrada na fila local.');
  writeQueue(intents);
}

export function removeOfflineIntent(id: string): void {
  const queue = readQueue();
  if (!queue.intents.some((intent) => intent.id === id)) {
    throw new Error('Intenção de baixa não encontrada na fila local.');
  }
  writeQueue(queue.intents.filter((intent) => intent.id !== id));
}

export function subscribeOfflineQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const OFFLINE_QUEUE_STORAGE_KEY = STORAGE_KEY;
