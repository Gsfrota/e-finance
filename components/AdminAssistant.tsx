import React, { useState } from 'react';
import { Tenant, Profile } from '../types';
import { useBotConfig } from '../hooks/useBotConfig';
import { BotConnectionWidget } from './BotConnectionWidget';
import { Bot, Save, RefreshCw, CheckCircle2, Sun, MessageCircle, Zap, ToggleLeft, ToggleRight, Clock } from 'lucide-react';

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
  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700/50">
    <div className={`p-3 rounded-xl ${colorClass}`}>{icon}</div>
    <div>
      <h3 className="text-lg font-black text-white uppercase">{title}</h3>
      {subtitle && <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">{subtitle}</p>}
    </div>
  </div>
);

const AdminAssistant: React.FC<AdminAssistantProps> = ({ tenant, profile }) => {
  const { config, loading, saving, error, saveConfig } = useBotConfig(tenant.id);
  const [saveSuccess, setSaveSuccess] = useState(false);

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
        <RefreshCw className="animate-spin text-slate-500" size={28} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-12">
      <div className="border-b border-slate-800 pb-6">
        <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Assistente</h2>
        <p className="text-slate-500 text-xs font-bold uppercase tracking-[0.2em] mt-1">Automações, Conexões e Comportamento do Bot</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-2xl px-5 py-4 text-red-300 text-sm font-medium">
          {error}
        </div>
      )}

      {/* SEÇÃO 1: Conexões */}
      <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] p-8 shadow-2xl">
        <SectionHeader
          icon={<Bot size={24} />}
          title="Conexões"
          subtitle="Vincule seus canais ao assistente"
          colorClass="bg-teal-900/30 text-teal-400"
        />
        <BotConnectionWidget />
      </div>

      {/* SEÇÃO 2: Mensagem Matinal */}
      <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] p-8 shadow-2xl">
        <SectionHeader
          icon={<Sun size={24} />}
          title="Mensagem Matinal"
          subtitle="Resumo financeiro automático todo dia de manhã"
          colorClass="bg-amber-900/30 text-amber-400"
        />

        {/* Toggle */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-white font-semibold text-sm">Ativar briefing matinal</p>
            <p className="text-slate-400 text-xs mt-0.5">O bot envia um resumo diário nos canais vinculados</p>
          </div>
          <button
            onClick={() => saveConfig({ morning_briefing_enabled: !config.morning_briefing_enabled })}
            className="text-teal-400 hover:text-teal-300 transition-colors"
          >
            {config.morning_briefing_enabled
              ? <ToggleRight size={36} />
              : <ToggleLeft size={36} className="text-slate-500" />
            }
          </button>
        </div>

        {config.morning_briefing_enabled && (
          <>
            {/* Horário */}
            <div className="mb-5">
              <label className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                <Clock size={13} /> Horário (horário de Brasília)
              </label>
              <input
                type="time"
                value={config.morning_briefing_time}
                onChange={e => saveConfig({ morning_briefing_time: e.target.value })}
                className="bg-slate-900 border border-slate-700 rounded-2xl px-5 py-3 text-white text-sm font-mono focus:border-teal-500 outline-none transition-all w-40"
              />
            </div>

            {/* Destinatários */}
            <div className="mb-6">
              <label className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-3 block">
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
                          : 'bg-slate-700/40 border-slate-600 text-slate-400 hover:border-slate-500'
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
              <label className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-3 block">
                Preview da mensagem
              </label>
              <div className="bg-slate-900 border border-slate-700/60 rounded-2xl p-5 font-mono text-sm text-slate-200 whitespace-pre-line leading-relaxed">
{`Bom dia ${exampleName}! 🌅
Hoje você tem R$\u00a01.200,00 para receber.

📋 Cobranças do dia:
  • João Silva — Parcela 3/12 — R$\u00a0500,00
  • Ana Souza — Parcela 7/12 — R$\u00a0700,00

Quer ver o detalhamento completo?`}
              </div>
              <p className="text-slate-500 text-xs mt-2">* Os valores reais serão gerados com os dados do dia.</p>
            </div>
          </>
        )}
      </div>

      {/* SEÇÃO 3: Perguntas de Acompanhamento */}
      <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] p-8 shadow-2xl">
        <SectionHeader
          icon={<MessageCircle size={24} />}
          title="Perguntas de Acompanhamento"
          subtitle="O bot sugere a próxima ação após cada resposta"
          colorClass="bg-indigo-900/30 text-indigo-400"
        />

        {/* Toggle */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-white font-semibold text-sm">Ativar perguntas de acompanhamento</p>
            <p className="text-slate-400 text-xs mt-0.5">
              Ex: após ver o dashboard → "Quer ver quem está atrasado hoje?"
            </p>
          </div>
          <button
            onClick={() => saveConfig({ followup_enabled: !config.followup_enabled })}
            className="text-teal-400 hover:text-teal-300 transition-colors"
          >
            {config.followup_enabled
              ? <ToggleRight size={36} />
              : <ToggleLeft size={36} className="text-slate-500" />
            }
          </button>
        </div>

        {config.followup_enabled && (
          <div>
            <label className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-3 block">
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
                      : 'border-slate-700 bg-slate-700/20 hover:border-slate-600'
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
                    <p className="text-white font-semibold text-sm">{label}</p>
                    <p className="text-slate-400 text-xs mt-0.5">{example}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 4: Automações */}
      <div className="bg-slate-800 border border-slate-700 rounded-[2.5rem] p-8 shadow-2xl">
        <SectionHeader
          icon={<Zap size={24} />}
          title="Automações"
          subtitle="Regras de disparo automático"
          colorClass="bg-violet-900/30 text-violet-400"
        />

        <div className="flex items-center justify-between bg-slate-700/30 rounded-2xl border border-slate-700 px-5 py-4">
          <div className="flex items-center gap-3">
            <Sun size={18} className="text-amber-400" />
            <div>
              <p className="text-white font-semibold text-sm">Briefing Matinal</p>
              <p className="text-slate-400 text-xs">Resumo diário às {config.morning_briefing_time} BRT</p>
            </div>
          </div>
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${
            config.morning_briefing_enabled
              ? 'bg-green-900/40 text-green-400 border border-green-700/50'
              : 'bg-slate-700 text-slate-500'
          }`}>
            {config.morning_briefing_enabled ? 'Ativo' : 'Inativo'}
          </span>
        </div>

        <p className="text-slate-600 text-xs mt-4 text-center">
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
