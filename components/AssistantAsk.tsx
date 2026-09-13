import React, { useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { getSupabase, parseSupabaseError } from '../services/supabase';
import { useCompanyContext } from '../services/companyScope';
import { getWeekToDateRangeBR, getLast7DaysRangeBR } from '../services/dateUtils';
import { matchAssistantIntent, sumLentInRange, type LentRow, type LentTotal } from '../utils/assistantEngine';

interface AssistantAskProps {
  tenantId: string;
}

interface LentAnswer {
  week: LentTotal & { startYMD: string; endYMD: string };
  last7: LentTotal & { startYMD: string; endYMD: string };
}

const SUGESTOES = [
  'Quanto emprestei essa semana?',
  'Qual o total investido na semana?',
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatYMD = (ymd: string) => ymd.split('-').reverse().slice(0, 2).join('/');

/** Seção "Perguntar" — respostas determinísticas, sem LLM (BR-BOT-009). */
const AssistantAsk: React.FC<AssistantAskProps> = ({ tenantId }) => {
  const { activeCompanyId, activeCompany } = useCompanyContext();
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<LentAnswer | null>(null);
  const [notUnderstood, setNotUnderstood] = useState(false);

  const escopoLabel = activeCompanyId
    ? (activeCompany?.name ?? 'empresa ativa')
    : 'todas as empresas';

  const ask = async (text: string) => {
    setError(null);
    setAnswer(null);
    setNotUnderstood(false);

    if (matchAssistantIntent(text) !== 'lent_volume') {
      setNotUnderstood(true);
      return; // nunca consulta o banco sem intenção reconhecida
    }

    setLoading(true);
    try {
      const week = getWeekToDateRangeBR();
      const last7 = getLast7DaysRangeBR();
      // Uma leitura só: a janela maior cobre as duas
      const fromISO = week.startISO < last7.startISO ? week.startISO : last7.startISO;

      let query = getSupabase()
        .from('investments')
        .select('amount_invested, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', fromISO)
        .lt('created_at', week.endISO);
      if (activeCompanyId) query = query.eq('company_id', activeCompanyId);

      const { data, error: dbError } = await query;
      if (dbError) throw dbError;

      const rows = (data ?? []) as LentRow[];
      setAnswer({
        week: { ...sumLentInRange(rows, week.startISO, week.endISO), startYMD: week.startYMD, endYMD: week.endYMD },
        last7: { ...sumLentInRange(rows, last7.startISO, last7.endISO), startYMD: last7.startYMD, endYMD: last7.endYMD },
      });
    } catch (e) {
      setError(parseSupabaseError(e));
    } finally {
      setLoading(false);
    }
  };

  const cardClass = 'rounded-2xl border border-[color:var(--border-subtle)] p-5';

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Perguntar</h3>
        <p className="text-sm text-[color:var(--text-muted)]">
          Respostas calculadas direto do seu banco, sem IA generativa — o número é sempre o mesmo para a mesma pergunta.
        </p>
      </div>

      <div className="border-t border-[color:var(--border-subtle)] pt-6 space-y-5">
        <form
          onSubmit={(e) => { e.preventDefault(); ask(question); }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Quanto emprestei essa semana?"
            className="flex-1 rounded-xl border border-[color:var(--border-subtle)] bg-transparent px-4 py-3 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-faint)] focus:border-teal-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || question.trim().length === 0}
            className="flex items-center justify-center gap-2 rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-teal-400 disabled:opacity-40"
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
            Perguntar
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {SUGESTOES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { setQuestion(s); ask(s); }}
              className="rounded-full border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text-primary)]"
            >
              {s}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-700 bg-red-900/30 px-5 py-4 text-sm font-medium text-red-300">
            {error}
          </div>
        )}

        {notUnderstood && (
          <div className={cardClass}>
            <p className="text-sm font-semibold text-[color:var(--text-primary)]">Não entendi a pergunta.</p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Hoje sei responder quanto você emprestou na semana. Ex.: <em>"quanto emprestei essa semana"</em>.
            </p>
          </div>
        )}

        {answer && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { titulo: 'Semana corrente', sub: `segunda ${formatYMD(answer.week.startYMD)} até hoje`, dado: answer.week },
                { titulo: 'Últimos 7 dias', sub: `${formatYMD(answer.last7.startYMD)} até hoje`, dado: answer.last7 },
              ].map(({ titulo, sub, dado }) => (
                <div key={titulo} className={cardClass}>
                  <p className="section-kicker mb-1">{titulo}</p>
                  <p className="type-display text-[color:var(--text-primary)]">{formatCurrency(dado.total)}</p>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                    {dado.count} {dado.count === 1 ? 'contrato' : 'contratos'} · {sub}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-[color:var(--text-faint)]">
              Soma do valor emprestado dos contratos cadastrados no período ({escopoLabel}), renovações incluídas. Fuso de Mossoró.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AssistantAsk;
