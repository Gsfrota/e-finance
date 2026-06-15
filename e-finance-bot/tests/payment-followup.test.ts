import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInstallmentsToday: vi.fn(),
  getOverdueInstallments: vi.fn(),
  formatCurrency: vi.fn((value: number) => `R$ ${value.toFixed(2)}`),
  markInstallmentPaid: vi.fn(),
  getAdminProfiles: vi.fn(),
  getOrCreateSession: vi.fn(),
  saveMessage: vi.fn(),
  updateSessionContext: vi.fn(),
  waSendText: vi.fn(),
  tgSendText: vi.fn(),
  recheckStatus: vi.fn(),
}));

vi.mock('../src/infra/runtime-clients', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (_col: string, ids: string[]) => mocks.recheckStatus(ids),
        }),
      }),
    }),
  }),
}));

vi.mock('../src/actions/admin-actions', () => ({
  getInstallmentsToday: mocks.getInstallmentsToday,
  getOverdueInstallments: mocks.getOverdueInstallments,
  formatCurrency: mocks.formatCurrency,
  markInstallmentPaid: mocks.markInstallmentPaid,
}));

vi.mock('../src/scheduler/morning-briefing', () => ({
  getAdminProfiles: mocks.getAdminProfiles,
}));

vi.mock('../src/session/session-manager', () => ({
  getOrCreateSession: mocks.getOrCreateSession,
  saveMessage: mocks.saveMessage,
  updateSessionContext: mocks.updateSessionContext,
}));

vi.mock('../src/channels/whatsapp', () => ({
  sendText: mocks.waSendText,
}));

vi.mock('../src/channels/telegram', () => ({
  sendText: mocks.tgSendText,
}));

import { formatPaymentFollowupMessage, runPaymentFollowupForTenant, isWithinEodAlertWindow, confirmPendingPaymentFollowup } from '../src/scheduler/payment-followup';

describe('payment-followup scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getInstallmentsToday.mockResolvedValue([
      { id: 'inst-1', debtorName: 'Fulano', amount: 300, dueDate: '2026-03-23', status: 'pending', daysLate: 0, companyId: 'company-a', companyName: 'Empresa A' },
      { id: 'inst-2', debtorName: 'Beltrano', amount: 200, dueDate: '2026-03-23', status: 'pending', daysLate: 0, companyId: 'company-a', companyName: 'Empresa A' },
    ]);
    mocks.getOverdueInstallments.mockResolvedValue({ installments: [], olderCount: 0 });
    mocks.getAdminProfiles.mockResolvedValue([
      {
        id: 'admin-1',
        full_name: 'Admin Tenant A',
        whatsapp_phone: '5585999999999',
        telegram_chat_id: 'tg-1',
        company_id: 'company-a',
        companies: { name: 'Empresa A' },
      },
    ]);
    mocks.getOrCreateSession.mockResolvedValue({
      id: 'session-1',
      context: {},
    });
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.updateSessionContext.mockResolvedValue(undefined);
    mocks.waSendText.mockResolvedValue(undefined);
    mocks.tgSendText.mockResolvedValue(undefined);
  });

  it('monta mensagem informativa para múltiplas cobranças em aberto (sem baixar tudo por padrão)', () => {
    const text = formatPaymentFollowupMessage([
      { id: 'inst-1', debtorName: 'Fulano', amount: 300, daysLate: 0 },
      { id: 'inst-2', debtorName: 'Beltrano', amount: 200, daysLate: 0 },
    ]);

    expect(text).toContain('em aberto');
    expect(text).toContain('Vencem hoje');
    expect(text).toContain('Fulano');
    expect(text).toContain('Beltrano');
    // Não deve mais oferecer baixar tudo nem pedir "números a manter em aberto"
    expect(text).not.toContain('dar baixa em *todas*');
    expect(text).not.toContain('manter em aberto');
    // Convida baixa seletiva
    expect(text.toLowerCase()).toContain('dar baixa em');
  });

  it('separa vencendo hoje de atrasados e consolida os mais antigos', () => {
    const text = formatPaymentFollowupMessage(
      [
        { id: 'inst-1', debtorName: 'Fulano', amount: 300, daysLate: 0 },
        { id: 'inst-3', debtorName: 'Ciclano', amount: 150, daysLate: 5 },
      ],
      4,
    );

    expect(text).toContain('Vencem hoje');
    expect(text).toContain('Em atraso');
    expect(text).toContain('5 dias');
    expect(text).toContain('mais 4 em aberto');
  });

  it('mensagem vazia quando nada em aberto e sem atrasos antigos', () => {
    expect(formatPaymentFollowupMessage([], 0)).toContain('Tudo em dia');
  });

  it('dispara follow-up só para admins do tenant e grava contexto pendente', async () => {
    const result = await runPaymentFollowupForTenant('tenant-a', new Date('2026-03-23T21:00:00Z'));

    expect(mocks.getInstallmentsToday).toHaveBeenCalledWith('tenant-a', 'company-a');
    expect(mocks.getOverdueInstallments).toHaveBeenCalledWith('tenant-a', 'company-a');
    expect(mocks.waSendText).toHaveBeenCalledWith('5585999999999', expect.stringContaining('em aberto'));
    expect(mocks.waSendText).toHaveBeenCalledWith('5585999999999', expect.stringContaining('Empresa A'));
    expect(mocks.tgSendText).toHaveBeenCalledWith('tg-1', expect.any(String), 'HTML');
    expect(mocks.updateSessionContext).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        pendingAction: 'confirmar_baixas_pendentes',
        pendingStep: 1,
        pendingData: expect.objectContaining({
          tenantId: 'tenant-a',
          companyId: 'company-a',
          items: expect.arrayContaining([
            expect.objectContaining({ id: 'inst-1', debtorName: 'Fulano', companyId: 'company-a' }),
          ]),
        }),
      })
    );
    expect(result.sent).toBe(2);
  });

  it('não dispara duplicado quando a sessão já tem follow-up do mesmo dia', async () => {
    mocks.getOrCreateSession.mockResolvedValue({
      id: 'session-1',
      context: {
        pendingAction: 'confirmar_baixas_pendentes',
        pendingData: {
          referenceDate: '2026-03-23',
          companyId: 'company-a',
        },
      },
    });

    const result = await runPaymentFollowupForTenant('tenant-a', new Date('2026-03-23T21:00:00Z'));

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(mocks.tgSendText).not.toHaveBeenCalled();
    expect(result.skippedDuplicate).toBe(2);
  });

  it('pending de wizard EXPIRADO (>30min) não bloqueia o EOD', async () => {
    mocks.getOrCreateSession.mockResolvedValue({
      id: 'session-1',
      context: {
        pendingAction: 'criar_contrato',
        pendingActionAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h atrás
      },
    });

    const result = await runPaymentFollowupForTenant('tenant-a', new Date('2026-03-23T21:00:00Z'));

    expect(mocks.waSendText).toHaveBeenCalled();
    expect(result.sent).toBeGreaterThan(0);
    expect(result.skippedBusy).toBe(0);
  });

  it('pending de wizard RECENTE bloqueia o EOD (skipped_busy)', async () => {
    mocks.getOrCreateSession.mockResolvedValue({
      id: 'session-1',
      context: {
        pendingAction: 'criar_contrato',
        pendingActionAt: new Date(Date.now() - 60 * 1000).toISOString(), // 1min atrás
      },
    });

    const result = await runPaymentFollowupForTenant('tenant-a', new Date('2026-03-23T21:00:00Z'));

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(result.skippedBusy).toBeGreaterThan(0);
  });

  it('janela ±7min do horário configurado em BRT', () => {
    // 17:00 BRT == 20:00 UTC
    expect(isWithinEodAlertWindow(new Date('2026-03-23T20:00:00Z'), '17:00')).toBe(true);
    expect(isWithinEodAlertWindow(new Date('2026-03-23T19:54:00Z'), '17:00')).toBe(true);  // 16:54 → -6min
    expect(isWithinEodAlertWindow(new Date('2026-03-23T20:06:00Z'), '17:00')).toBe(true);  // 17:06 → +6min
    expect(isWithinEodAlertWindow(new Date('2026-03-23T19:52:00Z'), '17:00')).toBe(false); // 16:52 → -8min
    expect(isWithinEodAlertWindow(new Date('2026-03-23T20:08:00Z'), '17:00')).toBe(false); // 17:08 → +8min
  });

  it('respeita horário customizado (16:30) em vez do default', () => {
    expect(isWithinEodAlertWindow(new Date('2026-03-23T19:30:00Z'), '16:30')).toBe(true);  // exato
    expect(isWithinEodAlertWindow(new Date('2026-03-23T20:00:00Z'), '16:30')).toBe(false); // 17:00 já fora
  });

  it('confirmPendingPaymentFollowup baixa só as abertas e marca já-pagas (anti-stale)', async () => {
    // inst-1 já foi paga no painel; inst-2 ainda aberta
    mocks.recheckStatus.mockResolvedValue({
      data: [
        { id: 'inst-1', status: 'paid' },
        { id: 'inst-2', status: 'pending' },
      ],
      error: null,
    });
    mocks.markInstallmentPaid.mockResolvedValue(true);

    const result = await confirmPendingPaymentFollowup('tenant-a', [
      { id: 'inst-1', debtorName: 'Fulano', amount: 300 },
      { id: 'inst-2', debtorName: 'Beltrano', amount: 200 },
    ]);

    expect(result.alreadyPaid.map(i => i.id)).toEqual(['inst-1']);
    expect(result.paid.map(i => i.id)).toEqual(['inst-2']);
    expect(result.failed).toHaveLength(0);
    // só a aberta foi para markInstallmentPaid
    expect(mocks.markInstallmentPaid).toHaveBeenCalledTimes(1);
    expect(mocks.markInstallmentPaid).toHaveBeenCalledWith('inst-2', 'tenant-a');
  });

  it('lida com janela cruzando meia-noite (00:00)', () => {
    // 00:00 BRT == 03:00 UTC
    expect(isWithinEodAlertWindow(new Date('2026-03-23T03:00:00Z'), '00:00')).toBe(true);
    expect(isWithinEodAlertWindow(new Date('2026-03-23T02:55:00Z'), '00:00')).toBe(true);  // -5min
    expect(isWithinEodAlertWindow(new Date('2026-03-23T03:05:00Z'), '00:00')).toBe(true);  // +5min
  });

  it('não mistura cobranças de empresas diferentes entre admins do mesmo tenant', async () => {
    mocks.getAdminProfiles.mockResolvedValue([
      {
        id: 'admin-1',
        full_name: 'Admin Empresa A',
        whatsapp_phone: '5511999999991',
        telegram_chat_id: null,
        company_id: 'company-a',
        companies: { name: 'Empresa A' },
      },
      {
        id: 'admin-2',
        full_name: 'Admin Empresa B',
        whatsapp_phone: '5511999999992',
        telegram_chat_id: null,
        company_id: 'company-b',
        companies: { name: 'Empresa B' },
      },
    ]);
    mocks.getInstallmentsToday
      .mockResolvedValueOnce([
        { id: 'inst-a', debtorName: 'Fulano', amount: 300, dueDate: '2026-03-23', status: 'pending', daysLate: 0, companyId: 'company-a', companyName: 'Empresa A' },
      ])
      .mockResolvedValueOnce([
        { id: 'inst-b', debtorName: 'Beltrano', amount: 450, dueDate: '2026-03-23', status: 'pending', daysLate: 0, companyId: 'company-b', companyName: 'Empresa B' },
      ]);

    await runPaymentFollowupForTenant('tenant-a', new Date('2026-03-23T21:00:00Z'));

    expect(mocks.getInstallmentsToday).toHaveBeenNthCalledWith(1, 'tenant-a', 'company-a');
    expect(mocks.getInstallmentsToday).toHaveBeenNthCalledWith(2, 'tenant-a', 'company-b');
    expect(mocks.waSendText).toHaveBeenNthCalledWith(1, '5511999999991', expect.stringContaining('Empresa A'));
    expect(mocks.waSendText).toHaveBeenNthCalledWith(2, '5511999999992', expect.stringContaining('Empresa B'));
  });
});
