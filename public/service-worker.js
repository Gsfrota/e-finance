// service-worker.js — limpa o SW legado do Google AI Studio e
// encaminha /api-proxy/ para generativelanguage.googleapis.com

const GEMINI_HOST = 'generativelanguage.googleapis.com';
const PROXY_PREFIX = '/api-proxy/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercepta chamadas diretas ao Gemini (path base do AI Studio antigo)
  if (url.hostname === GEMINI_HOST) {
    const proxyUrl = `${self.location.origin}${PROXY_PREFIX}${url.pathname.replace(/^\//, '')}${url.search}`;
    console.log('Service Worker: Proxying to', proxyUrl);

    event.respondWith(
      fetch(new Request(proxyUrl, {
        method: event.request.method,
        headers: event.request.headers,
        body: event.request.method !== 'GET' ? event.request.body : undefined,
        duplex: 'half',
      }))
    );
  }
  // Tudo mais: comportamento padrão
});
