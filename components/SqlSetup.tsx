import React, { useState } from 'react';
import { SUPABASE_SQL_SCRIPT } from '../constants';
import { Clipboard, Check, Database, ShieldAlert, Zap, Wrench } from 'lucide-react';

interface SqlSetupProps {
  onComplete: () => void;
}

const SqlSetup: React.FC<SqlSetupProps> = ({ onComplete }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_SCRIPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full p-6 space-y-6 max-w-5xl mx-auto w-full animate-fade-in">
      <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-indigo-900/30 rounded-2xl text-indigo-400">
                <Wrench size={24} />
            </div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Reparo de Permissões (Erro 42501)</h2>
        </div>
        
        <p className="text-slate-300 mb-6 leading-relaxed text-sm">
          Identificamos um erro de permissão (Permission Denied for table users/profiles).
          <br/>
          Este novo script realiza um <strong>Reparo Profundo</strong>:
          <ul className="list-disc ml-4 mt-2 text-xs text-slate-400 space-y-1">
            <li>Define explicitamente o caminho de busca (search_path) para schemas de autenticação.</li>
            <li>Concede permissão de leitura explícita na tabela Profiles.</li>
            <li>Remove TODAS as políticas antigas (loop de limpeza) para evitar conflitos.</li>
            <li>Implementa um fallback duplo: Tenta ler do Token JWT (Rápido) e depois do Banco (Seguro).</li>
          </ul>
        </p>

        <div className="relative group">
          <div className="absolute top-4 right-4 z-10">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg hover:shadow-indigo-900/20 active:scale-95"
            >
              {copied ? <Check size={16} /> : <Clipboard size={16} />}
              {copied ? 'Copiado!' : 'Copiar Script de Reparo'}
            </button>
          </div>
          <pre className="bg-slate-950 p-6 rounded-2xl overflow-x-auto text-[10px] text-slate-400 font-mono border border-slate-700 h-96 custom-scrollbar shadow-inner leading-relaxed">
            <code>{SUPABASE_SQL_SCRIPT}</code>
          </pre>
        </div>

        <div className="mt-8 flex justify-between items-center border-t border-slate-700 pt-6">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Execute no SQL Editor do Supabase</p>
            <button 
                onClick={onComplete}
                className="bg-slate-700 hover:bg-slate-600 text-white px-8 py-3 rounded-xl transition-colors font-black text-xs uppercase tracking-widest"
            >
                Voltar para Login
            </button>
        </div>
      </div>
    </div>
  );
};

export default SqlSetup;