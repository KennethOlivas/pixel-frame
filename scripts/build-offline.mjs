import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../dist/', import.meta.url);
async function walk(url, prefix = '') {
  const entries = await readdir(url, { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(new URL(`${entry.name}/`, url), `${prefix}${entry.name}/`) : [`/${prefix}${entry.name}`]));
  return groups.flat().filter(path => !path.endsWith('/sw.js') && !path.endsWith('.map'));
}
const paths = await walk(root);
const html = await readFile(new URL('index.html', root), 'utf8');
const version = createHash('sha256').update(html).update(paths.join('\n')).digest('hex').slice(0, 12);
const cache = `pixelframe-${version}`;
await writeFile(new URL('sw.js', root), `
const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(paths)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('pixelframe-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
    for (const client of await self.clients.matchAll()) client.postMessage({type:'OFFLINE_READY'});
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(url.pathname === '/' ? '/index.html' : url.pathname, { ignoreVary: true });
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (error) { if (event.request.mode === 'navigate') return await cache.match('/index.html'); throw error; }
  })());
});
`);
console.log(`Offline bundle ready: ${paths.length} local assets (${cache}).`);
