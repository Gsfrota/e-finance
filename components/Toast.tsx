import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de ToastProvider');
  return ctx;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  const icons: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 size={16} className="shrink-0 text-[color:var(--accent-positive)]" />,
    error: <XCircle size={16} className="shrink-0 text-[color:var(--accent-danger)]" />,
    info: <Info size={16} className="shrink-0 text-[color:var(--accent-brass)]" />,
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        role="region"
        aria-live="polite"
        aria-label="Notificações"
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-[color:var(--bg-elevated)] px-4 py-3 shadow-2xl animate-fade-in min-w-[220px] max-w-xs"
          >
            {icons[toast.type]}
            <span className="flex-1 text-sm text-[color:var(--text-primary)]">{toast.message}</span>
            <button
              onClick={() => dismiss(toast.id)}
              aria-label="Fechar notificação"
              className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
