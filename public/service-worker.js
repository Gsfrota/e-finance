// service-worker.js — cache do app shell para funcionamento offline.
//
// REGRA DURA: este arquivo só mexe na Cache API. Nunca em localStorage nem em
// IndexedDB — é lá que vivem o snapshot da carteira e, na Entrega 3, a fila de
// baixas ainda não sincronizadas. Apagar isso é apagar dinheiro registrado.

const CACHE = 'ef-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Remove apenas caches de versões ANTERIORES deste app.
      caches.keys().then((names) => Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      )),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Só mexe no que é nosso. Supabase e qualquer outra origem passam direto —
  // dado de API não entra em cache de shell.
  if (url.origin !== self.location.origin) return;

  // Navegação: tenta a rede primeiro (para pegar deploy novo), cai no cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached
          || new Response('Sem conexão e sem cópia local do app.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }))),
    );
    return;
  }

  // Assets com hash são imutáveis: cache primeiro, rede só na primeira vez.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
