// Необязательный локальный просмотр. Только Node.js, npm install не нужен.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.STATIC_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STATIC_PORT must be between 1 and 65535.');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8' };
const within = target => { const value = relative(root, target); return !isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`); };
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Static preview only'); }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(403); return res.end('Forbidden'); }
    let target = resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
    if (!within(target)) { res.writeHead(403); return res.end('Forbidden'); }
    target = await realpath(target);
    if (!within(target) || !(await stat(target)).isFile() || !mime[extname(target)]) { res.writeHead(404); return res.end('Not found'); }
    res.setHeader('Content-Type', mime[extname(target)]);
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(target));
  } catch (error) {
    res.writeHead(error instanceof URIError ? 400 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Страница не найдена. Откройте /index.html');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Задайте другой STATIC_PORT или закройте предыдущий preview.` : 'Не удалось запустить локальный просмотр.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`HYDRA frontend: http://127.0.0.1:${port}/\nCtrl+C — остановить. База и API не используются.`));
