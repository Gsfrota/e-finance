# PWA-002 — manifest.json + ícones + meta tags Apple → app instalável no iOS/Android

**Agentes:** @sm → @po → @dev → @qa → @devops
**Status:** Ready
**Criada em:** 2026-06-24
**Prioridade:** P0 — app não instalável no iPhone (reclamação direta do cliente)
**Complexidade:** S (3 arquivos novos + 1 modificado, sem migration, sem lógica nova)
**Banco:** sem mudança de schema
**Valor:** Habilita instalação do PWA no iOS/Android e elimina o modo browser-tab como único acesso móvel

---

## 1. Problema

Após o merge de PWA-001 (remoção do importmap), o app renderiza corretamente em iOS. Porém **não pode ser instalado como PWA** pois:

- Não existe `manifest.json` — browsers não reconhecem o app como instalável
- Não existem ícones em formato PNG — iOS/Android exigem arquivos de bitmap, não SVG inline
- Não existem meta tags Apple (`apple-mobile-web-app-capable`, `apple-touch-icon`, `apple-mobile-web-app-status-bar-style`) — Safari ignora o manifest para fins de instalação e usa meta tags proprietárias
- O `service-worker.js` existente (`public/service-worker.js`) não está registrado no `index.html` nem em nenhum arquivo JS — o SW existe mas nunca é instalado pelo browser

O `service-worker.js` atual apenas faz proxy do Gemini, o que é suficiente para o iOS aceitar o app como PWA (iOS não exige estratégia de cache offline para install).

## 2. Acceptance Criteria

- **AC-1:** `public/manifest.json` existe com campos obrigatórios: `name`, `short_name`, `start_url`, `display: "standalone"`, `background_color`, `theme_color`, `icons` (192px e 512px).
- **AC-2:** `public/icons/icon-192.png` e `public/icons/icon-512.png` existem como arquivos PNG válidos gerados a partir do SVG do logo.
- **AC-3:** `public/icons/apple-touch-icon.png` existe com 180×180px.
- **AC-4:** `index.html` contém `<link rel="manifest" href="/manifest.json">`.
- **AC-5:** `index.html` contém `<meta name="apple-mobile-web-app-capable" content="yes">`.
- **AC-6:** `index.html` contém `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`.
- **AC-7:** `index.html` contém `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`.
- **AC-8:** O service worker `public/service-worker.js` é registrado no `index.html` com um bloco `<script>` inline (feature-detect + registro assíncrono).
- **AC-9:** `npm run build` passa sem erros TypeScript.
- **AC-10:** Lighthouse PWA score ≥ 80 em `http://localhost:4173` (ou equivalente manual: DevTools → Application → Manifest mostra todos os campos, SW aparece como registrado).

## 3. Implementação

### AC-1 — `public/manifest.json`

```json
{
  "name": "Juros Certo",
  "short_name": "Juros Certo",
  "description": "Gestão de crédito para investidores e devedores",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0f1d33",
  "theme_color": "#14b8a6",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

### AC-2 e AC-3 — Gerar ícones PNG

O logo atual é um SVG inline no `<link rel="icon">` do `index.html`. Extrair esse SVG para `public/icons/logo.svg` e converter com `sharp` ou `canvas` via script Node, ou gerar diretamente via script com `canvas`.

**Abordagem recomendada — script Node sem deps externas:**

```js
// scripts/generate-icons.cjs
const { createCanvas } = require('canvas');
// Gera icon-192.png, icon-512.png, apple-touch-icon.png
// usando as cores do tema: teal (#14b8a6) sobre fundo ink (#0f1d33)
```

Se `canvas` não estiver disponível, usar `sharp` (já pode estar em node_modules via Vite).
Alternativa: criar os PNGs como arquivos binários base64 hardcoded (fallback último recurso).

**Conteúdo visual mínimo aceito:** fundo `#0f1d33`, logo "JC" em branco centralizado, bordas arredondadas. O design exato não é crítico — o objetivo é ter um ícone válido.

### AC-4 a AC-7 — Meta tags em `index.html`

Inserir no `<head>`, logo após a linha do `<link rel="icon">`:

```html
<!-- PWA -->
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#14b8a6">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Juros Certo">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
```

### AC-8 — Registro do Service Worker

Inserir no `<head>` ou no final do `<body>` de `index.html`:

```html
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/service-worker.js');
    });
  }
</script>
```

**Não** usar `await` ou `.then()` complexo — manter o registro fire-and-forget para não bloquear o carregamento.

### Fora de escopo

- Estratégia de cache offline completa (Workbox, precache) — story futura PWA-003
- Migração do Tailwind de CDN para PostCSS — story futura
- Tela de splash personalizada no iOS (controlada pelo `apple-mobile-web-app-status-bar-style` + ícone)
- Push notifications

### Riscos

- **Geração de ícones:** depende de lib Node disponível (`canvas` ou `sharp`). Se nenhuma disponível, criar PNGs mínimos válidos via outra abordagem (ex: script Python com Pillow, ou converter SVG via Inkscape/ImageMagick se disponível no sistema).
- **Service Worker em dev:** em `npm run dev` (porta 3000, HTTP), o SW só funciona em localhost — normal.
- **HTTPS em produção:** Cloud Run já serve HTTPS — sem bloqueio.

## 4. File List

- [x] `public/manifest.json` — criado
- [x] `public/icons/icon-192.png` — gerado via `scripts/generate-icons.py`
- [x] `public/icons/icon-512.png` — gerado via `scripts/generate-icons.py`
- [x] `public/icons/apple-touch-icon.png` — gerado 180×180
- [x] `index.html` — link manifest + meta tags Apple + registro SW adicionados
- [x] `scripts/generate-icons.py` — script de geração (pure Python stdlib)

## 5. QA Results

**Gate: PASS** — 2026-06-24 — Quinn (@qa)

| AC | Resultado |
|---|---|
| AC-1 `manifest.json` com campos obrigatórios | ✅ name, short_name, start_url, display:standalone, background_color, theme_color, icons (192+512) |
| AC-2 `icon-192.png` e `icon-512.png` | ✅ dist/icons/ — presentes como PNG válidos |
| AC-3 `apple-touch-icon.png` 180×180 | ✅ dist/icons/ — presente |
| AC-4 `<link rel="manifest">` no index.html | ✅ linha 8 do dist/index.html |
| AC-5 `apple-mobile-web-app-capable` | ✅ linha 10 |
| AC-6 `apple-mobile-web-app-status-bar-style` | ✅ linha 11 |
| AC-7 `<link rel="apple-touch-icon">` | ✅ linha 13 |
| AC-8 registro do service worker | ✅ linha 72 — feature-detect + addEventListener('load') |
| AC-9 `npm run build` | ✅ verde (exit 0, 43s) |
| AC-10 Lighthouse / DevTools | ⚠️ não executado — requer browser aberto em localhost:4173 |

**Concern (LOW):** AC-10 (Lighthouse) não verificado automaticamente — requer servidor preview rodando. Validar manualmente em DevTools → Application → Manifest após próximo deploy.
