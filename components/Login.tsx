
import React, { useState } from 'react';
import { Lock, Mail, User, ArrowRight, Activity, Building2, AlertCircle, Settings2, ShieldCheck, Key, CheckCircle } from 'lucide-react';
import { getSupabase, isProduction, clearExternalConfig } from '../services/supabase';

interface LoginProps {
  onLoginSuccess: () => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [authMode, setAuthMode] = useState<'login' | 'signUpAdmin' | 'signUpInvited'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetRequested, setResetRequested] = useState(false);

  const handlePasswordReset = async () => {
    if (!email) {
        setError("Por favor, digite seu e-mail para redefinir a senha.");
        return;
    }
    setLoading(true);
    setError(null);
    setResetRequested(false);
    
    const supabase = getSupabase();
    if (!supabase) return;

    const redirectUrl = window.location.origin + window.location.pathname.replace('index.html', '');

    try {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: redirectUrl
        });
        if (resetError) throw resetError;
        setResetRequested(true);
    } catch (err: any) {
        setError(err.message || "Erro ao enviar e-mail de redefinição.");
    } finally {
        setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResetRequested(false);
    
    const supabase = getSupabase();
    if (!supabase) {
        setError("Erro de Infraestrutura: Conexão com banco não inicializada.");
        setLoading(false);
        return;
    }

    try {
      if (authMode === 'signUpAdmin') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { 
                full_name: fullName,
                company_name: companyName,
                role: 'admin'
            }
          }
        });
        if (signUpError) throw signUpError;
        if (data.user && !data.session) {
          setError("Registro iniciado! Verifique seu e-mail para confirmar o cadastro.");
        } else if (data.session) onLoginSuccess();
      
      } else if (authMode === 'signUpInvited') {
          const { data, error: signUpError } = await supabase.auth.signUp({
              email,
              password,
              options: {
                  data: {
                      full_name: fullName,
                      invite_code: inviteCode.toUpperCase().trim()
                  }
              }
          });
          if (signUpError) throw signUpError;
          if (data.user && !data.session) {
              setError("Conta criada! Verifique seu e-mail de confirmação para poder fazer login.");
          } else if (data.session) onLoginSuccess();

      } else { // Login
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        if (data.session) onLoginSuccess();
      }
    } catch (err: any) {
      setError(err.message || "Credenciais inválidas ou erro de servidor.");
    } finally {
      setLoading(false);
    }
  };
  
  const getTitle = () => {
    if (authMode === 'signUpAdmin') return 'Criar Organização';
    if (authMode === 'signUpInvited') return 'Ativar Conta com Convite';
    return 'Acessar Plataforma';
  }

  const getSubtitle = () => {
    if (authMode === 'signUpAdmin') return 'Preencha os dados para configurar seu ambiente.';
    if (authMode === 'signUpInvited') return 'Use o código fornecido para acessar sua conta.';
    return 'Entre com suas credenciais para continuar.';
  }

  return (
    <div className="flex min-h-screen bg-[#020617] text-white font-sans overflow-hidden">
      
      <div className="hidden lg:flex w-1/2 relative flex-col justify-between p-12 overflow-hidden bg-slate-950">
        <div className="absolute inset-0 z-0">
            <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[120px] animate-pulse"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px]"></div>
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
            <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)', backgroundSize: '50px 50px' }}></div>
        </div>
        <div className="relative z-10">
            <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-gradient-to-tr from-teal-400 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-teal-500/20">
                    <Activity className="text-white" size={20} />
                </div>
                <span className="text-xl font-black tracking-tighter uppercase">E-Finance</span>
            </div>
        </div>
        <div className="relative z-10 max-w-lg">
            <h1 className="text-5xl font-bold tracking-tight leading-tight mb-6 text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400">
                Gestão Financeira de Alta Performance.
            </h1>
            <p className="text-lg text-slate-400 leading-relaxed mb-8">
                Centralize ativos, controle contratos e gerencie riscos com a plataforma mais segura do mercado.
            </p>
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-6 rounded-2xl flex items-start gap-4 shadow-2xl">
                <div className="p-3 bg-teal-500/20 rounded-full text-teal-400">
                    <ShieldCheck size={24} />
                </div>
                <div>
                    <h3 className="font-bold text-white mb-1">Segurança Bancária</h3>
                    <p className="text-sm text-slate-400">Dados criptografados de ponta a ponta e conformidade com RLS.</p>
                </div>
            </div>
        </div>
        <div className="relative z-10 flex items-center gap-6 text-xs font-medium text-slate-500 uppercase tracking-widest">
            <span>&copy; 2026 E-Finance Suite</span>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-6 relative bg-[#0B0F19]">
        {!isProduction() && (
            <button onClick={clearExternalConfig} className="absolute top-6 right-6 flex items-center gap-2 text-[10px] font-black uppercase text-slate-600 hover:text-teal-400 transition-colors px-4 py-2">
                <Settings2 size={14}/> Reset Config
            </button>
        )}
        <div className="w-full max-w-md space-y-8">
            <div className="text-center lg:text-left space-y-2">
                <h2 className="text-3xl font-bold tracking-tight text-white">{getTitle()}</h2>
                <p className="text-slate-400 text-sm">{getSubtitle()}</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
                {authMode === 'signUpAdmin' && (
                    <div className="grid grid-cols-1 gap-5 animate-fade-in-down">
                        <input required type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:border-teal-500 outline-none" placeholder="Nome da Organização" />
                    </div>
                )}
                {(authMode === 'signUpAdmin' || authMode === 'signUpInvited') && (
                     <input required type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:border-teal-500 outline-none" placeholder="Seu Nome Completo" />
                )}
                {authMode === 'signUpInvited' && (
                     <div className="relative group">
                        <Key className="absolute left-4 top-3.5 text-slate-500 group-focus-within:text-teal-400" size={18} />
                        <input required type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className="w-full bg-slate-900/50 border border-slate-800 rounded-xl pl-12 pr-4 py-3 text-sm text-white focus:border-teal-500 outline-none tracking-[0.2em] font-mono" placeholder="CÓDIGO" />
                     </div>
                )}
                <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:border-teal-500 outline-none" placeholder="E-mail Corporativo" />
                <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:border-teal-500 outline-none" placeholder="Senha de Acesso" />

                {error && (
                    <div data-testid="error-message" className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-start gap-3">
                        <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={16} />
                        <p className="text-red-400 text-xs font-medium leading-relaxed">{error}</p>
                    </div>
                )}
                {resetRequested && (
                    <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-xl flex items-start gap-3">
                        <CheckCircle className="text-green-400 shrink-0 mt-0.5" size={16} />
                        <p className="text-green-400 text-xs font-medium leading-relaxed">
                            Se uma conta com este e-mail existir, um link de redefinição foi enviado. Verifique sua caixa de entrada.
                        </p>
                    </div>
                )}
                <button data-testid="login-btn" type="submit" disabled={loading} className="w-full group bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-70">
                    {loading ? <Activity className="animate-spin" size={20} /> : <span>{authMode === 'login' ? 'Entrar' : 'Registrar'}</span>}
                </button>
            </form>
            <div className="pt-6 text-center space-y-4">
                 {authMode !== 'login' ? (
                     <p className="text-slate-500 text-sm">
                        Já tem uma conta?
                        <button onClick={() => { setAuthMode('login'); setError(null); }} className="ml-2 text-teal-400 hover:text-teal-300 font-bold">
                            Fazer Login
                        </button>
                     </p>
                 ) : (
                    <>
                        <p className="text-slate-500 text-sm">
                            Recebeu um convite?
                            <button onClick={() => { setAuthMode('signUpInvited'); setError(null); }} className="ml-2 text-teal-400 hover:text-teal-300 font-bold">
                                Ativar Conta
                            </button>
                        </p>
                        <p className="text-slate-500 text-sm">
                            Quer criar sua própria organização?
                            <button onClick={() => { setAuthMode('signUpAdmin'); setError(null); }} className="ml-2 text-slate-400 hover:text-teal-300 font-bold">
                                Registrar Empresa
                            </button>
                        </p>
                        <p className="text-slate-500 text-xs pt-4 border-t border-slate-800">
                            Problemas para acessar?
                            <button type="button" onClick={handlePasswordReset} disabled={loading} className="ml-2 text-slate-400 hover:text-teal-300 font-bold">
                                Redefinir senha
                            </button>
                        </p>
                    </>
                 )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
