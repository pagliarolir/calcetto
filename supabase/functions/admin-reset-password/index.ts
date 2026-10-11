// Il Leader (o un Premier, per i giocatori) assegna una password temporanea a chi l'ha dimenticata.
// Funziona senza email: la password va comunicata in privato e va cambiata al primo accesso.
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const reply = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: cors });

// 12 caratteri senza simboli ambigui (niente 0/o, 1/l/i), in tre gruppi: facile da dettare
function tempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join("")).join("-");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply(405, { message: "Metodo non consentito" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // il controllo dei permessi gira con l'identità di chi chiama
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await asCaller.auth.getUser();
  if (!user) return reply(401, { message: "Accesso richiesto" });

  const { user_id } = await req.json().catch(() => ({ user_id: null }));
  if (typeof user_id !== "string") return reply(400, { message: "Giocatore mancante" });

  const { data: allowed, error: permError } = await asCaller.rpc("can_reset_password", { p_target: user_id });
  if (permError || allowed !== true) {
    return reply(403, { message: "Non puoi reimpostare la password di questo giocatore." });
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const temp = tempPassword();
  const { error: updError } = await admin.auth.admin.updateUserById(user_id, { password: temp });
  if (updError) return reply(500, { message: "Reimpostazione non riuscita: " + updError.message });

  const { error: markError } = await admin.rpc("mark_password_reset", { p_target: user_id, p_actor: user.id });
  if (markError) return reply(500, { message: "Password cambiata, ma l'avviso non è partito: " + markError.message });

  return reply(200, { temp_password: temp });
});
