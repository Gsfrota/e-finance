import path from 'path';
import { execFileSync } from 'child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

interface BuildVersion {
  version: string;
  commitSha: string;
  ref: string;
  environment: string;
  builtAt: string;
}

function resolveGitCommit(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.COMMIT_SHA
    || process.env.GITHUB_SHA;
  if (fromEnv && fromEnv !== 'dev') return fromEnv.trim();

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'dev';
  }
}

function resolveBuildVersion(): BuildVersion {
  const commitSha = resolveGitCommit();
  const versionOverride = process.env.VITE_APP_VERSION?.trim();

  return {
    version: versionOverride || (commitSha === 'dev' ? 'dev' : commitSha.slice(0, 7)),
    commitSha,
    ref: process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || 'local',
    environment: process.env.VERCEL_ENV || (process.env.CI ? 'ci' : 'development'),
    builtAt: new Date().toISOString(),
  };
}

function emitVersionFile(buildVersion: BuildVersion): Plugin {
  return {
    name: 'emit-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(buildVersion, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(() => {
    const buildVersion = resolveBuildVersion();

    return {
      define: {
        __APP_VERSION__: JSON.stringify(buildVersion.version),
        __BUILD_TIME__: JSON.stringify(buildVersion.builtAt),
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), emitVersionFile(buildVersion)],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
