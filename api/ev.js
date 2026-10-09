// POST /api/ev {e:[names]} -> anonymous daily event counters (no personal data)
// GET  /api/ev -> last 14 days of counters
const C = require('./_lib/core');
module.exports = C.handler(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    const out = {};
    for (let i = 0; i < 14; i++) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); const h = await C.redis('HGETALL', 'ev:' + d); const o = {}; for (let j = 0; j < (h || []).length; j += 2) o[h[j]] = +h[j + 1]; if (Object.keys(o).length) out[d] = o; }
    return C.send(res, 200, { days: out });
  }
  const b = await C.readBody(req), d = new Date().toISOString().slice(0, 10);
  const list = (Array.isArray(b.e) ? b.e : []).slice(0, 30).filter(n => /^[a-z0-9_]{1,24}$/.test(n));
  for (const n of list) await C.redis('HINCRBY', 'ev:' + d, n, 1);
  if (list.length) await C.redis('EXPIRE', 'ev:' + d, 60 * 864e2);
  C.send(res, 200, { ok: true, n: list.length });
});
