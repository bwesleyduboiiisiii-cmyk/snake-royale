// Vercel serverless function — /api/event
// The local bridge POSTs TikTok events here. We validate a shared secret,
// then insert a row into Supabase `events`. Supabase Realtime pushes it to
// the overlay. This mirrors the HoardBound bridge -> /api -> Supabase pattern.
//
// Required Vercel env vars (Project Settings -> Environment Variables):
//   SUPABASE_URL            = https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE   = your service_role key (server-only, never in the browser)
//   EVENT_INGEST_SECRET     = any long random string (must match the bridge .env)

import { createClient } from "@supabase/supabase-js";

const URL    = process.env.SUPABASE_URL || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE || "";
const SECRET  = process.env.EVENT_INGEST_SECRET || "";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!URL || !SERVICE) { res.status(500).json({ error: "server not configured" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (SECRET && body.secret !== SECRET) { res.status(401).json({ error: "bad secret" }); return; }

  const kind = String(body.kind || "").toLowerCase();
  const allowed = ["gift", "like", "share", "follow", "join", "chat"];
  if (!allowed.includes(kind)) { res.status(400).json({ error: "bad kind" }); return; }

  const u = body.user || {};
  const row = {
    kind,
    user_id:     String(u.id || u.uniqueId || "").slice(0, 120) || null,
    user_name:   String(u.name || u.nickname || "viewer").slice(0, 80),
    user_avatar: String(u.avatar || "").slice(0, 600) || null,
    payload:     (body.payload && typeof body.payload === "object") ? body.payload : {},
  };

  try {
    const sb = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const { error } = await sb.from("events").insert(row);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || String(e) });
  }
}
