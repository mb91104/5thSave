const app = require('./index');

// Vercel invokes this with the original /api/... request path. Express routes
// in backend/index.js are declared without the prefix so the same app runs
// directly on a Node server and behind /api on Vercel.
module.exports = function handler(req, res) {
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    req.url = req.url.slice(4) || '/';
  }
  return app(req, res);
};
