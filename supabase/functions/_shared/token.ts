// Token firmati (HMAC-SHA256) per i pulsanti delle notifiche: permettono di
// prenotarsi senza aprire l'app, senza esporre la sessione dell'utente.

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export interface ActionClaims {
  u: string; // utente
  m: string; // partita
  a: string; // azione
  exp: number; // scadenza (secondi epoch)
}

export async function signAction(claims: ActionClaims, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyAction(token: string, secret: string): Promise<ActionClaims | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(body));
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as ActionClaims;
  if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
  return claims;
}
