import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";
import { invites, memberships } from "../schema.js";
import { requireRole } from "../lib/context.js";
import { badRequest, conflict, unauthorized } from "../lib/errors.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function inviteRoutes(app: FastifyInstance): void {
  app.post("/api/invites", async (req) => {
    const membership = requireRole(req.membership, "admin");
    const [invite] = await db
      .insert(invites)
      .values({
        houseId: membership.houseId,
        createdBy: req.authUser!.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();
    return { ok: true, url: `${env.appBaseUrl}/invite?token=${invite.token}` };
  });

  // Public route, but the caller must already be signed in (magic link first).
  app.post("/api/invites/:token/accept", async (req) => {
    if (!req.authUser) throw unauthorized("Sign in first, then open the invite link again");
    const token = z.string().uuid().safeParse((req.params as Record<string, string>).token);
    if (!token.success) throw badRequest("Malformed invite token");

    if (req.membership) throw conflict("You already belong to a house", "ALREADY_MEMBER");

    const [invite] = await db
      .update(invites)
      .set({ usedBy: req.authUser.id })
      .where(
        and(
          eq(invites.token, token.data),
          isNull(invites.usedBy),
          sql`${invites.expiresAt} > now()`,
        ),
      )
      .returning();
    if (!invite) throw badRequest("Invite is invalid, used, or expired");

    await db.insert(memberships).values({
      houseId: invite.houseId,
      userId: req.authUser.id,
    });
    return { ok: true, houseId: invite.houseId };
  });
}
