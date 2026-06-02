import path from 'path';
import { execSync } from 'child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Resolve a versão do app: usa o commit do CI (build-arg COMMIT_SHA) quando
// disponível; senão tenta o git local; senão 'dev'. Exibida em Configurações
// para conferir se o cliente está na versão atualizada.
function resolveVersion(): string {
    const fromEnv = process.env.COMMIT_SHA || process.env.VITE_APP_VERSION || process.env.GITHUB_SHA;
    if (fromEnv && fromEnv !== 'dev') return fromEnv.slice(0, 7);
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
        return 'dev';
    }
}

export default defineConfig(() => {
    return {
      define: {
        __APP_VERSION__: JSON.stringify(resolveVersion()),
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
