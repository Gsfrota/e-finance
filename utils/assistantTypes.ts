/**
 * Contrato do assistente determinístico (BR-BOT-009 / BR-BOT-010).
 *
 * Só tipos — o motor vive em utils/assistantEngine.ts e as consultas em
 * services/assistantAnswer.ts. Nenhuma resposta usa LLM: mesma pergunta,
 * mesmo número, mesmo texto.
 */

export type AssistantIntent =
  | 'lent_volume'     // "quanto emprestei essa semana"
  | 'late_debtors'    // "quem está atrasado"
  | 'receivables'     // "quanto tenho pra receber"
  | 'received'        // "quanto recebi hoje"
  | 'debtor_balance'  // "quanto o João me deve"
  | 'received_from_debtor' // "quanto o João já me pagou"
  | 'unknown';

export type PeriodKind =
  | 'today'
  | 'yesterday'
  | 'current_week'    // segunda 00:00 BRT até o fim de hoje
  | 'last_7_days'     // hoje-6 00:00 BRT até o fim de hoje
  | 'current_month'   // dia 1 00:00 BRT até o fim de hoje
  | 'last_n_days'     // "últimos N dias"
  | 'week_remainder'  // hoje até domingo — "a receber essa semana"
  | 'next_7_days'     // olhando pra frente (recebíveis)
  | 'next_n_days';

/** Janela resolvida em instantes UTC, prontos para query. `endISO` é EXCLUSIVO. */
export interface ResolvedPeriod {
  kind: PeriodKind;
  label: string;      // "hoje", "esta semana", "nos últimos 15 dias" — entra no texto
  startISO: string;
  endISO: string;
  startYMD: string;
  endYMD: string;     // exclusivo
}

export interface AssistantMatch {
  intent: AssistantIntent;
  /** Período citado na pergunta; null quando a intent usa o padrão dela. */
  period: ResolvedPeriod | null;
  /** Nome do cliente citado, apenas para `debtor_balance`. */
  debtorName?: string;
}

/** Contexto que as consultas precisam para respeitar tenant/empresa ativa. */
export interface AssistantCtx {
  tenantId: string;
  companyId: string | null;
  scopeLabel: string;
}

/**
 * Uma linha do detalhamento — o que compõe o número da resposta.
 * Clicar nela abre o contrato de origem, então `investmentId` é obrigatório.
 */
export interface ReplyLine {
  /** Chave de render; única dentro da lista. */
  key: string;
  investmentId: number;
  /** Empresa do contrato: o app troca o escopo ativo antes de abrir. */
  companyId: string | null;
  /** Quem — nome do cliente. */
  title: string;
  /** Onde/quando — "Parcela 2/4 · vence 16/09", "Cadastrado em 09/09". */
  subtitle: string;
  amount: number;
}

/** Lista expansível abaixo da resposta. `label` é o texto do botão. */
export interface ReplyDetails {
  label: string;
  lines: ReplyLine[];
}

/** Resposta pronta para o chat. */
export interface AssistantReply {
  text: string;
  /** Sugestão de próxima pergunta — vira botão clicável no chat. */
  followUp?: string;
  /** Linha a linha do que soma no número; ausente quando não há o que abrir. */
  details?: ReplyDetails;
}
