import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Crown, Lock, Plus, X } from 'lucide-react';
import { Company, CompanyAccessMode, CompanyScope } from '../types';

interface CompanySwitcherProps {
  tenantName?: string | null;
  companies: Company[];
  activeCompanyId?: string | null;
  activeCompanyScope?: CompanyScope;
  accessMode?: CompanyAccessMode | null;
  scopeLabel?: string;
  scopeDescriptorLabel?: string;
  triggerTitle?: string;
  variant?: 'desktop' | 'mobile-sheet';
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectScope: (scope: CompanyScope) => void;
  onCreateCompany?: () => void;
  onUpgrade?: () => void;
}

const CompanySwitcher: React.FC<CompanySwitcherProps> = ({
  tenantName,
  companies,
  activeCompanyId,
  activeCompanyScope,
  accessMode = 'enabled',
  scopeLabel,
  scopeDescriptorLabel,
  triggerTitle,
  variant = 'desktop',
  isOpen,
  onOpenChange,
  onSelectScope,
  onCreateCompany,
  onUpgrade,
}) => {
  const normalizedScope = activeCompanyScope || activeCompanyId || 'all';
  const isLocked = accessMode === 'upsell_locked';
  const isMobileSheet = variant === 'mobile-sheet';
  const isControlled = typeof isOpen === 'boolean';
  const [internalOpen, setInternalOpen] = useState(false);
  const [shouldRenderSheet, setShouldRenderSheet] = useState(false);
  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const sheetOpen = isControlled ? Boolean(isOpen) : internalOpen;
  const sheetSummaryLabel = scopeDescriptorLabel || 'Empresa ativa';
  const sheetSummaryValue = scopeLabel || tenantName || 'Empresa ativa';
  const allCompaniesLabel = tenantName ? `Todas as empresas de ${tenantName}` : 'Todas as empresas';

  const setSheetOpen = (open: boolean) => {
    if (!isControlled) {
      setInternalOpen(open);
    }
    onOpenChange?.(open);
  };

  useEffect(() => {
    if (!isMobileSheet) return;

    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (sheetOpen) {
      setShouldRenderSheet(true);
      const animationFrame = window.requestAnimationFrame(() => setIsSheetVisible(true));
      return () => window.cancelAnimationFrame(animationFrame);
    }

    setIsSheetVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => {
      setShouldRenderSheet(false);
      closeTimeoutRef.current = null;
    }, 220);

    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, [isMobileSheet, sheetOpen]);

  useEffect(() => {
    if (!isMobileSheet || !shouldRenderSheet) return;

    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyTouchAction = body.style.touchAction;
    const previousDocumentOverflow = documentElement.style.overflow;

    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
    documentElement.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousBodyOverflow;
      body.style.touchAction = previousBodyTouchAction;
      documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [isMobileSheet, shouldRenderSheet]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const companyOptions = useMemo(() => companies, [companies]);

  const handleSelectScope = (scope: CompanyScope) => {
    if (isLocked) return;
    onSelectScope(scope);
    if (isMobileSheet) {
      setSheetOpen(false);
    }
  };

  const handleCreateCompany = () => {
    onCreateCompany?.();
    if (isMobileSheet) {
      setSheetOpen(false);
    }
  };

  const handleUpgrade = () => {
    onUpgrade?.();
    if (isMobileSheet) {
      setSheetOpen(false);
    }
  };

  if (isMobileSheet) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="group mt-1 flex min-h-[36px] w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.05]"
        >
          <Building2 size={13} className="shrink-0 text-[color:var(--accent-brass)]" />
          <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden">
            <span className="shrink-0 text-[0.58rem] font-bold uppercase tracking-[0.16em] text-[color:var(--text-faint)]">
              {sheetSummaryLabel}
            </span>
            <span className="truncate text-[0.8rem] font-semibold text-[color:var(--text-primary)]">
              {sheetSummaryValue}
            </span>
          </div>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-[color:var(--accent-brass)]">
            {isLocked ? <Lock size={13} /> : <ChevronDown size={14} />}
          </div>
        </button>

        {shouldRenderSheet && (
          <div className="fixed inset-0 z-[70] md:hidden">
            <button
              type="button"
              aria-label="Fechar seletor de empresas"
              onClick={() => setSheetOpen(false)}
              className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
                isSheetVisible ? 'opacity-100' : 'opacity-0'
              }`}
            />

            <div
              className={`absolute inset-x-0 bottom-0 rounded-t-[2rem] border border-white/10 bg-[color:var(--bg-elevated)] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-4 shadow-[0_-24px_60px_rgba(0,0,0,0.35)] transition-all duration-200 ${
                isSheetVisible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
              }`}
            >
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/10" />

              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="section-kicker mb-1">Escopo operacional</p>
                  <h3 className="truncate text-base font-semibold text-[color:var(--text-primary)]">
                    {tenantName || 'Empresas'}
                  </h3>
                  <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                    {sheetSummaryLabel}: {sheetSummaryValue}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text-primary)]"
                >
                  <X size={18} />
                </button>
              </div>

              {isLocked && (
                <div className="mb-4 rounded-[1.5rem] border border-[rgba(202,176,122,0.2)] bg-[rgba(202,176,122,0.08)] px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]">
                      <Crown size={15} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[color:var(--text-primary)]">Multiempresa bloqueado</p>
                      <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                        Sua empresa primária continua ativa. Faça upgrade para voltar a alternar entre empresas e usar a visão consolidada.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => handleSelectScope('all')}
                  className={`flex min-h-[52px] w-full items-center gap-3 rounded-[1.35rem] border px-4 py-3 text-left transition-colors ${
                    normalizedScope === 'all'
                      ? 'border-[rgba(202,176,122,0.28)] bg-[rgba(202,176,122,0.08)]'
                      : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-base)]'
                  } ${isLocked ? 'cursor-not-allowed opacity-55' : 'hover:border-[rgba(202,176,122,0.2)] hover:bg-white/[0.03]'}`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(202,176,122,0.12)] text-[color:var(--accent-brass)]">
                    <Building2 size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[color:var(--text-primary)]">{allCompaniesLabel}</div>
                    <div className="mt-0.5 text-[0.68rem] uppercase tracking-[0.16em] text-[color:var(--text-faint)]">
                      Visão consolidada
                    </div>
                  </div>
                  {normalizedScope === 'all' && <Check size={16} className="shrink-0 text-[color:var(--accent-brass)]" />}
                </button>

                {companyOptions.map((company) => {
                  const isActive = normalizedScope === company.id;
                  return (
                    <button
                      key={company.id}
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleSelectScope(company.id)}
                      className={`flex min-h-[52px] w-full items-center gap-3 rounded-[1.35rem] border px-4 py-3 text-left transition-colors ${
                        isActive
                          ? 'border-[rgba(202,176,122,0.28)] bg-[rgba(202,176,122,0.08)]'
                          : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-base)]'
                      } ${isLocked ? 'cursor-not-allowed opacity-55' : 'hover:border-[rgba(202,176,122,0.2)] hover:bg-white/[0.03]'}`}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(202,176,122,0.12)] text-[color:var(--accent-brass)]">
                        <Building2 size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[color:var(--text-primary)]">{company.name}</div>
                        <div className="mt-0.5 text-[0.68rem] uppercase tracking-[0.16em] text-[color:var(--text-faint)]">
                          {company.is_primary ? 'Empresa principal' : 'Empresa'}
                        </div>
                      </div>
                      {isActive && <Check size={16} className="shrink-0 text-[color:var(--accent-brass)]" />}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
                {isLocked ? (
                  <button
                    type="button"
                    onClick={handleUpgrade}
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-[rgba(202,176,122,0.24)] bg-[rgba(202,176,122,0.1)] px-4 py-3 text-sm font-bold uppercase tracking-[0.16em] text-[color:var(--accent-brass)] transition-colors hover:bg-[rgba(202,176,122,0.16)]"
                  >
                    <Crown size={14} />
                    Ver assinatura
                  </button>
                ) : onCreateCompany ? (
                  <button
                    type="button"
                    onClick={handleCreateCompany}
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-[rgba(202,176,122,0.2)] bg-[rgba(202,176,122,0.1)] px-4 py-3 text-sm font-bold uppercase tracking-[0.16em] text-[color:var(--accent-brass)] transition-colors hover:bg-[rgba(202,176,122,0.16)]"
                  >
                    <Plus size={14} />
                    Nova empresa
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (isLocked) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={handleUpgrade}
          className="group flex min-w-0 max-w-[260px] items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-left transition-colors hover:border-[rgba(202,176,122,0.24)] hover:bg-[rgba(202,176,122,0.08)]"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(202,176,122,0.14)] text-[color:var(--accent-brass)]">
            <Building2 size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
              {scopeLabel || tenantName || 'Empresa ativa'}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[color:var(--text-faint)]">
              <Lock size={11} />
              Multiempresa bloqueado
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={handleUpgrade}
          className="shrink-0 whitespace-nowrap rounded-full border border-[rgba(202,176,122,0.24)] bg-[rgba(202,176,122,0.1)] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--accent-brass)] transition-colors hover:bg-[rgba(202,176,122,0.16)]"
        >
          <Crown size={12} />
          Upgrade
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative w-full min-w-[180px] max-w-[280px]">
        <Building2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--accent-brass)]" />
        <select
          value={normalizedScope}
          onChange={(event) => handleSelectScope(event.target.value)}
          className="w-full appearance-none rounded-full border border-white/10 bg-white/[0.03] py-2 pl-10 pr-10 text-sm font-semibold text-[color:var(--text-primary)] outline-none transition-colors hover:border-white/20"
        >
          <option value="all">{tenantName ? `Todas as empresas de ${tenantName}` : 'Todas as empresas'}</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" />
      </div>

      {onCreateCompany && (
        <button
          type="button"
          onClick={handleCreateCompany}
          className="shrink-0 whitespace-nowrap rounded-full border border-[rgba(202,176,122,0.2)] bg-[rgba(202,176,122,0.1)] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--accent-brass)] transition-colors hover:bg-[rgba(202,176,122,0.16)]"
        >
          <Plus size={12} />
          Nova empresa
        </button>
      )}
    </div>
  );
};

export default CompanySwitcher;
