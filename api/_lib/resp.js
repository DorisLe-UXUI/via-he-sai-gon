// Minimal Redis client over TCP/TLS (RESP2) for when only REDIS_URL is provided (e.g. Redis Cloud via Vercel).
const net = require('net'), tls = require('tls');
let conn = null;
function encode(args) { let s = '*' + args.length + '\r\n'; for (const a of args) { const b = Buffer.from(String(a)); s += '$' + b.length + '\r\n' + b.toString('binary') + '\r\n'; } return Buffer.from(s, 'binary'); }
// returns [value, nextOffset] or null if incomplete
function parse(buf, i) {
  if (i >= buf.length) return null;
  const t = String.fromCharCode(buf[i]), e = buf.indexOf('\r\n', i);
  if (e < 0) return null;
  const line = buf.toString('utf8', i + 1, e);
  if (t === '+') return [line, e + 2];
  if (t === '-') return [new Error(line), e + 2];
  if (t === ':') return [Number(line), e + 2];
  if (t === '$') { const n = +line; if (n < 0) return [null, e + 2]; if (buf.length < e + 2 + n + 2) return null; return [buf.toString('utf8', e + 2, e + 2 + n), e + 2 + n + 2]; }
  if (t === '*') { const n = +line; if (n < 0) return [null, e + 2]; const out = []; let j = e + 2; for (let k = 0; k < n; k++) { const r = parse(buf, j); if (!r) return null; out.push(r[0]); j = r[1]; } return [out, j]; }
  return [new Error('Bad reply'), buf.length];
}
function connect(url) {
  return new Promise((ok, no) => {
    const u = new URL(url), secure = u.protocol === 'rediss:', port = +u.port || 6379;
    const sock = secure ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port });
    const c = { sock, buf: Buffer.alloc(0), q: [], ready: false };
    sock.setTimeout(8000, () => sock.destroy(new Error('Redis timeout')));
    sock.on('data', d => { c.buf = Buffer.concat([c.buf, d]); let r; while (c.q.length && (r = parse(c.buf, 0))) { c.buf = c.buf.slice(r[1]); const p = c.q.shift(); r[0] instanceof Error ? p.no(r[0]) : p.ok(r[0]); } });
    const fail = err => { if (conn === c) conn = null; while (c.q.length) c.q.shift().no(err); };
    sock.on('error', e => { fail(e); no(e); }); sock.on('close', () => fail(new Error('Redis closed')));
    sock.on(secure ? 'secureConnect' : 'connect', async () => {
      c.send = args => new Promise((o, n) => { c.q.push({ ok: o, no: n }); sock.write(encode(args)); });
      try {
        const pw = decodeURIComponent(u.password || ''), user = decodeURIComponent(u.username || '');
        if (pw) await c.send(user && user !== 'default' ? ['AUTH', user, pw] : ['AUTH', pw]);
        const db = (u.pathname || '').slice(1); if (db) await c.send(['SELECT', db]);
        ok(c);
      } catch (e) { sock.destroy(); no(e); }
    });
  });
}
async function cmd(url, args) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { if (!conn) conn = connect(url).catch(e => { conn = null; throw e; }); const c = await conn; return await c.send(args); }
    catch (e) { conn = null; if (attempt) throw e; if (/WRONGTYPE|ERR/.test(e.message) && !/closed|timeout|ECONN/.test(e.message)) throw e; }
  }
}
module.exports = { cmd };
