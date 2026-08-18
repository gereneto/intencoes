/* Rezar por — cache do app. Suba o número da versão a cada mudança nos arquivos. */
const CACHE = "rezar-por-v2";
const ARQUIVOS = [
  "./", "./index.html", "./estilo.css", "./app.js", "./dados.js",
  "./manifest.json", "./icone-192.png", "./icone-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // dados.js primeiro pela rede, para pegar o que foi enviado ao GitHub
  if (url.pathname.endsWith("dados.js")) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
