import React, { useState } from 'react';
import { Tenant, Profile } from '../types';
import { useBotConfig } from '../hooks/useBotConfig';
import { BotConnectionWidget } from './BotConnectionWidget';
import { Bot, Save, RefreshCw, CheckCircle2, Sun, MessageCircle, Zap, ToggleLeft, ToggleRight, Clock, Shield, Phone, X, Plus } from 'lucide-react';

interface AdminAssistantProps {
  tenant: Tenant;
  profile: Profile;
}

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  colorClass: string;
}> = ({ icon, title, subtitle, colorClass }) => (
  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[color:var(--border-subtle)]">
    <div className={`p-3 rounded-xl ${colorClass}`}>{icon}</div>
    <div>
      <h3 className="text-lg font-black text-[color:var(--text-primary)] uppercase">{title}</h3>
      {subtitle && <p className="text-[10px] text-[color:var(--text-muted)] font-bold uppercase tracking-wide">{subtitle}</p>}
    </div>
  </div>
);

type KnownCountry = 'BR' | 'US' | 'AR' | 'MX' | 'CO' | 'PE' | 'CL' | 'PY' | 'UY' | 'BO' | 'PT' | 'ES' | 'GB' | 'FR' | 'DE' | 'IT' | 'unknown';

interface PhonePreview {
  e164: string;
  display: string;
  country: KnownCountry;
  wasInferred: boolean;
}

const COUNTRY_PREFIXES: Array<{ code: string; country: KnownCountry; lengths: number[] }> = [
  { code: '351', country: 'PT', lengths: [12] },
  { code: '598', country: 'UY', lengths: [11] },
  { code: '591', country: 'BO', lengths: [11] },
  { code: '595', country: 'PY', lengths: [12] },
  { code: '55', country: 'BR', lengths: [12, 13] },
  { code: '54', country: 'AR', lengths: [13] },
  { code: '52', country: 'MX', lengths: [12] },
  { code: '57', country: 'CO', lengths: [12] },
  { code: '51', country: 'PE', lengths: [11] },
  { code: '56', country: 'CL', lengths: [11] },
  { code: '44', country: 'GB', lengths: [12, 13] },
  { code: '34', country: 'ES', lengths: [11] },
  { code: '33', country: 'FR', lengths: [11] },
  { code: '49', country: 'DE', lengths: [12, 13, 14] },
  { code: '39', country: 'IT', lengths: [11, 12] },
  { code: '1', country: 'US', lengths: [11] },
];

function normalizePhoneDisplay(raw: string): PhonePreview | null {
  const digits = raw.replace(/^\+/, '').replace(/^00/, '').replace(/\D/g, '');
  if (digits.length < 7) return null;

  for (const { code, country, lengths } of COUNTRY_PREFIXES) {
    if (digits.startsWith(code) && lengths.includes(digits.length)) {
      let e164 = digits;
      if (country === 'BR' && digits.length === 12) {
        e164 = digits.slice(0, 4) + '9' + digits.slice(4);
      }
      return { e164, display: '+' + e164, country, wasInferred: false };
    }
  }

  if (digits.length >= 8 && digits.length <= 11) {
    const withBR = '55' + digits;
    const e164 = withBR.length === 12 ? withBR.slice(0, 4) + '9' + withBR.slice(4) : withBR;
    return { e164, display: '+' + e164, country: 'BR', wasInferred: true };
  }

  return { e164: digits, display: '+' + digits, country: 'unknown', wasInferred: true };
}

const AdminAssistant: React.FC<AdminAssistantProps> = ({ tenant, profile }) => {
  const { config, loading, saving, error, saveConfig } = useBotConfig(tenant.id);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [rawPhone, setRawPhone] = useState('');
  const [phonePreview, setPhonePreview] = useState<PhonePreview | null>(null);
  const [addingPhone, setAddingPhone] = useState(false);

  const handleSave = async () => {
    try {
      await saveConfig(config);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      // erro já está em `error`
    }
  };

  const toggleTarget = (target: string) => {
    const current = config.morning_briefing_targets;
    const next = current.includes(target)
      ? current.filter(t => t !== target)
      : [...current, target];
    saveConfig({ morning_briefing_targets: next.length > 0 ? next : [target] });
  };

  const exampleName = profile.full_name?.split(' ')[0] || 'Gestor';

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto pt-20 flex justify-center">
        <RefreshCw className="animate-spin text-[color:var(--text-muted)]" size={28} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-12">
      <div className="border-b border-[color:var(--border-subtle)] pb-6">
        <p className="section-kicker mb-2">Configuração</p>
        <h2 className="font-display text-5xl leading-none text-[color:var(--text-primary)]">Assistente</h2>
        <p className="text-[color:var(--text-muted)] text-xs font-bold uppercase tracking-[0.2em] mt-2">Automações, Conexões e Comportamento do Bot</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-2xl px-5 py-4 text-red-300 text-sm font-medium">
          {error}
        </div>
      )}

      {/* SEÇÃO 1: Conexões */}
      <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-[var(--shadow-panel)]">
        <SectionHeader
          icon={<Bot size={24} />}
          title="Conexões"
          subtitle="Vincule seus canais ao assistente"
          colorClass="bg-teal-900/30 text-teal-400"
        />
        <BotConnectionWidget />
      </div>

      {/* SEÇÃO 1.5: Whitelist de Acesso */}
      <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-[var(--shadow-panel)]">
        <SectionHeader
          icon={<Shield size={24} />}
          title="Lista de Acesso"
          subtitle="Controle quem pode usar o assistente"
          colorClass="bg-rose-900/30 text-rose-400"
        />

        {/* Toggle whitelist */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="font-semibold text-sm text-[color:var(--text-primary)]">Ativar lista de acesso</p>
            <p className="text-xs text-[color:var(--text-secondary)] mt-0.5">
              Apenas números cadastrados abaixo podem usar o bot
            </p>
          </div>
          <button
            onClick={() => saveConfig({ whitelist_enabled: !config.whitelist_enabled })}
            className="text-teal-400 hover:text-teal-300 transition-colors"
          >
            {config.whitelist_enabled
              ? <ToggleRight size={36} />
              : <ToggleLeft size={36} className="text-[color:var(--text-muted)]" />}
          </button>
        </div>

        {config.whitelist_enabled && (
          <>
            {/* Lista de números cadastrados */}
            {config.whitelist_phones.length > 0 && (
              <div className="mb-5 space-y-2">
                {config.whitelist_phones.map(phone => (
                  <div key={phone} className="flex items-center justify-between bg-white/[0.03] rounded-2xl border border-[color:var(--border-subtle)] px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Phone size={15} className="text-teal-400" />
                      <span className="text-sm font-mono text-[color:var(--text-primary)]">{phone}</span>
                    </div>
                    <button
                      onClick={() => saveConfig({ whitelist_phones: config.whitelist_phones.filter(p => p !== phone) })}
                      className="text-[color:var(--text-muted)] hover:text-rose-400 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Formulário de adição */}
            {addingPhone ? (
              <div className="bg-white/[0.03] rounded-2xl border border-[color:var(--border-subtle)] p-5">
                <label className="text-xs font-bold uppercase tracking-widest text-[color:var(--text-secondary)] mb-2 block">
                  Número de WhatsApp
                </label>
                <input
                  type="tel"
                  placeholder="Ex: 85991318582 ou +15551234567"
                  value={rawPhone}
                  onChange={e => {
                    setRawPhone(e.target.value);
                    setPhonePreview(normalizePhoneDisplay(e.target.value));
                  }}
                  className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl px-5 py-3 text-sm text-[color:var(--text-primary)] font-mono focus:border-teal-500 outline-none"
                />
                {phonePreview && (
                  <div className={`mt-2 text-xs ${phonePreview.wasInferred ? 'text-amber-400' : 'text-teal-400'}`}>
                    {phonePreview.wasInferred ? '⚠ ' : '✓ '}
                    {phonePreview.display}
                    {phonePreview.wasInferred && ' — código de país inferido como Brasil'}
                  </div>
                )}
                <div className="flex gap-3 mt-4">
                  <button
                    disabled={!phonePreview}
                    onClick={async () => {
                      if (!phonePreview) return;
                      const updated = [...new Set([...config.whitelist_phones, phonePreview.e164])];
                      await saveConfig({ whitelist_phones: updated });
                      setRawPhone('');
                      setPhonePreview(null);
                      setAddingPhone(false);
                    }}
                    className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40 transition-all"
                  >
                    Cadastrar número
                  </button>
                  <button
                    onClick={() => { setAddingPhone(false); setRawPhone(''); setPhonePreview(null); }}
                    className="px-5 py-3 rounded-xl text-xs font-bold text-[color:var(--text-secondary)] border border-[color:var(--border-subtle)] hover:border-[color:var(--border-strong)] transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingPhone(true)}
                className="w-full py-3 rounded-2xl text-xs font-black uppercase tracking-widest border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-secondary)] hover:border-teal-500 hover:text-teal-400 transition-all flex items-center justify-center gap-2"
              >
                <Plus size={15} /> Adicionar número
              </button>
            )}
          </>
        )}
      </div>

      {/* SEÇÃO 2: Mensagem Matinal */}
      <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-[var(--shadow-panel)]">
        <SectionHeader
          icon={<Sun size={24} />}
          title="Mensagem Matinal"
          subtitle="Resumo financeiro automático todo dia de manhã"
          colorClass="bg-amber-900/30 text-amber-400"
        />

        {/* Toggle */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[color:var(--text-primary)] font-semibold text-sm">Ativar briefing matinal</p>
            <p className="text-[color:var(--text-secondary)] text-xs mt-0.5">O bot envia um resumo diário nos canais vinculados</p>
          </div>
          <button
            onClick={() => saveConfig({ morning_briefing_enabled: !config.morning_briefing_enabled })}
            className="text-teal-400 hover:text-teal-300 transition-colors"
          >
            {config.morning_briefing_enabled
              ? <ToggleRight size={36} />
              : <ToggleLeft size={36} className="text-[color:var(--text-muted)]" />
            }
          </button>
        </div>

        {config.morning_briefing_enabled && (
          <>
            {/* Horário */}
            <div className="mb-5">
              <label className="text-[color:var(--text-secondary)] text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                <Clock size={13} /> Horário (horário de Brasília)
              </label>
              <input
                type="time"
                value={config.morning_briefing_time}
                onChange={e => saveConfig({ morning_briefing_time: e.target.value })}
                className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl px-5 py-3 text-[color:var(--text-primary)] text-sm font-mono focus:border-teal-500 outline-none transition-all w-40"
              />
            </div>

            {/* Destinatários */}
            <div className="mb-6">
              <label className="text-[color:var(--text-secondary)] text-xs font-bold uppercase tracking-widest mb-3 block">
                Destinatários
              </label>
              <div className="flex gap-3">
                {[
                  { key: 'admin', label: 'Administradores' },
                  { key: 'investor', label: 'Investidores' },
                ].map(({ key, label }) => {
                  const active = config.morning_briefing_targets.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleTarget(key)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wide transition-all border ${
                        active
                          ? 'bg-teal-600/20 border-teal-500/50 text-teal-300'
                          : 'bg-white/[0.03] border-[color:var(--border-strong)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div>
              <label className="text-[color:var(--text-secondary)] text-xs font-bold uppercase tracking-widest mb-3 block">
                Preview da mensagem
              </label>
              <div className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-2xl p-5 font-mono text-sm text-[color:var(--text-primary)] whitespace-pre-line leading-relaxed">
{`Bom dia ${exampleName}! 🌅
Hoje você tem R$\u00a01.200,00 para receber.

📋 Cobranças do dia:
  • João Silva — Parcela 3/12 — R$\u00a0500,00
  • Ana Souza — Parcela 7/12 — R$\u00a0700,00

Quer ver o detalhamento completo?`}
              </div>
              <p className="text-[color:var(--text-faint)] text-xs mt-2">* Os valores reais serão gerados com os dados do dia.</p>
            </div>
          </>
        )}
      </div>

      {/* SEÇÃO 3: Perguntas de Acompanhamento */}
      <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-[var(--shadow-panel)]">
        <SectionHeader
          icon={<MessageCircle size={24} />}
          title="Perguntas de Acompanhamento"
          subtitle="O bot sugere a próxima ação após cada resposta"
          colorClass="bg-indigo-900/30 text-indigo-400"
        />

        {/* Toggle */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[color:var(--text-primary)] font-semibold text-sm">Ativar perguntas de acompanhamento</p>
            <p className="text-[color:var(--text-secondary)] text-xs mt-0.5">
              Ex: após ver o dashboard → "Quer ver quem está atrasado hoje?"
            </p>
          </div>
          <button
            onClick={() => saveConfig({ followup_enabled: !config.followup_enabled })}
            className="text-teal-400 hover:text-teal-300 transition-colors"
          >
            {config.followup_enabled
              ? <ToggleRight size={36} />
              : <ToggleLeft size={36} className="text-[color:var(--text-muted)]" />
            }
          </button>
        </div>

        {config.followup_enabled && (
          <div>
            <label className="text-[color:var(--text-secondary)] text-xs font-bold uppercase tracking-widest mb-3 block">
              Estilo das perguntas
            </label>
            <div className="flex flex-col gap-2">
              {[
                { value: 'natural', label: 'Natural', example: '"Quer ver quem está atrasado hoje?"' },
                { value: 'direto', label: 'Direto', example: '"Ver atrasados hoje?"' },
              ].map(({ value, label, example }) => (
                <label
                  key={value}
                  className={`flex items-start gap-4 cursor-pointer rounded-2xl border px-5 py-4 transition-all ${
                    config.followup_style === value
                      ? 'border-indigo-500/50 bg-indigo-900/10'
                      : 'border-[color:var(--border-subtle)] bg-white/[0.03] hover:border-[color:var(--border-strong)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="followup_style"
                    value={value}
                    checked={config.followup_style === value}
                    onChange={() => saveConfig({ followup_style: value as 'natural' | 'direto' })}
                    className="mt-1 accent-indigo-500"
                  />
                  <div>
                    <p className="text-[color:var(--text-primary)] font-semibold text-sm">{label}</p>
                    <p className="text-[color:var(--text-secondary)] text-xs mt-0.5">{example}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 4: Automações */}
      <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-[var(--shadow-panel)]">
        <SectionHeader
          icon={<Zap size={24} />}
          title="Automações"
          subtitle="Regras de disparo automático"
          colorClass="bg-violet-900/30 text-violet-400"
        />

        <div className="flex items-center justify-between bg-white/[0.03] rounded-2xl border border-[color:var(--border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3">
            <Sun size={18} className="text-amber-400" />
            <div>
              <p className="text-[color:var(--text-primary)] font-semibold text-sm">Briefing Matinal</p>
              <p className="text-[color:var(--text-secondary)] text-xs">Resumo diário às {config.morning_briefing_time} BRT</p>
            </div>
          </div>
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${
            config.morning_briefing_enabled
              ? 'bg-green-900/40 text-green-400 border border-green-700/50'
              : 'bg-white/[0.04] text-[color:var(--text-muted)] border border-[color:var(--border-subtle)]'
          }`}>
            {config.morning_briefing_enabled ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        <p className="text-[color:var(--text-faint)] text-xs mt-4 text-center">
          Mais automações em breve (lembretes de cobrança, alertas de atraso...)
        </p>
      </div>

      {/* Botão salvar */}
      <div className="pt-2 sticky bottom-4 z-10">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-3 shadow-2xl ${
            saveSuccess
              ? 'bg-green-600 text-white'
              : 'bg-teal-600 hover:bg-teal-500 text-white shadow-teal-900/50'
          }`}
        >
          {saving
            ? <><RefreshCw className="animate-spin" size={18} /> Salvando...</>
            : saveSuccess
              ? <><CheckCircle2 size={18} /> Salvo!</>
              : <><Save size={18} /> Salvar Configurações</>
          }
        </button>
      </div>
    </div>
  );
};

export default AdminAssistant;
