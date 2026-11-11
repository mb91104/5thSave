// Local simulation of Vercel Services routing for deployment tests:
//   /api, /api/*  -> the Express backend service (original path preserved)
//   everything else -> frontend/dist with SPA fallback
// This is only used by tests/deploy.sh; Vercel does this itself in production.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'frontend', 'dist');
const backend = require('../backend/index.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    return backend(req, res);
  }

  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const candidate = path.normalize(path.join(DIST, pathname === '/' ? 'index.html' : pathname));

  if (candidate.startsWith(DIST) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    res.setHeader('Content-Type', MIME[path.extname(candidate)] || 'application/octet-stream');
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(candidate).pipe(res);
  }

  // SPA fallback, matching the frontend service rewrite in vercel.json.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(path.join(DIST, 'index.html')).pipe(res);
});

const PORT = Number(process.env.PORT || 4567);
server.listen(PORT, () => {
  console.log(`Vercel Services simulation listening on http://127.0.0.1:${PORT}`);
});
