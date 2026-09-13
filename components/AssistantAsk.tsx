import React, { useState } from 'react';
import { Landmark, AlertTriangle, CalendarClock, Wallet, Sparkles } from 'lucide-react';
import { useCompanyContext } from '../services/companyScope';
import { useBotConfig } from '../hooks/useBotConfig';
import { answerAssistant } from '../services/assistantRouter';
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

/** Tela de conversa com o assistente — respostas determinísticas, sem LLM. */
const AssistantAsk: React.FC<AssistantAskProps> = ({ tenantId, onOpenContract }) => {
  const { activeCompanyId, activeCompany } = useCompanyContext();
  const { config } = useBotConfig(tenantId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [followUp, setFollowUp] = useState<string | null>(null);

  const scopeLabel = activeCompanyId ? (activeCompany?.name ?? 'empresa ativa') : 'todas as empresas';

  const handleSend = async (text: string) => {
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text }]);
    setIsTyping(true);
    setFollowUp(null);
    try {
      const reply = await answerAssistant(text, { tenantId, companyId: activeCompanyId, scopeLabel });
      setMessages(prev => [
        ...prev,
        { id: nextId(), role: 'assistant', content: reply.text, details: reply.details },
      ]);
      setFollowUp(reply.followUp ?? null);
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'erro desconhecido';
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: `Não consegui consultar agora: ${detail}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  // A sugestão de próxima pergunta entra na frente dos atalhos fixos
  const suggestions: ChatSuggestion[] = followUp
    ? [
        { icon: <Sparkles className="w-4 h-4" />, label: followUp, prefix: followUp },
        ...SUGGESTIONS.filter(s => s.prefix !== followUp),
      ]
    : SUGGESTIONS;

  return (
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
  );
};

export default AssistantAsk;
