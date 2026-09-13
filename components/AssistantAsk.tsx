import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Landmark,
  AlertTriangle,
  CalendarClock,
  Wallet,
  Sparkles,
  Plus,
  History,
  Trash2,
  Check,
} from 'lucide-react';
import { useCompanyContext } from '../services/companyScope';
import { useBotConfig } from '../hooks/useBotConfig';
import { answerAssistant } from '../services/assistantRouter';
import {
  listarConversas,
  carregarConversa,
  salvarConversa,
  apagarConversa,
  type ConversationSummary,
} from '../services/assistantConversations';
import { AnimatedAIChat, type ChatMessage, type ChatSuggestion } from './ui/animated-ai-chat';

interface AssistantAskProps {
  tenantId: string;
  /** Abre o contrato de uma linha do detalhamento; ausente deixa a lista só informativa. */
  onOpenContract?: (investmentId: number, companyId: string | null) => void;
}

/** Atalhos fixos — o que ele sabe responder hoje (BR-BOT-009 / BR-BOT-010). */
const SUGGESTIONS: ChatSuggestion[] = [
  { icon: <Landmark className="w-4 h-4" />, label: 'Emprestado na semana', prefix: 'Quanto emprestei essa semana?' },
  { icon: <AlertTriangle className="w-4 h-4" />, label: 'Quem está atrasado', prefix: 'Quem está atrasado?' },
  { icon: <CalendarClock className="w-4 h-4" />, label: 'A receber', prefix: 'Quanto tenho pra receber essa semana?' },
  { icon: <Wallet className="w-4 h-4" />, label: 'Quanto entrou', prefix: 'Quanto recebi hoje?' },
];

let messageSeq = 0;
const nextId = () => `msg-${++messageSeq}`;

/**
 * ponytail: a conversa ABERTA fica num módulo porque sair da tela — inclusive
 * clicando numa linha do detalhamento, que navega para o contrato — desmonta o chat.
 * É só cache de tela: a fonte da verdade é `assistant_conversations` (BR-BOT-012).
 */
let aberta: { tenantId: string; id: string | null; messages: ChatMessage[]; followUp: string | null } = {
  tenantId: '',
  id: null,
  messages: [],
  followUp: null,
};

const lerAberta = (tenantId: string) => {
  if (aberta.tenantId !== tenantId) aberta = { tenantId, id: null, messages: [], followUp: null };
  return aberta;
};

/** "hoje", "ontem" ou "12/09" — data curta para a lista de conversas. */
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dia = (x: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(x);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86400000);
  if (dia(d) === dia(hoje)) return 'hoje';
  if (dia(d) === dia(ontem)) return 'ontem';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  }).format(d);
}

/** Tela de conversa com o assistente — respostas determinísticas, sem LLM. */
const AssistantAsk: React.FC<AssistantAskProps> = ({ tenantId, onOpenContract }) => {
  const { activeCompanyId, activeCompany, profile } = useCompanyContext();
  const { config } = useBotConfig(tenantId);
  const userId = profile?.id ?? null;

  const inicial = lerAberta(tenantId);
  const [messages, setMessagesState] = useState<ChatMessage[]>(inicial.messages);
  const [conversaId, setConversaIdState] = useState<string | null>(inicial.id);
  const [followUpState, setFollowUpState] = useState<string | null>(inicial.followUp);
  const [isTyping, setIsTyping] = useState(false);
  const [conversas, setConversas] = useState<ConversationSummary[]>([]);
  const [listaAberta, setListaAberta] = useState(false);
  const [erroHistorico, setErroHistorico] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  /**
   * Grava no cache do módulo e na tela ao mesmo tempo. Direto, sem updater
   * funcional: a lista nova sai sempre de `aberta.messages`, que é síncrono —
   * ler o state logo depois de agendá-lo salvaria a conversa sem a última resposta.
   */
  const aplicarMensagens = (mensagens: ChatMessage[]) => {
    aberta.messages = mensagens;
    setMessagesState(mensagens);
  };

  const setConversaId = (id: string | null) => {
    aberta.id = id;
    setConversaIdState(id);
  };

  const setFollowUp = (valor: string | null) => {
    aberta.followUp = valor;
    setFollowUpState(valor);
  };

  const recarregarLista = useCallback(async () => {
    if (!userId) return;
    try {
      setConversas(await listarConversas(tenantId, userId));
      setErroHistorico(null);
    } catch (e) {
      setErroHistorico(e instanceof Error ? e.message : 'erro ao carregar o histórico');
    }
  }, [tenantId, userId]);

  useEffect(() => {
    void recarregarLista();
  }, [recarregarLista]);

  // fecha a lista ao clicar fora — comportamento esperado de dropdown
  useEffect(() => {
    if (!listaAberta) return;
    const fora = (e: MouseEvent) => {
      if (!listaRef.current?.contains(e.target as Node)) setListaAberta(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [listaAberta]);

  const scopeLabel = activeCompanyId ? (activeCompany?.name ?? 'empresa ativa') : 'todas as empresas';

  const persistir = async (mensagens: ChatMessage[]) => {
    if (!userId) return; // sem perfil não há dono para a conversa
    try {
      const salva = await salvarConversa({
        id: aberta.id,
        tenantId,
        userId,
        messages: mensagens.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.details ? { details: m.details } : {}),
        })),
      });
      setConversaId(salva.id);
      await recarregarLista();
    } catch (e) {
      // gravar é secundário: a resposta já está na tela, não some por causa disso
      setErroHistorico(e instanceof Error ? e.message : 'não consegui salvar a conversa');
    }
  };

  const handleSend = async (text: string) => {
    const comPergunta: ChatMessage[] = [
      ...aberta.messages,
      { id: nextId(), role: 'user', content: text },
    ];
    aplicarMensagens(comPergunta);
    setIsTyping(true);
    setFollowUp(null);
    try {
      const reply = await answerAssistant(text, { tenantId, companyId: activeCompanyId, scopeLabel });
      const completa: ChatMessage[] = [
        ...comPergunta,
        { id: nextId(), role: 'assistant', content: reply.text, details: reply.details },
      ];
      aplicarMensagens(completa);
      setFollowUp(reply.followUp ?? null);
      await persistir(completa);
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'erro desconhecido';
      // erro de consulta não vai para o banco: não é conversa, é falha de momento
      aplicarMensagens([
        ...comPergunta,
        { id: nextId(), role: 'assistant', content: `Não consegui consultar agora: ${detail}` },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const novaConversa = () => {
    setListaAberta(false);
    // conversa vazia não vira linha no banco: só grava quando houver a primeira pergunta
    setConversaId(null);
    setFollowUp(null);
    aplicarMensagens([]);
  };

  const abrirConversa = async (id: string) => {
    setListaAberta(false);
    if (id === conversaId) return;
    try {
      const conversa = await carregarConversa(id);
      if (!conversa) {
        await recarregarLista(); // sumiu no meio do caminho (apagada em outra aba)
        return;
      }
      setConversaId(conversa.id);
      setFollowUp(null);
      aplicarMensagens(conversa.messages as ChatMessage[]);
    } catch (e) {
      setErroHistorico(e instanceof Error ? e.message : 'não consegui abrir a conversa');
    }
  };

  const removerConversa = async (id: string) => {
    try {
      await apagarConversa(id);
      if (id === conversaId) novaConversa();
      await recarregarLista();
    } catch (e) {
      setErroHistorico(e instanceof Error ? e.message : 'não consegui apagar a conversa');
    }
  };

  const followUp = followUpState;

  // A sugestão de próxima pergunta entra na frente dos atalhos fixos
  const suggestions: ChatSuggestion[] = followUp
    ? [
        { icon: <Sparkles className="w-4 h-4" />, label: followUp, prefix: followUp },
        ...SUGGESTIONS.filter(s => s.prefix !== followUp),
      ]
    : SUGGESTIONS;

  const barra = (
    <div className="mb-3 flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={novaConversa}
        data-testid="nova-conversa"
        className="flex items-center gap-1.5 rounded-lg border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs font-semibold text-[color:var(--text-primary)] transition-colors hover:border-teal-400/60 hover:text-teal-400"
      >
        <Plus className="h-3.5 w-3.5" />
        Nova conversa
      </button>

      <div className="relative" ref={listaRef}>
        <button
          type="button"
          onClick={() => setListaAberta(v => !v)}
          data-testid="abrir-historico"
          className="flex items-center gap-1.5 rounded-lg border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs font-semibold text-[color:var(--text-muted)] transition-colors hover:border-teal-400/60 hover:text-teal-400"
        >
          <History className="h-3.5 w-3.5" />
          Conversas
          {conversas.length > 0 && (
            <span className="rounded-full bg-[color:var(--bg-subtle)] px-1.5 text-[10px] tabular-nums">
              {conversas.length}
            </span>
          )}
        </button>

        {listaAberta && (
          <div
            data-testid="lista-conversas"
            className="absolute right-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-1 shadow-lg"
          >
            {conversas.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-[color:var(--text-muted)]">
                Nenhuma conversa salva ainda.
              </p>
            )}
            {conversas.map(c => (
              <div
                key={c.id}
                className="group flex items-center gap-1 rounded-lg px-1 hover:bg-[color:var(--bg-subtle)]"
              >
                <button
                  type="button"
                  onClick={() => abrirConversa(c.id)}
                  data-testid="conversa-item"
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                >
                  {c.id === conversaId ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-teal-400" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[color:var(--text-primary)]">
                      {c.title}
                    </span>
                    <span className="block text-[10px] text-[color:var(--text-muted)]">
                      {quando(c.updatedAt)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removerConversa(c.id)}
                  aria-label={`Apagar conversa ${c.title}`}
                  className="shrink-0 rounded p-1.5 text-[color:var(--text-muted)] opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div>
      {barra}
      {erroHistorico && (
        <p className="mb-2 text-xs text-amber-500">Histórico: {erroHistorico}</p>
      )}
      <AnimatedAIChat
        messages={messages}
        isTyping={isTyping}
        assistantName={config.ai_persona_name}
        suggestions={suggestions}
        onSend={handleSend}
        placeholder={`Pergunte ao ${config.ai_persona_name}...`}
        emptyTitle={`Oi! Sou o ${config.ai_persona_name}`}
        onOpenLine={onOpenContract ? line => onOpenContract(line.investmentId, line.companyId) : undefined}
      />
    </div>
  );
};

export default AssistantAsk;
