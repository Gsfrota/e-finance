import React, { useState } from 'react';
import { Database, ShieldCheck, ArrowRight, ExternalLink, AlertCircle, Info } from 'lucide-react';
import { saveExternalConfig } from '../services/supabase';

const SetupWizard: React.FC = () => {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!url.startsWith('https://')) {
      setError("A URL do Supabase deve começar com https://");
      return;
    }

    if (key.length < 20) {
      setError("A Anon Key parece ser inválida.");
      return;
    }

    try {
        saveExternalConfig(url, key);
    } catch (err) {
        setError("Erro ao salvar configuração local.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-xl bg-slate-800 rounded-[2.5rem] border border-slate-700 shadow-2xl overflow-hidden animate-fade-in">
        <div className="p-10">
          <div className="flex items-center gap-4 mb-8">
            <div className="p-4 bg-teal-600 rounded-2xl text-white shadow-lg shadow-teal-900/40">
                <Database size={32} />
            </div>
            <div>
                <h1 className="text-3xl font-black text-white uppercase tracking-tighter">Conexão Ativa</h1>
                <p className="text-teal-500 text-xs font-black uppercase tracking-widest">Enterprise Database Bridge</p>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-700 p-6 rounded-2xl mb-8">
            <div className="flex gap-3 text-slate-300 text-sm leading-relaxed">
                <Info className="text-teal-400 shrink-0 mt-1" size={18} />
                <p>
                    As credenciais abaixo foram extraídas do seu ambiente de produção. 
                    Confirme os dados para liberar o acesso ao <strong>Juros Certo</strong>.
                </p>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Project URL</label>
              <input 
                required 
                type="url" 
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">API Anon Key</label>
              <textarea 
                required 
                rows={4}
                value={key}
                onChange={e => setKey(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white font-mono text-xs focus:ring-2 focus:ring-teal-500 outline-none transition-all resize-none"
              />
            </div>

            {error && (
                <div className="flex items-center gap-2 text-red-400 text-xs bg-red-900/20 p-4 rounded-xl border border-red-900/30">
                    <AlertCircle size={16} className="shrink-0" />
                    <span className="font-bold">{error}</span>
                </div>
            )}

            <button type="submit" className="w-full bg-teal-600 hover:bg-teal-500 text-white py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-teal-950/40 flex items-center justify-center gap-3">
                Confirmar Credenciais <ArrowRight size={18} />
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-slate-700/50 flex flex-col items-center gap-4 text-center">
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck size={14} className="text-teal-600"/> Conexão Encriptada | SSL Ativo
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupWizard;