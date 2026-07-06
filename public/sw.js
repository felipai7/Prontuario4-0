// Service worker do PWA — cache do "app shell" (assets estáticos e páginas
// já visitadas) para abrir mais rápido e funcionar minimamente offline.
//
// Deliberadamente NÃO cacheia respostas da API do Supabase: dados clínicos
// (pacientes, sinais vitais, escalas) precisam sempre vir da rede quando
// disponível, para nunca mostrar informação desatualizada sem o usuário
// perceber. Offline, essas chamadas simplesmente falham como de costume.

const CACHE_NAME = 'promed-uti-v2'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'])
    )
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // não intercepta chamadas ao Supabase
  if (url.pathname.startsWith('/api/')) return     // rotas de API sempre frescas

  if (request.mode === 'navigate') {
    // Páginas: tenta a rede primeiro, cai pro cache se estiver offline
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

  // Assets estáticos: cache primeiro, atualiza em segundo plano
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
