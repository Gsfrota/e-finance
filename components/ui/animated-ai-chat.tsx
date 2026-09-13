import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SendHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSuggestion {
  icon: React.ReactNode;
  label: string;
  prefix: string;
}

export interface AnimatedAIChatProps {
  messages: ChatMessage[];
  isTyping: boolean;
  assistantName: string;
  suggestions: ChatSuggestion[];
  onSend: (text: string) => void;
  placeholder?: string;
  emptyTitle?: string;
}

interface UseAutoResizeTextareaProps {
  minHeight: number;
  maxHeight?: number;
}

function useAutoResizeTextarea({ minHeight, maxHeight }: UseAutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        return;
      }

      textarea.style.height = `${minHeight}px`;
      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY),
      );
      textarea.style.height = `${newHeight}px`;
    },
    [minHeight, maxHeight],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) textarea.style.height = `${minHeight}px`;
  }, [minHeight]);

  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
}

/** 3 bolinhas pulsando enquanto o assistente responde. */
function TypingDots({ assistantName }: { assistantName: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-4 py-3">
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-teal-400"
            initial={{ opacity: 0.3 }}
            animate={{ opacity: [0.3, 0.9, 0.3], scale: [0.85, 1.1, 0.85] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
          />
        ))}
      </div>
      <span className="text-xs text-[color:var(--text-muted)]">
        {assistantName} está digitando
      </span>
    </div>
  );
}

/**
 * O texto da resposta usa *asterisco* como negrito (mesmo formato do bot no WhatsApp).
 * ponytail: split por asterisco em vez de parser de markdown — negrito é a única marca usada.
 */
function renderEmphasis(text: string) {
  return text.split(/\*([^*\n]+)\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part
  );
}

export function AnimatedAIChat({
  messages,
  isTyping,
  assistantName,
  suggestions,
  onSend,
  placeholder = 'Pergunte alguma coisa...',
  emptyTitle = 'Como posso ajudar?',
}: AnimatedAIChatProps) {
  const [value, setValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: 60, maxHeight: 200 });
  const commandPaletteRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Glow que segue o mouse
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => setMousePosition({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Abre a paleta ao digitar "/" no começo
  useEffect(() => {
    if (value.startsWith('/') && !value.includes(' ')) {
      setShowCommandPalette(true);
      setActiveSuggestion((prev) => (prev === -1 ? 0 : prev));
    } else {
      setShowCommandPalette(false);
    }
  }, [value]);

  // Clique fora fecha a paleta
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (commandPaletteRef.current && !commandPaletteRef.current.contains(target)) {
        setShowCommandPalette(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Rola para o fim quando chega mensagem nova
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, isTyping]);

  const send = () => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue('');
    adjustHeight(true);
    setShowCommandPalette(false);
  };

  const selectSuggestion = (index: number) => {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    setValue(suggestion.prefix);
    setShowCommandPalette(false);
    textareaRef.current?.focus();
    requestAnimationFrame(() => adjustHeight());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandPalette && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        selectSuggestion(activeSuggestion >= 0 ? activeSuggestion : 0);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommandPalette(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="lab-bg relative flex h-full min-h-[520px] w-full flex-col">
      {/* Blobs de fundo */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -left-20 top-0 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl"
          animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.6, 0.4] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl"
          animate={{ scale: [1.05, 1, 1.05], opacity: [0.35, 0.55, 0.35] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        />
      </div>

      {/* Glow seguindo o mouse enquanto o input está focado */}
      <AnimatePresence>
        {inputFocused && (
          <motion.div
            className="pointer-events-none fixed z-0 h-[50rem] w-[50rem] rounded-full blur-[96px]"
            style={{
              background:
                'radial-gradient(circle, rgba(139,92,246,0.10) 0%, rgba(45,212,191,0.06) 50%, transparent 70%)',
              left: mousePosition.x - 400,
              top: mousePosition.y - 400,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}
      </AnimatePresence>

      {/* Lista de mensagens */}
      <div ref={listRef} className="relative z-10 flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex h-full flex-col items-center justify-center text-center"
          >
            <h1 className="type-display pb-1 text-[color:var(--text-primary)]">{emptyTitle}</h1>
            <motion.div
              className="h-px w-24 bg-gradient-to-r from-transparent via-teal-400/50 to-transparent"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 96, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.7 }}
            />
            <p className="mt-3 text-sm text-[color:var(--text-muted)]">
              Digite <span className="font-mono text-[color:var(--text-secondary)]">/</span> para ver
              o que {assistantName} sabe responder.
            </p>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              data-testid={`chat-msg-${message.role}`}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm',
                  message.role === 'user'
                    ? 'bg-teal-500 text-black'
                    : 'border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]',
                )}
              >
                {renderEmphasis(message.content)}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-start"
            >
              <TypingDots assistantName={assistantName} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input */}
      <motion.div
        className="relative z-10 mt-4"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="relative rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-[var(--shadow-card)]">
          <AnimatePresence>
            {showCommandPalette && suggestions.length > 0 && (
              <motion.div
                ref={commandPaletteRef}
                className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-[var(--shadow-panel)]"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
              >
                {suggestions.map((suggestion, index) => (
                  <motion.button
                    key={suggestion.prefix}
                    type="button"
                    onClick={() => selectSuggestion(index)}
                    onMouseEnter={() => setActiveSuggestion(index)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                      activeSuggestion === index
                        ? 'bg-[color:var(--bg-soft)] text-[color:var(--text-primary)]'
                        : 'text-[color:var(--text-muted)]',
                    )}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <span className="flex h-4 w-4 items-center justify-center text-teal-400">
                      {suggestion.icon}
                    </span>
                    <span className="font-medium">{suggestion.label}</span>
                    <span className="ml-auto truncate text-[color:var(--text-faint)]">
                      {suggestion.prefix}
                    </span>
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* anel de foco animado */}
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-2xl border border-teal-400/40"
            initial={false}
            animate={{ opacity: inputFocused ? 1 : 0 }}
            transition={{ duration: 0.2 }}
          />

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none border-none bg-transparent px-4 py-4 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-faint)] focus:outline-none"
            style={{ overflow: 'hidden' }}
          />

          <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border-subtle)] px-3 py-2">
            <span className="text-xs text-[color:var(--text-faint)]">
              Enter envia · Shift+Enter quebra linha
            </span>
            <motion.button
              type="button"
              onClick={send}
              disabled={!value.trim()}
              whileHover={{ scale: value.trim() ? 1.02 : 1 }}
              whileTap={{ scale: value.trim() ? 0.98 : 1 }}
              className={cn(
                'flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-colors',
                value.trim()
                  ? 'bg-teal-500 text-black hover:bg-teal-400'
                  : 'bg-[color:var(--bg-soft)] text-[color:var(--text-faint)]',
              )}
              aria-label="Enviar"
            >
              <SendHorizontal size={14} />
              Enviar
            </motion.button>
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((suggestion, index) => (
              <motion.button
                key={suggestion.prefix}
                type="button"
                onClick={() => selectSuggestion(index)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.05 }}
                whileHover={{ y: -1 }}
                className="flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text-primary)]"
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center text-teal-400">
                  {suggestion.icon}
                </span>
                {suggestion.label}
              </motion.button>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
