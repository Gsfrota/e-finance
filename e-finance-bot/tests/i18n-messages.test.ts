import { describe, expect, it } from 'vitest';
import { t, messagesFromConfig } from '../src/i18n/messages';
import { formatFastPathReply, type FastPathContext } from '../src/ai/fast-path';

describe('i18n t(key)', () => {
  it('interpola {var} e trata var ausente como vazio', () => {
    expect(t('fastpath.thanks', { name: ', Felipe' })).toBe('De nada, Felipe! 🤝');
    expect(t('fastpath.thanks', {})).toBe('De nada! 🤝');
  });

  it('override do tenant ganha do default', () => {
    const out = t('fastpath.thanks', { name: '' }, { 'fastpath.thanks': 'Valeu{name}!' });
    expect(out).toBe('Valeu!');
  });

  it('ignora override não-string (espelha o CHECK do banco)', () => {
    const overrides = messagesFromConfig({ messages: { 'fastpath.thanks': 123 as unknown as string } });
    expect(overrides).toBeUndefined();
    // cai no default do código (template interpolado), ignorando o override inválido
    expect(t('fastpath.thanks', { name: '' }, overrides)).toBe('De nada! 🤝');
  });

  it('chaves de sistema preservam o texto original (paridade)', () => {
    expect(t('system.action_not_allowed')).toBe('Essa ação não está disponível para o seu perfil neste chat.');
    expect(t('system.validate_failed')).toBe('Não consegui validar essa ação agora.');
    expect(t('system.ai_disabled')).toBe('Assistente IA desativado pelo administrador.');
    expect(t('system.budget_exceeded')).toBe('Limite mensal do assistente IA atingido. Fale com o administrador para aumentar o plano.');
    expect(t('system.kill_switch')).toBe('Assistente IA temporariamente indisponível. Usando modo básico.');
    expect(t('system.generic_error')).toBe('Tive um problema para processar sua mensagem. Pode reformular?');
  });

  it('chaves "não entendi" do handler preservam o texto original', () => {
    expect(t('handler.not_understood_repeat')).toBe('Não entendi. Pode repetir?');
    expect(t('handler.not_understood_help')).toBe('Não entendi bem. Pode reformular? Posso ajudar com cobranças, recebíveis, dashboard, contratos ou pagamentos.');
    expect(t('handler.not_understood_baixas')).toBe('Não entendi. Responda *sim* (baixa em todos), *não* (nenhum) ou os *números* a manter em aberto (ex.: *2* ou *1,3*).');
    expect(t('handler.not_understood_frequency')).toBe('Não entendi. Responda *1* (Mensal), *2* (Semanal), *3* (Quinzenal) ou *4* (Diária).');
    expect(t('handler.not_understood_weekday')).toBe('Não entendi o dia. Responda com o nome (segunda, terça...) ou número (1–7).');
  });

  it('override de sistema por tenant funciona', () => {
    const out = t('system.ai_disabled', undefined, { 'system.ai_disabled': 'IA off.' });
    expect(out).toBe('IA off.');
  });

  it('messagesFromConfig é defensivo a shapes inválidos e coluna ausente', () => {
    expect(messagesFromConfig(null)).toBeUndefined();
    expect(messagesFromConfig({})).toBeUndefined(); // coluna messages ainda não existe
    expect(messagesFromConfig({ messages: [] })).toBeUndefined(); // array
    expect(messagesFromConfig({ messages: { a: 'x', b: 1 } })).toEqual({ a: 'x' });
  });
});

describe('fast-path — paridade exata após externalizar strings', () => {
  const ctx = (over: Partial<FastPathContext> = {}): FastPathContext => ({
    personaName: 'Juros Certo',
    userFirstName: 'Felipe',
    role: 'admin',
    hasPendingConfirmation: false,
    ...over,
  });

  it('slash_start preserva o texto original', () => {
    const out = formatFastPathReply({ kind: 'slash_start', normalized: '/start', original: '/start' }, ctx());
    expect(out).toBe('Olá, Felipe! Sou Juros Certo. Digite /help para ver o que posso fazer.');
  });

  it('thanks/goodbye/confirm/deny preservam o texto original', () => {
    const c = ctx();
    expect(formatFastPathReply({ kind: 'thanks', normalized: 'obg', original: 'obg' }, c)).toBe('De nada, Felipe! 🤝');
    expect(formatFastPathReply({ kind: 'goodbye', normalized: 'flw', original: 'flw' }, c)).toBe('Até mais, Felipe! Qualquer coisa é só chamar.');
    expect(formatFastPathReply({ kind: 'confirm', normalized: 'ok', original: 'ok' }, c)).toBe('Ok, Felipe! Me diz o que posso fazer.');
    expect(formatFastPathReply({ kind: 'deny', normalized: 'não', original: 'não' }, c)).toBe('Tudo bem, Felipe, cancelado.');
  });

  it('sem userFirstName não vaza vírgula solta', () => {
    const out = formatFastPathReply({ kind: 'thanks', normalized: 'obg', original: 'obg' }, ctx({ userFirstName: undefined }));
    expect(out).toBe('De nada! 🤝');
  });

  it('help admin preserva blocos e dicas originais', () => {
    const out = formatFastPathReply({ kind: 'slash_help', normalized: '/help', original: '/help' }, ctx());
    expect(out).toContain('Sou Juros Certo. Posso te ajudar com:');
    expect(out).toContain('*Consultas*');
    expect(out).toContain('*Operações*');
    expect(out).toContain('• Criar contrato — _"empresta R$ 2.000 pro Felipe em 10× a 5%"_');
    expect(out).toContain('Pode falar comigo em português natural.');
  });

  it('help investor/debtor preservam os itens originais', () => {
    const inv = formatFastPathReply({ kind: 'slash_help', normalized: '/help', original: '/help' }, ctx({ role: 'investor' }));
    expect(inv).toContain('• Seu portfólio — _"como está meu capital?"_');
    const deb = formatFastPathReply({ kind: 'slash_help', normalized: '/help', original: '/help' }, ctx({ role: 'debtor' }));
    expect(deb).toContain('• Saldo devedor — _"quanto eu devo?"_');
  });

  it('override de tenant troca o texto sem mudar o resto', () => {
    const out = formatFastPathReply(
      { kind: 'goodbye', normalized: 'flw', original: 'flw' },
      ctx(),
      { 'fastpath.goodbye': 'Falou{name}!' },
    );
    expect(out).toBe('Falou, Felipe!');
  });
});
