// GET  /api/friends                -> my friends with their street cards
// POST /api/friends {code}         -> add friend by code (mutual)
// POST /api/friends {visit: uid}   -> visit a friend's street (returns card, gives both a small bonus once per day)
const C = require('./_lib/core');
async function card(uid) {
  const p = await C.redis('HGETALL', 'street:' + uid); const o = {}; for (let i = 0; i < (p || []).length; i += 2) o[p[i]] = p[i + 1];
  const name = o.name || (await C.redis('HGET', 'user:' + uid, 'name')) || 'Người chơi';
  let deco = {}; try { deco = JSON.parse(o.deco || '{}'); } catch { }
  return { uid, name, level: +o.level || 1, day: +o.day || 1, chain: +o.chain || 0, cart: o.cart || 'banhmi', rep: (+o.rep || 0) / 10, cash: +o.cash || 0, sold: +o.sold || 0, deco, seen: +o.seen || 0 };
}
module.exports = C.handler(['GET', 'POST'], async (req, res) => {
  const s = C.needUser(req);
  if (req.method === 'GET') {
    const ids = await C.redis('SMEMBERS', 'friends:' + s.uid); const out = [];
    for (const id of ids.slice(0, 100)) out.push(await card(id));
    return C.send(res, 200, { friends: out });
  }
  const b = await C.readBody(req);
  if (b.code) {
    const code = C.clean(b.code, 8).toUpperCase().trim(), uid = await C.redis('GET', 'code:' + code);
    if (!uid) throw new C.HttpError(404, 'Không có mã bạn bè này.');
    if (uid === s.uid) throw new C.HttpError(400, 'Đó là mã của chính mày.');
    if ((await C.redis('SCARD', 'friends:' + s.uid)) >= 100) throw new C.HttpError(400, 'Tối đa 100 bạn.');
    await C.redis('SADD', 'friends:' + s.uid, uid); await C.redis('SADD', 'friends:' + uid, s.uid);
    return C.send(res, 200, { ok: true, friend: await card(uid) });
  }
  if (b.visit) {
    const id = C.clean(b.visit, 60);
    if (!(await C.redis('SISMEMBER', 'friends:' + s.uid, id))) throw new C.HttpError(403, 'Chưa là bạn.');
    const day = new Date().toISOString().slice(0, 10), k = `visit:${day}:${s.uid}:${id}`;
    const first = await C.redis('SET', k, 1, 'NX', 'EX', 90000);
    return C.send(res, 200, { friend: await card(id), bonus: first ? 5 : 0 });
  }
  throw new C.HttpError(400, 'Thiếu code hoặc visit.');
});
