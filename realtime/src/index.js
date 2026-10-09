// Vỉa Hè Sài Gòn · phố online: thấy người chơi khác trên cùng con phố + chat
// Mỗi phòng (thành phố, có chia ca khi đông) là một Durable Object giữ các kết nối WebSocket.
const MAX_ROOM = 40, HIST = 40;
const BAD = ['địt', 'dit me', 'đ m', 'đm', 'dm', 'đmm', 'dmm', 'vl', 'vcl', 'vkl', 'cl', 'clm', 'lồn', 'lon', 'cặc', 'cac', 'buồi', 'đéo', 'deo', 'đĩ', 'cave', 'óc chó', 'oc cho', 'thằng chó', 'con chó', 'mẹ mày', 'me may', 'fuck', 'shit', 'bitch', 'dick', 'pussy'];
const badRe = new RegExp('(^|[^\\p{L}])(' + BAD.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*')).join('|') + ')(?=$|[^\\p{L}])', 'giu');
function clean(s) {
  s = String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120);
  s = s.replace(/https?:\/\/\S+|www\.\S+|\b\S+\.(com|net|vn|io|xyz|link|me)\b\S*/gi, '[link]');
  s = s.replace(/\b\d{9,11}\b/g, '[số]');
  return s.replace(badRe, (m, a, w) => a + '*'.repeat([...w].length));
}
const vcache = new Map();
async function verify(t, env) {
  if (!t || t.length > 600) return null;
  const c = vcache.get(t); if (c && c.exp > Date.now()) return c.who;
  try {
    const r = await fetch(env.VERIFY_URL + '?verify=' + encodeURIComponent(t), { headers: { 'User-Agent': 'vhsg-realtime' } });
    if (!r.ok) return null; const j = await r.json(); if (!j.uid) return null;
    const who = { uid: String(j.uid).slice(0, 60), name: String(j.name || 'Người chơi').slice(0, 24) };
    vcache.set(t, { who, exp: Date.now() + 60_000 }); if (vcache.size > 2000) vcache.clear(); return who;
  } catch { return null; }
}
const cors = (env, req) => { const o = req.headers.get('Origin') || ''; const ok = (env.ALLOWED_ORIGINS || '').split(',').includes(o) || /^http:\/\/localhost(:\d+)?$/.test(o); return { 'Access-Control-Allow-Origin': ok ? o : 'null', 'Vary': 'Origin' }; };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health') return new Response(JSON.stringify({ ok: true, service: 'vhsg-realtime' }), { headers: { 'content-type': 'application/json', ...cors(env, req) } });
    const m = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]{1,40})$/);
    if (!m) return new Response('Not found', { status: 404 });
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    if (!allowed) return new Response('Forbidden origin', { status: 403 });
    const id = env.ROOM.idFromName(m[1]);
    return env.ROOM.get(id).fetch(req);
  }
};

export class Room {
  constructor(state, env) { this.state = state; this.env = env; this.hist = null; }
  async loadHist() { if (!this.hist) this.hist = (await this.state.storage.get('hist')) || []; return this.hist; }
  others(except) { return this.state.getWebSockets().filter(w => w !== except); }
  info(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  pub(a) { return { u: a.uid, n: a.name, x: a.x, d: a.d, m: a.m, o: a.o, l: a.l, c: a.c }; }
  bcast(obj, except) { const s = JSON.stringify(obj); for (const w of this.others(except)) { try { w.send(s); } catch { } } }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket only', { status: 426 });
    const url = new URL(req.url);
    const who = await verify(url.searchParams.get('t'), this.env);
    if (!who) return new Response('Unauthorized', { status: 401 });
    // đá kết nối cũ của cùng tài khoản
    for (const w of this.state.getWebSockets()) { if (this.info(w).uid === who.uid) { try { w.close(4002, 'replaced'); } catch { } } }
    const live = this.state.getWebSockets().filter(w => this.info(w).uid !== who.uid);
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    if (live.length >= MAX_ROOM) { server.send(JSON.stringify({ t: 'full' })); server.close(4001, 'full'); return new Response(null, { status: 101, webSocket: client }); }
    const a = { uid: who.uid, name: who.name, x: 0, d: 1, m: 0, o: 0, l: '', c: '', lc: 0, lp: 0, rep: [] };
    server.serializeAttachment(a);
    const hist = await this.loadHist();
    server.send(JSON.stringify({ t: 'hi', me: who.uid, players: live.map(w => this.pub(this.info(w))).filter(p => p.u), hist }));
    this.bcast({ t: 'join', p: this.pub(a) }, server);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 600) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const a = this.info(ws); if (!a.uid) return; const now = Date.now();
    if (msg.t === 'p') { // vị trí
      if (now - a.lp < 120) return; a.lp = now;
      a.x = Math.max(-1e5, Math.min(1e6, Math.round(+msg.x || 0))); a.d = msg.d < 0 ? -1 : 1; a.m = msg.m ? 1 : 0; a.o = msg.o ? 1 : 0;
      if (typeof msg.l === 'string') a.l = msg.l.replace(/[^a-zA-Z0-9_/]/g, '').slice(0, 40);
      if (typeof msg.c === 'string') a.c = msg.c.replace(/[^a-zA-Z0-9_/]/g, '').slice(0, 60);
      ws.serializeAttachment(a);
      this.bcast({ t: 'p', u: a.uid, x: a.x, d: a.d, m: a.m, o: a.o, l: a.l, c: a.c }, ws);
    } else if (msg.t === 'chat') {
      if (a.muted) { ws.send(JSON.stringify({ t: 'sys', m: 'Mày đang bị tạm khoá chat do bị báo cáo nhiều.' })); return; }
      if (now - a.lc < 1500) { ws.send(JSON.stringify({ t: 'sys', m: 'Chat chậm lại chút nha.' })); return; }
      const text = clean(msg.m); if (!text) return; a.lc = now; ws.serializeAttachment(a);
      const out = { t: 'chat', u: a.uid, n: a.name, m: text, ts: now };
      const hist = await this.loadHist(); hist.push(out); while (hist.length > HIST) hist.shift(); await this.state.storage.put('hist', hist);
      ws.send(JSON.stringify(out)); this.bcast(out, ws);
    } else if (msg.t === 'emo') {
      const e = ['wave', 'heart', 'laugh', 'fire', 'like', 'buy'].includes(msg.e) ? msg.e : null; if (!e) return;
      if (now - (a.le || 0) < 800) return; a.le = now; ws.serializeAttachment(a);
      this.bcast({ t: 'emo', u: a.uid, e }, ws);
    } else if (msg.t === 'report') {
      const target = this.state.getWebSockets().find(w => this.info(w).uid === msg.u); if (!target) return;
      const ta = this.info(target); ta.rep = ta.rep || []; if (!ta.rep.includes(a.uid)) ta.rep.push(a.uid);
      if (ta.rep.length >= 3 && !ta.muted) { ta.muted = true; try { target.send(JSON.stringify({ t: 'sys', m: 'Mày bị khoá chat trong phòng này do nhiều người báo cáo.' })); } catch { } }
      target.serializeAttachment(ta); ws.send(JSON.stringify({ t: 'sys', m: 'Đã gửi báo cáo. Cảm ơn mày.' }));
    } else if (msg.t === 'ping') { ws.send('{"t":"pong"}'); }
  }
  async webSocketClose(ws) { const a = this.info(ws); if (a.uid) this.bcast({ t: 'leave', u: a.uid }, ws); }
  async webSocketError(ws) { const a = this.info(ws); if (a.uid) this.bcast({ t: 'leave', u: a.uid }, ws); }
}
