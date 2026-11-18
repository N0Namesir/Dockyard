// Solo se guarda la ayuda de conexión y sus imágenes. Nunca la API ni las páginas del aula.
// Cambiar la versión cuando cambie offline.html o alguna imagen de esta lista.
const CACHE = 'dockyard-offline-v1'
const ASSETS = ['/offline.html', '/favicon.svg', '/marca/ds-insamt.png']

async function cached(path) {
  return (await caches.open(CACHE)).match(path)
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('dockyard-offline-') && key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  // No se interceptan operaciones, datos de proyectos ni otros orígenes/puertos.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.status < 500) return response
      } catch { /* El servicio local puede estar apagado. */ }
      return await cached('/offline.html') ?? new Response('Dockyard no está disponible. Vuelve a intentarlo cuando el servicio esté encendido.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    })())
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(cached(url.pathname).then(response => response ?? fetch(request)))
  }
})
