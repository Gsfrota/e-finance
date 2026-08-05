/**
 * services/dateUtils.ts — BR-TZ-001, a fonte única de "hoje" do frontend.
 *
 * Importa porque o banco roda em UTC e o produto é brasileiro: entre 21h e 00h
 * BRT o CURRENT_DATE do Postgres já é o dia seguinte. Estas funções são o único
 * lugar do frontend que resolve isso — e as que NÃO usam BRT são bug.
 *
 * Relógio congelado com vi.setSystemTime; TZ do host forçada onde a função
 * depende dela (é justamente o que expõe o bug de addDaysBR).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDaysBR,
  getBrazilToday,
  getMonthRangeBR,
  isoToBrazilYMD,
  toBrazilYMD,
} from '@/services/dateUtils';

afterEach(() => {
  vi.useRealTimers();
});

describe('toBrazilYMD / getBrazilToday — a divergência UTC × BRT, medida', () => {
  it('02:08 UTC de 05/08 ainda é 04/08 no Brasil', () => {
    // Instante capturado no briefing (§1.11) direto do banco de produção:
    //   db_tz = UTC | now = 2026-08-05 02:08:18+00 | current_date = 2026-08-05
    //   timezone('America/Sao_Paulo', now())::date = 2026-08-04
    // Todo CURRENT_DATE do Postgres nesta janela aponta para o dia seguinte.
    expect(toBrazilYMD(new Date('2026-08-05T02:08:18.000Z'))).toBe('2026-08-04');
    expect(new Date('2026-08-05T02:08:18.000Z').toISOString().slice(0, 10)).toBe('2026-08-05');
  });

  it('03:00 UTC é a virada do dia no Brasil (UTC-3)', () => {
    expect(toBrazilYMD(new Date('2026-08-05T02:59:59.999Z'))).toBe('2026-08-04');
    expect(toBrazilYMD(new Date('2026-08-05T03:00:00.000Z'))).toBe('2026-08-05');
  });

  it('getBrazilToday segue o relógio congelado, não o fuso do host', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T02:30:00.000Z')); // 31/08 23:30 BRT
    expect(getBrazilToday()).toBe('2026-08-31');
  });
});

describe('isoToBrazilYMD — por que a UI grava paid_at com "T12:00:00"', () => {
  it('meio-dia UTC cai no mesmo dia no Brasil (09:00 BRT) — o buffer funciona', () => {
    expect(isoToBrazilYMD('2026-08-04T12:00:00.000Z')).toBe('2026-08-04');
  });

  it('meia-noite UTC cai no dia ANTERIOR no Brasil — por isso não se usa T00:00', () => {
    expect(isoToBrazilYMD('2026-08-04T00:00:00.000Z')).toBe('2026-08-03');
  });

  it('23h UTC cai no mesmo dia — mas 02h UTC não', () => {
    expect(isoToBrazilYMD('2026-08-04T23:00:00.000Z')).toBe('2026-08-04');
    expect(isoToBrazilYMD('2026-08-04T02:00:00.000Z')).toBe('2026-08-03');
  });
});

describe('getMonthRangeBR — a janela dos KPIs "esperado/recebido do mês"', () => {
  it('às 23h30 BRT do dia 31 a janela ainda é agosto (o banco já viraria setembro)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T02:30:00.000Z'));
    expect(getMonthRangeBR()).toEqual({
      startISO: '2026-08-01T03:00:00.000Z',
      endISO: '2026-09-01T03:00:00.000Z',
      startYMD: '2026-08-01',
      endYMD: '2026-09-01',
    });
  });

  it('vira o ano corretamente de dezembro para janeiro', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-15T15:00:00.000Z'));
    expect(getMonthRangeBR()).toEqual({
      startISO: '2026-12-01T03:00:00.000Z',
      endISO: '2027-01-01T03:00:00.000Z',
      startYMD: '2026-12-01',
      endYMD: '2027-01-01',
    });
  });
});

describe('addDaysBR — depende do fuso do BROWSER, não do Brasil', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it('no fuso do Brasil atravessa a virada de mês corretamente', () => {
    process.env.TZ = 'America/Sao_Paulo';
    expect(addDaysBR('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysBR('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysBR('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('num browser em UTC ou a leste, o resultado sai UM DIA ATRASADO', () => {
    // BUG CONFIRMADO (BR-TZ-001): dateUtils.ts:54 constrói
    //   new Date(y, m - 1, d + days)   ← meia-noite no fuso do HOST
    // e só depois formata em BRT. Se o host não for UTC-3, a meia-noite local
    // convertida para BRT cai no dia anterior. addDaysBR alimenta as pills
    // "A COBRAR 3d/6d/15d/30d" (DashboardWidgets.tsx:201-219): num usuário
    // acessando de fuso UTC+ a janela de cobrança fecha um dia cedo.
    // Correto seria montar a data já em BRT (Date.UTC(y, m-1, d+days, 12)).
    process.env.TZ = 'UTC';
    expect(addDaysBR('2026-08-31', 1)).toBe('2026-08-31');

    process.env.TZ = 'Asia/Tokyo';
    expect(addDaysBR('2026-08-31', 1)).toBe('2026-08-31');
  });
});
