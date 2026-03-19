
import React from 'react';
import { Tenant } from '../types';
import { Crown, CheckCircle2, ExternalLink, Lock, Star, Bot, BarChart3, Users, FileText, Settings, Clock, AlertCircle, Smartphone, TrendingUp, Building2 } from 'lucide-react';

const getTrialDaysLeft = (trial_ends_at: string): number => {
  const diff = new Date(trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
};

// Payment Links de produção (Stripe livemode)
// Caderneta:   price_1TClkd0OdUyqvIqVJuNexoLI (R$150/mês) — prod_UB80PnGOAAQuNl
// Empresarial: price_1TClke0OdUyqvIqVAztaS2sU (R$275/mês) — prod_UB802rvwFurlTU
const CADERNETA_PAYMENT_LINK = 'https://buy.stripe.com/7sY00b575dQc7ys42e1VK00';
const EMPRESARIAL_PAYMENT_LINK = 'https://buy.stripe.com/aFa14f0QPfYkdWQ6am1VK01';

const STRIPE_CUSTOMER_PORTAL = 'https://billing.stripe.com/p/login/7sY00b575dQc7ys42e1VK00';

interface SubscriptionTabProps {
  tenant: Tenant;
  adminEmail?: string;
}

const planLabel = (plan?: string) => {
  if (plan === 'empresarial') return 'Empresarial';
  if (plan === 'caderneta') return 'Caderneta';
  return 'Free';
};

const planStatusLabel = (status?: string) => {
  if (status === 'active') return { text: 'Ativo', color: 'text-teal-400' };
  if (status === 'past_due') return { text: 'Inadimplente', color: 'text-[color:var(--accent-premium)]' };
  if (status === 'canceled') return { text: 'Cancelado', color: 'text-red-400' };
  return { text: 'Inativo', color: 'text-[color:var(--text-secondary)]' };
};

const buildPaymentLink = (base: string, tenantId: string, email?: string) => {
  const url = new URL(base);
  url.searchParams.set('client_reference_id', tenantId);
  if (email) url.searchParams.set('prefilled_email', email);
  return url.toString();
};

const CADERNETA_FEATURES = [
  { icon: FileText, label: 'Gestão de contratos de crédito' },
  { icon: Users, label: 'Gestão de clientes' },
  { icon: BarChart3, label: 'Dashboard informativo de cobrança' },
  { icon: Settings, label: 'Configurações e Pix integrado' },
  { icon: Bot, label: 'Assistente IA integrado ao WhatsApp' },
];

const EMPRESARIAL_EXTRAS = [
  { icon: Building2, label: 'Multi-empresa (filiais em outros estados ou locais)' },
  { icon: Smartphone, label: 'Portal do cliente (login próprio para consulta e pagamento)' },
  { icon: TrendingUp, label: 'Portal do investidor (login próprio para consultar portfólio)' },
];

const SubscriptionTab: React.FC<SubscriptionTabProps> = ({ tenant, adminEmail }) => {
  const currentPlan = tenant.plan ?? 'free';
  const currentStatus = tenant.plan_status;
  const status = planStatusLabel(currentStatus);
  const hasCaderneta = currentPlan === 'caderneta' || currentPlan === 'empresarial';
  const hasEmpresarial = currentPlan === 'empresarial';

  const trialDaysLeft = tenant.trial_ends_at ? getTrialDaysLeft(tenant.trial_ends_at) : null;
  const trialActive = trialDaysLeft !== null && trialDaysLeft > 0;
  const trialExpired = tenant.trial_ends_at && trialDaysLeft === 0;
  const trialProgress = trialActive ? Math.round(((15 - trialDaysLeft) / 15) * 100) : 100;

  return (
    <div className="space-y-8 animate-fade-in">

      {/* Banner de trial */}
      {tenant.trial_ends_at && (
        trialActive ? (
          <div className="bg-[color:var(--accent-premium-bg)] border border-[color:var(--accent-premium-border)] rounded-[2.5rem] p-8 shadow-xl">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 rounded-xl bg-[color:var(--accent-premium-bg-strong)] text-[color:var(--accent-premium)]">
                <Clock size={24} />
              </div>
              <div>
                <p className="text-[10px] text-[color:var(--accent-premium-muted)] font-bold uppercase tracking-widest">Período de Teste</p>
                <h3 className="text-xl font-black text-[color:var(--accent-premium-strong)]">Trial gratuito — {trialDaysLeft} {trialDaysLeft === 1 ? 'dia restante' : 'dias restantes'}</h3>
              </div>
              <span className="ml-auto text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full text-[color:var(--accent-premium)] bg-[color:var(--accent-premium-bg-strong)]">
                Ativo
              </span>
            </div>
            <p className="text-sm text-[color:var(--accent-premium-faint)] mb-4">
              Você está aproveitando acesso completo ao Juros Certo, incluindo o Assistente IA. Assine antes do período encerrar para não perder o acesso.
            </p>
            <div className="w-full bg-[color:var(--accent-premium-bg-strong)] rounded-full h-2">
              <div
                className="bg-[color:var(--accent-premium)] h-2 rounded-full transition-all"
                style={{ width: `${trialProgress}%` }}
              />
            </div>
            <p className="text-[10px] text-[color:var(--accent-premium-faint)] mt-2 text-right">{15 - trialDaysLeft!} de 15 dias utilizados</p>
          </div>
        ) : trialExpired ? (
          <div className="bg-red-900/20 border border-red-700/40 rounded-[2.5rem] p-8 shadow-xl">
            <div className="flex items-center gap-4 mb-3">
              <div className="p-3 rounded-xl bg-red-900/40 text-red-400">
                <AlertCircle size={24} />
              </div>
              <div>
                <p className="text-[10px] text-red-400/70 font-bold uppercase tracking-widest">Período de Teste</p>
                <h3 className="text-xl font-black text-red-300">Período de teste encerrado</h3>
              </div>
              <span className="ml-auto text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full text-red-400 bg-red-900/40">
                Expirado
              </span>
            </div>
            <p className="text-sm text-red-200/60">
              Seu trial gratuito expirou. Assine um plano para continuar usando o Juros Certo e manter o acesso às suas operações.
            </p>
          </div>
        ) : null
      )}

      {/* Plano atual */}
      <div className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-[2.5rem] p-8 shadow-2xl">
        <div className="flex items-center gap-4 mb-2">
          <div className={`p-3 rounded-xl ${hasEmpresarial ? 'bg-[color:var(--accent-premium-bg)] text-[color:var(--accent-premium)]' : hasCaderneta ? 'bg-teal-900/30 text-teal-400' : 'bg-[color:var(--bg-soft)] text-[color:var(--text-secondary)]'}`}>
            <Crown size={24} />
          </div>
          <div>
            <p className="text-[10px] text-[color:var(--text-muted)] font-bold uppercase tracking-widest">Plano Atual</p>
            <h3 className="text-2xl font-black text-[color:var(--text-primary)] uppercase">{planLabel(currentPlan)}</h3>
          </div>
          {hasCaderneta && (
            <span className={`ml-auto text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full ${status.color} bg-[color:var(--bg-soft)]`}>
              {status.text}
            </span>
          )}
        </div>
        {currentStatus === 'past_due' && (
          <p className="mt-3 text-[color:var(--accent-premium)] text-xs font-bold bg-[color:var(--accent-premium-bg)] rounded-xl px-4 py-3">
            Pagamento pendente. Regularize para manter o acesso ao plano.
          </p>
        )}
        {currentStatus === 'canceled' && (
          <p className="mt-3 text-red-400 text-xs font-bold bg-red-900/20 rounded-xl px-4 py-3">
            Assinatura cancelada. Assine novamente para reativar.
          </p>
        )}
      </div>

      {/* Cards de planos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Plano Caderneta */}
        <div className={`bg-[color:var(--bg-elevated)] border rounded-[2.5rem] p-8 shadow-2xl flex flex-col ${currentPlan === 'caderneta' ? 'border-teal-500' : 'border-[color:var(--border-subtle)]'}`}>
          <div className="flex items-center gap-3 mb-1">
            <Star size={20} className="text-teal-400" />
            <h4 className="text-lg font-black text-[color:var(--text-primary)] uppercase">Caderneta</h4>
            {currentPlan === 'caderneta' && <span className="ml-auto text-[10px] font-black text-teal-400 bg-teal-900/30 px-2 py-0.5 rounded-full uppercase">Seu plano</span>}
          </div>
          <p className="text-3xl font-black text-[color:var(--text-primary)] mt-2">R$150<span className="text-base text-[color:var(--text-secondary)] font-bold">/mês</span></p>
          <ul className="mt-6 space-y-3 flex-1">
            {CADERNETA_FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-[color:var(--text-secondary)]">
                <CheckCircle2 size={16} className="text-teal-400 flex-shrink-0" />
                {label}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            {currentPlan === 'free' || currentStatus === 'canceled' ? (
              <a
                href={buildPaymentLink(CADERNETA_PAYMENT_LINK, tenant.id, adminEmail)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-teal-600 hover:bg-teal-500 text-white transition-all"
              >
                <ExternalLink size={16} /> Assinar Caderneta
              </a>
            ) : currentPlan === 'caderneta' ? (
              <a
                href={STRIPE_CUSTOMER_PORTAL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-[color:var(--bg-soft)] hover:bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] transition-all"
              >
                <ExternalLink size={16} /> Gerenciar no Stripe
              </a>
            ) : (
              <button disabled className="w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-[color:var(--bg-soft)] text-[color:var(--text-muted)] cursor-not-allowed">
                Incluído no Empresarial
              </button>
            )}
          </div>
        </div>

        {/* Plano Empresarial */}
        <div className={`bg-[color:var(--bg-elevated)] border rounded-[2.5rem] p-8 shadow-2xl flex flex-col relative overflow-hidden ${currentPlan === 'empresarial' ? 'border-[color:var(--accent-premium)]' : 'border-[color:var(--border-subtle)]'}`}>
          <div className="absolute top-4 right-4 bg-[color:var(--accent-premium-btn)] text-white text-[10px] font-black uppercase px-3 py-1 rounded-full">
            Recomendado
          </div>
          <div className="flex items-center gap-3 mb-1">
            <Crown size={20} className="text-[color:var(--accent-premium)]" />
            <h4 className="text-lg font-black text-[color:var(--text-primary)] uppercase">Empresarial</h4>
            {currentPlan === 'empresarial' && <span className="ml-2 text-[10px] font-black text-[color:var(--accent-premium)] bg-[color:var(--accent-premium-bg)] px-2 py-0.5 rounded-full uppercase">Seu plano</span>}
          </div>
          <p className="text-3xl font-black text-[color:var(--text-primary)] mt-2">R$275<span className="text-base text-[color:var(--text-secondary)] font-bold">/mês</span></p>
          <ul className="mt-6 space-y-3 flex-1">
            {CADERNETA_FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-[color:var(--text-secondary)]">
                <CheckCircle2 size={16} className="text-teal-400 flex-shrink-0" />
                {label}
              </li>
            ))}
            <li className="pt-2 text-[10px] font-black text-[color:var(--accent-premium)] uppercase tracking-widest">+ Exclusivo Empresarial</li>
            {EMPRESARIAL_EXTRAS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-[color:var(--text-secondary)]">
                <CheckCircle2 size={16} className="text-[color:var(--accent-premium)] flex-shrink-0" />
                {label}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            {(currentPlan === 'free' || currentStatus === 'canceled') ? (
              <a
                href={buildPaymentLink(EMPRESARIAL_PAYMENT_LINK, tenant.id, adminEmail)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-[color:var(--accent-premium-btn)] hover:bg-[color:var(--accent-premium-btn-hover)] text-white transition-all"
              >
                <ExternalLink size={16} /> Assinar Empresarial
              </a>
            ) : currentPlan === 'caderneta' ? (
              <a
                href={buildPaymentLink(EMPRESARIAL_PAYMENT_LINK, tenant.id, adminEmail)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-[color:var(--accent-premium-btn)] hover:bg-[color:var(--accent-premium-btn-hover)] text-white transition-all"
              >
                <Crown size={16} /> Upgrade para Empresarial
              </a>
            ) : (
              <a
                href={STRIPE_CUSTOMER_PORTAL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-[color:var(--bg-soft)] hover:bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] transition-all"
              >
                <ExternalLink size={16} /> Gerenciar no Stripe
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionTab;

/* Paywall inline para o Assistente */
export const AssistantPaywall: React.FC<{ tenant: Tenant }> = ({ tenant }) => {
  const cadernetaLink = buildPaymentLink(CADERNETA_PAYMENT_LINK, tenant.id, tenant.owner_email);
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-8 animate-fade-in">
      <div className="p-5 bg-teal-900/30 rounded-3xl mb-6">
        <Lock size={48} className="text-teal-400" />
      </div>
      <h2 className="text-3xl font-black text-[color:var(--text-primary)] uppercase tracking-tighter mb-3">Recurso Caderneta</h2>
      <p className="text-[color:var(--text-secondary)] text-sm max-w-md mb-8">
        O Assistente IA com automações por WhatsApp está disponível a partir do plano <strong className="text-teal-400">Caderneta</strong> (R$150/mês).
      </p>
      <div className="flex flex-col sm:flex-row gap-4">
        <a
          href={cadernetaLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest bg-teal-600 hover:bg-teal-500 text-white transition-all"
        >
          <Star size={16} /> Assinar Caderneta — R$150/mês
        </a>
      </div>
    </div>
  );
};
