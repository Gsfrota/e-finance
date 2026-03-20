
import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Key,
  Landmark,
  Lock,
  Settings2,
} from 'lucide-react';
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

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabase();
    if (!supabase) {
      setError("Erro de Infraestrutura: Conexão com banco não inicializada.");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/' },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // Se ok: redireciona para Google → callback → onAuthStateChange dispara
  };

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

  const baseInputClass = 'w-full rounded-2xl border border-[color:var(--border-strong)] bg-white/[0.03] px-4 py-3.5 text-sm text-[color:var(--text-primary)] outline-none transition-all placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent-brass)] focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(240,180,41,0.08)]';

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)] flex flex-col items-center justify-center px-6 py-10">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-80 w-[480px] rounded-full bg-[rgba(202,176,122,0.09)] blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-64 w-64 rounded-full bg-[rgba(144,160,189,0.07)] blur-3xl" />

      {/* Reset Config (dev only) */}
      {!isProduction() && (
        <button
          onClick={clearExternalConfig}
          aria-label="Resetar configuração externa"
          className="absolute right-6 top-6 flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-faint)] transition-colors hover:text-[color:var(--accent-brass)] cursor-pointer"
        >
          <Settings2 size={14} /> Reset Config
        </button>
      )}

      <div className="relative z-10 w-full max-w-sm">
        {/* Brand header — só no modo login */}
        {authMode === 'login' && (
          <div className="mb-10 flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.22)]">
              <Landmark size={26} />
            </div>
            <div>
              <h1 className="type-display text-[color:var(--text-primary)]">Juros Certo</h1>
              <p className="mt-1 type-caption text-[color:var(--accent-brass)]">Gestão de crédito</p>
            </div>
          </div>
        )}

        {/* Header para modos de cadastro */}
        {authMode !== 'login' && (
          <div className="mb-8 text-center">
            <p className="section-kicker mb-2">Acesso seguro</p>
            <h2 className="type-display text-[color:var(--text-primary)]">
              {authMode === 'signUpAdmin' ? 'Criar Organização' : 'Ativar Conta com Convite'}
            </h2>
            <p className="mt-3 text-sm text-[color:var(--text-secondary)]">
              {authMode === 'signUpAdmin'
                ? 'Preencha os dados para configurar seu ambiente.'
                : 'Use o código fornecido para acessar sua conta.'}
            </p>
          </div>
        )}

        {/* Botão Google — só no modo login, acima do formulário */}
        {authMode === 'login' && (
          <>
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 rounded-full bg-white py-4 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-gray-100 disabled:opacity-60 mb-4"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continuar com Google
            </button>

            <div className="flex items-center gap-3 text-[color:var(--text-faint)] mb-4">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">ou</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>
          </>
        )}

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {authMode === 'signUpAdmin' && (
            <div className="animate-fade-in-down">
              <label className="mb-2 block type-label text-[color:var(--text-faint)]">Organização</label>
              <input required type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={baseInputClass} placeholder="Nome da organização" />
            </div>
          )}

          {(authMode === 'signUpAdmin' || authMode === 'signUpInvited') && (
            <div>
              <label className="mb-2 block type-label text-[color:var(--text-faint)]">Nome completo</label>
              <input required type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className={baseInputClass} placeholder="Seu nome" />
            </div>
          )}

          {authMode === 'signUpInvited' && (
            <div>
              <label className="mb-2 block type-label text-[color:var(--text-faint)]">Código de convite</label>
              <div className="relative">
                <Key className="absolute left-4 top-4 text-[color:var(--text-faint)]" size={16} />
                <input required type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className={`${baseInputClass} pl-12 font-mono tracking-[0.2em]`} placeholder="CÓDIGO" />
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block type-label text-[color:var(--text-faint)]">E-mail</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={baseInputClass} placeholder="seu@email.com" />
          </div>

          <div>
            <label className="mb-2 block type-label text-[color:var(--text-faint)]">Senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-4 text-[color:var(--text-faint)]" size={16} />
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} className={`${baseInputClass} pl-12`} placeholder="Senha de acesso" />
            </div>
          </div>

          {error && (
            <div data-testid="error-message" className="rounded-2xl border border-[rgba(198,126,105,0.26)] bg-[rgba(198,126,105,0.08)] p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 shrink-0 text-[color:var(--accent-danger)]" size={16} />
                <p className="text-xs leading-6 text-[color:var(--text-secondary)]">{error}</p>
              </div>
            </div>
          )}

          {resetRequested && (
            <div className="rounded-2xl border border-[rgba(143,179,157,0.24)] bg-[rgba(143,179,157,0.08)] p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-0.5 shrink-0 text-[color:var(--accent-positive)]" size={16} />
                <p className="text-xs leading-6 text-[color:var(--text-secondary)]">
                  Se uma conta com este e-mail existir, um link de redefinição foi enviado. Verifique sua caixa de entrada.
                </p>
              </div>
            </div>
          )}

          <button
            data-testid="login-btn"
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="btn btn-primary w-full rounded-full py-4 text-xs uppercase tracking-[0.22em] disabled:opacity-60 mt-2"
          >
            {loading ? <Activity className="animate-spin" size={18} /> : <ArrowRight size={16} />}
            <span>{authMode === 'login' ? 'Entrar na operação' : 'Prosseguir'}</span>
          </button>
        </form>

        {/* Links de navegação */}
        <div className="mt-8 text-center space-y-3 text-sm text-[color:var(--text-muted)]">
          {authMode !== 'login' ? (
            <p>
              Já possui acesso?
              <button onClick={() => { setAuthMode('login'); setError(null); }} className="ml-2 font-semibold text-[color:var(--accent-brass)]">
                Fazer login
              </button>
            </p>
          ) : (
            <>
              <p>
                Recebeu um convite?
                <button onClick={() => { setAuthMode('signUpInvited'); setError(null); }} className="ml-2 font-semibold text-[color:var(--accent-brass)]">
                  Ativar conta
                </button>
              </p>
              <p>
                Vai abrir uma nova operação?
                <button onClick={() => { setAuthMode('signUpAdmin'); setError(null); }} className="ml-2 font-semibold text-[color:var(--accent-brass)]">
                  Registrar empresa
                </button>
              </p>
              <p className="pt-1 text-xs uppercase tracking-[0.16em]">
                Problemas para acessar?
                <button type="button" onClick={handlePasswordReset} disabled={loading} aria-busy={loading} aria-label="Redefinir senha por e-mail" className="ml-2 font-semibold text-[color:var(--text-secondary)]">
                  Redefinir senha
                </button>
              </p>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-[10px] text-[color:var(--text-faint)] leading-5">
          Ao continuar, você concorda com os{' '}
          <span className="underline cursor-pointer">Termos de Uso</span>
          {' '}e a{' '}
          <span className="underline cursor-pointer">Política de Privacidade</span>.
        </p>
      </div>
    </div>
  );
};

export default Login;
