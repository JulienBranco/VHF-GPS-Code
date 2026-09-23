// Serve the PWA on localhost without any package or network dependency.
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, extname, normalize, sep } = require('node:path');

const root = join(__dirname, '..');
const port = Number(process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '') || 'index.html';
    const file = join(root, relative);
    if (!file.startsWith(root + sep) || !types[extname(file)]) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[extname(file)],
      'Cache-Control': 'no-cache',
    }).end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`PWA locale : http://localhost:${port}/\n`);
});
