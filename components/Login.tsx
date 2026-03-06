
import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle,
  Key,
  Landmark,
  Lock,
  Settings2,
  ShieldCheck,
  WalletCards,
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

  const baseInputClass = 'w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-sm text-[color:var(--text-primary)] outline-none transition-all placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent-brass)] focus:bg-white/[0.05]';

  return (
    <div className="min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className="mx-auto grid min-h-screen max-w-[1680px] grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,560px)]">
        <section className="relative hidden overflow-hidden border-r border-white/10 px-12 py-12 lg:flex lg:flex-col lg:justify-between">
          <div className="app-noise absolute inset-0"></div>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(202,176,122,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(144,160,189,0.14),transparent_24%)]"></div>
          <div className="relative z-10 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.18)]">
              <Landmark size={22} />
            </div>
            <div>
              <p className="section-kicker mb-1">Plataforma Operacional</p>
              <div className="font-display text-3xl leading-none">E-Finance</div>
            </div>
          </div>

          <div className="relative z-10 max-w-2xl">
            <p className="section-kicker mb-4">Controle de crédito</p>
            <h1 className="font-display max-w-xl text-6xl leading-[0.92] text-[color:var(--text-primary)]">
              Crédito, cobrança e caixa em uma única operação.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[color:var(--text-secondary)]">
              Organize carteira, acompanhe parcelas, valide rentabilidade e mantenha o fluxo financeiro com leitura clara do que venceu, do que entrou e do que ainda está aberto.
            </p>

            <div className="mt-12 grid max-w-2xl grid-cols-3 gap-4">
              <div className="panel-card rounded-[1.75rem] p-5">
                <ShieldCheck size={18} className="text-[color:var(--accent-brass)]" />
                <p className="mt-4 text-sm font-semibold">Estrutura multi-tenant</p>
                <p className="mt-2 text-xs leading-6 text-[color:var(--text-muted)]">Isolamento por tenant, vínculo por perfil e auditoria de eventos críticos.</p>
              </div>
              <div className="panel-card rounded-[1.75rem] p-5">
                <WalletCards size={18} className="text-[color:var(--accent-steel)]" />
                <p className="mt-4 text-sm font-semibold">Carteira legível</p>
                <p className="mt-2 text-xs leading-6 text-[color:var(--text-muted)]">Painel enxuto para saber o que está na rua, o que já retornou e o que vence no período.</p>
              </div>
              <div className="panel-card rounded-[1.75rem] p-5">
                <Building2 size={18} className="text-[color:var(--accent-positive)]" />
                <p className="mt-4 text-sm font-semibold">Operação diária</p>
                <p className="mt-2 text-xs leading-6 text-[color:var(--text-muted)]">Contratos, clientes, cobrança e baixa integrados em uma rotina única.</p>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-6 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-faint)]">
            <span>© 2026 E-Finance</span>
            <span>Infraestrutura operacional</span>
          </div>
        </section>

        <section className="relative flex flex-col justify-center px-6 py-8 lg:px-16">
        {!isProduction() && (
            <button onClick={clearExternalConfig} className="absolute right-6 top-6 flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-faint)] transition-colors hover:text-[color:var(--accent-brass)]">
                <Settings2 size={14}/> Reset Config
            </button>
        )}
        <div className="mx-auto w-full max-w-lg">
            <div className="panel-card rounded-[2rem] p-8 sm:p-10">
              <div className="mb-8 space-y-3">
                <p className="section-kicker">Acesso seguro</p>
                <h2 className="font-display text-5xl leading-none text-[color:var(--text-primary)]">{getTitle()}</h2>
                <p className="max-w-md text-sm leading-7 text-[color:var(--text-secondary)]">{getSubtitle()}</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {authMode === 'signUpAdmin' && (
                    <div className="animate-fade-in-down">
                        <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Organização</label>
                        <input required type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={baseInputClass} placeholder="Nome da organização" />
                    </div>
                )}
                {(authMode === 'signUpAdmin' || authMode === 'signUpInvited') && (
                    <div>
                      <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Nome completo</label>
                      <input required type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className={baseInputClass} placeholder="Seu nome" />
                    </div>
                )}
                {authMode === 'signUpInvited' && (
                     <div>
                        <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Código de convite</label>
                        <div className="relative">
                          <Key className="absolute left-4 top-4 text-[color:var(--text-faint)]" size={16} />
                          <input required type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className={`${baseInputClass} pl-12 font-mono tracking-[0.2em]`} placeholder="CÓDIGO" />
                        </div>
                     </div>
                )}

                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">E-mail</label>
                  <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={baseInputClass} placeholder="seu@email.com" />
                </div>

                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Senha</label>
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
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[color:var(--accent-brass)] px-6 py-4 text-xs font-extrabold uppercase tracking-[0.22em] text-[#17120b] transition-all hover:bg-[color:var(--accent-brass-strong)] disabled:opacity-70"
                >
                  {loading ? <Activity className="animate-spin" size={18} /> : <ArrowRight size={16} />}
                  <span>{authMode === 'login' ? 'Entrar na operação' : 'Prosseguir'}</span>
                </button>
              </form>

              <div className="mt-8 border-t border-white/10 pt-6 text-center">
                {authMode !== 'login' ? (
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Já possui acesso?
                    <button onClick={() => { setAuthMode('login'); setError(null); }} className="ml-2 font-semibold text-[color:var(--accent-brass)]">
                      Fazer login
                    </button>
                  </p>
                ) : (
                  <div className="space-y-3 text-sm text-[color:var(--text-muted)]">
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
                    <p className="pt-2 text-xs uppercase tracking-[0.16em]">
                      Problemas para acessar?
                      <button type="button" onClick={handlePasswordReset} disabled={loading} className="ml-2 font-semibold text-[color:var(--text-secondary)]">
                        Redefinir senha
                      </button>
                    </p>
                  </div>
                )}
              </div>
            </div>
        </div>
        </section>
      </div>
    </div>
  );
};

export default Login;
