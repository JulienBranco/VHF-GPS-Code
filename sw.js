"use strict";

// À synchroniser avec APP_VERSION : un nouveau cache est préparé en entier
// avant de remplacer l'ancien, sans recharger une session radio ouverte.
const APP_VERSION = "3.28.94";
const CACHE_PREFIX = "vhf-gps-code-app-";
const CACHE_NAME = CACHE_PREFIX + APP_VERSION;
const SCOPE = self.registration.scope;
const APP_URL = new URL("vhf_gps_code.html", SCOPE).href;
const INDEX_URL = new URL("index.html", SCOPE).href;
const ROOT_URL = new URL("./", SCOPE).href;
const PRECACHE_URLS = [
  APP_URL,
  INDEX_URL,
  new URL("manifest.webmanifest", SCOPE).href,
  new URL("icons/icon-192.png", SCOPE).href,
  new URL("icons/icon-512.png", SCOPE).href,
  new URL("icons/icon-maskable-512.png", SCOPE).href,
  new URL("icons/apple-touch-icon.png", SCOPE).href
];
const PRECACHE_SET = new Set(PRECACHE_URLS);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Le cache HTTP ne doit pas réintroduire un ancien HTML dans une mise à jour.
    await cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: "reload" })));
    // Pas de skipWaiting : la version utilisée en mer reste active jusqu'à fermeture.
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Les paramètres de suivi ou de partage ne changent pas le contenu local.
  // On garde le chemin exact pour ne pas servir l'application à une autre page.
  const cacheUrl = url.origin + url.pathname;

  if (request.mode === "navigate" &&
      (cacheUrl === APP_URL || cacheUrl === INDEX_URL || cacheUrl === ROOT_URL)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(APP_URL)) || fetch(request);
    })());
    return;
  }

  if (PRECACHE_SET.has(cacheUrl)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(cacheUrl)) || fetch(request);
    })());
  }
});
