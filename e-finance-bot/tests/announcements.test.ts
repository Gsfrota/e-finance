import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveAnnouncements: vi.fn(),
  getAllAdminProfiles: vi.fn(),
  getDeliveredProfileIds: vi.fn(),
  recordDelivery: vi.fn(),
  getOrCreateSession: vi.fn(),
  waSendText: vi.fn(),
  tgSendText: vi.fn(),
}));

vi.mock('../src/actions/announcement-actions', () => ({
  getActiveAnnouncements: mocks.getActiveAnnouncements,
  getAllAdminProfiles: mocks.getAllAdminProfiles,
  getDeliveredProfileIds: mocks.getDeliveredProfileIds,
  recordDelivery: mocks.recordDelivery,
}));
vi.mock('../src/session/session-manager', () => ({ getOrCreateSession: mocks.getOrCreateSession }));
vi.mock('../src/channels/whatsapp', () => ({ sendText: mocks.waSendText }));
vi.mock('../src/channels/telegram', () => ({ sendText: mocks.tgSendText }));

let runAnnouncements: typeof import('../src/scheduler/announcements').runAnnouncements;

const announcement = {
  id: 'a1', title: 'Nova feature', body: 'Agora você pode...', target_roles: ['admin'],
  active: true, starts_at: null, ends_at: null, created_at: new Date().toISOString(), tenant_id: null,
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getActiveAnnouncements.mockResolvedValue([announcement]);
  mocks.getAllAdminProfiles.mockResolvedValue([{ id: 'p1', full_name: 'Admin', whatsapp_phone: '5511999', telegram_chat_id: null, tenant_id: 't1' }]);
  mocks.getOrCreateSession.mockResolvedValue({ id: 's1', context: {} });
  mocks.recordDelivery.mockResolvedValue(true);
  ({ runAnnouncements } = await import('../src/scheduler/announcements'));
});

describe('announcements — dedup por destinatário', () => {
  it('envia para admin ainda não atendido e grava a entrega', async () => {
    mocks.getDeliveredProfileIds.mockResolvedValue(new Set<string>());

    const result = await runAnnouncements();

    expect(mocks.recordDelivery).toHaveBeenCalledWith('a1', 'p1', 'whatsapp');
    expect(mocks.waSendText).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
  });

  it('NÃO reenvia para admin já entregue (fast-path por set)', async () => {
    mocks.getDeliveredProfileIds.mockResolvedValue(new Set(['p1']));

    const result = await runAnnouncements();

    expect(mocks.recordDelivery).not.toHaveBeenCalled();
    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(result.skippedAlready).toBe(1);
  });

  it('envia ANTES de marcar: se o envio falhar (UazAPI fora), NÃO marca entrega', async () => {
    // Fix FB-001: dispatch primeiro. Falha de envio → não grava entrega →
    // anúncio será reenviado no próximo run (não se perde).
    mocks.getDeliveredProfileIds.mockResolvedValue(new Set<string>());
    mocks.waSendText.mockRejectedValueOnce(new Error('uazapi down'));

    const result = await runAnnouncements();

    expect(mocks.waSendText).toHaveBeenCalledTimes(1);
    expect(mocks.recordDelivery).not.toHaveBeenCalled(); // erro de envio impede a marcação
    expect(result.sent).toBe(0);
  });

  it('corrida: envio ok mas recordDelivery=false (já marcado) → conta como já entregue', async () => {
    mocks.getDeliveredProfileIds.mockResolvedValue(new Set<string>());
    mocks.recordDelivery.mockResolvedValue(false);

    const result = await runAnnouncements();

    expect(mocks.waSendText).toHaveBeenCalledTimes(1); // já enviou (ordem nova)
    expect(result.sent).toBe(0);
    expect(result.skippedAlready).toBe(1);
  });

  it('quando tenant_id está setado, entrega só aos admins daquele tenant', async () => {
    mocks.getActiveAnnouncements.mockResolvedValue([{ ...announcement, tenant_id: 't1' }]);
    mocks.getAllAdminProfiles.mockResolvedValue([
      { id: 'p1', full_name: 'Admin T1', whatsapp_phone: '5511111', telegram_chat_id: null, tenant_id: 't1' },
      { id: 'p2', full_name: 'Admin T2', whatsapp_phone: '5522222', telegram_chat_id: null, tenant_id: 't2' },
    ]);
    mocks.getDeliveredProfileIds.mockResolvedValue(new Set<string>());

    const result = await runAnnouncements();

    expect(mocks.recordDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordDelivery).toHaveBeenCalledWith('a1', 'p1', 'whatsapp');
    expect(mocks.waSendText).toHaveBeenCalledTimes(1);
    expect(mocks.waSendText).toHaveBeenCalledWith('5511111', expect.any(String));
    expect(result.sent).toBe(1);
  });

  it('ignora anúncio que não tem admin no target_roles', async () => {
    mocks.getActiveAnnouncements.mockResolvedValue([{ ...announcement, target_roles: ['debtor'] }]);
    mocks.getDeliveredProfileIds.mockResolvedValue(new Set<string>());

    const result = await runAnnouncements();

    expect(mocks.waSendText).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });
});
