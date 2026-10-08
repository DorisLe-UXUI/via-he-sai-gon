// POST /api/score {cash, day, level, rep, chain, sold, cart, deco} -> update leaderboard + public street card
// GET  /api/score -> top 50 by wealth (cash + assets), with my rank
const C = require('./_lib/core');
const num = (v, a, b) => Math.max(a, Math.min(b, Math.floor(+v || 0)));
module.exports = C.handler(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    const arr = await C.redis('ZREVRANGE', 'lb:wealth', 0, 49, 'WITHSCORES'); const rows = [];
    for (let i = 0; i < arr.length; i += 2) {
      const uid = arr[i], p = await C.redis('HMGET', 'street:' + uid, 'name', 'level', 'day', 'chain', 'cart');
      rows.push({ uid, wealth: +arr[i + 1], name: p[0] || 'Người chơi', level: +p[1] || 1, day: +p[2] || 1, chain: +p[3] || 0, cart: p[4] || 'banhmi' });
    }
    const s = C.session(req); let me = null;
    if (s) { const r = await C.redis('ZREVRANK', 'lb:wealth', s.uid); me = r == null ? null : r + 1; }
    return C.send(res, 200, { rows, me });
  }
  const s = C.needUser(req), b = await C.readBody(req);
  // Sanity limits: the client is untrusted, so cap values and rate limit.
  const last = +(await C.redis('GET', 'rl:score:' + s.uid) || 0);
  if (Date.now() - last < 20_000) throw new C.HttpError(429, 'Gửi điểm quá nhanh.');
  await C.redis('SET', 'rl:score:' + s.uid, Date.now(), 'EX', 60);
  const cash = num(b.cash, 0, 5e9), assets = num(b.assets, 0, 5e9), wealth = cash + assets;
  const name = (await C.redis('HGET', 'user:' + s.uid, 'name')) || 'Người chơi';
  await C.redis('HSET', 'street:' + s.uid, 'name', name, 'level', num(b.level, 1, 999), 'day', num(b.day, 1, 99999), 'chain', num(b.chain, 0, 999), 'cart', C.clean(b.cart, 20), 'rep', num((+b.rep || 0) * 10, 0, 50), 'cash', cash, 'sold', num(b.sold, 0, 1e9), 'deco', C.clean(JSON.stringify(b.deco || {}), 400), 'seen', Date.now());
  await C.redis('ZADD', 'lb:wealth', wealth, s.uid);
  C.send(res, 200, { ok: true, wealth });
});
