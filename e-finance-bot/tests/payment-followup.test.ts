import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getInstallmentsToday: vi.fn(),
  formatCurrency: vi.fn((value: number) => `R$ ${value.toFixed(2)}`),
  markInstallmentPaid: vi.fn(),
  getAdminProfiles: vi.fn(),
  getOrCreateSession: vi.fn(),
  saveMessage: vi.fn(),
  updateSessionContext: vi.fn(),
  waSendText: vi.fn(),
  tgSendText: vi.fn(),
}));

vi.mock('../src/actions/admin-actions', () => ({
  getInstallmentsToday: mocks.getInstallmentsToday,
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

import { formatPaymentFollowupMessage, runPaymentFollowupForTenant, shouldRunPaymentFollowupNow } from '../src/scheduler/payment-followup';

describe('payment-followup scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getInstallmentsToday.mockResolvedValue([
      { id: 'inst-1', debtorName: 'Fulano', amount: 300, dueDate: '2026-03-23', status: 'pending', daysLate: 0, companyId: 'company-a', companyName: 'Empresa A' },
      { id: 'inst-2', debtorName: 'Beltrano', amount: 200, dueDate: '2026-03-23', status: 'pending', daysLate: 0, companyId: 'company-a', companyName: 'Empresa A' },
    ]);
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

  it('monta mensagem proativa útil para múltiplas cobranças pendentes', () => {
    const text = formatPaymentFollowupMessage([
      { id: 'inst-1', debtorName: 'Fulano', amount: 300 },
      { id: 'inst-2', debtorName: 'Beltrano', amount: 200 },
    ]);

    expect(text).toContain('Hoje ainda não houve baixa');
    expect(text).toContain('Fulano');
    expect(text).toContain('Beltrano');
    expect(text).toContain('números que devo manter em aberto');
  });

  it('dispara follow-up só para admins do tenant e grava contexto pendente', async () => {
    const result = await runPaymentFollowupForTenant('tenant-a', new Date('2026-03-23T21:00:00Z'));

    expect(mocks.getInstallmentsToday).toHaveBeenCalledWith('tenant-a', 'company-a');
    expect(mocks.waSendText).toHaveBeenCalledWith('5585999999999', expect.stringContaining('Hoje ainda não houve baixa'));
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

  it('só roda após 17h BRT', () => {
    expect(shouldRunPaymentFollowupNow(new Date('2026-03-23T19:59:00Z'))).toBe(false); // 16:59 BRT
    expect(shouldRunPaymentFollowupNow(new Date('2026-03-23T20:00:00Z'))).toBe(true);  // 17:00 BRT
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
