import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  upload: vi.fn(),
  deleteFile: vi.fn(),
  createPartFromUri: vi.fn((uri: string, mimeType: string) => ({
    fileData: { fileUri: uri, mimeType },
  })),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
    files = {
      upload: mocks.upload,
      delete: mocks.deleteFile,
    };
  },
  createPartFromUri: mocks.createPartFromUri,
}));

async function loadModule() {
  vi.resetModules();
  return import('../src/ai/audio-pipeline');
}

describe('audio-pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUDIO_MAX_DURATION_SEC;
    delete process.env.AUDIO_INLINE_MAX_BYTES;
    delete process.env.AUDIO_TRANSCRIBE_TIMEOUT_MS;
    delete process.env.AUDIO_PREVIEW_CHARS;

    mocks.generateContent.mockResolvedValue({ text: 'parcela de janeiro do Icaro Soares' });
    mocks.upload.mockResolvedValue({
      name: 'files/audio-1',
      uri: 'gs://files/audio-1',
      mimeType: 'audio/ogg',
    });
    mocks.deleteFile.mockResolvedValue(undefined);
  });

  it('usa inline para áudio pequeno', async () => {
    const { transcribeAudioDetailed } = await loadModule();

    const result = await transcribeAudioDetailed({
      audioBuffer: Buffer.from('audio'),
      mimeType: 'audio/ogg',
      sizeBytes: 128,
    });

    expect(result.quality).toBe('ok');
    expect(result.usedFilesApi).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it('usa Files API para áudio acima do limite inline', async () => {
    const { transcribeAudioDetailed } = await loadModule();

    const result = await transcribeAudioDetailed({
      audioBuffer: Buffer.from('audio grande'),
      mimeType: 'audio/ogg',
      sizeBytes: 2_500_000,
    });

    expect(result.quality).toBe('ok');
    expect(result.usedFilesApi).toBe(true);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.createPartFromUri).toHaveBeenCalledWith('gs://files/audio-1', 'audio/ogg');
    expect(mocks.deleteFile).toHaveBeenCalledWith({ name: 'files/audio-1' });
  });

  it('rejeita áudio acima de 90 segundos', async () => {
    const { transcribeAudioDetailed } = await loadModule();

    const result = await transcribeAudioDetailed({
      audioBuffer: Buffer.from('audio'),
      mimeType: 'audio/ogg',
      durationSec: 91,
    });

    expect(result.quality).toBe('too_long');
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it('retorna timeout quando a transcrição excede o orçamento', async () => {
    process.env.AUDIO_TRANSCRIBE_TIMEOUT_MS = '5';
    mocks.generateContent.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ text: 'ok' }), 40))
    );

    const { transcribeAudioDetailed } = await loadModule();

    const result = await transcribeAudioDetailed({
      audioBuffer: Buffer.from('audio'),
      mimeType: 'audio/ogg',
      sizeBytes: 128,
    });

    expect(result.quality).toBe('timeout');
  });

  it('dá orçamento maior para áudio curto com duração conhecida', async () => {
    process.env.AUDIO_TRANSCRIBE_TIMEOUT_MS = '5';
    mocks.generateContent.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ text: 'parcela paga hoje' }), 40))
    );

    const { transcribeAudioDetailed } = await loadModule();

    const result = await transcribeAudioDetailed({
      audioBuffer: Buffer.from('audio'),
      mimeType: 'audio/ogg',
      sizeBytes: 128,
      durationSec: 2,
    });

    expect(result.quality).toBe('ok');
  });

  it('normaliza transcript sem perder mês e valores', async () => {
    const { normalizeTranscriptText } = await loadModule();

    const normalized = normalizeTranscriptText('hum   empréstimo pro Ícaro, 1000 reais por 2000 em janeiro   ');

    expect(normalized).toContain('1000 reais por 2000 em janeiro');
    expect(normalized.startsWith('empréstimo')).toBe(true);
  });
});
