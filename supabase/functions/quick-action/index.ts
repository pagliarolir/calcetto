// Esegue l'azione scelta dal pulsante di una notifica (Ci sono / Riserva / Non ci sono, ...)
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { verifyAction } from "../_shared/token.ts";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = corsHeaders(req, "content-type");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors });

  const token = new URL(req.url).searchParams.get("t") ?? "";
  const claims = await verifyAction(token, Deno.env.get("QUICK_ACTION_SECRET")!);
  if (!claims) {
    return Response.json({ ok: false, message: "Link scaduto: apri l'app per rispondere." }, { status: 401, headers: cors });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await db.rpc("quick_action", { p_user: claims.u, p_match: claims.m, p_action: claims.a });
  if (error) {
    // i messaggi scritti da noi (in italiano, dalle funzioni SQL) si possono mostrare; quelli tecnici no
    const ours = error.code === "P0001" || error.code === "GDL01";
    if (!ours) console.error("quick-action:", error.code, error.message);
    return Response.json({ ok: false, message: ours ? error.message : "Non è andata: apri l'app per rispondere." }, { status: 400, headers: cors });
  }
  return Response.json({ ok: true, message: data }, { headers: cors });
});
