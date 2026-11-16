// CORS delle Edge Functions chiamate dall'app: solo dagli indirizzi dell'app.
// Il segreto APP_ORIGIN (uno o più indirizzi separati da virgola, es. "https://gdl.vercel.app") limita le origini;
// finché non è impostato si accetta qualsiasi origine (le funzioni chiedono comunque il token o un link firmato).
const allowed = (Deno.env.get("APP_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

export function corsHeaders(req: Request, headers: string): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = !allowed.length ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": headers,
    "Vary": "Origin",
  };
}
