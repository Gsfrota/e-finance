import React, { useState } from 'react';
import { Tenant, Profile } from '../types';
import { useBotConfig } from '../hooks/useBotConfig';
import { BotConnectionWidget } from './BotConnectionWidget';
import { Bot, Save, RefreshCw, CheckCircle2, Sun, MessageCircle, Zap, ToggleLeft, ToggleRight, Clock, Shield, Phone, X, Plus } from 'lucide-react';

interface AdminAssistantProps {
  tenant: Tenant;
  profile: Profile;
}

type AssistantSection = 'conexoes' | 'whitelist' | 'briefing' | 'perguntas' | 'automacoes';

const NAV_ITEMS: { id: AssistantSection; label: string; icon: React.ReactNode }[] = [
  { id: 'conexoes',   label: 'Conexões',       icon: <Bot size={16} /> },
  { id: 'whitelist',  label: 'Lista de Acesso', icon: <Shield size={16} /> },
  { id: 'briefing',   label: 'Briefing Matinal', icon: <Sun size={16} /> },
  { id: 'perguntas',  label: 'Perguntas',       icon: <MessageCircle size={16} /> },
  { id: 'automacoes', label: 'Automações',      icon: <Zap size={16} /> },
];

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
  { code: '55',  country: 'BR', lengths: [12, 13] },
  { code: '54',  country: 'AR', lengths: [13] },
  { code: '52',  country: 'MX', lengths: [12] },
  { code: '57',  country: 'CO', lengths: [12] },
  { code: '51',  country: 'PE', lengths: [11] },
  { code: '56',  country: 'CL', lengths: [11] },
  { code: '44',  country: 'GB', lengths: [12, 13] },
  { code: '34',  country: 'ES', lengths: [11] },
  { code: '33',  country: 'FR', lengths: [11] },
  { code: '49',  country: 'DE', lengths: [12, 13, 14] },
  { code: '39',  country: 'IT', lengths: [11, 12] },
  { code: '1',   country: 'US', lengths: [11] },
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

const AdminAssistant: React.FC<AdminAssistantProps> = ({ tenant }) => {
  const { config, loading, saving, error, saveConfig } = useBotConfig(tenant.id);
  const [activeSection, setActiveSection] = useState<AssistantSection>('conexoes');
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

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto pt-20 flex justify-center">
        <RefreshCw className="animate-spin text-[color:var(--text-muted)]" size={28} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in pb-16">
      {/* Page header */}
      <div className="border-b border-[color:var(--border-subtle)] pb-6 mb-8">
        <p className="section-kicker mb-2">Configuração</p>
        <h2 className="type-display text-[color:var(--text-primary)]">Assistente</h2>
        <p className="type-label text-[color:var(--text-muted)] mt-2">Automações, Conexões e Comportamento do Bot</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl px-5 py-4 text-red-300 text-sm font-medium mb-6">
          {error}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-[color:var(--border-subtle)] overflow-x-auto mb-8">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveSection(item.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
              activeSection === item.id
                ? 'border-teal-400 text-[color:var(--text-primary)]'
                : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

          {/* CONEXÕES */}
          {activeSection === 'conexoes' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Conexões</h3>
                <p className="text-sm text-[color:var(--text-muted)]">Vincule seus canais ao assistente.</p>
              </div>
              <div className="border-t border-[color:var(--border-subtle)] pt-6">
                <BotConnectionWidget />
              </div>
            </div>
          )}

          {/* WHITELIST */}
          {activeSection === 'whitelist' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Lista de Acesso</h3>
                <p className="text-sm text-[color:var(--text-muted)]">Controle quem pode usar o assistente.</p>
              </div>
              <div className="border-t border-[color:var(--border-subtle)] pt-6 space-y-6">
                {/* Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-[color:var(--text-primary)]">Ativar lista de acesso</p>
                    <p className="text-xs text-[color:var(--text-muted)] mt-0.5">
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
                    {/* Tabela de números */}
                    {config.whitelist_phones.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[260px]">
                          <thead>
                            <tr className="border-b border-[color:var(--border-subtle)]">
                              <th className="text-left type-label text-[color:var(--text-muted)] pb-2">Número</th>
                              <th className="w-10" />
                            </tr>
                          </thead>
                          <tbody>
                            {config.whitelist_phones.map(phone => (
                              <tr key={phone} className="border-b border-[color:var(--border-subtle)] last:border-0">
                                <td className="py-3">
                                  <div className="flex items-center gap-2">
                                    <Phone size={14} className="text-teal-400 shrink-0" />
                                    <span className="font-mono text-sm text-[color:var(--text-primary)] break-all">{phone}</span>
                                  </div>
                                </td>
                                <td className="py-3 text-right">
                                  <button
                                    onClick={() => saveConfig({ whitelist_phones: config.whitelist_phones.filter(p => p !== phone) })}
                                    className="text-[color:var(--text-muted)] hover:text-red-400 transition-colors p-1"
                                  >
                                    <X size={15} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Formulário de adição */}
                    {addingPhone ? (
                      <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-xl p-5 space-y-4">
                        <div>
                          <label className="block type-label text-[color:var(--text-muted)] mb-2">
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
                            className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-sm text-[color:var(--text-primary)] font-mono focus:border-teal-500 outline-none transition-colors"
                          />
                          {phonePreview && (
                            <p className={`mt-1.5 text-xs ${phonePreview.wasInferred ? 'text-[color:var(--accent-caution)]' : 'text-teal-400'}`}>
                              {phonePreview.wasInferred ? '⚠ ' : '✓ '}
                              {phonePreview.display}
                              {phonePreview.wasInferred && ' — código de país inferido como Brasil'}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-3">
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
                            className="flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40 transition-all"
                          >
                            Cadastrar número
                          </button>
                          <button
                            onClick={() => { setAddingPhone(false); setRawPhone(''); setPhonePreview(null); }}
                            className="px-4 py-2.5 rounded-xl text-xs font-medium text-[color:var(--text-secondary)] border border-[color:var(--border-subtle)] hover:border-[color:var(--border-strong)] transition-all"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingPhone(true)}
                        className="flex items-center gap-2 text-sm text-teal-400 hover:text-teal-300 transition-colors font-medium"
                      >
                        <Plus size={15} /> Adicionar número
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* BRIEFING MATINAL */}
          {activeSection === 'briefing' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Briefing Matinal</h3>
                <p className="text-sm text-[color:var(--text-muted)]">Resumo financeiro automático enviado todo dia de manhã.</p>
              </div>
              <div className="border-t border-[color:var(--border-subtle)] pt-6 space-y-6">
                {/* Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-[color:var(--text-primary)]">Ativar briefing matinal</p>
                    <p className="text-xs text-[color:var(--text-muted)] mt-0.5">O bot envia um resumo diário nos canais vinculados</p>
                  </div>
                  <button
                    onClick={() => saveConfig({ morning_briefing_enabled: !config.morning_briefing_enabled })}
                    className="text-teal-400 hover:text-teal-300 transition-colors"
                  >
                    {config.morning_briefing_enabled
                      ? <ToggleRight size={36} />
                      : <ToggleLeft size={36} className="text-[color:var(--text-muted)]" />}
                  </button>
                </div>

                {config.morning_briefing_enabled && (
                  <>
                    {/* Horário */}
                    <div>
                      <label className="block type-label text-[color:var(--text-muted)] mb-2 flex items-center gap-1.5">
                        <Clock size={12} /> Horário (Brasília)
                      </label>
                      <input
                        type="time"
                        value={config.morning_briefing_time}
                        onChange={e => saveConfig({ morning_briefing_time: e.target.value })}
                        className="bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm font-mono focus:border-teal-500 outline-none transition-colors w-40"
                      />
                    </div>

                    {/* Destinatários */}
                    <div>
                      <label className="block type-label text-[color:var(--text-muted)] mb-3">
                        Destinatários
                      </label>
                      <div className="flex gap-3">
                        {[
                          { key: 'admin',    label: 'Administradores' },
                          { key: 'investor', label: 'Investidores' },
                        ].map(({ key, label }) => {
                          const active = config.morning_briefing_targets.includes(key);
                          return (
                            <button
                              key={key}
                              onClick={() => toggleTarget(key)}
                              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all border ${
                                active
                                  ? 'bg-teal-600/20 border-teal-500/50 text-teal-300'
                                  : 'bg-white/[0.03] border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <SaveActionButton saving={saving} success={saveSuccess} onSave={handleSave} />
              </div>
            </div>
          )}

          {/* PERGUNTAS */}
          {activeSection === 'perguntas' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Perguntas de Acompanhamento</h3>
                <p className="text-sm text-[color:var(--text-muted)]">O bot sugere a próxima ação após cada resposta.</p>
              </div>
              <div className="border-t border-[color:var(--border-subtle)] pt-6 space-y-6">
                {/* Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-[color:var(--text-primary)]">Ativar perguntas de acompanhamento</p>
                    <p className="text-xs text-[color:var(--text-muted)] mt-0.5">
                      Ex: após ver o dashboard → "Quer ver quem está atrasado hoje?"
                    </p>
                  </div>
                  <button
                    onClick={() => saveConfig({ followup_enabled: !config.followup_enabled })}
                    className="text-teal-400 hover:text-teal-300 transition-colors"
                  >
                    {config.followup_enabled
                      ? <ToggleRight size={36} />
                      : <ToggleLeft size={36} className="text-[color:var(--text-muted)]" />}
                  </button>
                </div>

                {config.followup_enabled && (
                  <fieldset className="border border-[color:var(--border-subtle)] rounded-xl p-4 space-y-2">
                    <legend className="type-label text-[color:var(--text-muted)] px-1">Estilo das perguntas</legend>
                    {[
                      { value: 'natural', label: 'Natural', example: '"Quer ver quem está atrasado hoje?"' },
                      { value: 'direto',  label: 'Direto',  example: '"Ver atrasados hoje?"' },
                    ].map(({ value, label, example }) => (
                      <label
                        key={value}
                        className={`flex items-start gap-4 cursor-pointer rounded-lg border px-4 py-3 transition-all ${
                          config.followup_style === value
                            ? 'border-teal-500/50 bg-teal-900/10'
                            : 'border-[color:var(--border-subtle)] hover:border-[color:var(--border-strong)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="followup_style"
                          value={value}
                          checked={config.followup_style === value}
                          onChange={() => saveConfig({ followup_style: value as 'natural' | 'direto' })}
                          className="mt-0.5 accent-teal-500"
                        />
                        <div>
                          <p className="text-[color:var(--text-primary)] font-semibold text-sm">{label}</p>
                          <p className="text-[color:var(--text-muted)] text-xs mt-0.5">{example}</p>
                        </div>
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <SaveActionButton saving={saving} success={saveSuccess} onSave={handleSave} />
              </div>
            </div>
          )}

          {/* AUTOMAÇÕES */}
          {activeSection === 'automacoes' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Automações</h3>
                <p className="text-sm text-[color:var(--text-muted)]">Regras de disparo automático ativas no assistente.</p>
              </div>
              <div className="border-t border-[color:var(--border-subtle)] pt-6">
                <div className="space-y-3">
                  {[
                    {
                      icon: <Sun size={15} className="text-[color:var(--accent-caution)] shrink-0" />,
                      label: 'Briefing Matinal',
                      desc: `Resumo diário às ${config.morning_briefing_time} BRT`,
                      active: config.morning_briefing_enabled,
                    },
                    {
                      icon: <MessageCircle size={15} className="text-[color:var(--text-muted)] shrink-0" />,
                      label: 'Perguntas de Acompanhamento',
                      desc: 'Sugestão de próxima ação após cada resposta',
                      active: config.followup_enabled,
                    },
                  ].map(({ icon, label, desc, active }) => (
                    <div key={label} className="flex items-center justify-between gap-4 py-3 border-b border-[color:var(--border-subtle)] last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {icon}
                        <div className="min-w-0">
                          <p className="text-[color:var(--text-primary)] font-medium text-sm">{label}</p>
                          <p className="text-[color:var(--text-muted)] text-xs mt-0.5 truncate">{desc}</p>
                        </div>
                      </div>
                      <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${
                        active
                          ? 'bg-green-900/40 text-green-400 border border-green-700/50'
                          : 'bg-white/[0.04] text-[color:var(--text-muted)] border border-[color:var(--border-subtle)]'
                      }`}>
                        {active ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[color:var(--text-muted)] text-xs mt-4">
                  Mais automações em breve (lembretes de cobrança, alertas de atraso...)
                </p>
              </div>
            </div>
          )}

    </div>
  );
};

const SaveActionButton: React.FC<{ saving: boolean; success: boolean; onSave: () => void }> = ({ saving, success, onSave }) => (
  <button
    onClick={onSave}
    disabled={saving}
    className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
      success
        ? 'bg-green-600 text-white'
        : 'bg-[color:var(--accent-brass)] hover:bg-[color:var(--accent-brass-strong)] text-[color:var(--text-on-accent)]'
    }`}
  >
    {saving
      ? <><RefreshCw className="animate-spin" size={15} /> Salvando...</>
      : success
        ? <><CheckCircle2 size={15} /> Salvo!</>
        : <><Save size={15} /> Salvar</>}
  </button>
);

export default AdminAssistant;
