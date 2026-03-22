import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Loader2, Key } from 'lucide-react';
import { cleanNumbers, fetchProfileByAuthUserId, getSupabase, isValidCPF } from '../services/supabase';
import { Tenant } from '../types';

const TIMEZONE_OPTIONS = [
  { value: 'America/Sao_Paulo',   label: 'Brasília (GMT-3)' },
  { value: 'America/Manaus',      label: 'Manaus (GMT-4)' },
  { value: 'America/Belem',       label: 'Belém (GMT-3)' },
  { value: 'America/Cuiaba',      label: 'Cuiabá (GMT-4)' },
  { value: 'America/Rio_Branco',  label: 'Rio Branco (GMT-5)' },
  { value: 'America/Noronha',     label: 'Fernando de Noronha (GMT-2)' },
  { value: 'America/New_York',    label: 'Nova York (GMT-5)' },
  { value: 'Europe/Lisbon',       label: 'Lisboa (GMT+0)' },
];

interface OnboardingWizardProps {
  sessionUser: any;
  tenant: Tenant | null;
  mode: 'full' | 'setup';
  onComplete: () => void;
  onLogout: () => void;
}

const TOTAL_STEPS: Record<'full' | 'setup', number> = { full: 3, setup: 2 };

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  sessionUser,
  tenant,
  mode,
  onComplete,
  onLogout,
}) => {
  const [step, setStep] = useState(mode === 'full' ? 1 : 2);
  const [fullName, setFullName] = useState(
    sessionUser?.user_metadata?.full_name || sessionUser?.user_metadata?.name || ''
  );
  const [companyName, setCompanyName] = useState(tenant?.name || '');
  const [inviteMode, setInviteMode] = useState<'company' | 'invite'>('company');
  const [inviteCode, setInviteCode] = useState('');

  // PIX
  const [pixKeyType, setPixKeyType] = useState<'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'>(
    tenant?.pix_key_type || 'CNPJ'
  );
  const [pixKey, setPixKey] = useState(tenant?.pix_key || '');
  const [pixName, setPixName] = useState(tenant?.pix_name || '');
  const [pixCity, setPixCity] = useState(tenant?.pix_city || '');

  // Timezone
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  );

  // WhatsApp
  const [whatsapp, setWhatsapp] = useState(tenant?.support_whatsapp || '');

  // UX
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tenant id resolvido após passo 1 (modo full) ou vindo de props (modo setup)
  const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(tenant?.id || null);

  const baseInputClass =
    'w-full rounded-2xl border border-[color:var(--border-strong)] bg-white/[0.03] px-4 py-3.5 text-sm text-[color:var(--text-primary)] outline-none transition-all placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent-brass)] focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(240,180,41,0.08)]';

  const totalSteps = TOTAL_STEPS[mode];
  const displayStep = mode === 'full' ? step : step - 1; // passo visual para barra de progresso

  // ─── Passo 1: Organização (modo full) ──────────────────────────────────────
  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) { setError('Informe seu nome.'); return; }
    if (inviteMode === 'company' && !companyName.trim()) { setError('Informe o nome da organização.'); return; }
    if (inviteMode === 'invite' && !inviteCode.trim()) { setError('Informe o código de convite.'); return; }

    setError(null);
    setLoading(true);
    const supabase = getSupabase();
    if (!supabase) { setError('Conexão indisponível.'); setLoading(false); return; }

    try {
      const { data, error: rpcError } = await supabase.rpc('complete_oauth_onboarding', {
        p_full_name: fullName.trim(),
        p_mode: inviteMode,
        p_company_name: inviteMode === 'company' ? companyName.trim() : null,
        p_invite_code: inviteMode === 'invite' ? inviteCode.toUpperCase().trim() : null,
      });

      if (rpcError) throw rpcError;

      // Atualiza o JWT para que o tenant_id entre nos claims (necessário para RLS e roteamento)
      await supabase.auth.refreshSession();

      // Busca tenant_id via RPC SECURITY DEFINER (ignora RLS, funciona mesmo antes do JWT atualizar)
      const { data: tid } = await supabase.rpc('get_my_tenant_id');
      if (tid) {
        setResolvedTenantId(tid);
        if (inviteMode === 'company') {
          await supabase.from('tenants').update({ timezone }).eq('id', tid);
        }
      }

      // Se entrou via convite, não precisa configurar PIX do tenant novo — vai direto pro app
      if (inviteMode === 'invite') {
        onComplete();
        return;
      }

      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Erro ao configurar sua conta.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Passo 2: PIX ──────────────────────────────────────────────────────────
  const validatePix = (): string | null => {
    const cleanKey = pixKey.trim();
    if (!cleanKey) return 'Chave Pix é obrigatória.';
    if (pixKeyType === 'CPF' && !isValidCPF(cleanKey)) return 'CPF inválido.';
    if (pixKeyType === 'PHONE' && cleanNumbers(cleanKey).length < 10) return 'Telefone inválido.';
    if (pixKeyType === 'EMAIL' && !cleanKey.includes('@')) return 'E-mail inválido.';
    if (!pixName.trim()) return 'Nome do beneficiário é obrigatório.';
    if (!pixCity.trim()) return 'Cidade é obrigatória.';
    return null;
  };

  const handleStep2Save = async () => {
    const validationError = validatePix();
    if (validationError) { setError(validationError); return; }

    setError(null);
    setLoading(true);
    const supabase = getSupabase();
    if (!supabase) { setError('Conexão indisponível.'); setLoading(false); return; }

    // Resolve tenant_id se ainda não foi obtido (ex: recuperação de onboarding interrompido)
    let tenantId = resolvedTenantId;
    if (!tenantId && sessionUser?.id) {
      const { data: p } = await fetchProfileByAuthUserId<{ tenant_id?: string }>(supabase, sessionUser.id, 'tenant_id');
      if (p?.tenant_id) { tenantId = p.tenant_id; setResolvedTenantId(p.tenant_id); }
    }
    if (!tenantId) { setError('Tenant não encontrado. Tente sair e entrar novamente.'); setLoading(false); return; }

    let sanitizedKey = pixKey.trim();
    if (['CPF', 'CNPJ', 'PHONE'].includes(pixKeyType)) {
      sanitizedKey = cleanNumbers(sanitizedKey);
      if (pixKeyType === 'PHONE' && !sanitizedKey.startsWith('55')) {
        sanitizedKey = '55' + sanitizedKey;
      }
    }

    const { error: dbError } = await supabase.from('tenants').update({
      pix_key_type: pixKeyType,
      pix_key: sanitizedKey,
      pix_name: pixName.toUpperCase().trim(),
      pix_city: pixCity.toUpperCase().trim(),
    }).eq('id', tenantId);

    if (dbError) { setError(`Erro ao salvar: ${dbError.message}`); setLoading(false); return; }

    setLoading(false);
    setStep(3);
  };

  const handleStep2Skip = () => { setError(null); setStep(3); };

  // ─── Passo 3: WhatsApp ─────────────────────────────────────────────────────
  const handleStep3Save = async () => {
    const cleanWa = cleanNumbers(whatsapp);
    if (cleanWa.length < 10) { setError('Número inválido. Use o formato: 5585912345678'); return; }

    setError(null);
    setLoading(true);
    const supabase = getSupabase();

    let tenantId = resolvedTenantId;
    if (!tenantId && supabase && sessionUser?.id) {
      const { data: p } = await fetchProfileByAuthUserId<{ tenant_id?: string }>(supabase, sessionUser.id, 'tenant_id');
      if (p?.tenant_id) { tenantId = p.tenant_id; setResolvedTenantId(p.tenant_id); }
    }

    if (supabase && tenantId) {
      const { error: dbError } = await supabase.from('tenants').update({
        support_whatsapp: cleanWa,
      }).eq('id', tenantId);
      if (dbError) { setError(`Erro ao salvar: ${dbError.message}`); setLoading(false); return; }
    }

    setLoading(false);
    onComplete();
  };

  const handleStep3Skip = () => onComplete();

  // ─── JSX reutilizável (variáveis, não componentes — evita perda de foco) ────
  const progressBar = (
    <div className="mb-8 flex items-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNum = mode === 'full' ? i + 1 : i + 2;
        const isActive = step === stepNum;
        const isDone = step > stepNum;
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div className={`h-px flex-1 transition-all ${isDone ? 'bg-[color:var(--accent-brass)]' : 'bg-[color:var(--border-strong)]'}`} />
            )}
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-all ${
              isActive
                ? 'bg-[color:var(--accent-brass)] text-black'
                : isDone
                ? 'bg-[rgba(202,176,122,0.3)] text-[color:var(--accent-brass)]'
                : 'border border-[color:var(--border-strong)] text-[color:var(--text-faint)]'
            }`}>
              {isDone ? '✓' : i + 1}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );

  const errorBox = error ? (
    <div className="rounded-2xl border border-[rgba(198,126,105,0.26)] bg-[rgba(198,126,105,0.08)] p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 shrink-0 text-[color:var(--accent-danger)]" size={16} />
        <p className="text-xs leading-6 text-[color:var(--text-secondary)]">{error}</p>
      </div>
    </div>
  ) : null;

  const wrapperClass = "min-h-screen flex items-center justify-center p-6 text-[color:var(--text-primary)]";
  const cardClass = "panel-card w-full max-w-lg rounded-[2rem] p-8 sm:p-10";

  // ─── Passo 1 ─────────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className={wrapperClass}>
        <div className={cardClass} style={{ boxShadow: 'var(--shadow-float)' }}>
        {progressBar}
        <div className="mb-8 space-y-3">
          <p className="section-kicker">Bem-vindo(a)</p>
          <h2 className="type-title text-[color:var(--text-primary)]">Configure sua conta</h2>
          <p className="type-body text-[color:var(--text-secondary)]">
            Sua conta Google foi autenticada. Agora defina como você quer acessar a plataforma.
          </p>
        </div>

        {/* Seletor de modo */}
        <div className="mb-6 flex rounded-2xl border border-[color:var(--border-strong)] bg-white/[0.02] p-1">
          <button
            type="button"
            onClick={() => setInviteMode('company')}
            className={`flex-1 rounded-xl py-2.5 text-xs font-bold uppercase tracking-[0.18em] transition-all ${inviteMode === 'company' ? 'bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
          >
            Nova organização
          </button>
          <button
            type="button"
            onClick={() => setInviteMode('invite')}
            className={`flex-1 rounded-xl py-2.5 text-xs font-bold uppercase tracking-[0.18em] transition-all ${inviteMode === 'invite' ? 'bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
          >
            Código de convite
          </button>
        </div>

        <form onSubmit={handleStep1} className="space-y-5">
          <div>
            <label className="mb-2 block type-label text-[color:var(--text-faint)]">Nome completo</label>
            <input
              required
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={baseInputClass}
              placeholder="Seu nome"
            />
          </div>

          {inviteMode === 'company' && (
            <>
            <div>
              <label className="mb-2 block type-label text-[color:var(--text-faint)]">Organização</label>
              <input
                required
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className={baseInputClass}
                placeholder="Nome da organização"
              />
            </div>
            <div>
              <label className="mb-2 block type-label text-[color:var(--text-faint)]">Fuso Horário</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={baseInputClass}
              >
                {TIMEZONE_OPTIONS.map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
            </>
          )}

          {inviteMode === 'invite' && (
            <div>
              <label className="mb-2 block type-label text-[color:var(--text-faint)]">Código de convite</label>
              <div className="relative">
                <Key className="absolute left-4 top-4 text-[color:var(--text-faint)]" size={16} />
                <input
                  required
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className={`${baseInputClass} pl-12 font-mono tracking-[0.2em]`}
                  placeholder="CÓDIGO"
                />
              </div>
            </div>
          )}

          {errorBox}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-full py-4 text-xs uppercase tracking-[0.22em] disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={16} />}
            <span>Prosseguir</span>
          </button>
        </form>

        <div className="mt-6 text-center">
          <button type="button" onClick={onLogout} className="text-xs text-[color:var(--text-faint)] hover:text-[color:var(--text-muted)]">
            Usar outra conta
          </button>
        </div>
        </div>
      </div>
    );
  }

  // ─── Passo 2: PIX ─────────────────────────────────────────────────────────
  if (step === 2) {
    return (
      <div className={wrapperClass}>
        <div className={cardClass} style={{ boxShadow: 'var(--shadow-float)' }}>
        {progressBar}
        <div className="mb-8 space-y-3">
          <p className="section-kicker">Recebimento</p>
          <h2 className="type-title text-[color:var(--text-primary)]">Configure o Pix</h2>
          <p className="type-body text-[color:var(--text-secondary)]">
            Sua chave Pix será usada para gerar cobranças automáticas para os devedores.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <label className="mb-2 block type-label text-[color:var(--text-faint)]">Tipo de chave</label>
            <select
              value={pixKeyType}
              onChange={(e) => setPixKeyType(e.target.value as any)}
              className={baseInputClass}
            >
              <option value="CNPJ">CNPJ</option>
              <option value="CPF">CPF</option>
              <option value="EMAIL">E-mail</option>
              <option value="PHONE">Telefone</option>
              <option value="EVP">Chave aleatória (EVP)</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block type-label text-[color:var(--text-faint)]">Chave Pix</label>
            <input
              type="text"
              value={pixKey}
              onChange={(e) => setPixKey(e.target.value)}
              className={baseInputClass}
              placeholder={
                pixKeyType === 'CNPJ' ? '00.000.000/0001-00' :
                pixKeyType === 'CPF' ? '000.000.000-00' :
                pixKeyType === 'EMAIL' ? 'email@exemplo.com' :
                pixKeyType === 'PHONE' ? '5585912345678' :
                'Chave aleatória'
              }
            />
          </div>

          <div>
            <label className="mb-2 block type-label text-[color:var(--text-faint)]">Nome do beneficiário</label>
            <input
              type="text"
              value={pixName}
              onChange={(e) => setPixName(e.target.value)}
              className={baseInputClass}
              placeholder="NOME CONFORME NO BANCO"
            />
          </div>

          <div>
            <label className="mb-2 block type-label text-[color:var(--text-faint)]">Cidade</label>
            <input
              type="text"
              value={pixCity}
              onChange={(e) => setPixCity(e.target.value)}
              className={baseInputClass}
              placeholder="FORTALEZA"
            />
          </div>

          {errorBox}

          <button
            type="button"
            onClick={handleStep2Save}
            disabled={loading}
            className="btn btn-primary w-full py-4 text-xs uppercase tracking-[0.22em] disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={16} />}
            <span>Continuar</span>
          </button>

          <button
            type="button"
            onClick={handleStep2Skip}
            disabled={loading}
            className="w-full py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-faint)] hover:text-[color:var(--text-muted)] transition-all"
          >
            Configurar depois
          </button>
        </div>
        </div>
      </div>
    );
  }

  // ─── Passo 3: WhatsApp ─────────────────────────────────────────────────────
  return (
    <div className={wrapperClass}>
      <div className={cardClass} style={{ boxShadow: 'var(--shadow-float)' }}>
      {progressBar}
      <div className="mb-8 space-y-3">
        <p className="section-kicker">Atendimento</p>
        <h2 className="type-title text-[color:var(--text-primary)]">WhatsApp do negócio</h2>
        <p className="type-body text-[color:var(--text-secondary)]">
          Este número será usado pelo bot para envio de cobranças e atendimento aos clientes.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-faint)]">Número do WhatsApp</label>
          <input
            type="text"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            className={baseInputClass}
            placeholder="5585912345678"
          />
          <p className="mt-2 type-caption text-[color:var(--text-faint)]">
            Formato: código do país (55) + DDD + número. Ex: 5585912345678
          </p>
        </div>

        {errorBox}

        <button
          type="button"
          onClick={handleStep3Save}
          disabled={loading}
          className="btn btn-primary w-full py-4 text-xs uppercase tracking-[0.22em] disabled:opacity-60"
        >
          {loading ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={16} />}
          <span>Entrar no app</span>
        </button>

        <button
          type="button"
          onClick={handleStep3Skip}
          disabled={loading}
          className="w-full py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-faint)] hover:text-[color:var(--text-muted)] transition-all"
        >
          Configurar depois
        </button>
      </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
