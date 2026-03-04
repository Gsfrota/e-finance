
import React, { useState, useEffect } from 'react';
import { HashRouter as Router } from 'react-router-dom'; 
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminUsers from './components/AdminUsers';
import AdminContracts from './components/AdminContracts';
import AdminSettings from './components/AdminSettings';
import AdminUserDetails from './components/AdminUserDetails';
import SetupWizard from './components/SetupWizard';
import ResetPassword from './components/ResetPassword';
import { AppView, UserRole, Tenant, Profile } from './types';
import { getSupabase, isProduction, isSupabaseConfigured, logError } from './services/supabase';
import { LayoutDashboard, LogOut, User, Users, FileText, Building2, ShieldCheck, Loader2, AlertCircle, Menu, X } from 'lucide-react';

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

  const handleViewChange = (view: AppView) => {
    onChangeView(view);
    setMobileMenuOpen(false); // Fecha menu ao clicar
  };

  const NavContent = () => (
    <>
      <div className="p-8 border-b border-slate-700">
        <div className="flex items-center gap-3">
            {tenant?.logo_url ? (
                <img src={tenant.logo_url} alt="Logo" className="w-8 h-8 rounded object-cover" />
            ) : (
                <div className="w-8 h-8 bg-teal-600 rounded flex items-center justify-center font-bold text-white shrink-0">
                    {tenant?.name?.charAt(0) || <ShieldCheck size={14} />}
                </div>
            )}
            <div className="min-w-0">
                <h2 className="text-lg font-black tracking-tighter text-white truncate uppercase leading-tight">
                  {tenant?.name || 'Enterprise'}
                </h2>
                <p className="text-[8px] text-slate-500 uppercase tracking-[0.2em] font-black">
                  {isProduction() ? 'Secure Production' : 'Development Env'}
                </p>
            </div>
        </div>
      </div>
      
      <nav className="flex-1 p-6 space-y-2 overflow-y-auto">
        <button 
          onClick={() => handleViewChange(AppView.DASHBOARD)}
          className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 ${activeView === AppView.DASHBOARD ? 'bg-teal-600 text-white shadow-lg shadow-teal-900/30 font-bold translate-x-1' : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'}`}
        >
          <LayoutDashboard size={20} />
          <span className="text-sm">Dashboard</span>
        </button>

        {userRole === 'admin' && (
            <>
                <button 
                onClick={() => handleViewChange(AppView.USERS)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 ${(activeView === AppView.USERS || activeView === AppView.USER_DETAILS) ? 'bg-teal-600 text-white shadow-lg shadow-teal-900/30 font-bold translate-x-1' : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'}`}
                >
                <Users size={20} />
                <span className="text-sm">Usuários</span>
                </button>

                <button 
                onClick={() => handleViewChange(AppView.CONTRACTS)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 ${activeView === AppView.CONTRACTS ? 'bg-teal-600 text-white shadow-lg shadow-teal-900/30 font-bold translate-x-1' : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'}`}
                >
                <FileText size={20} />
                <span className="text-sm">Contratos</span>
                </button>

                <button 
                onClick={() => handleViewChange(AppView.SETTINGS)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 ${activeView === AppView.SETTINGS ? 'bg-teal-600 text-white shadow-lg shadow-teal-900/30 font-bold translate-x-1' : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'}`}
                >
                <Building2 size={20} />
                <span className="text-sm">Ajustes</span>
                </button>
            </>
        )}
      </nav>

      <div className="p-6 border-t border-slate-700">
        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-slate-500 hover:bg-red-900/10 hover:text-red-400 transition-all font-black text-xs uppercase tracking-widest"
        >
          <LogOut size={18} />
          <span>Sair</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden font-sans">
      
      {/* DESKTOP SIDEBAR */}
      <aside className="w-64 bg-slate-800 border-r border-slate-700 hidden md:flex flex-col">
        <NavContent />
      </aside>

      {/* MOBILE SIDEBAR (Overlay) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}></div>
          <aside className="relative w-4/5 max-w-xs bg-slate-800 h-full shadow-2xl flex flex-col animate-fade-in-right">
             <button onClick={() => setMobileMenuOpen(false)} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white">
                <X size={24} />
             </button>
             <NavContent />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* HEADER */}
        <header className="h-16 md:h-20 bg-slate-900/50 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-4 md:px-8 shadow-xl z-20">
          
          {/* Mobile Menu Button & Logo */}
          <div className="flex items-center gap-4 md:hidden">
            <button onClick={() => setMobileMenuOpen(true)} className="text-slate-300 hover:text-white">
              <Menu size={24} />
            </button>
            <div className="font-black text-teal-400 tracking-tighter text-xl uppercase truncate max-w-[150px]">
              {tenant?.name || '...'}
            </div>
          </div>

          <div className="hidden md:flex flex-1 justify-end items-center gap-6">
            <div className="text-right">
                <p className="text-xs font-bold text-white">{profile?.full_name || 'Usuário'}</p>
                <p className="text-[9px] text-slate-500 uppercase tracking-widest">
                  {userRole === 'admin' ? 'Administrador' : userRole || '---'}
                </p>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-teal-500 shadow-xl">
              <User size={20} />
            </div>
          </div>

          {/* Mobile Profile Icon */}
          <div className="md:hidden w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-teal-500">
             <User size={16} />
          </div>

        </header>

        {/* MAIN CONTENT */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-950/40 custom-scrollbar">
          {children}
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
          <div className="h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-center">
              <div className="bg-red-900/20 border border-red-900/50 p-10 rounded-[3rem] max-w-md shadow-2xl">
                  <AlertCircle size={64} className="text-red-500 mx-auto mb-6" />
                  <h1 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter">Erro de Inicialização</h1>
                  <p className="text-slate-400 text-sm mb-8 leading-relaxed">{appError}</p>
                  <button onClick={() => window.location.reload()} className="bg-slate-800 hover:bg-slate-700 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all">
                      Tentar Novamente
                  </button>
              </div>
          </div>
      );
  }
  
  if (currentView === AppView.RESET_PASSWORD) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-200">
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
      <div className="min-h-screen bg-slate-900 text-slate-200">
        <Login onLoginSuccess={() => setIsLoading(true)} />
      </div>
    );
  }

  if (isLoading) {
      return (
        <div className="h-screen bg-slate-900 flex flex-col items-center justify-center text-teal-500">
            <Loader2 className="animate-spin mb-4" size={40} />
            <p className="text-white font-bold animate-pulse text-xs tracking-widest uppercase">Protegendo Sessão...</p>
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
        </Layout>
    </Router>
  );
};

export default App;
