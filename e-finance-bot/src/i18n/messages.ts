/**
 * i18n / catálogo de mensagens — Fase 1 do motor determinístico.
 * Ver: docs/architecture/bot-deterministic-engine.md
 *
 * Fonte de verdade dos textos PT-BR é ESTE arquivo (DEFAULT_MESSAGES). O banco
 * (bot_tenant_config.messages, jsonb chave→texto) só SOBRESCREVE chaves por
 * tenant, editável sem deploy. O helper t(key) resolve override → default →
 * (último recurso) a própria chave, e nunca quebra se a coluna/JSON não existir.
 *
 * Interpolação: `{var}` é substituído pelo valor em `vars`; var ausente vira ''.
 */

export const DEFAULT_MESSAGES = {
  // Fast-path (respostas determinísticas, sem LLM) — ver src/ai/fast-path.ts
  'fastpath.greeting': '{greeting}{name}! Sou {persona}. Como posso ajudar?',
  'fastpath.start': 'Olá{name}! Sou {persona}. Digite /help para ver o que posso fazer.',
  'fastpath.confirm_no_pending': 'Ok{name}! Me diz o que posso fazer.',
  'fastpath.deny_no_pending': 'Tudo bem{name}, cancelado.',
  'fastpath.thanks': 'De nada{name}! 🤝',
  'fastpath.goodbye': 'Até mais{name}! Qualquer coisa é só chamar.',
  'fastpath.help.header': 'Sou {persona}. Posso te ajudar com:',
  'fastpath.help.admin': [
    'Sou {persona}. Posso te ajudar com:',
    '',
    '*Consultas*',
    '• Dashboard do mês — _"como tá o mês?"_',
    '• Recebíveis — _"quanto vou receber na semana?"_',
    '• Cobranças — _"quem cobro hoje?"_',
    '• Saldo de um cliente — _"quanto o João me deve?"_',
    '',
    '*Operações*',
    '• Criar contrato — _"empresta R$ 2.000 pro Felipe em 10× a 5%"_',
    '• Marcar parcela paga — _"baixa parcela 3 do João"_',
    '• Relatório do mês — _"gera relatório"_',
    '• Convite — _"gera um convite"_',
    '',
    'Pode falar comigo em português natural.',
  ].join('\n'),
  'fastpath.help.investor': [
    'Sou {persona}. Posso te ajudar com:',
    '',
    '• Seu portfólio — _"como está meu capital?"_',
    '• Desconectar — _"me desconecta"_',
  ].join('\n'),
  // Respostas de sistema (determinísticas, sem LLM)
  'system.action_not_allowed': 'Essa ação não está disponível para o seu perfil neste chat.',
  'system.validate_failed': 'Não consegui validar essa ação agora.',
  'system.ai_disabled': 'Assistente IA desativado pelo administrador.',
  'system.budget_exceeded': 'Limite mensal do assistente IA atingido. Fale com o administrador para aumentar o plano.',
  'system.kill_switch': 'Assistente IA temporariamente indisponível. Usando modo básico.',
  'system.generic_error': 'Tive um problema para processar sua mensagem. Pode reformular?',

  // "Não entendi" contextuais do message-handler
  'handler.not_understood_repeat': 'Não entendi. Pode repetir?',
  'handler.not_understood_help': 'Não entendi bem. Pode reformular? Posso ajudar com cobranças, recebíveis, dashboard, contratos ou pagamentos.',
  'handler.not_understood_baixas': 'Não entendi. Responda *sim* (baixa em todos), *não* (nenhum) ou os *números* a manter em aberto (ex.: *2* ou *1,3*).',
  'handler.not_understood_frequency': 'Não entendi. Responda *1* (Mensal), *2* (Semanal), *3* (Quinzenal) ou *4* (Diária).',
  'handler.not_understood_weekday': 'Não entendi o dia. Responda com o nome (segunda, terça...) ou número (1–7).',

  'fastpath.help.debtor': [
    'Sou {persona}. Posso te ajudar com:',
    '',
    '• Suas parcelas — _"quais as próximas?"_',
    '• Saldo devedor — _"quanto eu devo?"_',
    '• Desconectar — _"me desconecta"_',
  ].join('\n'),
} as const;

export type MessageKey = keyof typeof DEFAULT_MESSAGES;

/** Overrides por tenant (de bot_tenant_config.messages). Chave→texto. */
export type MessageOverrides = Record<string, string> | null | undefined;

/**
 * Resolve uma mensagem: override do tenant → default do código → a própria chave.
 * Substitui `{var}` por `vars[var]` (var ausente/undefined → '').
 */
export function t(
  key: MessageKey,
  vars?: Record<string, string | undefined>,
  overrides?: MessageOverrides,
): string {
  const override = overrides && typeof overrides[key] === 'string' ? overrides[key] : undefined;
  const template = override ?? DEFAULT_MESSAGES[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars?.[name];
    return value != null ? value : '';
  });
}

/**
 * Extrai overrides de uma linha de bot_tenant_config de forma defensiva:
 * só aceita objeto de valores string (espelha o CHECK do banco). Funciona
 * mesmo antes da coluna `messages` existir (retorna undefined → usa defaults).
 */
export function messagesFromConfig(
  config: { messages?: unknown } | null | undefined,
): MessageOverrides {
  const raw = config?.messages;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
