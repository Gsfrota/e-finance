import React, { useState, useEffect } from 'react';
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

      // Remove códigos anteriores não usados deste profile/channel
      await supabase
        .from('bot_link_codes')
        .delete()
        .eq('profile_id', user.id)
        .eq('channel', channel)
        .is('used_at', null);

      await supabase.from('bot_link_codes').insert({
        profile_id: user.id,
        code,
        channel,
        expires_at: expiresAt,
      });

      setLinkCode(code);
      setActiveChannel(channel);
      setCountdown(15 * 60); // 15 min em segundos
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
    <div className="bg-[color:var(--bg-elevated)] rounded-xl p-5 border border-[color:var(--border-subtle)]">
      <h3 className="text-[color:var(--text-primary)] font-semibold text-base mb-1">Assistente de Bolso</h3>
      <p className="text-[color:var(--text-secondary)] text-sm mb-4">
        Conecte seu WhatsApp ou Telegram para gerenciar contratos por mensagem.
      </p>

      <div className="space-y-3">
        {/* WhatsApp */}
        <ChannelRow
          label="WhatsApp"
          icon="📱"
          connected={status.whatsapp}
          identifier={status.whatsapp_phone ? `+${status.whatsapp_phone}` : undefined}
          onConnect={() => generateCode('whatsapp')}
          onDisconnect={() => disconnect('whatsapp')}
          loading={loading && activeChannel === 'whatsapp'}
        />

        {/* Telegram */}
        <ChannelRow
          label="Telegram"
          icon="✈️"
          connected={status.telegram}
          identifier={status.telegram_chat_id ? `@claulermbot` : undefined}
          onConnect={() => generateCode('telegram')}
          onDisconnect={() => disconnect('telegram')}
          loading={loading && activeChannel === 'telegram'}
        />
      </div>

      {/* Código de vinculação */}
      {linkCode && countdown > 0 && (
        <div className="mt-4 bg-[color:var(--bg-base)] rounded-lg p-4 border border-teal-700">
          <p className="text-[color:var(--text-secondary)] text-sm mb-2">
            Envie o código abaixo para o bot no{' '}
            <a
              href={activeChannel === 'whatsapp'
                ? `https://wa.me/5585920284195?text=${encodeURIComponent(linkCode)}`
                : `https://t.me/claulermbot?start=${linkCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-400 font-medium underline hover:text-teal-300"
            >
              {activeChannel === 'whatsapp' ? 'WhatsApp (+55 85 2028-4195)' : 'Telegram (@claulermbot)'}
            </a>
            :
          </p>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-[color:var(--text-primary)] tracking-widest font-mono">{linkCode}</span>
            <button
              onClick={() => navigator.clipboard.writeText(linkCode)}
              className="text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] border border-[color:var(--border-subtle)] rounded px-2 py-1"
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
            className="mt-3 inline-flex items-center gap-2 text-xs bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-lg transition-colors font-medium"
          >
            Abrir {activeChannel === 'whatsapp' ? 'WhatsApp' : 'Telegram'} com o código →
          </a>
          <p className="text-[color:var(--text-muted)] text-xs mt-2">Expira em {formatCountdown(countdown)}</p>
          <button
            onClick={() => { setLinkCode(null); setCountdown(0); loadStatus(); }}
            className="mt-3 text-xs text-teal-400 hover:underline"
          >
            Já enviei, verificar status
          </button>
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  label, icon, connected, identifier, onConnect, onDisconnect, loading,
}: {
  label: string; icon: string; connected: boolean; identifier?: string;
  onConnect: () => void; onDisconnect: () => void; loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between bg-[color:var(--bg-soft)] rounded-lg px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-lg">{icon}</span>
        <div>
          <p className="text-[color:var(--text-primary)] text-sm font-medium">{label}</p>
          {connected && identifier && (
            <p className="text-[color:var(--text-secondary)] text-xs">{identifier}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {connected ? (
          <>
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <button
              onClick={onDisconnect}
              className="text-xs text-[color:var(--text-secondary)] hover:text-red-400 transition-colors"
            >
              Desconectar
            </button>
          </>
        ) : (
          <button
            onClick={onConnect}
            disabled={loading}
            className="text-xs bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-md transition-colors"
          >
            {loading ? 'Gerando...' : 'Conectar'}
          </button>
        )}
      </div>
    </div>
  );
}
