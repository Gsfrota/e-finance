
import React, { useState, useEffect, useRef } from 'react';
import { HashRouter as Router } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminUsers from './components/AdminUsers';
import AdminContracts from './components/AdminContracts';
import AdminSettings from './components/AdminSettings';
import AdminAssistant from './components/AdminAssistant';
import AdminHome from './components/AdminHome';
import OnboardingWizard from './components/OnboardingWizard';
import { AssistantPaywall } from './components/SubscriptionTab';
import AdminUserDetails from './components/AdminUserDetails';
import ResetPassword from './components/ResetPassword';
import DailyCollectionView from './components/DailyCollectionView';
import LegacyContractPage from './components/LegacyContractPage';
import TopClientes from './components/TopClientes';
import { AppView, UserRole, Tenant, Profile } from './types';
import { clearAllCache } from './services/cache';
import { fetchProfileByAuthUserId, getSupabase, isProduction, logError } from './services/supabase';
import {
  LayoutDashboard,
  Home,
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
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Sun,
  Moon,
  Clock,
  PhoneCall,
  Trophy,
} from 'lucide-react';

const isInTrial = (tenant: Tenant | null | undefined): boolean => {
  if (!tenant?.trial_ends_at) return false;
  return new Date(tenant.trial_ends_at) > new Date();
};

const getTrialDaysLeft = (trial_ends_at: string): number => {
  const diff = new Date(trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
};

const APP_STORAGE_KEYS = ['EF_SIDEBAR_COLLAPSED', 'EF_THEME'] as const;

const clearAppStorageKeys = () => {
  if (typeof window === 'undefined') return;
  APP_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
};

// ─── Layout ────────────────────────────────────────────────────────────────────
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const stored = localStorage.getItem('EF_SIDEBAR_COLLAPSED');
    return stored === null ? true : stored === 'true';
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('EF_THEME') as 'dark' | 'light') || 'light';
  });

  const toggleSidebar = () => {
    setSidebarCollapsed(v => {
      const next = !v;
      localStorage.setItem('EF_SIDEBAR_COLLAPSED', String(next));
      return next;
    });
  };

  const toggleTheme = () => {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('EF_THEME', next);
      document.documentElement.setAttribute('data-theme', next);
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const currentSectionLabel: Record<AppView, string> = {
    [AppView.LOGIN]: 'Acesso',
    [AppView.HOME]: 'Início',
    [AppView.DASHBOARD]: 'Visão Executiva',
    [AppView.USERS]: 'Relacionamentos',
    [AppView.USER_DETAILS]: 'Dossiê do Cliente',
    [AppView.CONTRACTS]: 'Contratos',
    [AppView.SETTINGS]: 'Configurações',
    [AppView.ASSISTANT]: 'Assistente',
    [AppView.COLLECTION]: 'Cobranças',
    [AppView.LEGACY_CONTRACT]: 'Contrato Antigo',
    [AppView.TOP_CLIENTES]: 'Top Clientes',
    [AppView.RESET_PASSWORD]: 'Segurança',
  };

  const handleViewChange = (view: AppView) => {
    onChangeView(view);
    setMobileMenuOpen(false);
  };

  const NavContent = ({ collapsed = false, showCollapseToggle = true }: { collapsed?: boolean; showCollapseToggle?: boolean }) => {
    const btnBase = `flex w-full items-center rounded-2xl py-3 transition-all`;
    const btnExpanded = `gap-3 px-4 text-left`;
    const btnCollapsed = `justify-center px-3`;
    const activeClass = `bg-[rgba(202,176,122,0.12)] text-[color:var(--text-primary)] ring-1 ring-[rgba(202,176,122,0.2)]`;
    const inactiveClass = `text-[color:var(--text-muted)] hover:bg-white/[0.03] hover:text-[color:var(--text-primary)]`;

    return (
      <>
        {/* Cabeçalho */}
        <div className={`border-b soft-divider ${collapsed ? 'flex justify-center px-4 py-5' : 'px-7 py-7'}`}>
          {collapsed ? (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.16)] overflow-hidden">
              {tenant?.logo_url
                ? <img src={tenant.logo_url} alt="Logo" className="h-full w-full rounded-2xl object-cover" />
                : (tenant?.name?.charAt(0)?.toUpperCase() || <ShieldCheck size={16} />)}
            </div>
          ) : (
            <div className="flex items-center gap-4">
              {tenant?.logo_url ? (
                <img src={tenant.logo_url} alt="Logo" className="h-11 w-11 rounded-2xl object-cover ring-1 ring-white/10" />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] ring-1 ring-[rgba(202,176,122,0.16)]">
                  {tenant?.name?.charAt(0)?.toUpperCase() || <ShieldCheck size={16} />}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold truncate text-[color:var(--text-primary)]">
                  {tenant?.name || 'Workspace'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[0.72rem] font-medium text-[color:var(--text-muted)]">
                    {userRole === 'admin' ? 'Administrador' : userRole === 'investor' ? 'Investidor' : userRole === 'debtor' ? 'Devedor' : 'Workspace'}
                  </p>
                  {isProduction() && (
                    <span className="chip chip-active" style={{ fontSize: '0.55rem', padding: '0.15rem 0.5rem' }}>● LIVE</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navegação */}
        <nav className={`flex-1 space-y-1 overflow-y-auto py-5 ${collapsed ? 'px-3' : 'px-5'}`}>
          <button
            onClick={() => handleViewChange(AppView.HOME)}
            title={collapsed ? 'Início' : undefined}
            className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${activeView === AppView.HOME ? activeClass : inactiveClass}`}
          >
            <Home size={20} className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Início</div>
                <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Painel de entrada</div>
              </div>
            )}
          </button>

          <button
            onClick={() => handleViewChange(AppView.DASHBOARD)}
            title={collapsed ? 'Dashboard' : undefined}
            className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${activeView === AppView.DASHBOARD ? activeClass : inactiveClass}`}
          >
            <LayoutDashboard size={20} className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Dashboard</div>
                <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Leitura financeira</div>
              </div>
            )}
          </button>

          {userRole === 'admin' && (
            <>
              <button
                onClick={() => handleViewChange(AppView.USERS)}
                title={collapsed ? 'Usuários' : undefined}
                className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${(activeView === AppView.USERS || activeView === AppView.USER_DETAILS) ? activeClass : inactiveClass}`}
              >
                <Users size={20} className="shrink-0" />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Usuários</div>
                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Relacionamentos</div>
                  </div>
                )}
              </button>

              <button
                onClick={() => handleViewChange(AppView.CONTRACTS)}
                title={collapsed ? 'Contratos' : undefined}
                className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${activeView === AppView.CONTRACTS ? activeClass : inactiveClass}`}
              >
                <BriefcaseBusiness size={20} className="shrink-0" />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Contratos</div>
                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Crédito e prazos</div>
                  </div>
                )}
              </button>

              <button
                onClick={() => handleViewChange(AppView.COLLECTION)}
                title={collapsed ? 'Cobranças' : undefined}
                className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${activeView === AppView.COLLECTION ? activeClass : inactiveClass}`}
              >
                <PhoneCall size={20} className="shrink-0" />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Cobranças</div>
                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Agenda do dia</div>
                  </div>
                )}
              </button>

              <button
                onClick={() => handleViewChange(AppView.TOP_CLIENTES)}
                title={collapsed ? 'Top Clientes' : undefined}
                className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${activeView === AppView.TOP_CLIENTES ? activeClass : inactiveClass}`}
              >
                <Trophy size={20} className="shrink-0" />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Top Clientes</div>
                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Ranking de pagadores</div>
                  </div>
                )}
              </button>

              <button
                onClick={() => handleViewChange(AppView.ASSISTANT)}
                title={collapsed ? 'Assistente' : undefined}
                className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${activeView === AppView.ASSISTANT ? activeClass : inactiveClass}`}
              >
                <Bot size={20} className="shrink-0" />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Assistente</div>
                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Automações e conexões</div>
                  </div>
                )}
              </button>

              <button
                onClick={() => handleViewChange(AppView.SETTINGS)}
                title={collapsed ? 'Ajustes' : undefined}
                className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${activeView === AppView.SETTINGS ? activeClass : inactiveClass}`}
              >
                <Building2 size={20} className="shrink-0" />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Ajustes</div>
                    <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Empresa e financeiro</div>
                  </div>
                )}
              </button>
            </>
          )}
        </nav>

        {/* Rodapé */}
        <div className={`border-t soft-divider space-y-1 ${collapsed ? 'p-3' : 'p-5'}`}>
          {/* Alternador de tema */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            className={`${btnBase} ${collapsed ? btnCollapsed : 'gap-3 px-4'} text-[color:var(--text-muted)] hover:bg-white/[0.04] hover:text-[color:var(--text-primary)]`}
          >
            {theme === 'dark'
              ? <Sun size={18} className="text-[color:var(--accent-brass)] shrink-0" />
              : <Moon size={18} className="shrink-0" />}
            {!collapsed && (
              <span className="text-xs font-bold uppercase tracking-widest">
                {theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
              </span>
            )}
          </button>

          {/* Recolher sidebar */}
          {showCollapseToggle && (
            <button
              onClick={toggleSidebar}
              title={collapsed ? 'Expandir menu' : 'Recolher menu'}
              className={`${btnBase} ${collapsed ? btnCollapsed : 'gap-3 px-4'} text-[color:var(--text-muted)] hover:bg-white/[0.04] hover:text-[color:var(--text-primary)]`}
            >
              {collapsed
                ? <ChevronsRight size={18} className="shrink-0" />
                : <><ChevronsLeft size={18} className="shrink-0" /><span className="text-xs font-bold uppercase tracking-widest">Recolher</span></>}
            </button>
          )}

          {/* Banner de trial */}
          {tenant && isInTrial(tenant) && (
            collapsed ? (
              <button
                onClick={() => handleViewChange(AppView.SETTINGS)}
                title={`${getTrialDaysLeft(tenant.trial_ends_at!)}d de trial`}
                className={`${btnBase} ${btnCollapsed} text-[color:var(--accent-premium)] hover:bg-[color:var(--accent-premium-bg)]`}
              >
                <Clock size={18} className="shrink-0" />
              </button>
            ) : (
              <button
                onClick={() => handleViewChange(AppView.SETTINGS)}
                className="w-full rounded-2xl bg-[color:var(--accent-premium-bg)] border border-[color:var(--accent-premium-border)] px-4 py-3 text-left transition-all hover:bg-[color:var(--accent-premium-bg-strong)]"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={14} className="text-[color:var(--accent-premium)] shrink-0" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-[color:var(--accent-premium)]">
                    {getTrialDaysLeft(tenant.trial_ends_at!)} dias de trial
                  </span>
                </div>
                <p className="text-[10px] text-[color:var(--accent-premium-faint)] leading-relaxed">Período gratuito. Clique para assinar.</p>
              </button>
            )
          )}

          {/* Sair */}
          <button
            onClick={onLogout}
            title={collapsed ? 'Encerrar sessão' : undefined}
            className={`${btnBase} ${collapsed ? btnCollapsed : 'gap-3 px-4'} text-[color:var(--text-muted)] hover:bg-[rgba(198,126,105,0.08)] hover:text-[color:var(--accent-danger)]`}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && <span className="text-sm font-semibold">Encerrar sessão</span>}
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="flex min-h-screen bg-transparent text-[color:var(--text-primary)] overflow-x-hidden font-sans">

      <aside className={`glass-border hidden shrink-0 flex-col border-r md:flex transition-all duration-300 ease-in-out ${sidebarCollapsed ? 'w-[72px]' : 'w-[280px]'}`}>
        <NavContent collapsed={sidebarCollapsed} showCollapseToggle />
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}></div>
          <aside className="glass-border relative flex h-full w-[84%] max-w-xs animate-fade-in-right flex-col pb-[env(safe-area-inset-bottom,0px)]">
             <button onClick={() => setMobileMenuOpen(false)} className="absolute right-4 top-4 flex min-h-[44px] min-w-[44px] items-center justify-center text-[color:var(--text-muted)] hover:text-white">
                <X size={22} />
             </button>
             <NavContent collapsed={false} showCollapseToggle={false} />
          </aside>
        </div>
      )}

      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <header className="glass-border z-20 flex h-16 items-center justify-between border-b px-4 md:h-20 md:px-8">

          <div className="flex items-center gap-3 md:hidden">
            <button onClick={() => setMobileMenuOpen(true)} className="flex min-h-[44px] min-w-[44px] items-center justify-center text-[color:var(--text-secondary)] hover:text-white">
              <Menu size={24} />
            </button>
            <div className="font-display truncate text-lg text-[color:var(--text-primary)] max-w-[140px]">
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

        <main className="custom-scrollbar relative flex-1 overflow-y-auto bg-[color:var(--bg-base)]">
          <div className="app-noise pointer-events-none absolute inset-0 z-0"></div>
          <div className="relative z-10 mx-auto w-full max-w-[1680px] px-4 py-6 md:px-8 md:py-8">
            {children}
          </div>
        </main>
      </div>

    </div>
  );
};

// Detecta se estamos voltando de um callback OAuth (PKCE ?code= ou legacy #access_token=)
const isOAuthCallback = () => {
  const params = new URLSearchParams(window.location.search);
  return params.has('code') || window.location.hash.includes('access_token');
};

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.LOGIN);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [targetUserId, setTargetUserId] = useState<string | undefined>(undefined);
  const [contractAutoNew, setContractAutoNew] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState<'init' | 'auth' | 'profile' | 'ready'>(isOAuthCallback() ? 'auth' : 'init');
  const [appError, setAppError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingUser, setOnboardingUser] = useState<any>(null);
  const [wizardMode, setWizardMode] = useState<'full' | 'setup'>('full');
  const profileLoadedRef = useRef(false);

  const resetSessionState = () => {
    profileLoadedRef.current = false;
    setTargetUserId(undefined);
    setContractAutoNew(false);
    setProfile(null);
    setTenant(null);
    setNeedsOnboarding(false);
    setOnboardingUser(null);
    setWizardMode('full');
    setLoadingPhase('init');
    setAppError(null);
    setCurrentView(AppView.LOGIN);
    setIsLoading(false);
  };

  const refreshTenant = async (tenantId: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data } = await supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle();
    if (data) setTenant(data as Tenant);
  };

  const loadAppData = async (sessionUser: any, fromOnboarding = false) => {
    console.log('[LoadAppData] Starting for user:', sessionUser.email);
    setLoadingPhase('profile');
    const supabase = getSupabase();
    if (!supabase) {
        console.error('[LoadAppData] Supabase client not available');
        setAppError("Conexão com banco de dados indisponível.");
        setIsLoading(false);
        return;
    }

    try {
        const { data: dbData, error } = await fetchProfileByAuthUserId<Profile>(
          supabase,
          sessionUser.id,
          `*, tenants!profiles_tenant_id_fkey (*)`
        );

        if (error) throw error;

        console.log('[LoadAppData] Profile query result:', dbData ? 'found' : 'not found');

        if (dbData && dbData.tenants) {
            setProfile(dbData);
            const tenantData = dbData.tenants as unknown as Tenant;
            setTenant(tenantData);

            // Detecta retorno do Stripe Checkout e agenda re-fetch do tenant
            const params = new URLSearchParams(window.location.search);
            if (params.get('checkout') === 'success') {
                window.history.replaceState({}, '', window.location.pathname);
                setTimeout(() => refreshTenant(tenantData.id), 4000);
                setTimeout(() => refreshTenant(tenantData.id), 10000);
            }
        } else if (dbData && !dbData.tenants) {
            // Perfil existe mas tenant não veio no join (estado parcial) — busca tenant direto
            setProfile(dbData);
            const { data: tenantData } = await supabase
                .from('tenants')
                .select('*')
                .eq('id', dbData.tenant_id)
                .maybeSingle();
            if (tenantData) {
                const t = tenantData as Tenant;
                setTenant(t);
            } else {
                // Tenant realmente não existe — onboarding parcial sem tenant
                setWizardMode('full');
                setOnboardingUser(sessionUser);
                setNeedsOnboarding(true);
                setIsLoading(false);
                return;
            }
        } else {
            const isOAuth = sessionUser.app_metadata?.provider !== 'email'
                && sessionUser.app_metadata?.provider != null;
            if (isOAuth) {
                // Usuário OAuth sem perfil — precisa de onboarding completo
                console.log('[LoadAppData] OAuth user without profile, starting onboarding');
                setWizardMode('full');
                setOnboardingUser(sessionUser);
                setNeedsOnboarding(true);
                setIsLoading(false);
                return;
            }
            // Usuário email/senha sem perfil (fluxo legado)
            const meta = sessionUser.user_metadata || {};
            setProfile({
                id: sessionUser.id,
                auth_user_id: sessionUser.id,
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
        profileLoadedRef.current = true;
        setLoadingPhase('ready');
        // Limpa parâmetros de callback da URL
        if (window.location.search.includes('code=')) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        setIsLoading(false);
        setCurrentView(AppView.HOME);
        console.log('[LoadAppData] Complete, redirecting to HOME');
    } catch (e: any) {
        console.error('[LoadAppData] Error:', e);
        logError("LoadAppData", e);
        setAppError(`Erro ao carregar seu perfil: ${e.message}`);
        setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentView !== AppView.CONTRACTS) setContractAutoNew(false);
  }, [currentView]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
        setIsLoading(false);
        return;
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (error) logError("GetSession", error);
        if (session) {
            console.log('[GetSession] Found session, loading app data');
            loadAppData(session.user);
        } else {
            console.log('[GetSession] No session found, showing login');
            setIsLoading(false);
            setCurrentView(AppView.LOGIN);
        }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        console.log('[Auth State Change]', event, session?.user?.email);
        if (event === 'PASSWORD_RECOVERY') {
            setCurrentView(AppView.RESET_PASSWORD);
            setIsLoading(false);
        } else if (event === 'SIGNED_IN' && session) {
            if (profileLoadedRef.current) return;
            console.log('[SIGNED_IN] Loading app data for:', session.user.email);
            setLoadingPhase('auth');
            setIsLoading(true);
            loadAppData(session.user);
        } else if (event === 'SIGNED_OUT') {
            clearAllCache();
            clearAppStorageKeys();
            resetSessionState();
        }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    clearAllCache();
    clearAppStorageKeys();
    resetSessionState();
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

  if (needsOnboarding) {
    return (
      <OnboardingWizard
        sessionUser={onboardingUser}
        tenant={tenant}
        mode={wizardMode}
        onComplete={() => {
          setNeedsOnboarding(false);
          setOnboardingUser(null);
          setIsLoading(true);
          getSupabase()!.auth.getSession().then(({ data: { session } }) => {
            if (session) loadAppData(session.user, true);
            else { setIsLoading(false); setCurrentView(AppView.LOGIN); }
          });
        }}
        onLogout={handleLogout}
      />
    );
  }

  if (isLoading) {
      const phaseMessages: Record<typeof loadingPhase, { label: string; sub: string }> = {
        init: { label: 'Preparando operação', sub: 'Conectando ao servidor...' },
        auth: { label: 'Autenticando', sub: 'Validando suas credenciais...' },
        profile: { label: 'Carregando perfil', sub: 'Buscando seus dados...' },
        ready: { label: 'Quase pronto', sub: 'Montando seu painel...' },
      };
      const phase = phaseMessages[loadingPhase];
      const steps = ['auth', 'profile', 'ready'] as const;
      const currentIdx = steps.indexOf(loadingPhase as any);

      return (
        <div className="flex h-screen flex-col items-center justify-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full bg-[rgba(202,176,122,0.15)] blur-xl animate-pulse" style={{ width: 72, height: 72 }} />
              <div className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[rgba(202,176,122,0.12)] ring-1 ring-[rgba(202,176,122,0.2)]">
                <Loader2 className="animate-spin text-[color:var(--accent-brass)]" size={32} />
              </div>
            </div>
            <h2 className="font-display text-xl text-[color:var(--text-primary)] mb-1">{phase.label}</h2>
            <p className="text-xs text-[color:var(--text-muted)] mb-6">{phase.sub}</p>

            {/* Barra de progresso com steps */}
            {currentIdx >= 0 && (
              <div className="flex items-center gap-2">
                {steps.map((s, i) => (
                  <div
                    key={s}
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      i <= currentIdx
                        ? 'w-8 bg-[color:var(--accent-brass)]'
                        : 'w-4 bg-white/10'
                    }`}
                  />
                ))}
              </div>
            )}
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

  return (
    <Router>
        <Layout
          activeView={currentView}
          onChangeView={(view) => {
              if (view !== AppView.HOME && view !== AppView.DASHBOARD && view !== AppView.COLLECTION && view !== AppView.USER_DETAILS) setTargetUserId(undefined);
              setCurrentView(view);
          }}
          onLogout={handleLogout}
          userRole={profile?.role}
          tenant={tenant}
          profile={profile}
        >
          {currentView === AppView.HOME && profile?.role === 'admin' && (
            <AdminHome
              tenant={tenant}
              profile={profile}
              onNavigate={(view) => {
                if (view !== AppView.DASHBOARD && view !== AppView.USER_DETAILS) setTargetUserId(undefined);
                setCurrentView(view);
              }}
              onNewContract={() => { setContractAutoNew(true); setCurrentView(AppView.CONTRACTS); }}
            />
          )}
          {currentView === AppView.DASHBOARD && (
            <Dashboard
                targetUserId={targetUserId}
                userRole={profile?.role}
                tenant={tenant}
                defaultTab="overview"
                onBack={targetUserId ? () => { setTargetUserId(undefined); setCurrentView(AppView.USERS); } : undefined}
                onNavigate={(view) => {
                    if (view !== AppView.DASHBOARD && view !== AppView.USER_DETAILS) setTargetUserId(undefined);
                    setCurrentView(view);
                }}
            />
          )}
          {currentView === AppView.COLLECTION && profile?.role === 'admin' && (
            <DailyCollectionView tenant={tenant} />
          )}
          {currentView === AppView.TOP_CLIENTES && profile?.role === 'admin' && (
            <TopClientes
              tenant={tenant}
              onNavigate={(view) => setCurrentView(view)}
              onClientClick={(uid) => { setTargetUserId(uid); setCurrentView(AppView.USER_DETAILS); }}
            />
          )}
          {currentView === AppView.USERS && profile?.role === 'admin' && (
              <AdminUsers onViewDashboard={(uid) => { setTargetUserId(uid); setCurrentView(AppView.USER_DETAILS); }} />
          )}
          {currentView === AppView.USER_DETAILS && profile?.role === 'admin' && targetUserId && (
              <AdminUserDetails userId={targetUserId} onBack={() => { setTargetUserId(undefined); setCurrentView(AppView.USERS); }} />
          )}
          {currentView === AppView.CONTRACTS && profile?.role === 'admin' && (
              <AdminContracts autoOpenCreate={contractAutoNew} onNavigate={(view) => setCurrentView(view)} />
          )}
          {currentView === AppView.LEGACY_CONTRACT && profile?.role === 'admin' && (
              <LegacyContractPage
                onBack={() => setCurrentView(AppView.CONTRACTS)}
                onSuccess={() => setCurrentView(AppView.CONTRACTS)}
              />
          )}
          {currentView === AppView.SETTINGS && profile?.role === 'admin' && tenant && (
              <AdminSettings tenant={tenant} onUpdate={(updated) => setTenant(updated)} profile={profile} />
          )}
          {currentView === AppView.ASSISTANT && profile?.role === 'admin' && tenant && profile && (
              (tenant?.plan === 'empresarial' && tenant?.plan_status === 'active') || isInTrial(tenant) ? (
                <AdminAssistant tenant={tenant} profile={profile} />
              ) : (
                <AssistantPaywall tenant={tenant} />
              )
          )}
        </Layout>
    </Router>
  );
};

export default App;
