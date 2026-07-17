// SNAKE ROYALE — TikTok LIVE bridge (same pattern as HoardBound v3).
// Listens to a TikTok LIVE and forwards gifts / likes / shares / follows / joins / chat
// to your deployed Vercel app's /api/event endpoint, which writes to Supabase.
// The overlay (hosted on Vercel) reads those rows via Supabase Realtime.
//
// Run:  node bridge.js            (uses TIKTOK_USER from .env)
//   or: node bridge.js someuser   (override the @username; no @ needed)
//
// Debug the raw gift fields:  set DEBUG_GIFTS=1 && node bridge.js

import "dotenv/config";
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";

const USER   = (process.argv[2] || process.env.TIKTOK_USER || "").replace(/^@/, "");
const APP    = (process.env.APP_URL || "").replace(/\/$/, "");            // https://your-app.vercel.app
const SECRET = process.env.EVENT_INGEST_SECRET || "";                    // must match Vercel env var
const SIGN   = process.env.SIGN_API_KEY || process.env.EULER_API_KEY || ""; // free key from eulerstream.com
const DEBUG  = !!process.env.DEBUG_GIFTS;

if (!USER || !APP) {
  console.error("Missing config. Need TIKTOK_USER (or arg) and APP_URL in .env");
  process.exit(1);
}

// ---- de-dupe helpers -------------------------------------------------------
const seen = new Map(); // msgId -> ts
function isDuplicate(key) {
  const t = Date.now();
  for (const [k, ts] of seen) if (t - ts > 15000) seen.delete(k);
  if (seen.has(key)) return true;
  seen.set(key, t);
  return false;
}

// ---- forward one event to the cloud ---------------------------------------
async function post(kind, user, payload) {
  try {
    const res = await fetch(`${APP}/api/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, user, payload, secret: SECRET }),
    });
    const data = await res.json().catch(() => ({}));
    // Show the actual chat text (and whether it counts as a join) so you can see what viewers type.
    let extra = "";
    if (kind === "chat" && payload && payload.comment) {
      const t = String(payload.comment).toLowerCase().replace(/[^a-z0-9\s]/g, " ");
      const isJoin = ["join", "play", "snake"].some(w => t.includes(w));
      extra = `  "${payload.comment}"` + (isJoin ? "  [JOIN ✓]" : "  [not a join]");
    }
    console.log(`-> ${kind.padEnd(6)} ${user.name || "?"}`, res.status, data.error || "ok", extra);
  } catch (e) {
    console.error("post failed:", e.message);
  }
}

function deepFind(obj, keys, depth){
  // breadth-first search for the first non-empty value under any of `keys`
  if(!obj || typeof obj!=="object" || depth>4) return "";
  for(const k of keys){ if(obj[k]!=null && obj[k]!=="" && typeof obj[k]!=="object") return obj[k]; }
  for(const v of Object.values(obj)){
    if(v && typeof v==="object"){ const r=deepFind(v, keys, depth+1); if(r) return r; }
  }
  return "";
}
function pickAvatar(u){
  const cands=[u.profilePicture, u.avatarThumb, u.avatarMedium, u.avatarLarger, u.avatar];
  for(const c of cands){
    if(!c) continue;
    if(typeof c==="string" && c.startsWith("http")) return c;
    if(c.url) return c.url;
    if(Array.isArray(c.urls) && c.urls[0]) return c.urls[0];
    if(Array.isArray(c.urlList) && c.urlList[0]) return c.urlList[0];
    if(Array.isArray(c) && typeof c[0]==="string") return c[0];
  }
  // last resort: any http string that looks like an avatar url anywhere in the object
  const any=deepFind(u, ["url"], 0);
  return (typeof any==="string" && any.startsWith("http")) ? any : "";
}
function mkUser(d) {
  const u = (d && d.user) || d || {};
  const avatar = pickAvatar(u) || pickAvatar(d||{});
  // Prefer the @username (uniqueId) — it's stable and unique. Fall back to numeric id, then deep search.
  const uniqueId = u.uniqueId || u.unique_id || (d && d.uniqueId) || deepFind(u, ["uniqueId","unique_id"], 0) || "";
  const numId    = u.userId || u.user_id || u.secUid || u.id || (d && d.userId) || deepFind(u, ["userId","user_id","secUid"], 0) || "";
  const nickname = u.nickname || u.nickName || (d && d.nickname) || deepFind(u, ["nickname","nickName"], 0) || "";
  const id = String(uniqueId || numId || "");
  return {
    id,
    uniqueId: String(uniqueId||""),
    name:   nickname || uniqueId || "viewer",
    avatar: typeof avatar === "string" ? avatar : "",
  };
}

// ---- connect ---------------------------------------------------------------
const conn = new TikTokLiveConnection(USER, SIGN ? { signApiKey: SIGN } : {});

conn.connect()
  .then(() => console.log(`Connected to @${USER}'s LIVE -> ${APP}/api/event. Leave this window open.`))
  .catch((e) => {
    console.error("connect failed:", (e && e.message) ? e.message : e);
    console.error("\nIf that mentions sign / signature / rate limit: get a FREE key at https://www.eulerstream.com");
    console.error("then add   SIGN_API_KEY=your-key   to your .env and run again.");
    process.exit(1);
  });

conn.on(ControlEvent.DISCONNECTED, () => console.log("Disconnected from TikTok."));
conn.on(WebcastEvent.STREAM_END, () => { console.log("Stream ended."); process.exit(0); });

// GIFT — count streakables only when the streak ends, then de-dupe by message id.
conn.on(WebcastEvent.GIFT, (d) => {
  if (DEBUG) console.log("RAW GIFT:", JSON.stringify(d).slice(0, 500));
  const gd = d.giftDetails || {};
  const streakable = gd.giftType === 1;
  if (streakable && d.repeatEnd === false) return;      // mid-streak tick — skip
  const msgId = d.msgId || `${mkUser(d).id}:${d.giftId}:${d.repeatCount}:${d.createTime || ""}`;
  if (isDuplicate("gift:" + msgId)) return;
  const diamonds = (gd.diamondCount || (d.gift && d.gift.diamondCount) || d.diamondCount || 0) * (d.repeatCount || 1);
  post("gift", mkUser(d), {
    giftName: gd.name || d.giftName || "Gift",
    diamonds,
    repeat: d.repeatCount || 1,
  });
});

conn.on(WebcastEvent.LIKE, (d) => {
  post("like", mkUser(d), { likeCount: d.likeCount || 1 });
});

conn.on(WebcastEvent.SOCIAL, (d) => {
  const t = String(d.displayType || "").toLowerCase();
  if (t.includes("share")) post("share", mkUser(d), {});
  else if (t.includes("follow")) post("follow", mkUser(d), {});
});

conn.on(WebcastEvent.MEMBER, (d) => {
  post("join", mkUser(d), {});
});

let _dumped = 0;
conn.on(WebcastEvent.CHAT, (d) => {
  const comment = d.comment || d.content || "";
  if (!comment) return;
  if (_dumped < 2) { _dumped++; console.log("\n===== RAW CHAT #" + _dumped + " (paste this to your dev) =====\n" + JSON.stringify(d, (k,v)=> typeof v==="bigint" ? v.toString() : v).slice(0, 1500) + "\n====================================\n"); }
  post("chat", mkUser(d), { comment });
});
