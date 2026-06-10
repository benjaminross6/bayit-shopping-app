// Session tokens: compact HMAC-SHA256 signed payload (no JWT lib needed).
// Format: base64url(json).base64url(hmac)
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export const SESSION_COOKIE = "bayit_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type SessionPayload = { uid: string; exp: number };

function hmac(data: string): Buffer {
  return createHmac("sha256", env.jwtSecret).update(data).digest();
}

export function createSessionToken(userId: string): string {
  const payload: SessionPayload = { uid: userId, exp: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = hmac(body).toString("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(body);
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof payload.uid !== "string" || Date.now() > payload.exp) return null;
    return payload.uid;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.isProd,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};
