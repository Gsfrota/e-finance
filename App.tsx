
import React, { useState, useEffect, useRef } from 'react';
import { HashRouter as Router } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminUsers from './components/AdminUsers';
import AdminContracts from './components/AdminContracts';
import AdminAssistant from './components/AdminAssistant';
import AdminHome from './components/AdminHome';
import PlatformOwnerPanel from './components/PlatformOwnerPanel';
import OnboardingWizard from './components/OnboardingWizard';
import { AssistantPaywall } from './components/SubscriptionTab';
import AdminUserDetails from './components/AdminUserDetails';
import ResetPassword from './components/ResetPassword';
import DailyCollectionView from './components/DailyCollectionView';
import CadernetaBullet from './components/dashboard/CadernetaBullet';
import LegacyContractPage from './components/LegacyContractPage';
import TopClientes from './components/TopClientes';
import CompanySwitcher from './components/CompanySwitcher';
import CompanyScopeGate from './components/CompanyScopeGate';
import AdminSettings, { type SettingsSection } from './components/AdminSettings';
import AccessUnavailable from './components/AccessUnavailable';
import { AppView, UserRole, Tenant, Profile, Company, CompanyAccessMode, CompanyScope } from './types';
import { clearAllCache, getCached, setCached } from './services/cache';
import OfflineBanner from './components/OfflineBanner';
import PendingIntentsPanel from './components/PendingIntentsPanel';
import { useOfflineSync } from './hooks/useOfflineSync';
import { fetchProfileByAuthUserId, getSupabase, isProduction, logError } from './services/supabase';
import {
  CompanyContextProvider,
  canUseAggregateScope as canUseAggregateCompanyScope,
  createFallbackCompany,
  FREE_PLAN_BLOCKED_VIEWS,
  getCompanyAccessMode,
  getCompanyScopeStorageKey,
  getOperationLabel,
  getScopeSummary,
  getScopedCompanyId,
  isAggregateCompanyScope,
  isEnterpriseTenant as isEnterprisePlan,
  isFreePlanLocked,
  isRoleBlocked,
  isTrialActive,
} from './services/companyScope';
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
  ChevronsLeft,
  ChevronsRight,
  Lock,
  Sun,
  Moon,
  Clock,
  PhoneCall,
  Trophy,
  Crown,
} from 'lucide-react';

const getTrialDaysLeft = (trial_ends_at: string): number => {
  const diff = new Date(trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
};

const APP_STORAGE_KEYS = ['EF_SIDEBAR_COLLAPSED', 'EF_THEME'] as const;
const COMPANY_SCOPE_STORAGE_PREFIX = 'EF_ACTIVE_COMPANY_SCOPE_';

const clearAppStorageKeys = () => {
  if (typeof window === 'undefined') return;
  APP_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  Object.keys(localStorage)
    .filter((key) => key.startsWith(COMPANY_SCOPE_STORAGE_PREFIX))
    .forEach((key) => localStorage.removeItem(key));
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
  companies?: Company[];
  activeCompany?: Company | null;
  activeCompanyScope?: CompanyScope;
  companyScopeLabel: string;
  companyScopeDescriptorLabel: string;
  isEnterpriseTenant?: boolean;
  companyAccessMode?: CompanyAccessMode | null;
  freePlanLocked?: boolean;
  isPlatformOwnerServer?: boolean;
  onSelectCompanyScope: (scope: CompanyScope) => void;
  onOpenCompanySettings: (section?: SettingsSection) => void;
  onOpenSubscriptionSettings: () => void;
  onOpenContract: (investmentId: number, companyId: string | null) => void;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  activeView,
  onChangeView,
  onLogout,
  userRole,
  tenant,
  profile,
  companies = [],
  activeCompany = null,
  activeCompanyScope = null,
  companyScopeLabel,
  companyScopeDescriptorLabel,
  isEnterpriseTenant = false,
  freePlanLocked = false,
  companyAccessMode = null,
  isPlatformOwnerServer = false,
  onSelectCompanyScope,
  onOpenCompanySettings,
  onOpenSubscriptionSettings,
  onOpenContract,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const stored = localStorage.getItem('EF_SIDEBAR_COLLAPSED');
    return stored === null ? true : stored === 'true';
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('EF_THEME') as 'dark' | 'light') || 'light';
  });
  const offlineSync = useOfflineSync(tenant?.id, userRole === 'admin');

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

  useEffect(() => {
    if (activeView === AppView.CADERNETA_BULLET) {
      mainContentRef.current?.scrollTo({ top: 0, left: 0 });
    }
  }, [activeView]);

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
    [AppView.CADERNETA_BULLET]: 'Caderneta Bullet',
    [AppView.LEGACY_CONTRACT]: 'Contrato Antigo',
    [AppView.TOP_CLIENTES]: 'Top Clientes',
    [AppView.RESET_PASSWORD]: 'Segurança',
    [AppView.PLATFORM_OWNER]: 'Painel da Plataforma',
  };

  const operationLabel = getOperationLabel(tenant, activeCompany, activeCompanyScope);
  const showCompanySwitcher = companies.length > 0 || companyAccessMode === 'upsell_locked';

  const handleViewChange = (view: AppView) => {
    onChangeView(view);
    setMobileMenuOpen(false);
  };

  const NavContent = ({ collapsed = false, showCollapseToggle = true, locked = false }: { collapsed?: boolean; showCollapseToggle?: boolean; locked?: boolean }) => {
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
                    Administrador
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
            className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${locked ? 'opacity-50' : ''} ${activeView === AppView.HOME ? activeClass : inactiveClass}`}
          >
            <Home size={20} className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  Início
                  {locked && <Lock size={11} className="text-[color:var(--text-faint)]" />}
                </div>
                <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Painel de entrada</div>
              </div>
            )}
          </button>

          <button
            onClick={() => handleViewChange(AppView.DASHBOARD)}
            title={collapsed ? 'Dashboard' : undefined}
            className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${locked ? 'opacity-50' : ''} ${activeView === AppView.DASHBOARD ? activeClass : inactiveClass}`}
          >
            <LayoutDashboard size={20} className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  Dashboard
                  {locked && <Lock size={11} className="text-[color:var(--text-faint)]" />}
                </div>
                <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Leitura financeira</div>
              </div>
            )}
          </button>

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
            className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${locked ? 'opacity-50' : ''} ${activeView === AppView.COLLECTION ? activeClass : inactiveClass}`}
          >
            <PhoneCall size={20} className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  Cobranças
                  {locked && <Lock size={11} className="text-[color:var(--text-faint)]" />}
                </div>
                <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Agenda do dia</div>
              </div>
            )}
          </button>

          <button
            onClick={() => handleViewChange(AppView.TOP_CLIENTES)}
            title={collapsed ? 'Top Clientes' : undefined}
            className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${locked ? 'opacity-50' : ''} ${activeView === AppView.TOP_CLIENTES ? activeClass : inactiveClass}`}
          >
            <Trophy size={20} className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  Top Clientes
                  {locked && <Lock size={11} className="text-[color:var(--text-faint)]" />}
                </div>
                <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Ranking de pagadores</div>
              </div>
            )}
          </button>

          <button
            onClick={() => handleViewChange(AppView.ASSISTANT)}
            title={collapsed ? 'Assistente' : undefined}
            className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${locked ? 'opacity-50' : ''} ${activeView === AppView.ASSISTANT ? activeClass : inactiveClass}`}
          >
            <Bot size={20} className="shrink-0" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  Assistente
                  {locked && <Lock size={11} className="text-[color:var(--text-faint)]" />}
                </div>
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

          {isPlatformOwnerServer && (
            <button
              onClick={() => handleViewChange(AppView.PLATFORM_OWNER)}
              title={collapsed ? 'Plataforma' : undefined}
              className={`${btnBase} ${collapsed ? btnCollapsed : btnExpanded} ${activeView === AppView.PLATFORM_OWNER ? activeClass : inactiveClass}`}
            >
              <Crown size={20} className="shrink-0 text-amber-400" />
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">Plataforma</div>
                  <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Painel do proprietário</div>
                </div>
              )}
            </button>
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
          {tenant && isTrialActive(tenant) && (
            collapsed ? (
            <button
                onClick={onOpenSubscriptionSettings}
                title={`${getTrialDaysLeft(tenant.trial_ends_at!)}d de trial`}
                className={`${btnBase} ${btnCollapsed} text-[color:var(--accent-premium)] hover:bg-[color:var(--accent-premium-bg)]`}
              >
                <Clock size={18} className="shrink-0" />
              </button>
            ) : (
              <button
                onClick={onOpenSubscriptionSettings}
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
        <NavContent collapsed={sidebarCollapsed} showCollapseToggle locked={freePlanLocked} />
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}></div>
          <aside className="glass-border relative flex h-full w-[84%] max-w-xs animate-fade-in-right flex-col pb-[env(safe-area-inset-bottom,0px)]">
             <button onClick={() => setMobileMenuOpen(false)} className="absolute right-4 top-4 flex min-h-[44px] min-w-[44px] items-center justify-center text-[color:var(--text-muted)] hover:text-white">
                <X size={22} />
             </button>
             <NavContent collapsed={false} showCollapseToggle={false} locked={freePlanLocked} />
          </aside>
        </div>
      )}

      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <header className="glass-border z-20 flex h-12 shrink-0 items-center justify-between border-b px-4 md:px-8">

          {/* Mobile: hamburger + título */}
          <div className="flex min-w-0 flex-1 items-center gap-3 md:hidden">
            <button onClick={() => setMobileMenuOpen(true)} className="flex h-9 w-9 shrink-0 items-center justify-center text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]">
              <Menu size={22} />
            </button>
            <span className="font-display min-w-0 truncate text-base font-semibold text-[color:var(--text-primary)]">
              {currentSectionLabel[activeView]}
            </span>
          </div>

          {/* Desktop: título à esquerda, controles à direita */}
          <div className="hidden min-w-0 flex-1 items-center justify-between gap-4 md:flex">
            <span className="min-w-0 truncate text-sm font-medium text-[color:var(--text-muted)] select-none">
              {currentSectionLabel[activeView]}
            </span>

            <div className="flex shrink-0 items-center gap-2">
              {showCompanySwitcher && (
                <CompanySwitcher
                  tenantName={tenant?.name ?? null}
                  companies={companies}
                  activeCompanyId={activeCompany?.id ?? null}
                  activeCompanyScope={activeCompanyScope}
                  accessMode={companyAccessMode}
                  scopeDescriptorLabel={companyScopeDescriptorLabel}
                  scopeLabel={companyScopeLabel}
                  onSelectScope={onSelectCompanyScope}
                  onCreateCompany={companyAccessMode === 'enabled' ? () => onOpenCompanySettings('empresas') : undefined}
                  onUpgrade={onOpenSubscriptionSettings}
                />
              )}

              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] border border-[rgba(202,176,122,0.2)] text-xs font-bold select-none"
                title={profile?.full_name || 'Usuário'}
              >
                {profile?.full_name?.charAt(0)?.toUpperCase() || <UserRound size={14} />}
              </div>
            </div>
          </div>

          {/* Mobile: avatar */}
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)] border border-[rgba(202,176,122,0.2)] text-xs font-bold select-none md:hidden"
            title={profile?.full_name || 'Usuário'}
          >
            {profile?.full_name?.charAt(0)?.toUpperCase() || <UserRound size={14} />}
          </div>
        </header>

        <main ref={mainContentRef} data-testid="app-main-scroll" className="custom-scrollbar relative flex-1 overflow-y-auto bg-[color:var(--bg-base)]">
          <div className="app-noise pointer-events-none absolute inset-0 z-0"></div>
          <div className="relative z-10 mx-auto w-full max-w-[1680px] px-4 py-6 md:px-8 md:py-8">
            {/* Fica no shell, não numa tela: sem rede o aviso vale em qualquer
                lugar do app, não só no dashboard. */}
            <div className="mb-4 empty:mb-0">
              <OfflineBanner />
            </div>
            <PendingIntentsPanel
              intents={offlineSync.intents}
              syncing={offlineSync.syncing}
              syncError={offlineSync.error}
              onSync={offlineSync.syncNow}
              onOpenContract={onOpenContract}
            />
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
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompanyScope, setActiveCompanyScope] = useState<CompanyScope>(null);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection | undefined>(undefined);
  const [targetUserId, setTargetUserId] = useState<string | undefined>(undefined);
  const [contractAutoNew, setContractAutoNew] = useState(false);
  const [targetContractId, setTargetContractId] = useState<number | null>(null);
  const [adminDashboardDefaultTab, setAdminDashboardDefaultTab] = useState<'overview' | 'receivables' | 'collection' | 'monthly' | 'yield'>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isPlatformOwnerServer, setIsPlatformOwnerServer] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<'init' | 'auth' | 'profile' | 'ready'>(isOAuthCallback() ? 'auth' : 'init');
  const [appError, setAppError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingUser, setOnboardingUser] = useState<any>(null);
  const [wizardMode, setWizardMode] = useState<'full' | 'setup'>('full');
  const profileLoadedRef = useRef(false);

  const isTrialTenant = isTrialActive(tenant);
  const companyAccessMode = getCompanyAccessMode(tenant, profile);
  const canAggregateCompanies = canUseAggregateCompanyScope(tenant, profile);
  const activeCompanyId = getScopedCompanyId(activeCompanyScope);
  const activeCompany =
    companies.find((company) => company.id === activeCompanyId)
    ?? companies.find((company) => company.is_primary)
    ?? companies[0]
    ?? null;
  const companyScopeSummary = getScopeSummary(tenant, activeCompany, activeCompanyScope);
  const companyScopeLabel = companyScopeSummary.value;

  const hydrateCompanyScope = (
    nextTenant: Tenant | null,
    nextProfile: Profile | null,
    availableCompanies: Company[]
  ): CompanyScope => {
    if (!nextTenant || !nextProfile) return null;

    const storageKey = getCompanyScopeStorageKey(nextTenant.id);
    const storedScope = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
    const validStoredScope =
      storedScope === 'all' || availableCompanies.some((company) => company.id === storedScope)
        ? storedScope
        : null;
    const primaryCompanyId =
      availableCompanies.find((company) => company.is_primary)?.id
      ?? nextProfile.company_id
      ?? availableCompanies[0]?.id
      ?? null;

    if (canUseAggregateCompanyScope(nextTenant, nextProfile)) {
      // Com apenas 1 empresa, modo agregado e empresa específica são equivalentes.
      // Preferir a empresa diretamente evita que views operacionais fiquem sem activeCompanyId.
      if (availableCompanies.length <= 1) return primaryCompanyId;
      return validStoredScope ?? 'all';
    }

    return primaryCompanyId;
  };

  const refreshCompanies = async (nextTenant = tenant, nextProfile = profile) => {
    if (!nextTenant || !nextProfile) {
      setCompanies([]);
      setActiveCompanyScope(null);
      return;
    }

    if (nextProfile.role !== 'admin') {
      setCompanies([]);
      setActiveCompanyScope(nextProfile.company_id ?? null);
      return;
    }

    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('tenant_id', nextTenant.id)
        .order('is_primary', { ascending: false })
        .order('name', { ascending: true });

      if (error) throw error;

      const availableCompanies = (data as Company[] | null)?.length
        ? (data as Company[])
        : [createFallbackCompany(nextTenant)];

      setCompanies(availableCompanies);
      setActiveCompanyScope(hydrateCompanyScope(nextTenant, nextProfile, availableCompanies));
    } catch (error) {
      logError('RefreshCompanies', error);
      const fallbackCompanies = [createFallbackCompany(nextTenant)];
      setCompanies(fallbackCompanies);
      setActiveCompanyScope(hydrateCompanyScope(nextTenant, nextProfile, fallbackCompanies));
    }
  };

  const resetSessionState = () => {
    profileLoadedRef.current = false;
    setTargetUserId(undefined);
    setContractAutoNew(false);
    setProfile(null);
    setTenant(null);
    setCompanies([]);
    setActiveCompanyScope(null);
    setSettingsInitialSection(undefined);
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
    if (data) {
      const nextTenant = data as Tenant;
      setTenant(nextTenant);
      await refreshCompanies(nextTenant, profile);
    }
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
            // Guarda o bootstrap para o app conseguir abrir sem rede depois.
            setCached(`bootstrap_${sessionUser.id}`, { profile: dbData, tenant: tenantData });
            await refreshCompanies(tenantData, dbData);

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
                await refreshCompanies(t, dbData);
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
                // Default 'investor' quando meta.role falta: cai no gate isRoleBlocked
                // (services/companyScope.ts) e mostra AccessUnavailable — nega por padrão,
                // não concede acesso de admin por engano.
                role: (meta.role as UserRole) || 'investor',
                tenant_id: meta.tenant_id || '00000000-0000-0000-0000-000000000000',
                company_id: meta.company_id || null,
                updated_at: new Date().toISOString()
            });
            const fallbackTenant = {
                id: meta.tenant_id || '00000000-0000-0000-0000-000000000000',
                name: meta.company_name || 'Organização',
                slug: 'org',
                created_at: new Date().toISOString()
            } as Tenant;
            setTenant(fallbackTenant);
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

        // Sem rede, o app não pode morrer na inicialização só porque não
        // alcançou o servidor. Se este aparelho já abriu a operação antes,
        // segue com o último perfil conhecido — é disso que depende a leitura
        // da carteira em campo. `refreshCompanies` já tem fallback próprio.
        const cached = getCached<{ profile: Profile; tenant: Tenant }>(`bootstrap_${sessionUser.id}`);
        if (cached && typeof navigator !== 'undefined' && navigator.onLine === false) {
            console.log('[LoadAppData] Offline — retomando com o perfil em cache');
            setProfile(cached.data.profile);
            setTenant(cached.data.tenant);
            await refreshCompanies(cached.data.tenant, cached.data.profile);
            setIsLoading(false);
            setCurrentView(AppView.HOME);
            return;
        }

        setAppError(`Erro ao carregar seu perfil: ${e.message}`);
        setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentView !== AppView.CONTRACTS) setContractAutoNew(false);
  }, [currentView]);

  useEffect(() => {
    if (currentView !== AppView.SETTINGS && settingsInitialSection) {
      setSettingsInitialSection(undefined);
    }
  }, [currentView, settingsInitialSection]);

  useEffect(() => {
    if (!tenant?.id || !activeCompanyScope) return;
    localStorage.setItem(getCompanyScopeStorageKey(tenant.id), activeCompanyScope);
  }, [tenant?.id, activeCompanyScope]);

  useEffect(() => {
    if (!profile) { setIsPlatformOwnerServer(false); return; }
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.rpc('is_platform_owner').then(({ data }) => {
      setIsPlatformOwnerServer(data === true);
    });
  }, [profile?.id]);

  const handleCompanyScopeChange = (scope: CompanyScope) => {
    const primaryCompanyId = companies.find((company) => company.is_primary)?.id ?? companies[0]?.id ?? profile?.company_id ?? null;
    const nextScope = companyAccessMode === 'enabled' ? scope : primaryCompanyId;

    setActiveCompanyScope(nextScope);
    clearAllCache();

    if (
      nextScope === 'all'
      && (currentView === AppView.USERS
        || currentView === AppView.USER_DETAILS
        || currentView === AppView.CONTRACTS
        || currentView === AppView.LEGACY_CONTRACT)
    ) {
      setTargetUserId(undefined);
      setCurrentView(AppView.HOME);
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
        if (session?.user && !profileLoadedRef.current) {
            console.log('[GetSession] Found session, loading app data');
            loadAppData(session.user);
        } else if (!session) {
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

  // Free plan paywall redirect — must be before early returns to respect Rules of Hooks
  const isFreeLocked = isFreePlanLocked(tenant) && profile?.role === 'admin';
  useEffect(() => {
    if (isFreeLocked && FREE_PLAN_BLOCKED_VIEWS.has(currentView)) {
      setSettingsInitialSection('assinatura');
      setCurrentView(AppView.SETTINGS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFreeLocked, currentView]);

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

  const companyContextValue = {
    tenant,
    profile,
    companies,
    activeCompanyScope,
    activeCompanyId,
    activeCompany,
    isEnterpriseTenant: isEnterprisePlan(tenant),
    isTrialActive: isTrialTenant,
    isFreePlanLocked: isFreeLocked,
    isPlatformOwnerServer,
    companyAccessMode,
    canManageMultipleCompanies: canAggregateCompanies,
    canUseAggregateScope: canAggregateCompanies,
    setActiveCompanyScope,
    refreshCompanies: () => refreshCompanies(),
  };

  const openSettingsSection = (section?: SettingsSection) => {
    setSettingsInitialSection(section);
    setCurrentView(AppView.SETTINGS);
  };

  const requiresCompanySelection =
    profile?.role === 'admin' &&
    canAggregateCompanies &&
    isAggregateCompanyScope(activeCompanyScope);

  const companyGate = (title: string, description: string) => (
    <CompanyScopeGate
      title={title}
      description={description}
      onSelectCompany={() => {
        const firstCompanyId = companies.find((company) => company.is_primary)?.id ?? companies[0]?.id;
        if (firstCompanyId) {
          handleCompanyScopeChange(firstCompanyId);
          return;
        }
        setCurrentView(AppView.HOME);
      }}
      onManageCompanies={() => openSettingsSection(companyAccessMode === 'enabled' ? 'empresas' : 'assinatura')}
    />
  );

  // Gate de role: a aplicação é exclusiva de admin. Perfis investor/debtor foram
  // descontinuados. Vem ANTES do Layout para que não-admin nunca monte a sidebar
  // nem alcance AppView.DASHBOARD (que faz fall-through para AdminDashboardView).
  if (isRoleBlocked(profile)) {
    return <AccessUnavailable onLogout={handleLogout} />;
  }

  return (
    <Router>
      <CompanyContextProvider value={companyContextValue}>
        <Layout
          activeView={currentView}
          onChangeView={(view) => {
              if (isFreeLocked && FREE_PLAN_BLOCKED_VIEWS.has(view)) {
                openSettingsSection('assinatura');
                return;
              }
              if (view !== AppView.HOME && view !== AppView.DASHBOARD && view !== AppView.COLLECTION && view !== AppView.USER_DETAILS) setTargetUserId(undefined);
              setCurrentView(view);
          }}
          onLogout={handleLogout}
          userRole={profile?.role}
          tenant={tenant}
          profile={profile}
          companies={companies}
          activeCompany={activeCompany}
          activeCompanyScope={activeCompanyScope}
          companyScopeLabel={companyScopeLabel}
          companyScopeDescriptorLabel={companyScopeSummary.label}
          isEnterpriseTenant={isEnterprisePlan(tenant)}
          freePlanLocked={isFreeLocked}
          companyAccessMode={companyAccessMode}
          isPlatformOwnerServer={isPlatformOwnerServer}
          onSelectCompanyScope={handleCompanyScopeChange}
          onOpenCompanySettings={openSettingsSection}
          onOpenSubscriptionSettings={() => openSettingsSection('assinatura')}
          onOpenContract={(investmentId, companyId) => {
            if (companyId) setActiveCompanyScope(companyId);
            setTargetContractId(investmentId);
            setContractAutoNew(false);
            setCurrentView(AppView.CONTRACTS);
          }}
        >
          {currentView === AppView.HOME && profile?.role === 'admin' && !isFreeLocked && (
            <AdminHome
              tenant={tenant}
              profile={profile}
              onNavigate={(view) => {
                if (view !== AppView.DASHBOARD && view !== AppView.USER_DETAILS) setTargetUserId(undefined);
                if (view === AppView.DASHBOARD) setAdminDashboardDefaultTab('overview');
                setCurrentView(view);
              }}
              onNewContract={() => { setContractAutoNew(true); setCurrentView(AppView.CONTRACTS); }}
              onNavigateDashboardMonthly={() => { setAdminDashboardDefaultTab('monthly'); setCurrentView(AppView.DASHBOARD); }}
              onNavigateDashboardYield={() => { setAdminDashboardDefaultTab('yield'); setCurrentView(AppView.DASHBOARD); }}
            />
          )}
          {currentView === AppView.DASHBOARD && !(isFreeLocked && profile?.role === 'admin') && (
            <Dashboard
                tenant={tenant}
                defaultTab={adminDashboardDefaultTab}
                onNavigate={(view) => {
                    if (view !== AppView.DASHBOARD && view !== AppView.USER_DETAILS) setTargetUserId(undefined);
                    setCurrentView(view);
                }}
            />
          )}
          {currentView === AppView.COLLECTION && profile?.role === 'admin' && !isFreeLocked && (
            <DailyCollectionView tenant={tenant} />
          )}
          {currentView === AppView.CADERNETA_BULLET && profile?.role === 'admin' && !isFreeLocked && (
            <CadernetaBullet
              tenant={tenant}
              onBack={() => setCurrentView(AppView.HOME)}
            />
          )}
          {currentView === AppView.TOP_CLIENTES && profile?.role === 'admin' && !isFreeLocked && (
            <TopClientes
              tenant={tenant}
              onNavigate={(view) => setCurrentView(view)}
              onClientClick={(uid) => { setTargetUserId(uid); setCurrentView(AppView.USER_DETAILS); }}
            />
          )}
          {currentView === AppView.USERS && profile?.role === 'admin' && (
              requiresCompanySelection
                ? companyGate(
                    'Usuários exigem empresa ativa',
                    'A lista de usuários e convites é operacional e fica isolada por empresa. Escolha uma empresa no topo para continuar.'
                  )
                : <AdminUsers onViewDashboard={(uid) => {
                    if (isFreeLocked) { openSettingsSection('assinatura'); return; }
                    setTargetUserId(uid); setCurrentView(AppView.USER_DETAILS);
                  }} />
          )}
          {currentView === AppView.USER_DETAILS && profile?.role === 'admin' && targetUserId && !isFreeLocked && (
              requiresCompanySelection
                ? companyGate(
                    'Detalhes do cliente exigem empresa ativa',
                    'O dossiê do cliente usa contratos e parcelas isolados por empresa. Escolha uma empresa específica para abrir o detalhe.'
                  )
                : <AdminUserDetails userId={targetUserId} onBack={() => { setTargetUserId(undefined); setCurrentView(AppView.USERS); }} />
          )}
          {currentView === AppView.CONTRACTS && profile?.role === 'admin' && (
              requiresCompanySelection
                ? companyGate(
                    'Contratos exigem empresa ativa',
                    'Criação, edição e leitura operacional de contratos só podem acontecer dentro de uma empresa específica.'
                  )
                : <AdminContracts
                    autoOpenCreate={contractAutoNew}
                    initialContractId={targetContractId}
                    onInitialContractOpened={() => setTargetContractId(null)}
                    onNavigate={(view) => setCurrentView(view)}
                    onPaywallRedirect={isFreeLocked ? () => openSettingsSection('assinatura') : undefined}
                  />
          )}
          {currentView === AppView.LEGACY_CONTRACT && profile?.role === 'admin' && (
              requiresCompanySelection
                ? companyGate(
                    'Importação legada exige empresa ativa',
                    'Contratos legados precisam nascer já vinculados a uma empresa. Escolha uma empresa antes de continuar.'
                  )
                : <LegacyContractPage
                    onBack={() => setCurrentView(AppView.CONTRACTS)}
                    onSuccess={() => setCurrentView(AppView.CONTRACTS)}
                  />
          )}
          {currentView === AppView.SETTINGS && profile?.role === 'admin' && tenant && (
              <AdminSettings
                tenant={tenant}
                onUpdate={(updated) => setTenant(updated)}
                profile={profile}
                companies={companies}
                activeCompany={activeCompany}
                activeCompanyScope={activeCompanyScope}
                companyAccessMode={companyAccessMode}
                isTrialActive={isTrialTenant}
                initialSection={settingsInitialSection}
                onCompanyScopeChange={handleCompanyScopeChange}
                onCompaniesChange={setCompanies}
                onRefreshCompanies={() => refreshCompanies()}
              />
          )}
          {currentView === AppView.ASSISTANT && profile?.role === 'admin' && tenant && profile && (
              ((tenant?.plan === 'empresarial' || tenant?.plan === 'caderneta') && tenant?.plan_status === 'active') || isTrialTenant ? (
                <AdminAssistant tenant={tenant} profile={profile} />
              ) : (
                <AssistantPaywall tenant={tenant} />
              )
          )}
          {currentView === AppView.PLATFORM_OWNER && isPlatformOwnerServer && (
            <PlatformOwnerPanel />
          )}
        </Layout>
      </CompanyContextProvider>
    </Router>
  );
};

export default App;
