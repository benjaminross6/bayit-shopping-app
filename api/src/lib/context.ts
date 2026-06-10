// Auth middleware: resolves the session cookie to user + membership on every
// /api/* route except the public ones. Decorates req.authUser / req.membership.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { users, memberships, shoppingRuns } from "../schema.js";
import { SESSION_COOKIE, verifySessionToken } from "./auth.js";
import { forbidden, unauthorized } from "./errors.js";

export type AuthUser = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser | null;
    membership: Membership | null;
  }
}

const PUBLIC_PATHS = [
  "/api/health",
  "/api/auth/magic-link",
  "/api/auth/verify",
];

function isPublic(url: string): boolean {
  const path = url.split("?")[0];
  if (PUBLIC_PATHS.includes(path)) return true;
  // Invite accept is public-ish: handler checks session itself (prompt §A)
  if (/^\/api\/invites\/[^/]+\/accept$/.test(path)) return true;
  if (!path.startsWith("/api/")) return true; // static PWA assets
  return false;
}

export async function loadSession(req: FastifyRequest): Promise<void> {
  req.authUser = null;
  req.membership = null;
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  const userId = verifySessionToken(token);
  if (!userId) return;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  req.authUser = user;
  const [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId));
  req.membership = membership ?? null;
}

export function registerAuthHook(app: FastifyInstance): void {
  app.decorateRequest("authUser", null);
  app.decorateRequest("membership", null);
  app.addHook("preHandler", async (req) => {
    await loadSession(req);
    if (isPublic(req.url)) return;
    if (!req.authUser) throw unauthorized();
  });
}

/** Throws 403 unless the caller holds at least one of the given roles. */
export function requireRole(
  membership: Membership | null,
  ...roles: ("admin" | "manager" | "kitchen_head")[]
): Membership {
  if (!membership) throw unauthorized("No house membership");
  const has =
    (roles.includes("admin") && membership.isAdmin) ||
    (roles.includes("manager") && membership.isManager) ||
    (roles.includes("kitchen_head") && membership.isKitchenHead);
  if (!has) throw forbidden(`Requires role: ${roles.join(" or ")}`);
  return membership;
}

/** Throws 401-equivalent if the caller has no membership at all. */
export function requireMembership(membership: Membership | null): Membership {
  if (!membership) throw forbidden("You are not a member of a house yet — ask for an invite");
  return membership;
}

type RunRow = typeof shoppingRuns.$inferSelect;

/** Shopper is run.shopperId; admins may act as fallback (SDD §4.2). */
export function requireShopper(
  run: Pick<RunRow, "shopperId">,
  authUser: AuthUser,
  membership: Membership | null,
): void {
  if (membership?.isAdmin) return;
  if (run.shopperId === authUser.id) return;
  throw forbidden("Only the assigned shopper (or admin) may perform this action");
}

export function isShopper(
  run: Pick<RunRow, "shopperId">,
  authUser: AuthUser,
  membership: Membership | null,
): boolean {
  return Boolean(membership?.isAdmin || run.shopperId === authUser.id);
}
