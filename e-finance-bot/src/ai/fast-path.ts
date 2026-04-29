/**
 * Fast-path regex para mensagens triviais que NÃO precisam de LLM.
 *
 * Conforme BR-BOT-008 (budget), fast-path NÃO consome budget do tenant
 * nem rate limit de LLM — resposta determinística pré-formatada.
 *
 * Cobre: saudações puras, confirmações/negações, comandos slash,
 * ajuda básica. Estimativa: 30-40% das mensagens resolvem aqui.
 *
 * Qualquer mensagem que NÃO bate em fast-path vai para o
 * conversation-orchestrator (LLM-first).
 */

export type FastPathKind =
  | 'greeting'
  | 'confirm'
  | 'deny'
  | 'slash_start'
  | 'slash_help'
  | 'thanks'
  | 'goodbye';

export interface FastPathHit {
  kind: FastPathKind;
  normalized: string;
  original: string;
}

export type FastPathResult =
  | { matched: true; hit: FastPathHit }
  | { matched: false };

const GREETING_RE = /^\s*(oi|ol[aá]|hey|hi+|ei|eai|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem(\?+)?|td\s*bem(\?+)?|e\s*a[ií](\?+)?)\s*[!.?\u{1F600}-\u{1F64F}]*\s*$/iu;
const CONFIRM_RE = /^\s*(sim|s|claro|ok|pode|pode\s*ser|confirmo|isso|isso\s*mesmo|beleza|blz|✅|👍)\s*[!.?]*\s*$/i;
const DENY_RE = /^\s*(n[aã]o|nao|n|cancela|cancelar|para|parar|sair|stop|❌|👎)\s*[!.?]*\s*$/i;
const THANKS_RE = /^\s*(obrigad[ao]|obg|vlw|valeu|thanks|thank\s*you|brigad[ao])\s*[!.?\u{1F600}-\u{1F64F}]*\s*$/iu;
const GOODBYE_RE = /^\s*(tchau|ate\s*mais|at[eé]\s*mais|flw|falou|bye|até)\s*[!.?]*\s*$/iu;
const SLASH_START_RE = /^\s*\/start\s*$/i;
const SLASH_HELP_RE = /^\s*(\/help|\/ajuda)\s*$/i;

export function matchFastPath(text: string): FastPathResult {
  if (!text || typeof text !== 'string') return { matched: false };
  const normalized = text.trim();
  if (normalized.length === 0 || normalized.length > 80) return { matched: false };

  if (SLASH_START_RE.test(normalized)) return hit('slash_start', normalized, text);
  if (SLASH_HELP_RE.test(normalized)) return hit('slash_help', normalized, text);
  if (GREETING_RE.test(normalized)) return hit('greeting', normalized, text);
  if (CONFIRM_RE.test(normalized)) return hit('confirm', normalized, text);
  if (DENY_RE.test(normalized)) return hit('deny', normalized, text);
  if (THANKS_RE.test(normalized)) return hit('thanks', normalized, text);
  if (GOODBYE_RE.test(normalized)) return hit('goodbye', normalized, text);

  return { matched: false };
}

function hit(kind: FastPathKind, normalized: string, original: string): FastPathResult {
  return { matched: true, hit: { kind, normalized, original } };
}

export interface FastPathContext {
  personaName: string;
  userFirstName?: string;
  role: 'admin' | 'investor' | 'debtor';
  hasPendingConfirmation: boolean;
}

/**
 * Formata a resposta do fast-path já personalizada pela persona do tenant.
 * Nenhuma chamada LLM. Se o hit for confirm/deny e houver pending confirmation,
 * o caller deve consumir o confirmation-store separadamente — esta função
 * apenas sugere um texto-fallback quando NÃO há pending.
 */
export function formatFastPathReply(hit: FastPathHit, ctx: FastPathContext): string {
  const name = ctx.userFirstName ? `, ${ctx.userFirstName}` : '';

  switch (hit.kind) {
    case 'greeting': {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
      return `${greeting}${name}! Sou ${ctx.personaName}. Como posso ajudar?`;
    }
    case 'slash_start':
      return `Olá${name}! Sou ${ctx.personaName}. Digite /help para ver o que posso fazer.`;
    case 'slash_help':
      return helpText(ctx.role, ctx.personaName);
    case 'confirm':
      return ctx.hasPendingConfirmation
        ? '' // caller resolve via confirmation-store
        : `Ok${name}! Me diz o que posso fazer.`;
    case 'deny':
      return ctx.hasPendingConfirmation
        ? '' // caller resolve via confirmation-store
        : `Tudo bem${name}, cancelado.`;
    case 'thanks':
      return `De nada${name}! 🤝`;
    case 'goodbye':
      return `Até mais${name}! Qualquer coisa é só chamar.`;
  }
}

function helpText(role: 'admin' | 'investor' | 'debtor', persona: string): string {
  const header = `Sou ${persona}. Posso te ajudar com:`;
  if (role === 'admin') {
    return [
      header,
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
    ].join('\n');
  }
  if (role === 'investor') {
    return [
      header,
      '',
      '• Seu portfólio — _"como está meu capital?"_',
      '• Desconectar — _"me desconecta"_',
    ].join('\n');
  }
  return [
    header,
    '',
    '• Suas parcelas — _"quais as próximas?"_',
    '• Saldo devedor — _"quanto eu devo?"_',
    '• Desconectar — _"me desconecta"_',
  ].join('\n');
}
