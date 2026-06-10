import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";
import { houses, magicLinkTokens, memberships, stores, users } from "../schema.js";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "../lib/auth.js";
import { magicLinkEmail, sendEmail } from "../lib/email.js";
import { badRequest } from "../lib/errors.js";

const TOKEN_TTL_MS = 15 * 60 * 1000;

const magicLinkBody = z.object({ email: z.string().email() });

export function authRoutes(app: FastifyInstance): void {
  app.post("/api/auth/magic-link", async (req) => {
    const { email } = magicLinkBody.parse(req.body);
    const normalized = email.toLowerCase().trim();
    const [row] = await db
      .insert(magicLinkTokens)
      .values({ email: normalized, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) })
      .returning();
    const link = `${env.appBaseUrl}/auth/verify?token=${row.token}`;
    const { subject, html } = magicLinkEmail(link);
    await sendEmail(normalized, subject, html);
    return env.isProd ? { ok: true } : { ok: true, devLink: link };
  });

  app.get("/api/auth/verify", async (req, reply) => {
    const token = z.string().uuid().safeParse((req.query as Record<string, string>).token);
    if (!token.success) throw badRequest("Missing or malformed token");

    // Atomically consume the token: single-use, unexpired
    const [consumed] = await db
      .update(magicLinkTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(magicLinkTokens.token, token.data),
          isNull(magicLinkTokens.usedAt),
          sql`${magicLinkTokens.expiresAt} > now()`,
        ),
      )
      .returning();
    if (!consumed) throw badRequest("Link is invalid or expired — request a new one");

    // Find or create the user (profile completed later if displayName empty)
    let [user] = await db.select().from(users).where(eq(users.email, consumed.email));
    if (!user) {
      [user] = await db
        .insert(users)
        .values({ email: consumed.email, displayName: "", fullName: "" })
        .returning();
    }

    // Solo-friendly bootstrap: first verified user creates the house (prompt §B)
    const [anyHouse] = await db.select({ id: houses.id }).from(houses).limit(1);
    if (!anyHouse) {
      const [house] = await db.insert(houses).values({ name: "Home" }).returning();
      await db.insert(stores).values([
        { houseId: house.id, name: "Safeway (Elmwood)" },
        { houseId: house.id, name: "Trader Joe's" },
      ]);
      await db.insert(memberships).values({
        houseId: house.id,
        userId: user.id,
        isAdmin: true,
        isManager: true,
        isKitchenHead: true,
      });
    }

    reply.setCookie(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
