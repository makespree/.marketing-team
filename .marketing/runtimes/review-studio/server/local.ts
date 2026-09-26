import { createServer } from 'node:http';
import { handler } from './api.js';
import { config } from './config.js';
import { servicesForRequest } from './services.js';
// Fail before listening if the launcher did not supply an exact local environment.
if (process.env.MARKETING_ENV !== 'local') throw new Error('This server is local-only.');
servicesForRequest();
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ workspaceId: config.workspaceId, projectId: config.local.projectId, environment: 'local' })); return; }
  const parts: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) { res.writeHead(413); res.end('File too large'); return; }
    parts.push(chunk);
  }
  const rawBody = Buffer.concat(parts);
  let body: unknown = rawBody;
  if (req.headers['content-type']?.split(';')[0] === 'application/json') {
    try { body = JSON.parse(rawBody.toString()); } catch { res.writeHead(400); res.end('Invalid JSON'); return; }
  }
  const request = Object.assign(req, { path: url.pathname, query: Object.fromEntries(url.searchParams), rawBody, body,
    get: (name: string) => req.headers[name.toLowerCase()], is: (type: string) => req.headers['content-type']?.split(';')[0] === type });
  const response = { set(name: string, value: string) { res.setHeader(name, value); return response; }, status(code: number) { res.statusCode = code; return response; }, json(value: unknown) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return response; }, send(value: Buffer) { res.end(value); return response; } };
  await handler(request as never, response as never);
}).listen(config.local.ports.api, '127.0.0.1', () => console.log(`Marketing API: http://127.0.0.1:${config.local.ports.api}`));
