
import React, { useState } from 'react';
import { Key, CheckCircle, AlertCircle, Activity, ShieldCheck } from 'lucide-react';
import { getSupabase } from '../services/supabase';

interface ResetPasswordProps {
  onResetSuccess: () => void;
}

const ResetPassword: React.FC<ResetPasswordProps> = ({ onResetSuccess }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (password.length < 6) {
      setError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    
    setLoading(true);
    setError(null);
    setSuccess(null);

    const supabase = getSupabase();
    if (!supabase) {
        setError("Erro de conexão.");
        setLoading(false);
        return;
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      
      setSuccess("Senha alterada com sucesso! Redirecionando...");
      setTimeout(() => {
        onResetSuccess();
      }, 2000);

    } catch (err: any) {
      setError(err.message || "Não foi possível alterar a senha.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[color:var(--bg-base)] justify-center items-center p-6 font-sans animate-fade-in">
      <div className="w-full max-w-md space-y-8 bg-[color:var(--bg-elevated)] p-10 rounded-3xl border border-[color:var(--border-subtle)] shadow-2xl">
        <div className="text-center space-y-2">
            <div className="inline-block p-4 bg-teal-600/10 rounded-2xl border border-teal-500/20 mb-4">
                <Key className="text-teal-400" size={32} />
            </div>
            <h2 className="type-title text-[color:var(--text-primary)]">Redefinir Senha</h2>
            <p className="type-body text-[color:var(--text-secondary)]">Crie uma nova senha segura para sua conta.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
            <input 
                required 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                minLength={6} 
                className="w-full bg-[color:var(--bg-base)]/50 border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-sm text-white focus:border-teal-500 outline-none" 
                placeholder="Nova Senha"
            />
            <input 
                required 
                type="password" 
                value={confirmPassword} 
                onChange={(e) => setConfirmPassword(e.target.value)} 
                minLength={6} 
                className="w-full bg-[color:var(--bg-base)]/50 border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-sm text-white focus:border-teal-500 outline-none" 
                placeholder="Confirmar Nova Senha"
            />

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-start gap-3">
                    <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={16} />
                    <p className="text-red-400 text-xs font-medium leading-relaxed">{error}</p>
                </div>
            )}

            {success && (
                <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-xl flex items-start gap-3">
                    <CheckCircle className="text-green-400 shrink-0 mt-0.5" size={16} />
                    <p className="text-green-400 text-xs font-medium leading-relaxed">{success}</p>
                </div>
            )}

            <button 
                type="submit" 
                disabled={loading || !!success} 
                className="w-full group bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-70"
            >
                {loading ? <Activity className="animate-spin" size={20} /> : <ShieldCheck size={20}/>}
                <span>Salvar Nova Senha</span>
            </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
