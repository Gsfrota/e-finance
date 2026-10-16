import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import { startAutoUpdate } from './services/autoUpdate';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Atualização automática: traz a versão nova para o aparelho sem o cobrador
// precisar limpar cache ou reinstalar. Fora da árvore React de propósito —
// é infraestrutura do aparelho, não UI.
startAutoUpdate();
