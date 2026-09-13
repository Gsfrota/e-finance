import React, { useState } from 'react';
import { Landmark, TrendingUp } from 'lucide-react';
import { useCompanyContext } from '../services/companyScope';
import { useBotConfig } from '../hooks/useBotConfig';
import { answerAssistantQuestion } from '../services/assistantAnswer';
import { AnimatedAIChat, type ChatMessage, type ChatSuggestion } from './ui/animated-ai-chat';

interface AssistantAskProps {
  tenantId: string;
}

const SUGGESTIONS: ChatSuggestion[] = [
  { icon: <Landmark className="w-4 h-4" />, label: 'Emprestado na semana', prefix: 'Quanto emprestei essa semana?' },
  { icon: <TrendingUp className="w-4 h-4" />, label: 'Total investido', prefix: 'Qual o total investido na semana?' },
];

let messageSeq = 0;
const nextId = () => `msg-${++messageSeq}`;

/** Tela de conversa com o assistente — respostas determinísticas, sem LLM (BR-BOT-009). */
const AssistantAsk: React.FC<AssistantAskProps> = ({ tenantId }) => {
  const { activeCompanyId, activeCompany } = useCompanyContext();
  const { config } = useBotConfig(tenantId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const scopeLabel = activeCompanyId ? (activeCompany?.name ?? 'empresa ativa') : 'todas as empresas';

  const handleSend = async (text: string) => {
    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text }]);
    setIsTyping(true);
    try {
      const answer = await answerAssistantQuestion(text, { tenantId, companyId: activeCompanyId, scopeLabel });
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: answer }]);
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'erro desconhecido';
      setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: `Não consegui consultar agora: ${detail}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <AnimatedAIChat
      messages={messages}
      isTyping={isTyping}
      assistantName={config.ai_persona_name}
      suggestions={SUGGESTIONS}
      onSend={handleSend}
      placeholder={`Pergunte ao ${config.ai_persona_name}...`}
      emptyTitle={`Oi! Sou o ${config.ai_persona_name}`}
    />
  );
};

export default AssistantAsk;
