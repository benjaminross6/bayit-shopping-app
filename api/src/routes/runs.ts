import type { FastifyInstance } from "fastify";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import {
  issueKind,
  listItems,
  shopperIssues,
  shoppingRuns,
  storeSection,
  stores,
  users,
} from "../schema.js";
import { requireMembership, requireRole, requireShopper } from "../lib/context.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";

const SECTIONS = storeSection.enumValues;
const ISSUE_KINDS = issueKind.enumValues;

const patchBody = z
  .object({
    scheduledAt: z.string().datetime({ offset: true }).nullable(),
    shopperId: z.string().uuid().nullable(),
  })
  .partial();

async function getHouseRun(runId: string, houseId: string) {
  const [run] = await db
    .select()
    .from(shoppingRuns)
    .where(and(eq(shoppingRuns.id, runId), eq(shoppingRuns.houseId, houseId)));
  if (!run) throw notFound("Run not found");
  return run;
}

export function runRoutes(app: FastifyInstance): void {
  app.post("/api/runs", async (req, reply) => {
    const membership = requireRole(req.membership, "admin", "manager", "kitchen_head");
    try {
      const [run] = await db
        .insert(shoppingRuns)
        .values({ houseId: membership.houseId })
        .returning();
      reply.code(201);
      return { ok: true, run };
    } catch (err: unknown) {
      // Partial unique index: one non-closed run per house
      if ((err as { code?: string }).code === "23505") {
        throw conflict("A shopping run is already active", "RUN_EXISTS");
      }
      throw err;
    }
  });

  app.patch("/api/runs/:id", async (req) => {
    const membership = requireRole(req.membership, "admin", "manager");
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const patch = patchBody.parse(req.body);
    const run = await getHouseRun(runId, membership.houseId);
    if (run.state === "closed") throw badRequest("Run is closed");

    const [updated] = await db
      .update(shoppingRuns)
      .set({
        ...(patch.scheduledAt !== undefined && {
          scheduledAt: patch.scheduledAt ? new Date(patch.scheduledAt) : null,
        }),
        ...(patch.shopperId !== undefined && { shopperId: patch.shopperId }),
      })
      .where(eq(shoppingRuns.id, runId))
      .returning();
    return { ok: true, run: updated };
  });

  app.post("/api/runs/:id/open", async (req) => {
    const membership = requireRole(req.membership, "admin", "manager");
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const run = await getHouseRun(runId, membership.houseId);
    if (run.state !== "draft") {
      throw conflict(`Cannot open a run in state '${run.state}'`, "BAD_STATE");
    }
    const [updated] = await db
      .update(shoppingRuns)
      .set({ state: "open" })
      .where(eq(shoppingRuns.id, runId))
      .returning();
    return { ok: true, run: updated };
  });

  app.get("/api/runs/current", async (req) => {
    const membership = requireMembership(req.membership);
    const [run] = await db
      .select()
      .from(shoppingRuns)
      .where(
        and(
          eq(shoppingRuns.houseId, membership.houseId),
          ne(shoppingRuns.state, "closed"),
        ),
      );
    if (!run) return { run: null, itemCounts: {}, shopper: null };

    const counts = await db
      .select({ state: listItems.state, count: sql<number>`count(*)::int` })
      .from(listItems)
      .where(eq(listItems.runId, run.id))
      .groupBy(listItems.state);
    const itemCounts = Object.fromEntries(counts.map((c) => [c.state, c.count]));

    let shopper = null;
    if (run.shopperId) {
      const [s] = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, run.shopperId));
      shopper = s ?? null;
    }
    return { run, itemCounts, shopper };
  });

  app.post("/api/runs/:id/lock", async (req) => {
    const membership = requireMembership(req.membership);
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const run = await getHouseRun(runId, membership.houseId);
    requireShopper(run, req.authUser!, membership);

    if (run.state !== "open") {
      throw conflict(`Cannot lock a run in state '${run.state}'`, "BAD_STATE");
    }
    if (!run.shopperId) throw badRequest("Assign a shopper before locking");

    const [updated] = await db
      .update(shoppingRuns)
      .set({ state: "locked", lockedAt: new Date() })
      .where(eq(shoppingRuns.id, runId))
      .returning();

    const items = await db
      .select({
        item: listItems,
        requesterDisplayName: users.displayName,
      })
      .from(listItems)
      .innerJoin(users, eq(listItems.requesterId, users.id))
      .where(eq(listItems.runId, runId))
      .orderBy(asc(listItems.storePref), asc(listItems.section), asc(listItems.createdAt));

    const houseStores = await db
      .select()
      .from(stores)
      .where(eq(stores.houseId, membership.houseId));

    return {
      ok: true,
      run: updated,
      snapshot: {
        items: items.map(({ item, requesterDisplayName }) => ({
          ...item,
          requesterDisplayName,
        })),
        stores: houseStores,
        sections: SECTIONS,
      },
    };
  });

  app.post("/api/runs/:id/done-shopping", async (req) => {
    const membership = requireMembership(req.membership);
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const run = await getHouseRun(runId, membership.houseId);
    requireShopper(run, req.authUser!, membership);

    if (run.state !== "locked") {
      throw conflict(`Cannot finish shopping in state '${run.state}'`, "BAD_STATE");
    }

    const [updated] = await db
      .update(shoppingRuns)
      .set({ state: "reconciling" })
      .where(eq(shoppingRuns.id, runId))
      .returning();
    return { ok: true, run: updated };
  });

  app.post("/api/runs/:id/issues", async (req) => {
    const membership = requireMembership(req.membership);
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const body = z
      .object({
        kind: z.enum(ISSUE_KINDS),
        itemId: z.string().uuid().optional(),
        note: z.string().max(1000).optional(),
      })
      .parse(req.body);

    const run = await getHouseRun(runId, membership.houseId);
    requireShopper(run, req.authUser!, membership);

    if (!["locked", "reconciling"].includes(run.state)) {
      throw conflict(`Cannot log issues while run is '${run.state}'`, "BAD_STATE");
    }

    if (body.itemId) {
      const [item] = await db
        .select({ id: listItems.id })
        .from(listItems)
        .where(and(eq(listItems.id, body.itemId), eq(listItems.runId, runId)));
      if (!item) throw notFound("Item not found on this run");
    }

    const [issue] = await db
      .insert(shopperIssues)
      .values({
        runId,
        itemId: body.itemId ?? null,
        kind: body.kind,
        note: body.note,
      })
      .returning();
    return { ok: true, issue };
  });
}
