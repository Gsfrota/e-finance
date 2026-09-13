/**
 * Roteador do assistente determinístico (BR-BOT-010).
 *
 * Uma pergunta entra, uma consulta sai. Cada intent tem seu handler; nada de LLM,
 * nada de escolha aleatória — mesma pergunta, mesma resposta.
 */

import { matchAssistant, resolvePeriod } from '../utils/assistantEngine';
import type { AssistantCtx, AssistantReply } from '../utils/assistantTypes';
import { answerLentVolume, formatUnknownReply } from './assistantAnswer';
import { answerLateDebtors, answerReceivables } from './assistantAnswerCollection';
import { answerReceived, answerDebtorBalance } from './assistantAnswerMoney';

export async function answerAssistant(question: string, ctx: AssistantCtx): Promise<AssistantReply> {
  const match = matchAssistant(question);

  switch (match.intent) {
    case 'lent_volume': {
      // BR-BOT-009: "essa semana" e "últimos 7 dias" dão números diferentes e o cliente
      // pediu para ver os dois lado a lado — qualquer uma das duas devolve o par. Só um
      // período de outra natureza ("esse mês", "ontem") responde sozinho.
      const parDeJanelas =
        !match.period ||
        match.period.kind === 'current_week' ||
        match.period.kind === 'last_7_days';
      return answerLentVolume(parDeJanelas ? null : match.period, ctx);
    }

    case 'late_debtors':
      return answerLateDebtors(ctx);

    case 'receivables': {
      // Recebível olha pra frente: "essa semana" aqui é o que ainda vai vencer até
      // domingo, não a janela retrospectiva que "quanto emprestei essa semana" usa.
      const janela = match.period?.kind === 'current_week'
        ? resolvePeriod('week_remainder')
        : match.period ?? resolvePeriod('next_7_days');
      return answerReceivables(janela, ctx);
    }

    case 'received':
      return answerReceived(match.period ?? resolvePeriod('today'), ctx);

    case 'debtor_balance':
      // o motor só devolve esta intent com nome extraído; sem nome seria 'unknown'
      return answerDebtorBalance(match.debtorName ?? '', ctx);

    default:
      return formatUnknownReply(); // nunca consulta o banco sem intenção reconhecida
  }
}
