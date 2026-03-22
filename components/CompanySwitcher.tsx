import React from 'react';
import { Building2, ChevronDown, Crown, Lock, Plus } from 'lucide-react';
import { Company, CompanyAccessMode, CompanyScope } from '../types';

interface CompanySwitcherProps {
  tenantName?: string | null;
  companies: Company[];
  activeCompanyId?: string | null;
  activeCompanyScope?: CompanyScope;
  accessMode?: CompanyAccessMode | null;
  scopeLabel?: string;
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
  onSelectScope,
  onCreateCompany,
  onUpgrade,
}) => {
  const normalizedScope = activeCompanyScope || activeCompanyId || 'all';
  const isLocked = accessMode === 'upsell_locked';

  if (isLocked) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onUpgrade}
          className="group flex min-w-[220px] items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-left transition-colors hover:border-[rgba(202,176,122,0.24)] hover:bg-[rgba(202,176,122,0.08)]"
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
          onClick={onUpgrade}
          className="flex items-center gap-2 rounded-full border border-[rgba(202,176,122,0.24)] bg-[rgba(202,176,122,0.1)] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--accent-brass)] transition-colors hover:bg-[rgba(202,176,122,0.16)]"
        >
          <Crown size={12} />
          Upgrade
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-[220px]">
        <Building2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--accent-brass)]" />
        <select
          value={normalizedScope}
          onChange={(event) => onSelectScope(event.target.value)}
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
          onClick={onCreateCompany}
          className="flex items-center gap-2 rounded-full border border-[rgba(202,176,122,0.2)] bg-[rgba(202,176,122,0.1)] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--accent-brass)] transition-colors hover:bg-[rgba(202,176,122,0.16)]"
        >
          <Plus size={12} />
          Nova empresa
        </button>
      )}
    </div>
  );
};

export default CompanySwitcher;
