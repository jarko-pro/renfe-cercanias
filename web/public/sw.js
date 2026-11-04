// Service worker mínimo: solo hace la web instalable en navegadores que lo exigen.
// No cachea nada a propósito, para no servir nunca versiones antiguas de la app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  /* sin respondWith: el navegador hace la petición normal */
});
