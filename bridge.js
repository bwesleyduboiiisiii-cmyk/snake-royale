/*
 * Snake Royale — TikTok LIVE Bridge
 * ---------------------------------
 * Connects to any TikTok LIVE room and forwards gifts / likes / shares /
 * joins / comments to the browser game over a local WebSocket.
 *
 * The game (snake-royale.html) sends { cmd:"connect", username:"@someone" }.
 * This bridge connects to that user's live and streams normalized events back.
 * Change the target live at any time from inside the game — no restart needed.
 *
 * Run:  npm install   then   npm start
 * Optional (recommended for reliability): set a free Euler Stream API key:
 *   Windows PowerShell:  $env:EULER_API_KEY="your-key"; npm start
 *   macOS/Linux:         EULER_API_KEY="your-key" npm start
 */

const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8081;
const EULER_API_KEY = process.env.EULER_API_KEY || undefined;

const wss = new WebSocketServer({ port: PORT });
console.log(`\n🐍  Snake Royale bridge listening on  ws://localhost:${PORT}`);
console.log(EULER_API_KEY
  ? '🔑  Euler Stream API key detected — good.'
  : '⚠️   No EULER_API_KEY set. Using the shared free tier (rate-limited & flaky).\n    Grab a free key at https://www.eulerstream.com and set EULER_API_KEY for reliable connections.\n');

// ---- helpers ----------------------------------------------------------------
function pickAvatar(user) {
  if (!user) return '';
  const p = user.profilePicture || {};
  return (
    (Array.isArray(p.url) && p.url[0]) ||
    (Array.isArray(p.urls) && p.urls[0]) ||
    p.url || user.profilePictureUrl ||
    (Array.isArray(user.profilePictureUrls) && user.profilePictureUrls[0]) ||
    ''
  );
}
function person(user) {
  user = user || {};
  return {
    id: String(user.userId || user.uniqueId || user.nickname || 'anon'),
    uniqueId: user.uniqueId || '',
    name: user.nickname || user.uniqueId || 'Someone',
    avatar: pickAvatar(user),
  };
}
function diamondsOf(data) {
  return (
    (data.extendedGiftInfo && data.extendedGiftInfo.diamond_count) ||
    (data.giftDetails && data.giftDetails.diamondCount) ||
    (data.gift && (data.gift.diamondCount ?? data.gift.diamond_count)) ||
    data.diamondCount || 0
  );
}
function giftNameOf(data) {
  return (
    (data.giftDetails && data.giftDetails.giftName) ||
    (data.gift && data.gift.name) ||
    data.giftName || 'Gift'
  );
}

// ---- per-browser-client session --------------------------------------------
wss.on('connection', (socket) => {
  console.log('▶  Game connected.');
  let conn = null;
  let currentUser = '';

  const send = (obj) => { try { socket.send(JSON.stringify(obj)); } catch (_) {} };
  const status = (state, message, extra) =>
    send(Object.assign({ type: 'status', state, message: message || '' }, extra || {}));

  async function stop() {
    if (conn) { try { await conn.disconnect(); } catch (_) {} conn = null; }
  }

  async function connectTo(raw) {
    const username = String(raw || '').trim().replace(/^@/, '');
    if (!username) { status('error', 'No username given.'); return; }
    await stop();
    currentUser = username;
    status('connecting', `Connecting to @${username}…`);

    const opts = { enableExtendedGiftInfo: true };
    if (EULER_API_KEY) opts.signApiKey = EULER_API_KEY;
    conn = new TikTokLiveConnection(username, opts);

    // ---- map TikTok events -> normalized game events ----
    conn.on(WebcastEvent.GIFT, (d) => {
      // Streakable gifts (giftType === 1) fire repeatedly; only count the final one.
      const isStreak = d.giftType === 1 || (d.gift && d.gift.type === 1);
      if (isStreak && d.repeatEnd === false) return;
      send({
        type: 'event', kind: 'gift', user: person(d.user),
        giftName: giftNameOf(d),
        diamonds: diamondsOf(d),
        repeat: d.repeatCount || 1,
      });
    });

    conn.on(WebcastEvent.LIKE, (d) => {
      send({ type: 'event', kind: 'like', user: person(d.user), likeCount: d.likeCount || 1 });
    });

    conn.on(WebcastEvent.SHARE, (d) => {
      send({ type: 'event', kind: 'share', user: person(d.user) });
    });

    // Some library builds route shares through SOCIAL with a displayType label.
    conn.on(WebcastEvent.SOCIAL, (d) => {
      const label = (d.displayType || '').toLowerCase();
      if (label.includes('share')) send({ type: 'event', kind: 'share', user: person(d.user) });
      else if (label.includes('follow')) send({ type: 'event', kind: 'follow', user: person(d.user) });
    });

    conn.on(WebcastEvent.MEMBER, (d) => {
      send({ type: 'event', kind: 'join', user: person(d.user) });
    });

    conn.on(WebcastEvent.CHAT, (d) => {
      send({ type: 'event', kind: 'chat', user: person(d.user), comment: d.comment || '' });
    });

    conn.on(ControlEvent.DISCONNECTED, () => status('disconnected', `Disconnected from @${currentUser}.`));
    conn.on(WebcastEvent.STREAM_END, () => status('offline', `@${currentUser} ended the live.`));
    conn.on(ControlEvent.ERROR, (e) => console.error('conn error:', e && e.message ? e.message : e));

    try {
      const state = await conn.connect();
      status('connected', `Live: @${currentUser}`, { room: state && state.roomId ? String(state.roomId) : '' });
      console.log(`✅  Connected to @${currentUser} (room ${state && state.roomId})`);
    } catch (err) {
      const msg = (err && err.message) || String(err);
      const offline = /offline|not.*live|LIVE has ended/i.test(msg);
      status(offline ? 'offline' : 'error', offline ? `@${currentUser} isn't live right now.` : `Couldn't connect: ${msg}`);
      console.error(`❌  Connect failed for @${currentUser}: ${msg}`);
      conn = null;
    }
  }

  socket.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.cmd === 'connect') connectTo(msg.username);
    else if (msg.cmd === 'disconnect') { stop(); status('disconnected', 'Stopped.'); }
    else if (msg.cmd === 'ping') send({ type: 'pong' });
  });

  socket.on('close', () => { console.log('⏹  Game disconnected.'); stop(); });
  socket.on('error', () => stop());

  status('idle', 'Bridge ready. Enter a @username in the game and press Connect.');
});
