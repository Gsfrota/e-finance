import React, { useEffect, useMemo, useState } from 'react';
import { Company, CompanyAccessMode, CompanyScope, Profile, Tenant } from '../types';
import { cleanNumbers, getSupabase, isValidCPF, parseSupabaseError } from '../services/supabase';
import { createFallbackCompany, isAggregateCompanyScope } from '../services/companyScope';
import {
  Activity,
  Building2,
  CheckCircle2,
  Crown,
  CreditCard,
  MessageCircle,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Upload,
} from 'lucide-react';
import SubscriptionTab from './SubscriptionTab';

interface AdminSettingsProps {
  tenant: Tenant;
  onUpdate: (tenant: Tenant) => void;
  profile?: Profile;
  companies?: Company[];
  activeCompany?: Company | null;
  activeCompanyScope?: CompanyScope;
  companyAccessMode?: CompanyAccessMode | null;
  isTrialActive?: boolean;
  initialSection?: SettingsSection;
  onCompanyScopeChange?: (scope: CompanyScope) => void;
  onCompaniesChange?: (companies: Company[]) => void;
  onRefreshCompanies?: () => Promise<void> | void;
}

export type SettingsSection = 'empresas' | 'empresa' | 'responsavel' | 'assinatura';

const TIMEZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'Brasília (GMT-3)' },
  { value: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { value: 'America/Belem', label: 'Belém (GMT-3)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (GMT-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (GMT-5)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (GMT-2)' },
  { value: 'America/New_York', label: 'Nova York (GMT-5)' },
  { value: 'Europe/Lisbon', label: 'Lisboa (GMT+0)' },
];

const SaveButton: React.FC<{ loading: boolean; success: boolean; label?: string }> = ({ loading, success, label = 'Salvar' }) => (
  <div className="flex justify-end pt-2">
    <button
      type="submit"
      disabled={loading}
      className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
        success
          ? 'bg-green-600 text-white'
          : 'bg-[color:var(--accent-brass)] hover:bg-[color:var(--accent-brass-strong)] text-[color:var(--text-on-accent)]'
      }`}
    >
      {loading
        ? <><RefreshCw className="animate-spin" size={15} /> Salvando...</>
        : success
          ? <><CheckCircle2 size={15} /> Salvo!</>
          : <><Save size={15} /> {label}</>}
    </button>
  </div>
);

const AdminSettings: React.FC<AdminSettingsProps> = ({
  tenant,
  onUpdate,
  profile,
  companies = [],
  activeCompany = null,
  activeCompanyScope = null,
  companyAccessMode = null,
  isTrialActive = false,
  initialSection,
  onCompanyScopeChange,
  onCompaniesChange,
  onRefreshCompanies,
}) => {
  const multiCompanyEnabled = companyAccessMode === 'enabled';
  const isAggregateMode = isAggregateCompanyScope(activeCompanyScope);
  const fallbackCompany = useMemo(() => createFallbackCompany(tenant), [tenant]);
  const editableCompany = activeCompany || fallbackCompany;
  const availableCompanies = companies.length > 0 ? companies : [fallbackCompany];
  const hasExtraCompanies = availableCompanies.some((company) => !company.is_primary);
  const showCompaniesSection = multiCompanyEnabled || hasExtraCompanies;
  const defaultSection: SettingsSection = showCompaniesSection
    ? (isAggregateMode && multiCompanyEnabled ? 'empresas' : 'empresa')
    : 'empresa';

  const [activeSection, setActiveSection] = useState<SettingsSection>(defaultSection);
  const [companyName, setCompanyName] = useState(editableCompany.name);
  const [logoUrl, setLogoUrl] = useState(editableCompany.logo_url || '');
  const [pixKeyType, setPixKeyType] = useState<'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'>(
    editableCompany.pix_key_type || tenant.pix_key_type || 'CNPJ'
  );
  const [pixKey, setPixKey] = useState(editableCompany.pix_key || '');
  const [pixName, setPixName] = useState(editableCompany.pix_name || '');
  const [pixCity, setPixCity] = useState(editableCompany.pix_city || '');
  const [whatsapp, setWhatsapp] = useState(editableCompany.support_whatsapp || '');
  const [timezone, setTimezone] = useState(editableCompany.timezone || tenant.timezone || 'America/Sao_Paulo');
  const [ownerName, setOwnerName] = useState(tenant.owner_name || '');
  const [ownerEmail, setOwnerEmail] = useState(tenant.owner_email || '');
  const [newCompanyName, setNewCompanyName] = useState('');

  const [companyLoading, setCompanyLoading] = useState(false);
  const [companySuccess, setCompanySuccess] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerSuccess, setOwnerSuccess] = useState(false);
  const [companyCreateLoading, setCompanyCreateLoading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    setActiveSection(initialSection ?? defaultSection);
  }, [defaultSection, initialSection]);

  useEffect(() => {
    setCompanyName(editableCompany.name);
    setLogoUrl(editableCompany.logo_url || '');
    setPixKeyType(editableCompany.pix_key_type || tenant.pix_key_type || 'CNPJ');
    setPixKey(editableCompany.pix_key || '');
    setPixName(editableCompany.pix_name || '');
    setPixCity(editableCompany.pix_city || '');
    setWhatsapp(editableCompany.support_whatsapp || '');
    setTimezone(editableCompany.timezone || tenant.timezone || 'America/Sao_Paulo');
    setFieldError(null);
  }, [editableCompany, tenant]);

  useEffect(() => {
    setOwnerName(tenant.owner_name || '');
    setOwnerEmail(tenant.owner_email || '');
  }, [tenant]);

  const navItems = useMemo(() => {
    const base: Array<{ id: SettingsSection; label: string; icon: React.ReactNode }> = [
      { id: 'empresa', label: 'Empresa', icon: <Building2 size={16} /> },
      { id: 'responsavel', label: 'Responsável', icon: <Crown size={16} /> },
      { id: 'assinatura', label: 'Assinatura', icon: <CreditCard size={16} /> },
    ];
    return showCompaniesSection
      ? [{ id: 'empresas' as const, label: 'Empresas', icon: <Building2 size={16} /> }, ...base]
      : base;
  }, [showCompaniesSection]);

  const handleLogoUpload = async (file: File) => {
    const supabase = getSupabase();
    if (!supabase) return;
    setLogoUploading(true);
    setFieldError(null);
    try {
      const ext = file.name.split('.').pop();
      const path = `logos/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('profile-photos').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from('profile-photos').getPublicUrl(path);
      setLogoUrl(data.publicUrl);
    } catch (error: any) {
      setFieldError(parseSupabaseError(error));
    } finally {
      setLogoUploading(false);
    }
  };

  const validatePixKey = () => {
    const cleanKey = pixKey.trim();
    if (!cleanKey) return null;
    if (pixKeyType === 'CPF' && !isValidCPF(cleanKey)) return 'CPF inválido.';
    if (pixKeyType === 'PHONE' && cleanNumbers(cleanKey).length < 10) return 'Telefone inválido.';
    if (pixKeyType === 'EMAIL' && !cleanKey.includes('@')) return 'E-mail inválido.';
    return null;
  };

  const notifyCompanyChange = async (nextCompanies: Company[], nextScope?: CompanyScope) => {
    onCompaniesChange?.(nextCompanies);
    if (nextScope && onCompanyScopeChange) onCompanyScopeChange(nextScope);
    await onRefreshCompanies?.();
  };

  const handleSaveCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    const validationError = validatePixKey();
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    const supabase = getSupabase();
    if (!supabase) return;

    const updates = {
      name: companyName.trim(),
      logo_url: logoUrl.trim() || null,
      pix_key_type: pixKeyType,
      pix_key: pixKey.trim() ? cleanNumbers(pixKey.trim()) : null,
      pix_name: pixName.trim() ? pixName.toUpperCase().trim() : null,
      pix_city: pixCity.trim() ? pixCity.toUpperCase().trim() : null,
      support_whatsapp: whatsapp.trim() ? cleanNumbers(whatsapp) : null,
      timezone,
    };

    setCompanyLoading(true);
    try {
      if (activeCompany && !activeCompany.is_fallback) {
        const { error } = await supabase.from('companies').update(updates).eq('id', activeCompany.id);
        if (error) throw error;
        const nextCompanies = availableCompanies.map((company) =>
          company.id === activeCompany.id ? { ...company, ...updates } : company
        );
        await notifyCompanyChange(nextCompanies, activeCompany.id);
      } else {
        const { error } = await supabase.from('tenants').update(updates).eq('id', tenant.id);
        if (error) throw error;
        onUpdate({ ...tenant, ...updates });
      }

      setCompanySuccess(true);
      setTimeout(() => setCompanySuccess(false), 2500);
    } catch (error: any) {
      setFieldError(parseSupabaseError(error));
    } finally {
      setCompanyLoading(false);
    }
  };

  const handleSaveOwner = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    const supabase = getSupabase();
    if (!supabase) return;

    const updates = {
      owner_name: ownerName.trim() || null,
      owner_email: ownerEmail.trim() || null,
    };

    setOwnerLoading(true);
    try {
      const { error } = await supabase.from('tenants').update(updates).eq('id', tenant.id);
      if (error) throw error;
      onUpdate({ ...tenant, ...updates });
      setOwnerSuccess(true);
      setTimeout(() => setOwnerSuccess(false), 2500);
    } catch (error: any) {
      setFieldError(parseSupabaseError(error));
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleCreateCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newCompanyName.trim()) return;
    if (!multiCompanyEnabled) {
      setCreateError('Multiempresa está bloqueado no seu plano atual. Faça upgrade para voltar a criar novas empresas.');
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;

    setCompanyCreateLoading(true);
    setCreateError(null);
    try {
      const { data, error } = await supabase
        .from('companies')
        .insert({
          tenant_id: tenant.id,
          name: newCompanyName.trim(),
          timezone: editableCompany.timezone || tenant.timezone || 'America/Sao_Paulo',
          is_primary: false,
        })
        .select('*')
        .single();

      if (error) throw error;
      const createdCompany = data as Company;
      const nextCompanies = [...availableCompanies.filter((company) => !company.is_fallback), createdCompany].sort((a, b) => {
        if (a.is_primary === b.is_primary) return a.name.localeCompare(b.name);
        return a.is_primary ? -1 : 1;
      });

      await notifyCompanyChange(nextCompanies, createdCompany.id);
      setNewCompanyName('');
      setActiveSection('empresa');
    } catch (error: any) {
      setCreateError(parseSupabaseError(error));
    } finally {
      setCompanyCreateLoading(false);
    }
  };

  const companySelectionRequired = showCompaniesSection && multiCompanyEnabled && isAggregateMode;

  return (
    <div className="max-w-5xl mx-auto animate-fade-in pb-16">
      <div className="border-b border-[color:var(--border-subtle)] pb-6 mb-8">
        <h2 className="type-title uppercase text-[color:var(--text-primary)]">Configurações</h2>
        <p className="type-label text-[color:var(--text-muted)] mt-1">Tenant, empresas e identidade operacional</p>
      </div>

      <div className="flex border-b border-[color:var(--border-subtle)] overflow-x-auto mb-8">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveSection(item.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
              activeSection === item.id
                ? 'border-teal-400 text-[color:var(--text-primary)]'
                : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-secondary)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {fieldError && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {fieldError}
        </div>
      )}

      {activeSection === 'empresas' && showCompaniesSection && (
        <div className="space-y-8">
          <div>
            <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Empresas</h3>
            <p className="text-sm text-[color:var(--text-muted)]">
              {multiCompanyEnabled
                ? 'Gerencie as empresas operacionais do mesmo tenant.'
                : 'Sua empresa primária segue ativa. Empresas extras continuam salvas, mas ficam bloqueadas até o upgrade.'}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {availableCompanies.map((company) => {
              const isCurrent = activeCompany?.id === company.id;
              const isLockedCompany = !multiCompanyEnabled && !company.is_primary;
              return (
                <button
                  key={company.id}
                  onClick={() => {
                    if (isLockedCompany) {
                      setActiveSection('assinatura');
                      return;
                    }
                    onCompanyScopeChange?.(company.id);
                    setActiveSection('empresa');
                  }}
                  className={`rounded-[1.5rem] border px-5 py-4 text-left transition-colors ${
                    isCurrent
                      ? 'border-[rgba(202,176,122,0.28)] bg-[rgba(202,176,122,0.08)]'
                      : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] hover:border-[rgba(202,176,122,0.2)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[color:var(--text-primary)]">{company.name}</div>
                      <div className="mt-1 text-[0.68rem] uppercase tracking-[0.16em] text-[color:var(--text-faint)]">
                        {company.is_primary ? 'Principal' : isLockedCompany ? 'Bloqueada' : 'Empresa'}
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="rounded-full bg-[rgba(202,176,122,0.12)] px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[color:var(--accent-brass)]">
                        Ativa
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {!multiCompanyEnabled && (
            <div className="rounded-[1.8rem] border border-[rgba(202,176,122,0.2)] bg-[rgba(202,176,122,0.08)] p-6">
              <div className="flex items-start gap-3">
                <Crown size={18} className="mt-0.5 text-[color:var(--accent-brass)]" />
                <div>
                  <h4 className="text-sm font-semibold text-[color:var(--text-primary)]">Multiempresa bloqueado</h4>
                  <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                    {isTrialActive
                      ? 'O trial ainda está ativo, mas houve uma inconsistência no entitlement. Verifique a assinatura.'
                      : 'Seu trial terminou ou o plano atual não inclui multiempresa. A empresa primária continua operável e as extras permanecem preservadas.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveSection('assinatura')}
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-[rgba(202,176,122,0.24)] bg-[rgba(202,176,122,0.1)] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--accent-brass)] transition-colors hover:bg-[rgba(202,176,122,0.16)]"
                  >
                    <Crown size={12} />
                    Ver assinatura
                  </button>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleCreateCompany} className="rounded-[1.8rem] border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-6 space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-[color:var(--text-primary)]">Nova empresa</h4>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                Cria uma nova operação mantendo o mesmo tenant e a mesma assinatura.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                required
                type="text"
                value={newCompanyName}
                onChange={(event) => setNewCompanyName(event.target.value)}
                placeholder="Ex: Filial Fortaleza"
                disabled={!multiCompanyEnabled}
                className="flex-1 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm outline-none"
              />
              <button
                type="submit"
                disabled={companyCreateLoading || !multiCompanyEnabled}
                className="flex items-center justify-center gap-2 rounded-xl bg-[color:var(--accent-brass)] px-5 py-3 text-sm font-bold text-[color:var(--text-on-accent)] disabled:opacity-60"
              >
                {companyCreateLoading ? <Activity size={16} className="animate-spin" /> : <Plus size={16} />}
                Criar empresa
              </button>
            </div>
            {createError && <p className="text-sm text-red-300">{createError}</p>}
          </form>
        </div>
      )}

      {activeSection === 'empresa' && (
        <div className="space-y-8">
          <div>
            <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Empresa</h3>
            <p className="text-sm text-[color:var(--text-muted)]">Branding, Pix, suporte e parâmetros operacionais da empresa ativa.</p>
          </div>

          {companySelectionRequired ? (
            <div className="rounded-[1.8rem] border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-6 py-8 text-center">
              <p className="text-sm font-semibold text-[color:var(--text-primary)]">Selecione uma empresa específica</p>
              <p className="mt-2 text-sm text-[color:var(--text-muted)]">
                Em `Todas as empresas`, esta tela fica somente em modo de gerenciamento geral. Escolha uma empresa no topo ou na aba `Empresas`.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSaveCompany} className="space-y-8">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="block type-label text-[color:var(--text-muted)] mb-2">Nome da empresa</label>
                  <input
                    required
                    type="text"
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                    className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="block type-label text-[color:var(--text-muted)] mb-2">Fuso horário</label>
                  <select
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm outline-none"
                  >
                    {TIMEZONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block type-label text-[color:var(--text-muted)] mb-2">Logotipo</label>
                <div className="flex items-center gap-4">
                  <label className="cursor-pointer flex-1">
                    <div className="flex items-center gap-3 bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] hover:border-teal-500 rounded-xl px-4 py-3 transition-colors">
                      {logoUploading ? <Activity className="text-teal-400 animate-spin shrink-0" size={16} /> : <Upload className="text-[color:var(--text-muted)] shrink-0" size={16} />}
                      <span className="text-sm text-[color:var(--text-muted)]">
                        {logoUploading ? 'Enviando...' : logoUrl ? 'Trocar logotipo' : 'Selecionar logotipo'}
                      </span>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={logoUploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) handleLogoUpload(file);
                      }}
                    />
                  </label>
                  {logoUrl && (
                    <img src={logoUrl} alt="Logo preview" className="w-12 h-12 rounded-xl object-cover border border-[color:var(--border-subtle)] shrink-0 bg-slate-800" />
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div className="flex items-center gap-2">
                  <QrCode size={16} className="text-[color:var(--accent-brass)]" />
                  <p className="text-sm font-semibold text-[color:var(--text-primary)]">PIX</p>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label className="block type-label text-[color:var(--text-muted)] mb-2">Tipo de chave</label>
                    <select
                      value={pixKeyType}
                      onChange={(event) => setPixKeyType(event.target.value as any)}
                      className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm outline-none"
                    >
                      <option value="CNPJ">CNPJ</option>
                      <option value="CPF">CPF</option>
                      <option value="EMAIL">E-mail</option>
                      <option value="PHONE">Celular</option>
                      <option value="EVP">Chave Aleatória (EVP)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block type-label text-[color:var(--text-muted)] mb-2">Chave PIX</label>
                    <input
                      type="text"
                      value={pixKey}
                      onChange={(event) => setPixKey(event.target.value)}
                      placeholder="Opcional no cadastro inicial"
                      className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm outline-none"
                    />
                  </div>
                  <div>
                    <label className="block type-label text-[color:var(--text-muted)] mb-2">Beneficiário</label>
                    <input
                      type="text"
                      value={pixName}
                      onChange={(event) => setPixName(event.target.value)}
                      placeholder="NOME COMPLETO OU RAZAO SOCIAL"
                      className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm uppercase outline-none"
                    />
                  </div>
                  <div>
                    <label className="block type-label text-[color:var(--text-muted)] mb-2">Cidade</label>
                    <input
                      type="text"
                      value={pixCity}
                      onChange={(event) => setPixCity(event.target.value)}
                      placeholder="SAO PAULO"
                      className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm uppercase outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <MessageCircle size={16} className="text-[color:var(--accent-brass)]" />
                  <p className="text-sm font-semibold text-[color:var(--text-primary)]">Atendimento</p>
                </div>
                <div>
                  <label className="block type-label text-[color:var(--text-muted)] mb-2">WhatsApp do consultor</label>
                  <input
                    type="text"
                    value={whatsapp}
                    onChange={(event) => setWhatsapp(event.target.value)}
                    placeholder="5585999999999"
                    className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm outline-none"
                  />
                </div>
              </div>

              <SaveButton loading={companyLoading} success={companySuccess} />
            </form>
          )}
        </div>
      )}

      {activeSection === 'responsavel' && (
        <div className="space-y-8">
          <div>
            <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Responsável</h3>
            <p className="text-sm text-[color:var(--text-muted)]">Dados oficiais do tenant e da assinatura.</p>
          </div>

          <form onSubmit={handleSaveOwner} className="space-y-5">
            <div>
              <label className="block type-label text-[color:var(--text-muted)] mb-2">Nome legal</label>
              <input
                type="text"
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm outline-none"
              />
            </div>
            <div>
              <label className="block type-label text-[color:var(--text-muted)] mb-2">E-mail owner</label>
              <input
                type="email"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                className="w-full bg-[color:var(--bg-base)] border border-[color:var(--border-subtle)] rounded-xl px-4 py-3 text-[color:var(--text-primary)] text-sm outline-none"
              />
            </div>
            <SaveButton loading={ownerLoading} success={ownerSuccess} />
          </form>
        </div>
      )}

      {activeSection === 'assinatura' && (
        <div className="space-y-8">
          <div>
            <h3 className="text-base font-bold text-[color:var(--text-primary)] mb-0.5">Assinatura</h3>
            <p className="text-sm text-[color:var(--text-muted)]">Plano atual, faturamento e gerenciamento da assinatura.</p>
          </div>
          <div className="border-t border-[color:var(--border-subtle)] pt-6">
            <SubscriptionTab tenant={tenant} adminEmail={profile?.email || tenant.owner_email} />
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSettings;
