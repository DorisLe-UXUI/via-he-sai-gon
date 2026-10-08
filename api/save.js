// GET /api/save -> cloud save; PUT /api/save {data, updatedAt, baseUpdatedAt} -> store (rejects stale overwrite unless force)
const C = require('./_lib/core');
module.exports = C.handler(['GET', 'PUT'], async (req, res) => {
  const s = C.needUser(req), key = 'save:' + s.uid;
  if (req.method === 'GET') {
    const raw = await C.redis('GET', key); if (!raw) return C.send(res, 200, { save: null });
    return C.send(res, 200, { save: JSON.parse(raw) });
  }
  const b = await C.readBody(req);
  if (!b.data || typeof b.data !== 'object') throw new C.HttpError(400, 'Thiếu data.');
  const str = JSON.stringify(b.data); if (str.length > 200_000) throw new C.HttpError(413, 'Save quá lớn.');
  const cur = await C.redis('GET', key), now = Date.now();
  if (cur && !b.force) { const c = JSON.parse(cur); if (c.updatedAt > (+b.baseUpdatedAt || 0)) return C.send(res, 409, { error: 'Bản trên máy chủ mới hơn.', save: c }); }
  const rec = { data: b.data, updatedAt: now };
  await C.redis('SET', key, JSON.stringify(rec));
  C.send(res, 200, { ok: true, updatedAt: now });
});
