// POST /api/auth {credential} -> login with Google; DELETE -> logout; GET -> who am I
const C = require('./_lib/core');
module.exports = C.handler(['GET', 'POST', 'DELETE'], async (req, res) => {
  if (req.method === 'DELETE') { C.setCookie(res, '', 0); return C.send(res, 200, { ok: true }); }
  if (req.method === 'GET') {
    const s = C.session(req); if (!s) return C.send(res, 200, { user: null });
    const u = await C.redis('HGETALL', 'user:' + s.uid); const o = {}; for (let i = 0; i < (u || []).length; i += 2) o[u[i]] = u[i + 1];
    return C.send(res, 200, { user: o.name ? { uid: s.uid, name: o.name, picture: o.picture, code: o.code } : null });
  }
  const b = await C.readBody(req);
  if (!b.credential) throw new C.HttpError(400, 'Thiếu credential.');
  const g = await C.googleVerify(b.credential);
  const uid = 'g' + g.sub;
  let code = await C.redis('HGET', 'user:' + uid, 'code');
  if (!code) {
    for (let i = 0; i < 6 && !code; i++) {
      const c = Math.random().toString(36).slice(2, 8).toUpperCase();
      if (await C.redis('SETNX', 'code:' + c, uid)) code = c;
    }
    if (!code) throw new C.HttpError(500, 'Không tạo được mã bạn bè.');
  }
  await C.redis('HSET', 'user:' + uid, 'name', C.clean(g.name, 40), 'picture', C.clean(g.picture, 300), 'code', code, 'seen', Date.now());
  C.setCookie(res, C.sign({ uid }));
  C.send(res, 200, { user: { uid, name: C.clean(g.name, 40), picture: g.picture, code } });
});
