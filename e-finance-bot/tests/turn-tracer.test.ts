import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config', () => ({
  config: {
    trace: { enabled: true, retentionDays: 14, maxEvents: 120, maxUserTextChars: 2000 },
    supabase: { url: 'https://test.supabase.co', serviceRoleKey: 'test-key' },
  },
}));

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: fromMock }),
}));

import {
  TurnTrace,
  beginTraceInPlace,
  flushTrace,
  getActiveTrace,
  enqueueTracePersist,
  startTrace,
  _resetForTests,
} from '../src/observability/turn-tracer';
import { logStructuredMessage } from '../src/observability/logger';

describe('TurnTrace', () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ data: null, error: null });
    fromMock.mockClear();
    _resetForTests();
  });

  afterEach(() => {
    _resetForTests();
  });

  it('captura eventos via logStructuredMessage quando há trace ativo', async () => {
    await startTrace({ channel: 'whatsapp', message_id: 'm1' }, async (trace) => {
      logStructuredMessage('intent_routed', { intent: 'cobrar_hoje', confidence: 'high' });
      logStructuredMessage('action_executed', { action: 'query_collection_window' });

      expect(getActiveTrace()).toBe(trace);
      const record = trace.toRecord();
      expect(record.events).toHaveLength(2);
      expect(record.events[0].event).toBe('intent_routed');
      expect(record.events[0].payload).toMatchObject({ intent: 'cobrar_hoje' });
    });
  });

  it('redige PII (CPF) em campos sensíveis via logger', async () => {
    await startTrace({ channel: 'telegram', message_id: 'm2' }, async (trace) => {
      logStructuredMessage('intent_classified', {
        inputText: 'cliente CPF 123.456.789-09 deve R$ 1.234,56',
      });
      const record = trace.toRecord();
      const evt = record.events[0];
      expect(JSON.stringify(evt.payload)).not.toContain('123.456.789-09');
      expect(JSON.stringify(evt.payload)).toMatch(/\[redacted-cpf\]/);
      expect(JSON.stringify(evt.payload)).toMatch(/\[redacted-value\]/);
    });
  });

  it('não captura eventos quando não há trace ativo', () => {
    expect(getActiveTrace()).toBeUndefined();
    expect(() => logStructuredMessage('orphan_event', { foo: 'bar' })).not.toThrow();
  });

  it('beginTraceInPlace registra trace via enterWith', async () => {
    const trace = beginTraceInPlace({ channel: 'whatsapp', message_id: 'mInPlace' });
    logStructuredMessage('first', { x: 1 });
    expect(getActiveTrace()).toBe(trace);
    expect(trace.toRecord().events).toHaveLength(1);
  });

  it('flushTrace faz INSERT com campos esperados', async () => {
    const trace = new TurnTrace({
      channel: 'whatsapp',
      tenant_id: 'tenant-uuid',
      session_id: 'session-uuid',
      user_text: 'oi',
    });
    trace.setField('intent', 'saudacao');
    trace.setField('reply_text', 'Olá!');
    trace.setField('total_ms', 234);

    await flushTrace(trace);

    expect(fromMock).toHaveBeenCalledWith('bot_turn_traces');
    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.calls[0][0];
    expect(inserted).toMatchObject({
      channel: 'whatsapp',
      tenant_id: 'tenant-uuid',
      session_id: 'session-uuid',
      intent: 'saudacao',
      reply_text: 'Olá!',
      total_ms: 234,
    });
  });

  it('enqueueTracePersist é fire-and-forget — falha de INSERT não propaga', async () => {
    insertMock.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: '500' } });

    const trace = new TurnTrace({ session_id: 's1', channel: 'whatsapp' });

    expect(() => {
      enqueueTracePersist('s1', () => flushTrace(trace));
    }).not.toThrow();

    // Aguarda o microtask para garantir que a fila processou sem rejeitar
    await new Promise((r) => setTimeout(r, 10));
  });

  it('respeita maxEvents — descarta eventos excedentes', async () => {
    await startTrace({ channel: 'whatsapp' }, async (trace) => {
      for (let i = 0; i < 200; i++) {
        logStructuredMessage('flood', { i });
      }
      expect(trace.toRecord().events.length).toBeLessThanOrEqual(120);
    });
  });

  it('clip aplica truncamento em user_text e reply_text longos', () => {
    const long = 'x'.repeat(5000);
    const trace = new TurnTrace({ user_text: long, reply_text: long });
    const record = trace.toRecord();
    expect(record.user_text!.length).toBeLessThanOrEqual(2000);
    expect(record.user_text).toMatch(/\.\.\.$/);
    expect(record.reply_text!.length).toBeLessThanOrEqual(2000);
  });
});
