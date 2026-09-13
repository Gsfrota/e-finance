import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, HelpCircle, SendHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReplyDetails, ReplyLine } from '@/utils/assistantTypes';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Linha a linha do que compõe o número da resposta. */
  details?: ReplyDetails;
}

export interface ChatSuggestion {
  icon: React.ReactNode;
  label: string;
  prefix: string;
}

/** Uma pergunta pronta do catálogo. `needsInput` só preenche o campo, sem enviar. */
export interface CatalogItem {
  label: string;
  question: string;
  needsInput?: boolean;
}

/** Assunto do catálogo — vira um cartão com as perguntas prontas dentro. */
export interface CatalogGroup {
  title: string;
  icon: React.ReactNode;
  items: CatalogItem[];
}

export interface AnimatedAIChatProps {
  messages: ChatMessage[];
  isTyping: boolean;
  assistantName: string;
  suggestions: ChatSuggestion[];
  onSend: (text: string) => void;
  placeholder?: string;
  emptyTitle?: string;
  /** Clique numa linha do detalhamento — abre o contrato de origem. */
  onOpenLine?: (line: ReplyLine) => void;
  /** Tudo que o assistente sabe responder, agrupado por assunto. */
  catalog?: CatalogGroup[];
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

const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

/** Quantas linhas aparecem antes de expandir — o resto fica sob o degradê. */
const LINHAS_VISIVEIS = 3;

/**
 * Detalhamento da resposta: o que soma no número, linha por linha.
 * Colapsado mostra as primeiras e esconde o resto sob um degradê; cada linha
 * abre o contrato de origem.
 */
function ReplyBreakdown({
  details,
  onOpenLine,
}: {
  details: ReplyDetails;
  onOpenLine?: (line: ReplyLine) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const temMais = details.lines.length > LINHAS_VISIVEIS;
  const visiveis = aberto ? details.lines : details.lines.slice(0, LINHAS_VISIVEIS);

  return (
    <div className="mt-3 border-t border-[color:var(--border-subtle)] pt-3">
      <div className="relative">
        <ul className="space-y-1" data-testid="reply-breakdown">
          {visiveis.map((line) => (
            <li key={line.key}>
              <button
                type="button"
                onClick={() => onOpenLine?.(line)}
                disabled={!onOpenLine}
                data-testid="reply-line"
                className={cn(
                  'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                  onOpenLine && 'hover:bg-[color:var(--bg-subtle)]',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[color:var(--text-primary)]">
                    {line.title}
                  </span>
                  <span className="block truncate text-[11px] text-[color:var(--text-muted)]">
                    {line.subtitle}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[color:var(--text-primary)]">
                  {formatBRL(line.amount)}
                </span>
                {onOpenLine && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* o degradê só existe quando há linha escondida embaixo dele */}
        {temMais && !aberto && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[color:var(--bg-elevated)] to-transparent" />
        )}
      </div>

      {temMais && (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          data-testid="reply-breakdown-toggle"
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-teal-400/40 bg-teal-400/10 px-3 py-2 text-xs font-semibold text-teal-500 transition-colors hover:border-teal-400 hover:bg-teal-400/20 dark:text-teal-300"
        >
          {aberto ? 'Ver menos' : details.label}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}

/**
 * Catálogo de perguntas prontas. É o que responde "o que eu posso perguntar?" sem
 * o cliente ter que adivinhar — some do caminho depois que a conversa começa,
 * mas continua a um clique no botão de ajuda.
 */
function CatalogPanel({
  groups,
  onPick,
}: {
  groups: CatalogGroup[];
  onPick: (item: CatalogItem) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="catalogo">
      {groups.map((group) => (
        <div
          key={group.title}
          className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-4 w-4 items-center justify-center text-teal-400">
              {group.icon}
            </span>
            <span className="text-xs font-semibold text-[color:var(--text-primary)]">
              {group.title}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((item) => (
              <button
                key={item.question + item.label}
                type="button"
                onClick={() => onPick(item)}
                data-testid="catalogo-item"
                title={item.question}
                className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-[11px] text-[color:var(--text-muted)] transition-colors hover:border-teal-400/60 hover:text-teal-400"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
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
  onOpenLine,
  catalog = [],
}: AnimatedAIChatProps) {
  const [value, setValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [mostrarCatalogo, setMostrarCatalogo] = useState(false);

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

  // Rola para o fim quando chega mensagem nova — e ao voltar de outra tela com a
  // conversa já preenchida, que abriria no começo. Quem rola pode ser a lista ou a
  // própria página, conforme a altura disponível.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (list.scrollHeight > list.clientHeight) {
      list.scrollTop = list.scrollHeight;
    } else {
      list.lastElementChild?.scrollIntoView({ block: 'end' });
    }
  }, [messages, isTyping]);

  const send = () => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue('');
    adjustHeight(true);
    setShowCommandPalette(false);
  };

  /** Pergunta completa vai direto; a que precisa de nome só preenche o campo. */
  const pickCatalog = (item: CatalogItem) => {
    setMostrarCatalogo(false);
    if (item.needsInput) {
      setValue(item.question);
      textareaRef.current?.focus();
      requestAnimationFrame(() => adjustHeight());
      return;
    }
    onSend(item.question);
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
              Toque numa pergunta pronta ou escreva do seu jeito.
            </p>
            {catalog.length > 0 && (
              <div className="mt-5 w-full max-w-2xl text-left">
                <CatalogPanel groups={catalog} onPick={pickCatalog} />
              </div>
            )}
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
                {message.details && message.details.lines.length > 0 && (
                  <ReplyBreakdown details={message.details} onOpenLine={onOpenLine} />
                )}
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
      {mostrarCatalogo && catalog.length > 0 && messages.length > 0 && (
        <motion.div
          className="relative z-10 mt-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <CatalogPanel groups={catalog} onPick={pickCatalog} />
        </motion.div>
      )}

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

        {/* na tela vazia os chips repetiriam o catálogo, que já está aberto acima */}
        {suggestions.length > 0 && !(messages.length === 0 && catalog.length > 0) && (
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

            {catalog.length > 0 && messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMostrarCatalogo((v) => !v)}
                data-testid="ver-catalogo"
                className="flex items-center gap-1.5 rounded-full border border-teal-400/40 bg-teal-400/10 px-3 py-1.5 text-xs font-semibold text-teal-500 transition-colors hover:border-teal-400 dark:text-teal-300"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                {mostrarCatalogo ? 'Fechar' : 'O que posso perguntar'}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
