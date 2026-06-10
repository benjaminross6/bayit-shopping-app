import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import { houses, memberships, users } from "../schema.js";
import { requireMembership } from "../lib/context.js";

export const ALLERGENS = [
  "peanut",
  "tree_nut",
  "dairy",
  "egg",
  "gluten",
  "soy",
  "shellfish",
  "fish",
  "sesame",
] as const;

const patchBody = z
  .object({
    displayName: z.string().min(1).max(60),
    fullName: z.string().min(1).max(120),
    allergens: z.array(z.enum(ALLERGENS)),
    preferences: z.string().max(2000),
    venmoHandle: z.string().max(60).nullable(),
    zelleContact: z.string().max(120).nullable(),
  })
  .partial();

export function meRoutes(app: FastifyInstance): void {
  app.get("/api/me", async (req) => {
    const user = req.authUser!;
    let house = null;
    if (req.membership) {
      const [h] = await db
        .select()
        .from(houses)
        .where(eq(houses.id, req.membership.houseId));
      house = h ?? null;
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        fullName: user.fullName,
        allergens: user.allergens,
        preferences: user.preferences,
        venmoHandle: user.venmoHandle,
        zelleContact: user.zelleContact,
      },
      membership: req.membership && {
        houseId: req.membership.houseId,
        isAdmin: req.membership.isAdmin,
        isManager: req.membership.isManager,
        isKitchenHead: req.membership.isKitchenHead,
        active: req.membership.active,
      },
      house: house && { id: house.id, name: house.name },
      profileComplete: user.displayName.length > 0,
      allergenOptions: ALLERGENS,
    };
  });

  app.get("/api/house/members", async (req) => {
    const membership = requireMembership(req.membership);
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        isAdmin: memberships.isAdmin,
        isManager: memberships.isManager,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(eq(memberships.houseId, membership.houseId), eq(memberships.active, true)),
      );
    return { members: rows };
  });

  app.patch("/api/me", async (req) => {
    const patch = patchBody.parse(req.body);
    const [updated] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, req.authUser!.id))
      .returning();
    return { ok: true, user: { id: updated.id, displayName: updated.displayName } };
  });
}
