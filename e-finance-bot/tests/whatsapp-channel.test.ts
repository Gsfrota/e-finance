import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: mocks.post,
    })),
  },
}));

describe('whatsapp channel media download', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('UAZAPI_SERVER_URL', 'https://uazapi.example.com');
    vi.stubEnv('UAZAPI_INSTANCE_TOKEN', 'token');
    vi.stubEnv('SUPABASE_URL', 'https://supabase.example.com');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'supabase-service-role-key');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-api-key');
  });

  it('usa o contrato real da UazAPI para baixar audio em base64', async () => {
    mocks.post.mockResolvedValue({
      data: {
        mimetype: 'audio/ogg',
        base64Data: Buffer.from('audio-ok').toString('base64'),
      },
    });

    const { downloadMedia } = await import('../src/channels/whatsapp');
    const result = await downloadMedia('wa-audio-123', '558599999999@s.whatsapp.net');

    expect(mocks.post).toHaveBeenCalledWith(
      '/message/download',
      {
        id: 'wa-audio-123',
        return_base64: true,
        return_link: false,
        generate_mp3: false,
      },
      expect.objectContaining({
        timeout: expect.any(Number),
      }),
    );
    expect(result?.toString()).toBe('audio-ok');
  });

  it('aceita resposta legacy com campo base64', async () => {
    mocks.post.mockResolvedValue({
      data: {
        base64: Buffer.from('legacy-audio').toString('base64'),
      },
    });

    const { downloadMedia } = await import('../src/channels/whatsapp');
    const result = await downloadMedia('wa-audio-legacy');

    expect(result?.toString()).toBe('legacy-audio');
  });
});
