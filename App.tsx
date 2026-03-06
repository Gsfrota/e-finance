
import React, { useState, useEffect } from 'react';
import { HashRouter as Router } from 'react-router-dom'; 
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminUsers from './components/AdminUsers';
import AdminContracts from './components/AdminContracts';
import AdminSettings from './components/AdminSettings';
import AdminAssistant from './components/AdminAssistant';
import AdminUserDetails from './components/AdminUserDetails';
import SetupWizard from './components/SetupWizard';
import ResetPassword from './components/ResetPassword';
import { AppView, UserRole, Tenant, Profile } from './types';
import { getSupabase, isProduction, isSupabaseConfigured, logError } from './services/supabase';
import {
  LayoutDashboard,
  LogOut,
  UserRound,
  Users,
  BriefcaseBusiness,
  Building2,
  ShieldCheck,
  Loader2,
  AlertCircle,
  Menu,
  X,
  ChevronRight,
  Bot,
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  activeView: AppView;
  onChangeView: (v: AppView) => void;
  onLogout: () => void;
  userRole?: UserRole;
  tenant?: Tenant | null;
  profile?: Profile | null;
}

const Layout: React.FC<LayoutProps> = ({ children, activeView, onChangeView, onLogout, userRole, tenant, profile }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentSectionLabel: Record<AppView, string> = {
    [AppView.LOGIN]: 'Acesso',
    [AppView.DASHBOARD]: 'Visão Executiva',
    [AppView.USERS]: 'Relacionamentos',
    [AppView.USER_DETAILS]: 'Dossiê do Cliente',
    [AppView.CONTRACTS]: 'Contratos',
    [AppView.SETTINGS]: 'Configurações',
    [AppView.ASSISTANT]: 'Assistente',
    [AppView.RESET_PASSWORD]: 'Segurança',
  };

  const handleViewChange = (view: AppView) => {
    onChangeView(view);
    setMobileMenuOpen(false);
  };

  const NavContent = () => (
    <>
      <div className="border-b soft-divider px-7 py-7">
        <div className="flex items-center gap-4">
            {tenant?.logo_url ? (
                <img src={tenant.logo_url} alt="Logo" className="h-11 w-11 rounded-2xl object-cover ring-1 ring-white/10" />
            ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.16)]">
                    {tenant?.name?.charAt(0) || <ShieldCheck size={16} />}
                </div>
            )}
            <div className="min-w-0">
                <p className="section-kicker mb-1">E-Finance</p>
                <h2 className="font-display truncate text-[1.9rem] leading-none text-[color:var(--text-primary)]">
                  {tenant?.name || 'Workspace'}
                </h2>
                <p className="mt-1 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">
                  {isProduction() ? 'Ambiente Operacional' : 'Ambiente de Desenvolvimento'}
                </p>
            </div>
        </div>
      </div>
      
      <nav className="flex-1 space-y-1 overflow-y-auto px-5 py-5">
        <button 
          onClick={() => handleViewChange(AppView.DASHBOARD)}
          className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all ${
            activeView === AppView.DASHBOARD
              ? 'bg-[rgba(202,176,122,0.12)] text-[color:var(--text-primary)] ring-1 ring-[rgba(202,176,122,0.2)]'
              : 'text-[color:var(--text-muted)] hover:bg-white/[0.03] hover:text-[color:var(--text-primary)]'
          }`}
        >
          <LayoutDashboard size={20} />
          <div className="flex-1">
            <div className="text-sm font-semibold">Dashboard</div>
            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Leitura financeira</div>
          </div>
        </button>

        {userRole === 'admin' && (
            <>
                <button 
                onClick={() => handleViewChange(AppView.USERS)}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all ${
                  activeView === AppView.USERS || activeView === AppView.USER_DETAILS
                    ? 'bg-[rgba(202,176,122,0.12)] text-[color:var(--text-primary)] ring-1 ring-[rgba(202,176,122,0.2)]'
                    : 'text-[color:var(--text-muted)] hover:bg-white/[0.03] hover:text-[color:var(--text-primary)]'
                }`}
                >
                <Users size={20} />
                <div className="flex-1">
                  <div className="text-sm font-semibold">Usuários</div>
                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Relacionamentos</div>
                </div>
                </button>

                <button 
                onClick={() => handleViewChange(AppView.CONTRACTS)}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all ${
                  activeView === AppView.CONTRACTS
                    ? 'bg-[rgba(202,176,122,0.12)] text-[color:var(--text-primary)] ring-1 ring-[rgba(202,176,122,0.2)]'
                    : 'text-[color:var(--text-muted)] hover:bg-white/[0.03] hover:text-[color:var(--text-primary)]'
                }`}
                >
                <BriefcaseBusiness size={20} />
                <div className="flex-1">
                  <div className="text-sm font-semibold">Contratos</div>
                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Crédito e prazos</div>
                </div>
                </button>

                <button
                onClick={() => handleViewChange(AppView.ASSISTANT)}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all ${
                  activeView === AppView.ASSISTANT
                    ? 'bg-[rgba(202,176,122,0.12)] text-[color:var(--text-primary)] ring-1 ring-[rgba(202,176,122,0.2)]'
                    : 'text-[color:var(--text-muted)] hover:bg-white/[0.03] hover:text-[color:var(--text-primary)]'
                }`}
                >
                <Bot size={20} />
                <div className="flex-1">
                  <div className="text-sm font-semibold">Assistente</div>
                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Automações e conexões</div>
                </div>
                </button>

                <button
                onClick={() => handleViewChange(AppView.SETTINGS)}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all ${
                  activeView === AppView.SETTINGS
                    ? 'bg-[rgba(202,176,122,0.12)] text-[color:var(--text-primary)] ring-1 ring-[rgba(202,176,122,0.2)]'
                    : 'text-[color:var(--text-muted)] hover:bg-white/[0.03] hover:text-[color:var(--text-primary)]'
                }`}
                >
                <Building2 size={20} />
                <div className="flex-1">
                  <div className="text-sm font-semibold">Ajustes</div>
                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Empresa e financeiro</div>
                </div>
                </button>
            </>
        )}
      </nav>

      <div className="border-t soft-divider p-5">
        <button 
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-[color:var(--text-muted)] transition-all hover:bg-[rgba(198,126,105,0.08)] hover:text-[color:var(--accent-danger)]"
        >
          <LogOut size={18} />
          <span className="text-sm font-semibold">Encerrar sessão</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-transparent text-[color:var(--text-primary)] overflow-hidden font-sans">
      
      <aside className="glass-border hidden w-[280px] flex-col border-r md:flex">
        <NavContent />
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}></div>
          <aside className="glass-border relative h-full w-[84%] max-w-xs animate-fade-in-right flex-col">
             <button onClick={() => setMobileMenuOpen(false)} className="absolute right-4 top-4 p-2 text-[color:var(--text-muted)] hover:text-white">
                <X size={24} />
             </button>
             <NavContent />
          </aside>
        </div>
      )}

      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <header className="glass-border z-20 flex h-16 items-center justify-between border-b px-4 md:h-20 md:px-8">
          
          <div className="flex items-center gap-4 md:hidden">
            <button onClick={() => setMobileMenuOpen(true)} className="text-[color:var(--text-secondary)] hover:text-white">
              <Menu size={24} />
            </button>
            <div className="font-display truncate text-2xl text-[color:var(--text-primary)] max-w-[160px]">
              {tenant?.name || '...'}
            </div>
          </div>

          <div className="hidden md:flex md:items-center md:gap-6">
            <div>
              <div className="section-kicker mb-1">Painel</div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-secondary)]">
                <span>{currentSectionLabel[activeView]}</span>
                <ChevronRight size={14} className="text-[color:var(--text-faint)]" />
                <span className="text-[color:var(--text-primary)]">{tenant?.name || 'Operação'}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]">
                <UserRound size={18} />
              </div>
              <div className="text-right">
                  <p className="text-sm font-semibold text-[color:var(--text-primary)]">{profile?.full_name || 'Usuário'}</p>
                  <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">
                    {userRole === 'admin' ? 'Administrador' : userRole || '---'}
                  </p>
              </div>
            </div>
          </div>

          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-[color:var(--accent-brass)] md:hidden">
             <UserRound size={16} />
          </div>
        </header>

        <main className="custom-scrollbar relative flex-1 overflow-y-auto">
          <div className="app-noise absolute inset-0"></div>
          <div className="relative mx-auto w-full max-w-[1680px] px-4 py-6 md:px-8 md:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.LOGIN);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [targetUserId, setTargetUserId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [appError, setAppError] = useState<string | null>(null);

  if (!isSupabaseConfigured()) {
      return <SetupWizard />;
  }

  const loadAppData = async (sessionUser: any) => {
    const supabase = getSupabase();
    if (!supabase) {
        setAppError("Conexão com banco de dados indisponível.");
        setIsLoading(false);
        return;
    }

    try {
        const { data: dbData, error } = await supabase
            .from('profiles')
            // FIX: Explicit relationship hint to resolve ambiguity between 'profiles' and 'tenants'
            .select(`*, tenants!profiles_tenant_id_fkey (*)`)
            .eq('id', sessionUser.id)
            .maybeSingle();

        if (error) throw error;

        if (dbData && dbData.tenants) {
            setProfile(dbData);
            setTenant(dbData.tenants as unknown as Tenant);
        } else {
            const meta = sessionUser.user_metadata || {};
            setProfile({
                id: sessionUser.id,
                email: sessionUser.email,
                full_name: meta.full_name || 'Novo Usuário',
                role: (meta.role as UserRole) || 'investor',
                tenant_id: meta.tenant_id || '00000000-0000-0000-0000-000000000000',
                updated_at: new Date().toISOString()
            });
            setTenant({
                id: meta.tenant_id || '00000000-0000-0000-0000-000000000000',
                name: meta.company_name || 'Organização',
                slug: 'org',
                created_at: new Date().toISOString()
            });
        }
        setIsLoading(false);
        setCurrentView(AppView.DASHBOARD);
    } catch (e: any) {
        logError("LoadAppData", e);
        setAppError(`Erro ao carregar seu perfil: ${e.message}`);
        setIsLoading(false);
    }
  };

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
        setIsLoading(false);
        return;
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (error) logError("GetSession", error);
        if (session) {
            loadAppData(session.user);
        } else {
            setIsLoading(false);
            setCurrentView(AppView.LOGIN);
        }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            setCurrentView(AppView.RESET_PASSWORD);
            setIsLoading(false);
        } else if (event === 'SIGNED_IN' && session) {
            loadAppData(session.user);
        } else if (event === 'SIGNED_OUT') {
            setProfile(null);
            setTenant(null);
            setCurrentView(AppView.LOGIN);
            setIsLoading(false);
        }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
  };

  if (appError) {
      return (
          <div className="flex h-screen items-center justify-center p-8 text-center">
              <div className="panel-card max-w-md rounded-[2rem] p-10">
                  <AlertCircle size={56} className="mx-auto mb-6 text-[color:var(--accent-danger)]" />
                  <p className="section-kicker mb-2">Inicialização</p>
                  <h1 className="font-display mb-4 text-4xl text-[color:var(--text-primary)]">Falha ao abrir a operação</h1>
                  <p className="mb-8 text-sm leading-relaxed text-[color:var(--text-secondary)]">{appError}</p>
                  <button onClick={() => window.location.reload()} className="rounded-full border border-[color:var(--border-strong)] bg-white/[0.04] px-8 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-primary)] transition-all hover:bg-white/[0.08]">
                      Tentar Novamente
                  </button>
              </div>
          </div>
      );
  }
  
  if (currentView === AppView.RESET_PASSWORD) {
    return (
      <div className="min-h-screen text-[color:var(--text-primary)]">
        <ResetPassword onResetSuccess={() => {
            setIsLoading(true);
            getSupabase()!.auth.getSession().then(({ data: { session } }) => {
                if (session) {
                    loadAppData(session.user);
                } else {
                    setCurrentView(AppView.LOGIN);
                    setIsLoading(false);
                }
            });
        }} />
      </div>
    );
  }

  if (currentView === AppView.LOGIN) {
    return (
      <div className="min-h-screen text-[color:var(--text-primary)]">
        <Login onLoginSuccess={() => setIsLoading(true)} />
      </div>
    );
  }

  if (isLoading) {
      return (
        <div className="flex h-screen flex-col items-center justify-center text-[color:var(--accent-brass)]">
            <Loader2 className="mb-4 animate-spin" size={40} />
            <p className="section-kicker animate-pulse text-[color:var(--text-secondary)]">Preparando operação</p>
        </div>
      );
  }

  return (
    <Router>
        <Layout 
          activeView={currentView} 
          onChangeView={(view) => {
              if (view !== AppView.DASHBOARD && view !== AppView.USER_DETAILS) setTargetUserId(undefined);
              setCurrentView(view);
          }}
          onLogout={handleLogout}
          userRole={profile?.role}
          tenant={tenant}
          profile={profile}
        >
          {currentView === AppView.DASHBOARD && (
            <Dashboard 
                targetUserId={targetUserId} 
                userRole={profile?.role}
                tenant={tenant}
                onBack={targetUserId ? () => { setTargetUserId(undefined); setCurrentView(AppView.USERS); } : undefined}
            />
          )}
          {currentView === AppView.USERS && profile?.role === 'admin' && (
              <AdminUsers onViewDashboard={(uid) => { setTargetUserId(uid); setCurrentView(AppView.USER_DETAILS); }} />
          )}
          {currentView === AppView.USER_DETAILS && profile?.role === 'admin' && targetUserId && (
              <AdminUserDetails userId={targetUserId} onBack={() => { setTargetUserId(undefined); setCurrentView(AppView.USERS); }} />
          )}
          {currentView === AppView.CONTRACTS && profile?.role === 'admin' && (
              <AdminContracts />
          )}
          {currentView === AppView.SETTINGS && profile?.role === 'admin' && tenant && (
              <AdminSettings tenant={tenant} onUpdate={(updated) => setTenant(updated)} />
          )}
          {currentView === AppView.ASSISTANT && profile?.role === 'admin' && tenant && profile && (
              <AdminAssistant tenant={tenant} profile={profile} />
          )}
        </Layout>
    </Router>
  );
};

export default App;
