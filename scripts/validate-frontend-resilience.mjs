import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const validateDist = process.argv.includes('--dist');
const failures = [];

const relative = (filePath) => path.relative(projectRoot, filePath) || '.';

async function readProjectFile(filePath) {
  try {
    return await readFile(path.join(projectRoot, filePath), 'utf8');
  } catch (error) {
    failures.push(`${filePath}: não foi possível ler (${error.message})`);
    return '';
  }
}

function assertCheck(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    return;
  }
  failures.push(message);
  console.error(`✗ ${message}`);
}

async function listTypeScriptFiles(directory) {
  const absoluteDirectory = path.join(projectRoot, directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absoluteEntry = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTypeScriptFiles(relative(absoluteEntry)));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(absoluteEntry);
    }
  }

  return files;
}

const [
  indexHtml,
  indexTsx,
  hookSource,
  cadernetaSource,
  dashboardSource,
  collectionSource,
  serviceWorkerSource,
  nginxSource,
  vercelSource,
  viteConfigSource,
] = await Promise.all([
  readProjectFile('index.html'),
  readProjectFile('index.tsx'),
  readProjectFile('hooks/useDashboardData.ts'),
  readProjectFile('components/dashboard/CadernetaBullet.tsx'),
  readProjectFile('components/Dashboard.tsx'),
  readProjectFile('components/DailyCollectionView.tsx'),
  readProjectFile('public/service-worker.js'),
  readProjectFile('nginx.conf'),
  readProjectFile('vercel.json'),
  readProjectFile('vite.config.ts'),
]);

assertCheck(
  indexHtml.includes('data-testid="pre-react-fallback"')
    && indexHtml.includes('__EF_SHOW_BOOT_ERROR__')
    && indexHtml.includes('__EF_RECOVER_APP__'),
  'HTML contém fallback e recuperação antes do React',
);

const errorBoundaryPosition = indexTsx.indexOf('<ErrorBoundary>');
const toastProviderPosition = indexTsx.indexOf('<ToastProvider>');
assertCheck(
  errorBoundaryPosition >= 0 && toastProviderPosition > errorBoundaryPosition,
  'ErrorBoundary envolve os providers globais',
);

assertCheck(
  hookSource.includes('hasLoaded: boolean')
    && hookSource.includes('hasLoaded: false')
    && hookSource.includes('hasLoaded: true'),
  'hook diferencia primeira carga de refetch',
);

for (const [name, source] of [
  ['Caderneta', cadernetaSource],
  ['Dashboard', dashboardSource],
  ['Cobrança diária', collectionSource],
]) {
  assertCheck(
    source.includes('loading && !hasLoaded'),
    `${name} preserva conteúdo durante refetch`,
  );
}

assertCheck(
  collectionSource.includes('COLLECTION_RENDER_BATCH = 75')
    && collectionSource.includes('visibleItems.slice(0, visibleLimit)')
    && collectionSource.includes('data-testid="daily-collection-card"'),
  'Cobrança diária limita a quantidade de cards montados no DOM',
);

assertCheck(
  serviceWorkerSource.includes('caches.keys()')
    && serviceWorkerSource.includes('caches.delete(cacheName)'),
  'service worker remove caches legados na ativação',
);

for (const stableAsset of ['service-worker.js', 'env-config.js']) {
  const escapedAsset = stableAsset.replace('.', '\\.');
  const locationMatch = nginxSource.match(new RegExp(`location = \\/${escapedAsset}\\s*\\{([\\s\\S]*?)\\}`));
  assertCheck(
    Boolean(locationMatch?.[1].includes('no-cache') && !locationMatch[1].includes('immutable')),
    `Nginx não aplica cache imutável em ${stableAsset}`,
  );
}

let vercelConfig = null;
try {
  vercelConfig = JSON.parse(vercelSource);
} catch (error) {
  failures.push(`vercel.json inválido: ${error.message}`);
}

for (const source of ['/', '/index.html', '/service-worker.js', '/env-config.js', '/version.json']) {
  const rule = vercelConfig?.headers?.find((candidate) => candidate.source === source);
  const cacheControl = rule?.headers?.find((header) => header.key.toLowerCase() === 'cache-control')?.value ?? '';
  assertCheck(
    cacheControl.includes('no-cache') && !cacheControl.includes('immutable'),
    `Vercel revalida ${source}`,
  );
}

assertCheck(
  viteConfigSource.includes('VERCEL_GIT_COMMIT_SHA')
    && viteConfigSource.includes("fileName: 'version.json'")
    && viteConfigSource.includes('commitSha'),
  'build publica version.json com o SHA da Vercel',
);

const immutableAssetRule = vercelConfig?.headers?.find((candidate) => candidate.source === '/assets/(.*)');
const immutableAssetCacheControl = immutableAssetRule?.headers
  ?.find((header) => header.key.toLowerCase() === 'cache-control')?.value ?? '';
assertCheck(
  immutableAssetCacheControl.includes('max-age=31536000')
    && immutableAssetCacheControl.includes('immutable'),
  'Vercel mantém assets com hash em cache imutável',
);

const e2eFiles = await listTypeScriptFiles('e2e');
const focusedTests = [];
for (const filePath of e2eFiles) {
  const source = await readFile(filePath, 'utf8');
  if (/\b(?:test|describe|it)\.only\s*\(/.test(source)) {
    focusedTests.push(relative(filePath));
  }
}
assertCheck(focusedTests.length === 0, `nenhum teste focado com .only (${focusedTests.join(', ') || 'ok'})`);

if (validateDist) {
  const [distHtml, distServiceWorker, distVersionSource] = await Promise.all([
    readProjectFile('dist/index.html'),
    readProjectFile('dist/service-worker.js'),
    readProjectFile('dist/version.json'),
  ]);
  assertCheck(
    distHtml.includes('data-testid="pre-react-fallback"'),
    'bundle de produção mantém o fallback pré-React',
  );
  assertCheck(
    /<script[^>]+type="module"[^>]+src="\/assets\/index-[^"]+\.js"/.test(distHtml)
      && !distHtml.includes('src="/index.tsx"'),
    'bundle de produção referencia entrada com hash',
  );
  assertCheck(
    distServiceWorker.includes('caches.delete(cacheName)'),
    'bundle de produção contém limpeza de caches legados',
  );
  let distVersion = null;
  try {
    distVersion = JSON.parse(distVersionSource);
  } catch (error) {
    failures.push(`dist/version.json inválido: ${error.message}`);
  }
  assertCheck(
    /^[0-9a-f]{7,40}$/i.test(distVersion?.commitSha ?? '')
      && distVersion?.version === distVersion?.commitSha.slice(0, 7)
      && !Number.isNaN(Date.parse(distVersion?.builtAt ?? '')),
    'bundle de produção identifica versão, commit e data do build',
  );
}

if (failures.length > 0) {
  console.error(`\nGate estrutural reprovado (${failures.length} problema(s)):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`\nGate estrutural aprovado${validateDist ? ' (source + dist)' : ' (source)'}.`);
