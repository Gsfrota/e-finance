import fs from 'node:fs';
import path from 'node:path';
import { expect, vi } from 'vitest';
import type { AgentEvalCase, AgentEvalExpectation, AgentEvalHarnessState, AgentEvalResult } from './contracts';

const mocks = vi.hoisted(() => ({
  routeIntent: vi.fn(),
  transcribeAudioDetailed: vi.fn(),
  analyzeImage: vi.fn(),
  inferInstallmentMonth: vi.fn(),
  renderConversationalReply: vi.fn(),
  generateGreeting: vi.fn(),

  getOrCreateSession: vi.fn(),
  syncSessionProfileFromChannelBinding: vi.fn(),
  updateSessionContext: vi.fn(),
  clearSessionContext: vi.fn(),
  linkProfileToSession: vi.fn(),
  saveMessage: vi.fn(),
  getRecentMessages: vi.fn(),
  getProfileByChannelBinding: vi.fn(),

  getDashboardSummary: vi.fn(),
  getInstallments: vi.fn(),
  getInstallmentsToday: vi.fn(),
  getDebtorsToCollectToday: vi.fn(),
  getInstallmentsInWindow: vi.fn(),
  getDebtorsToCollectInWindow: vi.fn(),
  getInstallmentsByDateRange: vi.fn(),
  getDebtorsToCollectByDateRange: vi.fn(),
  buildDateWindow: vi.fn(),
  generateMonthlyReport: vi.fn(),
  parseContractTextWithMeta: vi.fn(),
  createContract: vi.fn(),
  markInstallmentPaid: vi.fn(),
  searchUser: vi.fn(),
  getUserDebt: vi.fn(),
  getUserDebtDetails: vi.fn(),
  generateInvite: vi.fn(),
  validateLinkCode: vi.fn(),
  disconnectBot: vi.fn(),
  getContractOpenInstallments: vi.fn(),
  getContractOpenInstallmentByNumber: vi.fn(),
  getInstallmentByDebtorAndMonth: vi.fn(),
  listCompaniesByTenant: vi.fn(),

  getBotTenantConfig: vi.fn(),
  checkWhitelistBlock: vi.fn(),

  logStructuredMessage: vi.fn(),
  estimateCostUsd: vi.fn(),
}));

vi.mock('../../src/ai/intent-router', () => ({
  routeIntent: mocks.routeIntent,
}));

vi.mock('../../src/ai/intent-classifier', () => ({
  analyzeImage: mocks.analyzeImage,
  inferInstallmentMonth: mocks.inferInstallmentMonth,
}));

vi.mock('../../src/ai/audio-pipeline', () => ({
  transcribeAudioDetailed: mocks.transcribeAudioDetailed,
}));

vi.mock('../../src/ai/response-generator', () => ({
  renderConversationalReply: mocks.renderConversationalReply,
  generateGreeting: mocks.generateGreeting,
}));

vi.mock('../../src/session/session-manager', () => ({
  getOrCreateSession: mocks.getOrCreateSession,
  syncSessionProfileFromChannelBinding: mocks.syncSessionProfileFromChannelBinding,
  updateSessionContext: mocks.updateSessionContext,
  clearSessionContext: mocks.clearSessionContext,
  linkProfileToSession: mocks.linkProfileToSession,
  saveMessage: mocks.saveMessage,
  getRecentMessages: mocks.getRecentMessages,
  getProfileByChannelBinding: mocks.getProfileByChannelBinding,
}));

vi.mock('../../src/actions/admin-actions', () => ({
  getDashboardSummary: mocks.getDashboardSummary,
  getInstallments: mocks.getInstallments,
  getInstallmentsToday: mocks.getInstallmentsToday,
  getDebtorsToCollectToday: mocks.getDebtorsToCollectToday,
  getInstallmentsInWindow: mocks.getInstallmentsInWindow,
  getDebtorsToCollectInWindow: mocks.getDebtorsToCollectInWindow,
  getInstallmentsByDateRange: mocks.getInstallmentsByDateRange,
  getDebtorsToCollectByDateRange: mocks.getDebtorsToCollectByDateRange,
  buildDateWindow: mocks.buildDateWindow,
  generateMonthlyReport: mocks.generateMonthlyReport,
  parseContractTextWithMeta: mocks.parseContractTextWithMeta,
  createContract: mocks.createContract,
  markInstallmentPaid: mocks.markInstallmentPaid,
  searchUser: mocks.searchUser,
  getUserDebt: mocks.getUserDebt,
  getUserDebtDetails: mocks.getUserDebtDetails,
  generateInvite: mocks.generateInvite,
  validateLinkCode: mocks.validateLinkCode,
  disconnectBot: mocks.disconnectBot,
  getContractOpenInstallments: mocks.getContractOpenInstallments,
  getContractOpenInstallmentByNumber: mocks.getContractOpenInstallmentByNumber,
  getInstallmentByDebtorAndMonth: mocks.getInstallmentByDebtorAndMonth,
  listCompaniesByTenant: mocks.listCompaniesByTenant,
  normalizeCpf: (value?: string | null) => {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
  },
  isValidCpf: (value?: string | null) => value === '52998224725',
  formatCurrency: (value: number) => `R$ ${value.toFixed(2)}`,
  formatDate: (value: string) => value,
  extractDebtorNameSimple: (text: string) => {
    const cleaned = text.replace(/cpf\s*[:\-]?\s*\d[\d.\-]*/gi, '').replace(/r\$\s*[\d.,]+\s*(mil|k)?/gi, '').replace(/\d+\s*(%|por\s*cento|parcelas?|x|vezes)/gi, '').trim();
    const match = cleaned.match(/^([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*)/);
    return match?.[1] && match[1].length >= 3 ? match[1] : null;
  },
  extractAmount: (text: string) => {
    const m = text.match(/r\$\s*([0-9][0-9.]*[0-9](?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(mil|k)?/i)
      || text.match(/([0-9]+(?:[.,][0-9]+)?)\s*(mil|k)\b/i)
      || text.match(/([0-9][0-9.]*[0-9](?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(mil|k)?\s*reais?/i);
    if (!m?.[1]) return null;
    const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * (/mil|k/i.test(m[2] || '') ? 1000 : 1);
    return v >= 100 ? v : null;
  },
  extractRate: (text: string) => {
    const m = text.match(/(\d+(?:[.,]\d+)?)\s*%/) || text.match(/(\d+(?:[.,]\d+)?)\s*(?:por\s*cento|porcento)/i);
    return m?.[1] ? parseFloat(m[1].replace(',', '.')) : null;
  },
  extractInstallments: (text: string) => {
    const m = text.match(/(\d{1,3})\s*(?:x|parcelas?|vezes)/i);
    if (!m?.[1]) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
  },
}));

vi.mock('../../src/actions/bot-config-actions', () => ({
  getBotTenantConfig: mocks.getBotTenantConfig,
  checkWhitelistBlock: mocks.checkWhitelistBlock,
}));

vi.mock('../../src/observability/logger', () => ({
  logStructuredMessage: mocks.logStructuredMessage,
}));

vi.mock('../../src/observability/cost-estimator', () => ({
  estimateCostUsd: mocks.estimateCostUsd,
}));

import { handleMessage } from '../../src/handlers/message-handler';

export { mocks as agentEvalMocks };

function buildState(testCase: AgentEvalCase): AgentEvalHarnessState {
  return {
    context: structuredClone(testCase.initialContext || {}),
    role: testCase.role || 'admin',
    tenantId: testCase.tenantId === undefined ? 'tenant-1' : testCase.tenantId,
    profileId: testCase.profileId === undefined ? 'profile-1' : testCase.profileId,
  };
}

function currentSession(state: AgentEvalHarnessState) {
  return {
    id: 'session-eval',
    profile_id: state.profileId,
    channel: 'telegram',
    channel_user_id: 'chat-1',
    context: state.context,
    profile: state.profileId ? {
      id: state.profileId,
      name: 'Eval User',
      role: state.role,
      tenant_id: state.tenantId,
    } : null,
  };
}

function applyDefaults(state: AgentEvalHarnessState) {
  vi.clearAllMocks();

  mocks.getOrCreateSession.mockImplementation(async () => currentSession(state));
  mocks.syncSessionProfileFromChannelBinding.mockImplementation(async (session: any) => ({
    session,
    changed: false,
    oldProfileId: session.profile_id || null,
    newProfileId: session.profile_id || null,
    reason: 'matched',
  }));
  mocks.getRecentMessages.mockResolvedValue([]);
  mocks.saveMessage.mockResolvedValue(undefined);
  mocks.updateSessionContext.mockImplementation(async (_sessionId: string, ctx: Record<string, unknown>) => {
    state.context = structuredClone(ctx);
  });
  mocks.clearSessionContext.mockImplementation(async () => {
    state.context = {};
  });
  mocks.linkProfileToSession.mockResolvedValue(undefined);
  mocks.getProfileByChannelBinding.mockResolvedValue(null);

  mocks.routeIntent.mockResolvedValue({
    intent: 'ver_dashboard',
    entities: {},
    normalizedEntities: {},
    confidence: 'high',
    source: 'rule',
  });

  mocks.getDashboardSummary.mockResolvedValue({
    receivedMonth: 1000,
    receivedByPaymentMonth: 1000,
    receivedByDueMonth: 800,
    expectedMonth: 1500,
    totalOverdue: 300,
    activeContracts: 4,
    overdueContracts: 1,
  });
  mocks.getInstallments.mockResolvedValue([]);
  mocks.getInstallmentsToday.mockResolvedValue([]);
  mocks.getDebtorsToCollectToday.mockResolvedValue([]);
  mocks.listCompaniesByTenant.mockResolvedValue([
    { id: 'company-1', name: 'Empresa 1', isPrimary: true },
    { id: 'company-2', name: 'Empresa 2', isPrimary: false },
  ]);
  mocks.getInstallmentsInWindow.mockResolvedValue([]);
  mocks.getDebtorsToCollectInWindow.mockResolvedValue([]);
  mocks.getInstallmentsByDateRange.mockResolvedValue([]);
  mocks.getDebtorsToCollectByDateRange.mockResolvedValue([]);
  mocks.buildDateWindow.mockReturnValue({
    daysAhead: 7,
    windowStart: 'today',
    startDate: '2026-03-05',
    endDate: '2026-03-11',
  });
  mocks.generateMonthlyReport.mockResolvedValue({
    dashboard: {
      receivedMonth: 0,
      receivedByPaymentMonth: 0,
      receivedByDueMonth: 0,
      expectedMonth: 0,
      totalOverdue: 0,
      activeContracts: 0,
      overdueContracts: 0,
    },
    overdueDebtors: [],
    todayInstallments: [],
    topDebtors: [],
  });

  mocks.parseContractTextWithMeta.mockResolvedValue({ draft: null, mode: 'failed', reason: 'missing_fields' });
  mocks.createContract.mockResolvedValue({
    status: 'success',
    id: 123,
    debtorName: 'Ana Paula',
    debtorCpf: '52998224725',
    firstInstallment: '2026-04-10 - R$ 500',
    debtorResolution: 'created',
  });
  mocks.markInstallmentPaid.mockResolvedValue(true);
  mocks.searchUser.mockResolvedValue([]);
  mocks.getUserDebt.mockResolvedValue(0);
  mocks.getUserDebtDetails.mockResolvedValue({
    totalDebt: 0,
    pendingInstallments: 0,
    nextDueDate: null,
    nextDueAmount: 0,
    activeContracts: 0,
  });
  mocks.generateInvite.mockResolvedValue('INV123');
  mocks.validateLinkCode.mockResolvedValue({ status: 'invalid_or_expired' });
  mocks.disconnectBot.mockResolvedValue(true);
  mocks.getContractOpenInstallments.mockResolvedValue({
    items: [
      { id: 'inst-1', number: 1, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-03-10', status: 'pending' },
      { id: 'inst-2', number: 2, contractId: 123, debtorName: 'Carlos', amount: 900, dueDate: '2026-04-10', status: 'pending' },
    ],
    page: 0,
    pageSize: 2,
    total: 2,
    hasMore: false,
  });
  mocks.getContractOpenInstallmentByNumber.mockResolvedValue({
    id: 'inst-2',
    number: 2,
    contractId: 123,
    debtorName: 'Carlos',
    amount: 900,
    dueDate: '2026-04-10',
    status: 'pending',
  });
  mocks.getInstallmentByDebtorAndMonth.mockResolvedValue(null);
  mocks.transcribeAudioDetailed.mockResolvedValue({
    text: 'audio transcrito',
    quality: 'ok',
    usedFilesApi: false,
    durationMs: 120,
  });
  mocks.inferInstallmentMonth.mockReturnValue({});
  mocks.renderConversationalReply.mockResolvedValue({ text: null, tokensIn: 0, tokensOut: 0 });
  mocks.generateGreeting.mockResolvedValue({ text: null, tokensIn: 0, tokensOut: 0 });

  mocks.getBotTenantConfig.mockResolvedValue(null);
  mocks.checkWhitelistBlock.mockResolvedValue({ blocked: false, reason: 'whitelist_disabled' });

  mocks.logStructuredMessage.mockResolvedValue(undefined);
  mocks.estimateCostUsd.mockReturnValue(0);
}

function assertExpectation(expectation: AgentEvalExpectation, outputText: string, state: AgentEvalHarnessState) {
  for (const snippet of expectation.textIncludes || []) {
    expect(outputText).toContain(snippet);
  }

  for (const snippet of expectation.textExcludes || []) {
    expect(outputText).not.toContain(snippet);
  }

  if (expectation.pendingAction !== undefined) {
    expect((state.context as Record<string, unknown>).pendingAction ?? null).toBe(expectation.pendingAction);
  }

  if (expectation.workingState !== undefined) {
    if (expectation.workingState === null) {
      expect((state.context as Record<string, unknown>).workingState ?? null).toBeNull();
    } else {
      expect((state.context as Record<string, unknown>).workingState).toEqual(expect.objectContaining(expectation.workingState));
    }
  }

  for (const [mockName, count] of Object.entries(expectation.mockCalls || {})) {
    expect(mocks[mockName as keyof typeof mocks]).toHaveBeenCalledTimes(count);
  }

  for (const mockName of expectation.mockNotCalled || []) {
    expect(mocks[mockName as keyof typeof mocks]).not.toHaveBeenCalled();
  }
}

export async function runAgentEvalCase(testCase: AgentEvalCase): Promise<AgentEvalResult> {
  const state = buildState(testCase);
  applyDefaults(state);
  testCase.setup?.({ mocks, state });

  try {
    for (let index = 0; index < testCase.steps.length; index += 1) {
      const step = testCase.steps[index];
      const out = await handleMessage({
        messageId: step.input.messageId || `${testCase.id}-${index + 1}`,
        channel: step.input.channel || 'telegram',
        channelUserId: step.input.channelUserId || 'chat-1',
        senderName: step.input.senderName || 'Eval User',
        text: step.input.text,
        audioBuffer: step.input.audioBuffer,
        audioMimeType: step.input.audioMimeType,
        audioDurationSec: step.input.audioDurationSec,
        audioSizeBytes: step.input.audioSizeBytes,
        audioKind: step.input.audioKind,
        imageBuffer: step.input.imageBuffer,
        imageMimeType: step.input.imageMimeType,
      });

      assertExpectation(step.expect, out.text, state);
    }

    return {
      id: testCase.id,
      category: testCase.category,
      criticality: testCase.criticality,
      failureTag: testCase.failureTag,
      status: 'pass',
    };
  } catch (error) {
    return {
      id: testCase.id,
      category: testCase.category,
      criticality: testCase.criticality,
      failureTag: testCase.failureTag,
      status: testCase.allowSoftFailure ? 'soft_fail' : 'fail',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export function emitAgentEvalScorecard(scorecard: Record<string, unknown>) {
  const targetPath = process.env.AGENT_EVAL_SCORECARD_PATH;
  if (!targetPath) return;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8');
}
