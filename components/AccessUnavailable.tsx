import React from 'react';
import { ShieldOff, LogOut } from 'lucide-react';

interface AccessUnavailableProps {
  onLogout: () => void;
}

/**
 * Tela terminal para perfis sem acesso à aplicação (não-admin).
 * Os painéis de investidor e devedor foram descontinuados em 2026-08.
 */
const AccessUnavailable: React.FC<AccessUnavailableProps> = ({ onLogout }) => (
  <div className="flex min-h-screen items-center justify-center bg-[color:var(--bg-base)] p-6">
    <div className="panel-card w-full max-w-md rounded-[2rem] px-8 py-10 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--bg-soft)]">
        <ShieldOff size={26} className="text-[color:var(--text-muted)]" />
      </div>
      <h1 className="type-title font-display text-[color:var(--text-primary)]">
        Acesso indisponível
      </h1>
      <p className="mt-3 type-body text-[color:var(--text-secondary)]">
        Este acesso foi descontinuado. Fale com o administrador responsável pela sua conta
        para acompanhar seus contratos.
      </p>
      <button
        onClick={onLogout}
        className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--bg-soft)] py-3.5 type-label text-[color:var(--text-primary)] transition-all hover:bg-[color:var(--bg-strong)]"
      >
        <LogOut size={15} />
        Sair
      </button>
    </div>
  </div>
);

export default AccessUnavailable;
