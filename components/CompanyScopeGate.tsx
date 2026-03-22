import React from 'react';
import { Building2, Layers3 } from 'lucide-react';

interface CompanyScopeGateProps {
  title: string;
  description: string;
  onSelectCompany?: () => void;
  onManageCompanies?: () => void;
}

const CompanyScopeGate: React.FC<CompanyScopeGateProps> = ({
  title,
  description,
  onSelectCompany,
  onManageCompanies,
}) => (
  <div className="panel-card mx-auto max-w-2xl rounded-[2rem] px-8 py-10 text-center">
    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(202,176,122,0.12)] text-[color:var(--accent-brass)]">
      <Layers3 size={28} />
    </div>
    <p className="section-kicker mb-2">Escopo operacional</p>
    <h2 className="type-title text-[color:var(--text-primary)]">{title}</h2>
    <p className="mx-auto mt-3 max-w-xl type-body text-[color:var(--text-secondary)]">{description}</p>

    <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
      {onSelectCompany && (
        <button
          onClick={onSelectCompany}
          className="rounded-full bg-[color:var(--accent-brass)] px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-on-accent)] transition-opacity hover:opacity-90"
        >
          Escolher empresa
        </button>
      )}
      {onManageCompanies && (
        <button
          onClick={onManageCompanies}
          className="flex items-center justify-center gap-2 rounded-full border border-[color:var(--border-strong)] px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-primary)] transition-colors hover:bg-white/[0.04]"
        >
          <Building2 size={14} />
          Gerenciar empresas
        </button>
      )}
    </div>
  </div>
);

export default CompanyScopeGate;
