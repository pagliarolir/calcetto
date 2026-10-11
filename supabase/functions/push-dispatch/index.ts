// Spedisce come Web Push le notifiche accodate nella tabella "notifications".
// Viene chiamata dal database (pg_net) a ogni nuovo inserimento e dallo scheduler.
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import webpush from "npm:web-push@3.6.7";
import { signAction } from "../_shared/token.ts";

const env = (k: string, fallback?: string) => {
  const v = Deno.env.get(k) ?? fallback;
  if (v === undefined) throw new Error(`Variabile ${k} mancante`);
  return v;
};

const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const DISPATCH_SECRET = env("DISPATCH_SECRET");
const ACTION_SECRET = env("QUICK_ACTION_SECRET");

webpush.setVapidDetails(env("VAPID_SUBJECT", "mailto:calcetto@example.com"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

interface QueuedNotification {
  id: number;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  match_id: string | null;
  actions: { action: string; title: string }[] | null;
}

interface Subscription {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function payloadFor(n: QueuedNotification) {
  // URL firmati per ogni pulsante: il service worker li chiama con un semplice POST
  const actionUrls: Record<string, string> = {};
  if (n.actions?.length && n.match_id) {
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    for (const a of n.actions) {
      const t = await signAction({ u: n.user_id, m: n.match_id, a: a.action, exp }, ACTION_SECRET);
      actionUrls[a.action] = `${SUPABASE_URL}/functions/v1/quick-action?t=${encodeURIComponent(t)}`;
    }
  }
  // Formato atteso dal service worker di Angular: { notification: {...} }
  return {
    notification: {
      title: n.title,
      body: n.body,
      icon: "icons/icon-192x192.png",
      badge: "icons/badge-72x72.png",
      tag: n.match_id ? `${n.kind}:${n.match_id}` : n.kind,
      renotify: true,
      actions: n.actions ?? [],
      data: { url: n.url ?? "/", actionUrls, id: n.id },
    },
  };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-dispatch-secret") !== DISPATCH_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let sent = 0;
  let failed = 0;
  for (let round = 0; round < 10; round++) {
    const { data, error } = await db.rpc("claim_notifications", { p_limit: 200 });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as QueuedNotification[];
    if (batch.length === 0) break;

    const userIds = [...new Set(batch.map((n) => n.user_id))];
    const { data: subsData } = await db.from("push_subscriptions").select("*").in("user_id", userIds);
    const byUser = new Map<string, Subscription[]>();
    for (const s of (subsData ?? []) as Subscription[]) {
      byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
    }

    const expired: number[] = [];
    const jobs: Promise<void>[] = [];
    for (const n of batch) {
      const payload = JSON.stringify(await payloadFor(n));
      for (const s of byUser.get(n.user_id) ?? []) {
        jobs.push(
          webpush
            .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
              TTL: 12 * 3600,
              urgency: "high",
            })
            .then(() => {
              sent++;
            })
            .catch((e: { statusCode?: number }) => {
              if (e.statusCode === 404 || e.statusCode === 410) expired.push(s.id);
              else failed++;
            }),
        );
      }
    }
    await Promise.all(jobs);
    if (expired.length) await db.from("push_subscriptions").delete().in("id", expired);
  }
  return Response.json({ sent, failed });
});
