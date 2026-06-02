import React from 'react';
import { AlertCircle } from 'lucide-react';
import { logError } from '../services/supabase';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Captura exceções de render em qualquer ponto da árvore e exibe uma tela de erro
 * amigável em vez de desmontar tudo (sintoma "tela azul e some tudo"). O erro real
 * é registrado via logError para diagnóstico em produção.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logError('React render', error);
    console.error(errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center p-8 text-center">
          <div className="panel-card max-w-md rounded-[2rem] p-10">
            <AlertCircle size={56} className="mx-auto mb-6 text-[color:var(--accent-danger)]" />
            <p className="section-kicker mb-2">Erro inesperado</p>
            <h1 className="font-display mb-4 text-4xl text-[color:var(--text-primary)]">Algo deu errado</h1>
            <p className="mb-8 text-sm leading-relaxed text-[color:var(--text-secondary)]">
              Encontramos um problema ao exibir esta tela. Tente novamente — se persistir, recarregue a página.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-full border border-[color:var(--border-strong)] bg-white/[0.04] px-8 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-primary)] transition-all hover:bg-white/[0.08]"
            >
              Tentar Novamente
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
