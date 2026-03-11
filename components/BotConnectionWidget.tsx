import React, { useState, useEffect } from 'react';
import { Smartphone, Send, CheckCircle2, X } from 'lucide-react';
import { getSupabase } from '../services/supabase';

interface ConnectionStatus {
  whatsapp: boolean;
  telegram: boolean;
  whatsapp_phone?: string;
  telegram_chat_id?: string;
}

export function BotConnectionWidget() {
  const [status, setStatus] = useState<ConnectionStatus>({ whatsapp: false, telegram: false });
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<'whatsapp' | 'telegram' | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function loadStatus() {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('whatsapp_phone, telegram_chat_id')
      .eq('id', user.id)
      .single();
    if (data) {
      setStatus({
        whatsapp: !!data.whatsapp_phone,
        telegram: !!data.telegram_chat_id,
        whatsapp_phone: data.whatsapp_phone ?? undefined,
        telegram_chat_id: data.telegram_chat_id ?? undefined,
      });
    }
  }

  async function generateCode(channel: 'whatsapp' | 'telegram') {
    setLoading(true);
    try {
      const supabase = getSupabase();
      if (!supabase) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      await supabase
        .from('bot_link_codes')
        .delete()
        .eq('profile_id', user.id)
        .eq('channel', channel)
        .is('used_at', null);

      const { error: insertError } = await supabase.from('bot_link_codes').insert({
        profile_id: user.id,
        code,
        channel,
        expires_at: expiresAt,
      });

      if (insertError) {
        console.error('[BotConnectionWidget] falha ao salvar código:', insertError.message);
        alert('Erro ao gerar código. Tente novamente.');
        return;
      }

      setLinkCode(code);
      setActiveChannel(channel);
      setCountdown(15 * 60);
    } finally {
      setLoading(false);
    }
  }

  async function disconnect(channel: 'whatsapp' | 'telegram') {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const field = channel === 'whatsapp' ? 'whatsapp_phone' : 'telegram_chat_id';
    await supabase.from('profiles').update({ [field]: null }).eq('id', user.id);
    await loadStatus();
  }

  const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    // --bg-soft: um nível abaixo do card pai (--bg-elevated), cria hierarquia visual em ambos os modos
    <div className="bg-[color:var(--bg-soft)] rounded-2xl p-5 border border-[color:var(--border-subtle)]">
      <h3 className="text-[color:var(--text-primary)] font-bold text-sm mb-0.5">Assistente de Bolso</h3>
      <p className="text-[color:var(--text-muted)] text-xs mb-4">
        Conecte seu WhatsApp ou Telegram para gerenciar contratos por mensagem.
      </p>

      <div className="space-y-2">
        {/* WhatsApp */}
        <ChannelRow
          label="WhatsApp"
          icon={<Smartphone size={16} className="text-[color:var(--accent-positive)]" />}
          connected={status.whatsapp}
          identifier={status.whatsapp_phone ? `+${status.whatsapp_phone}` : undefined}
          onConnect={() => generateCode('whatsapp')}
          onDisconnect={() => disconnect('whatsapp')}
          loading={loading && activeChannel === 'whatsapp'}
        />

        {/* Telegram */}
        <ChannelRow
          label="Telegram"
          icon={<Send size={16} className="text-[color:var(--accent-steel)]" />}
          connected={status.telegram}
          identifier={status.telegram_chat_id ? `@claulermbot` : undefined}
          onConnect={() => generateCode('telegram')}
          onDisconnect={() => disconnect('telegram')}
          loading={loading && activeChannel === 'telegram'}
        />
      </div>

      {/* Código de vinculação */}
      {linkCode && countdown > 0 && (
        <div className="mt-4 bg-[color:var(--bg-base)] rounded-xl p-4 border border-[color:var(--border-strong)]">
          <p className="text-[color:var(--text-secondary)] text-xs mb-2">
            Envie o código abaixo para o bot no{' '}
            <a
              href={activeChannel === 'whatsapp'
                ? `https://wa.me/5585920284195?text=${encodeURIComponent(linkCode)}`
                : `https://t.me/claulermbot?start=${linkCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-500 font-semibold underline hover:text-teal-400 transition-colors"
            >
              {activeChannel === 'whatsapp' ? 'WhatsApp (+55 85 2028-4195)' : 'Telegram (@claulermbot)'}
            </a>
            :
          </p>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl font-black text-[color:var(--text-primary)] tracking-[0.25em] font-mono">
              {linkCode}
            </span>
            <button
              onClick={() => navigator.clipboard.writeText(linkCode)}
              className="cursor-pointer text-[9px] font-bold uppercase tracking-widest text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] border border-[color:var(--border-subtle)] rounded-lg px-2 py-1 transition-colors"
            >
              Copiar
            </button>
          </div>
          <a
            href={activeChannel === 'whatsapp'
              ? `https://wa.me/5585920284195?text=${encodeURIComponent(linkCode)}`
              : `https://t.me/claulermbot?start=${linkCode}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-lg transition-colors font-semibold"
          >
            Abrir {activeChannel === 'whatsapp' ? 'WhatsApp' : 'Telegram'} com o código →
          </a>
          <div className="flex items-center justify-between mt-3">
            <p className="text-[color:var(--text-faint)] text-xs">Expira em {formatCountdown(countdown)}</p>
            <button
              onClick={() => { setLinkCode(null); setCountdown(0); loadStatus(); }}
              className="cursor-pointer text-xs text-teal-500 hover:text-teal-400 underline transition-colors"
            >
              Já enviei, verificar →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  label, icon, connected, identifier, onConnect, onDisconnect, loading,
}: {
  label: string;
  icon: React.ReactNode;
  connected: boolean;
  identifier?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  loading: boolean;
}) {
  return (
    // --bg-base: nível base abaixo do --bg-soft, criando profundidade visual
    <div className="flex items-center justify-between bg-[color:var(--bg-base)] rounded-xl px-4 py-3 border border-[color:var(--border-subtle)]">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[color:var(--bg-soft)] border border-[color:var(--border-subtle)]">
          {icon}
        </div>
        <div>
          <p className="text-[color:var(--text-primary)] text-sm font-semibold leading-tight">{label}</p>
          {connected && identifier && (
            <p className="text-[color:var(--text-muted)] text-xs font-mono leading-tight">{identifier}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {connected ? (
          <>
            <span className="flex items-center gap-1.5 text-xs font-bold text-[color:var(--accent-positive)]">
              <CheckCircle2 size={13} />
              Conectado
            </span>
            <button
              onClick={onDisconnect}
              className="cursor-pointer ml-2 p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--accent-danger)] hover:bg-[color:var(--bg-soft)] transition-all"
              aria-label={`Desconectar ${label}`}
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <button
            onClick={onConnect}
            disabled={loading}
            className="cursor-pointer text-xs bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors font-semibold"
          >
            {loading ? 'Gerando...' : 'Conectar'}
          </button>
        )}
      </div>
    </div>
  );
}
