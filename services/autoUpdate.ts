// services/autoUpdate.ts
//
// Atualização automática do app no aparelho do cobrador — sem pedir nada a ele,
// sem "limpar cache". Compara a versão QUE ESTÁ RODANDO (__APP_VERSION__, embutida
// no bundle em build) com a versão NO SERVIDOR (/version.json, servido sem cache).
// Quando diferem, recarrega num momento seguro.
//
// Por que isto importa: uma correção já publicada não resolve nada enquanto o
// aparelho continua abrindo o bundle antigo em cache. Foi o gargalo real — o fix
// existia em produção e o cliente seguia vendo o bug.

declare const __APP_VERSION__: string;

const TARGET_KEY = 'ef_autoupdate_target';
const POLL_MS = 15 * 60 * 1000; // relê /version.json a cada 15 min

/**
 * Decisão pura (testável): deve recarregar para pegar a versão do servidor?
 * - Nunca em `dev` (build local sem commit).
 * - Só quando a versão do servidor difere da que está rodando.
 * - Nunca duas vezes para a MESMA versão-alvo — guarda anti-loop: se um reload não
 *   trouxe a versão nova (ex.: service worker ainda servindo o bundle antigo), não
 *   fica recarregando em loop.
 */
export function shouldReload(
  running: string,
  server: string | null | undefined,
  alreadyReloadedTo: string | null,
): boolean {
  if (!server) return false;
  if (running === 'dev' || server === 'dev') return false;
  if (server === running) return false;
  if (server === alreadyReloadedTo) return false;
  return true;
}

async function fetchServerVersion(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    // Sem rede / offline: não é erro — segue com o que está no aparelho.
    return null;
  }
}

export function startAutoUpdate(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const running = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
  if (running === 'dev') return; // só em produção/preview com versão de build

  let pendingVersion: string | null = null;
  let reloading = false;

  const readTarget = (): string | null => {
    try { return sessionStorage.getItem(TARGET_KEY); } catch { return null; }
  };
  const doReload = (version: string): void => {
    if (reloading) return;
    reloading = true;
    // Marca ANTES de recarregar: se o reload não trouxer a versão nova, o guard
    // impede um novo reload para a mesma versão (anti-loop).
    try { sessionStorage.setItem(TARGET_KEY, version); } catch { /* modo privado */ }
    window.location.reload();
  };

  const check = async (reloadIfVisible: boolean): Promise<void> => {
    const server = await fetchServerVersion();
    if (!shouldReload(running, server, readTarget())) return;
    pendingVersion = server;
    // reloadIfVisible: no cold boot nada está em andamento → pode recarregar já,
    // mesmo com a tela visível (corrige o aparelho que abriu com cache antigo).
    if (reloadIfVisible || document.visibilityState === 'hidden') {
      doReload(server as string);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Cobrador guardou o celular: momento seguro para recarregar (não há baixa
      // sendo digitada à vista). Na próxima abertura, já está na versão nova.
      if (pendingVersion) doReload(pendingVersion);
    } else {
      // Voltou ao app: confere se saiu versão nova enquanto esteve fora.
      void check(false);
    }
  });

  // Boot: aparelho pode ter aberto com bundle antigo em cache → recarrega já.
  void check(true);
  // Enquanto o app fica aberto o dia todo em campo, confere periodicamente.
  window.setInterval(() => void check(false), POLL_MS);
}
