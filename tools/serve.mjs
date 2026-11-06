import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

export const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

export async function createStaticServer(root = ROOT) {
  const resolvedRoot = await realpath(root);
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end('Method not allowed'); return; }
    try {
      const rawPath = decodeURIComponent((request.url || '/').split('?')[0]).replaceAll('\\', '/');
      const segments = rawPath.split('/').filter(Boolean);
      if (segments.some((part) => part.startsWith('.') || part.includes('\0') || part.includes(':'))) {
        response.writeHead(403); response.end('Forbidden'); return;
      }
      const target = path.join(resolvedRoot, ...segments, ...(rawPath.endsWith('/') ? ['index.html'] : []));
      const resolved = await realpath(target);
      if (!resolved.startsWith(resolvedRoot + path.sep) || !(await stat(resolved)).isFile()) {
        response.writeHead(403); response.end('Forbidden'); return;
      }
      const body = await readFile(resolved);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] || 'text/plain; charset=utf-8', 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535');
  const server = await createStaticServer();
  server.on('error', (error) => { console.error(`起動できませんでした: ${error.code}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`自律型光背: ${url}\n終了するには Ctrl+C。音は画面の「はじめる」から。`);
    if (process.argv.includes('--open') && process.platform === 'win32') {
      const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
      opener.on('error', () => console.log('ブラウザーで上のURLを開いてください。'));
    }
  });
}
