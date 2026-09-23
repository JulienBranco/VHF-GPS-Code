const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Script, createContext } = require('node:vm');
const test = require('node:test');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'vhf_gps_code.html'), 'utf8');
const workerSource = readFileSync(join(root, 'sw.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
const origin = 'https://example.test/app/';

test('versions synchronisées et fichiers d’installation présents', () => {
  const htmlVersion = html.match(/const APP_VERSION="([^"]+)"/)[1];
  const workerVersion = workerSource.match(/const APP_VERSION = "([^"]+)"/)[1];
  assert.equal(workerVersion, htmlVersion);
  assert.equal(manifest.start_url, './vhf_gps_code.html');
  assert.equal(manifest.display, 'standalone');
  for (const icon of [...manifest.icons, { src: './icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const file = readFileSync(join(root, icon.src));
    assert.equal(file.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(`${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`, icon.sizes);
  }
});

test('le service worker prépare tous les fichiers et ouvre l’application sans réseau', async () => {
  const handlers = new Map();
  const cacheContents = new Map();
  let online = true;
  let claimed = false;
  let skipWaiting = false;
  class Request {
    constructor(url, options = {}) { this.url = url; this.method = 'GET'; this.mode = options.mode || 'same-origin'; }
  }
  const key = request => typeof request === 'string' ? request : request.url;
  const caches = {
    async open(name) {
      if (!cacheContents.has(name)) cacheContents.set(name, new Map());
      const entries = cacheContents.get(name);
      return {
        async addAll(requests) {
          const fetched = await Promise.all(requests.map(async request => [key(request), await fetchMock(request)]));
          fetched.forEach(([url, response]) => entries.set(url, response));
        },
        async match(request) { return entries.get(key(request)); },
      };
    },
    async keys() { return [...cacheContents.keys()]; },
    async delete(name) { return cacheContents.delete(name); },
  };
  const fetchMock = async request => {
    if (!online) throw new Error('Réseau indisponible');
    const url = key(request);
    return { url, body: url.slice(origin.length) };
  };
  const self = {
    registration: { scope: origin },
    location: { origin: new URL(origin).origin },
    clients: { async claim() { claimed = true; } },
    skipWaiting() { skipWaiting = true; },
    addEventListener(name, handler) { handlers.set(name, handler); },
  };
  new Script(workerSource).runInContext(createContext({ self, caches, Request, URL, Set, Promise, fetch: fetchMock }));
  async function dispatch(name, request) {
    let completion, response;
    handlers.get(name)({
      request,
      waitUntil(promise) { completion = promise; },
      respondWith(promise) { response = promise; },
    });
    if (completion) await completion;
    return response ? await response : undefined;
  }

  await dispatch('install');
  const cacheName = [...cacheContents.keys()][0];
  assert.equal(cacheContents.get(cacheName).size, 7);
  assert.equal(skipWaiting, false);
  cacheContents.set('vhf-gps-code-app-ancienne', new Map());
  await dispatch('activate');
  assert.equal(claimed, true);
  assert.equal(cacheContents.has('vhf-gps-code-app-ancienne'), false);

  online = false;
  const app = await dispatch('fetch', new Request(origin + 'vhf_gps_code.html', { mode: 'navigate' }));
  assert.equal(app.body, 'vhf_gps_code.html');
  const home = await dispatch('fetch', new Request(origin, { mode: 'navigate' }));
  assert.equal(home.body, 'vhf_gps_code.html');
  const icon = await dispatch('fetch', new Request(origin + 'icons/icon-192.png'));
  assert.equal(icon.body, 'icons/icon-192.png');
  assert.equal(await dispatch('fetch', new Request(origin + 'autre.html', { mode: 'navigate' })), undefined);
});
