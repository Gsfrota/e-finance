/**
 * Catálogo de perguntas prontas do Assistente (BR-BOT-013).
 *
 * Dados puros, sem JSX, para que o teste possa exigir o essencial: **toda pergunta
 * oferecida aqui tem que ser entendida pelo motor**. Oferecer um botão que responde
 * "não entendi" é pior do que não oferecer botão nenhum.
 */

export interface CatalogEntry {
  /** Assunto — vira o título do cartão. */
  group: string;
  /** Texto do botão, curto: o assunto já está no título. */
  label: string;
  /** A pergunta que vai para o motor. */
  question: string;
  /** Só preenche o campo em vez de enviar: falta o nome, que só o dono sabe. */
  needsInput?: boolean;
}

export const GROUP_LENT = 'Quanto emprestei';
export const GROUP_LATE = 'Quem está atrasado';
export const GROUP_RECEIVABLES = 'Quanto tenho a receber';
export const GROUP_RECEIVED = 'Quanto entrou';
export const GROUP_DEBTOR = 'Sobre um cliente';

export const ASSISTANT_CATALOG: CatalogEntry[] = [
  { group: GROUP_LENT, label: 'essa semana', question: 'Quanto emprestei essa semana?' },
  { group: GROUP_LENT, label: 'esse mês', question: 'Quanto emprestei esse mês?' },
  { group: GROUP_LENT, label: 'hoje', question: 'Quanto emprestei hoje?' },
  { group: GROUP_LENT, label: 'últimos 15 dias', question: 'Quanto emprestei nos últimos 15 dias?' },

  { group: GROUP_LATE, label: 'ver atrasados', question: 'Quem está atrasado?' },
  { group: GROUP_LATE, label: 'quem devo cobrar', question: 'Quem devo cobrar hoje?' },

  { group: GROUP_RECEIVABLES, label: 'essa semana', question: 'Quanto tenho pra receber essa semana?' },
  { group: GROUP_RECEIVABLES, label: 'próximos 7 dias', question: 'Quanto tenho pra receber nos próximos 7 dias?' },
  { group: GROUP_RECEIVABLES, label: 'próximos 30 dias', question: 'Quanto tenho pra receber nos próximos 30 dias?' },

  { group: GROUP_RECEIVED, label: 'hoje', question: 'Quanto recebi hoje?' },
  { group: GROUP_RECEIVED, label: 'ontem', question: 'Quanto recebi ontem?' },
  { group: GROUP_RECEIVED, label: 'essa semana', question: 'Quanto recebi essa semana?' },
  { group: GROUP_RECEIVED, label: 'esse mês', question: 'Quanto recebi esse mês?' },

  // Sem nome não há pergunta: estes só preenchem o campo e deixam o cursor no fim.
  { group: GROUP_DEBTOR, label: 'quanto ele me deve', question: 'Quanto o ', needsInput: true },
  { group: GROUP_DEBTOR, label: 'quanto ele já pagou', question: 'Quanto o ', needsInput: true },
];

/** Ordem em que os assuntos aparecem na tela. */
export const CATALOG_GROUPS = [
  GROUP_LENT,
  GROUP_LATE,
  GROUP_RECEIVABLES,
  GROUP_RECEIVED,
  GROUP_DEBTOR,
] as const;
