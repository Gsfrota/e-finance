/**
 * BotError — erros classificados para mapear código → mensagem amigável ao usuário.
 *
 * Usado pelo catch raiz em message-handler.ts para diferenciar:
 *   - timeout vs network vs quota vs auth vs validation
 * E entregar sugestão acionável ao invés de "ocorreu um erro".
 */

export type BotErrorCode =
  | 'session_get_timeout'
  | 'session_sync_timeout'
  | 'history_read_timeout'
  | 'llm_quota_exceeded'
  | 'llm_unavailable'
  | 'tool_temporarily_unavailable'
  | 'tenant_misconfigured'
  | 'permission_denied'
  | 'validation_failed'
  | 'unknown';

export class BotError extends Error {
  public readonly code: BotErrorCode;
  public readonly retryable: boolean;
  public readonly userMessage?: string;

  constructor(code: BotErrorCode, message: string, options: { retryable?: boolean; userMessage?: string } = {}) {
    super(message);
    this.name = 'BotError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.userMessage = options.userMessage;
  }
}

export function mapErrorToUserMessage(error: unknown): string {
  if (error instanceof BotError && error.userMessage) return error.userMessage;
  if (error instanceof BotError) {
    switch (error.code) {
      case 'session_get_timeout':
        return 'A abertura da sua sessão demorou mais do que o esperado. Tente novamente em instantes.';
      case 'session_sync_timeout':
        return 'A validação do vínculo deste chat demorou demais. Tente novamente em instantes.';
      case 'history_read_timeout':
        return 'Tive um atraso para puxar nosso histórico. Pode repetir sua mensagem?';
      case 'llm_quota_exceeded':
        return 'Atingimos o limite mensal do assistente. Avise o administrador para liberar.';
      case 'llm_unavailable':
        return 'Estou sem acesso ao motor de IA agora. Tente daqui a um minuto.';
      case 'tool_temporarily_unavailable':
        return 'Essa operação está temporariamente indisponível. Tente daqui a um minuto.';
      case 'tenant_misconfigured':
        return 'Sua empresa precisa concluir a configuração do assistente. Avise o administrador.';
      case 'permission_denied':
        return 'Você não tem permissão para essa ação.';
      case 'validation_failed':
        return error.message || 'Faltou alguma informação para concluir a ação.';
      case 'unknown':
      default:
        return 'Ocorreu um erro ao processar sua mensagem. Tente novamente em instantes.';
    }
  }

  if (error instanceof Error) {
    if (error.message === 'session_get_timeout') return 'A abertura da sua sessão demorou mais do que o esperado. Tente novamente em instantes.';
    if (error.message === 'session_sync_timeout') return 'A validação do vínculo deste chat demorou demais. Tente novamente em instantes.';
  }
  return '❌ Ocorreu um erro ao processar sua mensagem. Tente novamente em instantes.';
}
