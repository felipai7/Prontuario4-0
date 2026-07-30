// Service worker do PWA — cache do "app shell" (assets estáticos e páginas
// já visitadas) para abrir mais rápido e funcionar minimamente offline.
//
// ⚠️  ESTE É UM TEMPLATE. O arquivo servido (public/sw.js) é GERADO a cada build
// por scripts/gen-sw.mjs, que troca __SW_VERSION__ pelo hash do commit. É essa
// troca que faz o navegador perceber que existe versão nova a cada deploy.
// Não edite public/sw.js à mão — edite aqui.
//
// Deliberadamente NÃO cacheia respostas da API do Supabase: dados clínicos
// (pacientes, sinais vitais, escalas) precisam sempre vir da rede quando
// disponível, para nunca mostrar informação desatualizada sem o usuário
// perceber. Offline, essas chamadas simplesmente falham como de costume.

const SW_VERSION = '__SW_VERSION__'
const CACHE_NAME = 'promed-uti-' + SW_VERSION
const PRECACHE = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  // NÃO chamamos skipWaiting() aqui, de propósito. Numa UTI, deixar a versão
  // nova assumir no meio de um atendimento faz o app já aberto (JavaScript
  // antigo) pedir arquivos que o deploy novo renomeou → tela branca. Em vez
  // disso a versão nova fica "esperando", e a página avisa o usuário para
  // atualizar na hora que ele escolher (ver components/pwa/ServiceWorkerRegister).
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  )
})

// A página manda esta mensagem quando o usuário toca em "Atualizar": só então a
// versão nova assume, e a página recarrega limpa logo em seguida.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // não intercepta chamadas ao Supabase
  if (url.pathname.startsWith('/api/')) return     // rotas de API sempre frescas

  if (request.mode === 'navigate') {
    // Páginas: tenta a rede primeiro, cai pro cache se estiver offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/dashboard')))
    )
    return
  }

  // Assets estáticos: cache primeiro, atualiza em segundo plano. Os arquivos do
  // Next.js têm hash no nome, então um nome novo é sempre conteúdo novo — servir
  // do cache o que já foi baixado é seguro.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return response
      }).catch(() => cached)
      return cached || fetchPromise
    })
  )
})
