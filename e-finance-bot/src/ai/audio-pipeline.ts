import { createPartFromUri, GoogleGenAI } from '@google/genai';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config';

let _genai: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!_genai) _genai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return _genai;
}

const TRANSCRIPTION_MODEL = 'gemini-2.5-flash-lite';
const TRANSCRIPTION_PROMPT = 'Transcreva este áudio em português brasileiro. Retorne apenas o texto transcrito, sem comentários.';
const SUPPORTED_AUDIO_MIME_PREFIX = 'audio/';

export type AudioTranscriptQuality = 'ok' | 'weak' | 'timeout' | 'too_long' | 'unsupported';

export interface AudioTranscriptInput {
  audioBuffer: Buffer;
  mimeType: string;
  durationSec?: number;
  sizeBytes?: number;
  audioKind?: 'voice_note' | 'audio_file';
}

export interface AudioTranscriptResult {
  text: string;
  quality: AudioTranscriptQuality;
  usedFilesApi: boolean;
  durationMs: number;
  reason?: string;
}

class AudioTimeoutError extends Error {
  constructor(message = 'audio_transcription_timeout') {
    super(message);
    this.name = 'AudioTimeoutError';
  }
}

function withTimeout<T>(task: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;

  return Promise.race([
    task(),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new AudioTimeoutError()), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function getTempExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('ogg')) return '.ogg';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return '.mp3';
  if (normalized.includes('wav')) return '.wav';
  if (normalized.includes('mp4') || normalized.includes('m4a') || normalized.includes('aac')) return '.m4a';
  if (normalized.includes('webm')) return '.webm';
  return '.audio';
}

function isSupportedAudioMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith(SUPPORTED_AUDIO_MIME_PREFIX);
}

export function normalizeTranscriptText(rawText: string): string {
  return rawText
    .replace(/```/g, ' ')
    .replace(/\[(?:inaud[ií]vel|inaudible)[^\]]*\]/gi, ' ')
    .replace(/\((?:inaud[ií]vel|inaudible)[^)]*\)/gi, ' ')
    .replace(/^(?:ah+n?|eh+|hum+|uhn?|[ée]+|ent[aã]o|tipo)\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

function classifyTranscriptQuality(text: string): AudioTranscriptQuality {
  const normalized = text.trim();
  if (!normalized) return 'weak';
  if (!/[A-Za-zÀ-ÿ0-9]/.test(normalized)) return 'weak';
  if (/(n[aã]o (?:consigo|foi poss[ií]vel)|inaud[ií]vel|sem [áa]udio|áudio n[aã]o)/i.test(normalized)) {
    return 'weak';
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (normalized.length < 8 && !/\d/.test(normalized)) return 'weak';
  if (words.length <= 2 && !/\d/.test(normalized)) return 'weak';
  return 'ok';
}

function resolveTranscriptionTimeoutMs(input: AudioTranscriptInput): number {
  const baseTimeoutMs = config.audio.transcribeTimeoutMs;
  const durationSec = input.durationSec ?? 0;
  const durationBudgetMs = durationSec > 0 ? 4_000 + (durationSec * 2_000) : 0;
  const filesApiBudgetMs = (input.sizeBytes ?? input.audioBuffer.length) > config.audio.inlineMaxBytes ? 6_000 : 0;

  return Math.max(baseTimeoutMs, durationBudgetMs, filesApiBudgetMs);
}

async function transcribeInline(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const base64 = audioBuffer.toString('base64');
  const result = await ai().models.generateContent({
    model: TRANSCRIPTION_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: TRANSCRIPTION_PROMPT },
        ],
      },
    ],
  });

  return result.text?.trim() || '';
}

async function transcribeViaFilesApi(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const tempPath = path.join(
    os.tmpdir(),
    `e-finance-audio-${Date.now()}-${Math.random().toString(16).slice(2)}${getTempExtension(mimeType)}`
  );

  let uploadedName = '';

  try {
    await fs.writeFile(tempPath, audioBuffer);
    const file = await ai().files.upload({
      file: tempPath,
      config: { mimeType },
    });
    uploadedName = file.name || '';

    const result = await ai().models.generateContent({
      model: TRANSCRIPTION_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            createPartFromUri(file.uri || '', file.mimeType || mimeType),
            { text: TRANSCRIPTION_PROMPT },
          ],
        },
      ],
    });

    return result.text?.trim() || '';
  } finally {
    if (uploadedName) {
      await ai().files.delete({ name: uploadedName }).catch(() => {});
    }
    await fs.unlink(tempPath).catch(() => {});
  }
}

export async function transcribeAudioDetailed(input: AudioTranscriptInput): Promise<AudioTranscriptResult> {
  const startedAt = Date.now();
  const sizeBytes = input.sizeBytes ?? input.audioBuffer.length;
  const durationSec = input.durationSec;

  if (!input.audioBuffer?.length || !input.mimeType || !isSupportedAudioMime(input.mimeType)) {
    return {
      text: '',
      quality: 'unsupported',
      usedFilesApi: false,
      durationMs: Date.now() - startedAt,
      reason: 'unsupported_mime',
    };
  }

  if (durationSec && durationSec > config.audio.maxDurationSec) {
    return {
      text: '',
      quality: 'too_long',
      usedFilesApi: false,
      durationMs: Date.now() - startedAt,
      reason: 'duration_limit_exceeded',
    };
  }

  const usedFilesApi = sizeBytes > config.audio.inlineMaxBytes;

  try {
    const timeoutMs = resolveTranscriptionTimeoutMs(input);
    const rawText = await withTimeout(
      () => usedFilesApi
        ? transcribeViaFilesApi(input.audioBuffer, input.mimeType)
        : transcribeInline(input.audioBuffer, input.mimeType),
      timeoutMs
    );
    const normalizedText = normalizeTranscriptText(rawText);
    const quality = classifyTranscriptQuality(normalizedText);

    return {
      text: normalizedText,
      quality,
      usedFilesApi,
      durationMs: Date.now() - startedAt,
      reason: quality === 'weak' ? 'weak_transcript' : undefined,
    };
  } catch (error) {
    if (error instanceof AudioTimeoutError) {
      return {
        text: '',
        quality: 'timeout',
        usedFilesApi,
        durationMs: Date.now() - startedAt,
        reason: 'transcription_timeout',
      };
    }

    return {
      text: '',
      quality: 'weak',
      usedFilesApi,
      durationMs: Date.now() - startedAt,
      reason: 'transcription_failed',
    };
  }
}
