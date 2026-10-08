// /api/auth
//   GET              -> who am I
//   POST {credential}                 -> Google sign-in (ID token)
//   POST {fbToken}                    -> Facebook sign-in (needs FACEBOOK_APP_ID + FACEBOOK_APP_SECRET)
//   POST {email,password,mode,name}   -> email sign-in; mode 'register' | 'login'
//   DELETE           -> sign out
const crypto = require('crypto');
const C = require('./_lib/core');

async function userOut(uid) {
  const u = await C.redis('HGETALL', 'user:' + uid); const o = {};
  for (let i = 0; i < (u || []).length; i += 2) o[u[i]] = u[i + 1];
  return o.name ? { uid, name: o.name, picture: o.picture || '', code: o.code, via: o.via || 'google' } : null;
}
async function upsert(uid, name, picture, via, extra = []) {
  let code = await C.redis('HGET', 'user:' + uid, 'code');
  if (!code) {
    for (let i = 0; i < 6 && !code; i++) {
      const c = Math.random().toString(36).slice(2, 8).toUpperCase();
      if (/^[A-Z0-9]{6}$/.test(c) && await C.redis('SETNX', 'code:' + c, uid)) code = c;
    }
    if (!code) throw new C.HttpError(500, 'Không tạo được mã bạn bè.');
  }
  await C.redis('HSET', 'user:' + uid, 'name', C.clean(name, 40), 'picture', C.clean(picture, 300), 'code', code, 'via', via, 'seen', Date.now(), ...extra);
  return { uid, name: C.clean(name, 40), picture: C.clean(picture, 300), code, via };
}
async function limit(req, key, max, sec) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
  const k = 'rl:' + key + ':' + ip, n = await C.redis('INCR', k);
  if (n === 1) await C.redis('EXPIRE', k, sec);
  if (n > max) throw new C.HttpError(429, 'Thử quá nhiều lần. Đợi vài phút rồi thử lại.');
}
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => e ? no(e) : ok(k)));

async function emailAuth(b) {
  const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(email)) throw new C.HttpError(400, 'Email chưa đúng.');
  if (pw.length < 6 || pw.length > 128) throw new C.HttpError(400, 'Mật khẩu cần từ 6 ký tự.');
  const uid = 'e' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);
  const stored = await C.redis('HGET', 'user:' + uid, 'pw');
  if (b.mode === 'register') {
    if (stored) throw new C.HttpError(409, 'Email này đã có tài khoản. Chuyển sang Đăng nhập.');
    const salt = crypto.randomBytes(16).toString('hex'), h = (await scrypt(pw, salt)).toString('hex');
    const name = C.clean(String(b.name || '').trim(), 40) || email.split('@')[0].slice(0, 20);
    return upsert(uid, name, '', 'email', ['pw', 'scrypt$' + salt + '$' + h, 'email', email]);
  }
  if (!stored) throw new C.HttpError(401, 'Sai email hoặc mật khẩu.');
  const [, salt, h] = String(stored).split('$');
  const got = await scrypt(pw, salt), want = Buffer.from(h, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new C.HttpError(401, 'Sai email hoặc mật khẩu.');
  await C.redis('HSET', 'user:' + uid, 'seen', Date.now());
  return userOut(uid);
}
async function fbAuth(token) {
  const id = process.env.FACEBOOK_APP_ID, sec = process.env.FACEBOOK_APP_SECRET;
  if (!id || !sec) throw new C.HttpError(503, 'Đăng nhập Facebook chưa bật.');
  const d = await (await fetch('https://graph.facebook.com/debug_token?input_token=' + encodeURIComponent(token) + '&access_token=' + encodeURIComponent(id + '|' + sec))).json().catch(() => ({}));
  if (!d.data || !d.data.is_valid || String(d.data.app_id) !== String(id) || !d.data.user_id) throw new C.HttpError(401, 'Facebook từ chối đăng nhập.');
  const me = await (await fetch('https://graph.facebook.com/me?fields=name,picture.type(large)&access_token=' + encodeURIComponent(token))).json().catch(() => ({}));
  return upsert('f' + d.data.user_id, me.name || 'Người chơi', me.picture?.data?.url || '', 'facebook');
}

module.exports = C.handler(['GET', 'POST', 'DELETE'], async (req, res) => {
  if (req.method === 'DELETE') { C.setCookie(res, '', 0); return C.send(res, 200, { ok: true }); }
  if (req.method === 'GET') {
    const s = C.session(req); if (!s) return C.send(res, 200, { user: null });
    return C.send(res, 200, { user: await userOut(s.uid) });
  }
  const b = await C.readBody(req);
  let user;
  if (b.credential) { const g = await C.googleVerify(b.credential); user = await upsert('g' + g.sub, g.name, g.picture, 'google'); }
  else if (b.fbToken) { await limit(req, 'fb', 30, 900); user = await fbAuth(String(b.fbToken)); }
  else if (b.email) { await limit(req, 'em', 20, 900); user = await emailAuth(b); }
  else throw new C.HttpError(400, 'Thiếu thông tin đăng nhập.');
  C.setCookie(res, C.sign({ uid: user.uid }));
  C.send(res, 200, { user });
});
