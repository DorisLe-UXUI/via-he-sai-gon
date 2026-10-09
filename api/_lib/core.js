// Shared helpers: Upstash Redis over REST, signed session cookie, Google ID-token check, JSON helpers.
const crypto = require('crypto');
// Upstash cũng có thể được gắn dưới dạng REDIS_URL / KV_URL (rediss://default:TOKEN@host:6379) -> đổi sang REST
function fromRedisUrl() {
  const u = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL || process.env.KV_URL || '';
  try { const x = new URL(u); if (/upstash\.io$/.test(x.hostname) && x.password) return { url: 'https://' + x.hostname, tok: decodeURIComponent(x.password) }; } catch { }
  return null;
}
const envFind = re => { const k = Object.keys(process.env).find(n => re.test(n) && process.env[n]); return k ? process.env[k] : ''; };
const RURL = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || envFind(/(^|_)(KV|UPSTASH|REDIS)_REST_API_URL$|REDIS_REST_URL$/) || (fromRedisUrl() || {}).url || '';
const RTOK = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || envFind(/(^|_)(KV|UPSTASH|REDIS)_REST_API_TOKEN$|REDIS_REST_TOKEN$/) || (fromRedisUrl() || {}).tok || '';
const SECRET = () => process.env.SESSION_SECRET || '';
// Google Client ID is public by design (it is sent to every browser), so a default is safe to keep in code.
const CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID || '288520258114-mo8lr8cseq71485305qhhtjae3gbcurt.apps.googleusercontent.com';

async function redis(...cmd) {
  if (!RURL() || !RTOK()) throw new HttpError(503, 'Chưa gắn database (thiếu biến môi trường UPSTASH_REDIS_REST_URL / TOKEN).');
  const r = await fetch(RURL(), { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK(), 'Content-Type': 'application/json' }, body: JSON.stringify(cmd.map(String)) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new HttpError(502, 'Database lỗi: ' + (j.error || r.status));
  return j.result;
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const b64u = b => Buffer.from(b).toString('base64url');
function sign(payload, ttlSec = 60 * 60 * 24 * 30) {
  if (!SECRET()) throw new HttpError(503, 'Thiếu SESSION_SECRET.');
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(tok) {
  if (!tok || !SECRET()) return null;
  const [body, sig] = String(tok).split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', SECRET()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() / 1000 ? p : null; } catch { return null; }
}
function cookies(req) { const o = {}; String(req.headers.cookie || '').split(/;\s*/).forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i)] = decodeURIComponent(c.slice(i + 1)); }); return o; }
function session(req) { return verify(cookies(req).vhsg); }
function setCookie(res, tok, maxAge = 60 * 60 * 24 * 30) {
  res.setHeader('Set-Cookie', `vhsg=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { throw new HttpError(400, 'JSON sai.'); } }
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 300_000) throw new HttpError(413, 'Dữ liệu quá lớn.'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new HttpError(400, 'JSON sai.'); }
}
function send(res, status, obj) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }
// wrap handler: method check, error → JSON
const handler = (methods, fn) => async (req, res) => {
  try {
    if (!methods.includes(req.method)) throw new HttpError(405, 'Sai phương thức.');
    await fn(req, res);
  } catch (e) { send(res, e.status || 500, { error: e.status ? e.message : 'Lỗi máy chủ.' }); if (!e.status) console.error(e); }
};
function needUser(req) { const s = session(req); if (!s) throw new HttpError(401, 'Cần đăng nhập.'); return s; }
async function googleVerify(idToken) {
  if (!CLIENT_ID()) throw new HttpError(503, 'Thiếu GOOGLE_CLIENT_ID.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.aud !== CLIENT_ID() || !['accounts.google.com', 'https://accounts.google.com'].includes(j.iss) || j.email_verified === 'false' || !j.sub) throw new HttpError(401, 'Google từ chối đăng nhập.');
  return { sub: j.sub, name: j.name || 'Người chơi', picture: j.picture || '', email: j.email || '' };
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').slice(0, n);
const dbStatus = () => ({ db: !!(RURL() && RTOK()), secret: !!SECRET(), envNames: Object.keys(process.env).filter(n => /REDIS|KV_|UPSTASH|SESSION_SECRET/.test(n)) });
module.exports = { dbStatus, redis, sign, verify, session, setCookie, readBody, send, handler, needUser, googleVerify, HttpError, clean, CLIENT_ID };
