// GET /api/rt-token            -> short-lived token for the realtime street server (needs login)
// GET /api/rt-token?verify=TOK -> used by the realtime server to check a token -> {uid,name}
const C = require('./_lib/core');
module.exports = C.handler(['GET'], async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const v = q.get('verify');
  if (v) {
    const p = C.verify(v);
    if (!p || p.k !== 'rt') return C.send(res, 401, { error: 'bad token' });
    return C.send(res, 200, { uid: p.uid, name: p.name });
  }
  const s = C.needUser(req);
  const name = (await C.redis('HGET', 'user:' + s.uid, 'name')) || 'Người chơi';
  C.send(res, 200, { token: C.sign({ k: 'rt', uid: s.uid, name: C.clean(name, 24) }, 60 * 60 * 6), url: process.env.RT_URL || '' });
});
