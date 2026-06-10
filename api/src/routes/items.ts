import type { FastifyInstance } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import {
  itemState,
  itemSyncOps,
  listItems,
  shoppingRuns,
  storeSection,
  stores,
  substituteRequests,
  users,
} from "../schema.js";
import { requireMembership, requireShopper } from "../lib/context.js";
import { findDuplicates, normalizeName } from "../lib/dedupe.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { notifyUser } from "../lib/push.js";

const SECTIONS = storeSection.enumValues;
const ITEM_STATES = itemState.enumValues;

const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  pending: ["in_cart", "archived"],
  in_cart: ["purchased", "archived", "pending"],
  purchased: ["in_cart"],
  archived: [],
};

function assertRunAllowsEdits(state: string): void {
  if (!["open", "locked", "reconciling"].includes(state)) {
    throw conflict(`List is not editable (run is '${state}')`, "LIST_NOT_EDITABLE");
  }
}

function assertRunAllowsStateChange(state: string): void {
  if (["settling", "closed"].includes(state)) {
    throw conflict(`State changes not allowed (run is '${state}')`, "BAD_STATE");
  }
  if (!["locked", "reconciling"].includes(state)) {
    throw conflict(`State changes only while shopping (run is '${state}')`, "BAD_STATE");
  }
}

const itemBody = z.object({
  name: z.string().min(1).max(200),
  quantity: z.coerce.number().positive().optional(),
  unit: z.string().max(30).optional(),
  kind: z.enum(["communal", "personal"]),
  notes: z.string().max(1000).optional(),
  storePref: z.string().uuid().nullable().optional(),
  section: z.enum(SECTIONS).default("other"),
  alternatives: z.array(z.string().max(200)).max(10).default([]),
  clientId: z.string().max(80).optional(),
  force: z.boolean().default(false),
  shopperSubstitute: z.boolean().default(false),
});

const itemPatch = z
  .object({
    name: z.string().min(1).max(200),
    quantity: z.coerce.number().positive().nullable(),
    unit: z.string().max(30).nullable(),
    kind: z.enum(["communal", "personal"]),
    notes: z.string().max(1000).nullable(),
    storePref: z.string().uuid().nullable(),
    section: z.enum(SECTIONS),
    alternatives: z.array(z.string().max(200)).max(10),
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

async function getItemWithRun(itemId: string, houseId: string) {
  const [row] = await db
    .select({ item: listItems, run: shoppingRuns })
    .from(listItems)
    .innerJoin(shoppingRuns, eq(listItems.runId, shoppingRuns.id))
    .where(and(eq(listItems.id, itemId), eq(shoppingRuns.houseId, houseId)));
  if (!row) throw notFound("Item not found");
  return row;
}

export function itemRoutes(app: FastifyInstance): void {
  app.get("/api/runs/:id/items", async (req) => {
    const membership = requireMembership(req.membership);
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    await getHouseRun(runId, membership.houseId);

    const q = req.query as Record<string, string | undefined>;
    const conditions = [eq(listItems.runId, runId)];
    if (q.store) conditions.push(eq(listItems.storePref, q.store));
    if (q.section) {
      const section = z.enum(SECTIONS).parse(q.section);
      conditions.push(eq(listItems.section, section));
    }
    const items = await db
      .select()
      .from(listItems)
      .where(and(...conditions))
      .orderBy(asc(listItems.storePref), asc(listItems.section), asc(listItems.createdAt));

    const houseStores = await db
      .select()
      .from(stores)
      .where(eq(stores.houseId, membership.houseId));
    return { items, stores: houseStores, sections: SECTIONS };
  });

  app.post("/api/runs/:id/items", async (req, reply) => {
    const membership = requireMembership(req.membership);
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const body = itemBody.parse(req.body);
    const run = await getHouseRun(runId, membership.houseId);
    if (run.state === "open") {
      // normal member adds
    } else if (run.state === "locked" && body.shopperSubstitute) {
      requireShopper(run, req.authUser!, membership);
    } else {
      throw conflict(`List is not open (run is '${run.state}')`, "LIST_NOT_OPEN");
    }

    const normalizedName = normalizeName(body.name);
    if (!body.force) {
      const duplicates = await findDuplicates(runId, normalizedName);
      if (duplicates.length > 0) {
        throw conflict("Similar items already on the list", "DUPLICATES", { duplicates });
      }
    }

    const values = {
      runId,
      requesterId: req.authUser!.id,
      name: body.name.trim(),
      normalizedName,
      quantity: body.quantity?.toString(),
      unit: body.unit,
      kind: body.kind,
      notes: body.notes,
      storePref: body.storePref ?? null,
      section: body.section,
      alternatives: body.alternatives,
      clientId: body.clientId,
    };
    // Partial unique index (client_id IS NOT NULL) — only use ON CONFLICT when replaying offline sync.
    const insert = db.insert(listItems).values(values);
    const [item] = body.clientId
      ? await insert
          .onConflictDoNothing({
            target: [listItems.runId, listItems.clientId],
            where: sql`${listItems.clientId} IS NOT NULL`,
          })
          .returning()
      : await insert.returning();
    reply.code(201);
    return { ok: true, item: item ?? null };
  });

  app.post("/api/items/:id/merge", async (req) => {
    const membership = requireMembership(req.membership);
    const itemId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const body = z
      .object({ quantity: z.coerce.number().positive().optional() })
      .parse(req.body ?? {});
    const { item, run } = await getItemWithRun(itemId, membership.houseId);
    if (run.state !== "open") throw conflict("List is not open", "LIST_NOT_OPEN");
    if (item.state !== "pending") throw badRequest("Can only merge into pending items");

    const existing = item.quantity ? parseFloat(item.quantity) : 1;
    const added = body.quantity ?? 1;
    const [updated] = await db
      .update(listItems)
      .set({ quantity: (existing + added).toString(), updatedAt: new Date() })
      .where(eq(listItems.id, itemId))
      .returning();
    return { ok: true, item: updated };
  });

  app.patch("/api/items/:id", async (req) => {
    const membership = requireMembership(req.membership);
    const itemId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const patch = itemPatch.parse(req.body);
    const { run } = await getItemWithRun(itemId, membership.houseId);
    assertRunAllowsEdits(run.state);

    const [updated] = await db
      .update(listItems)
      .set({
        ...(patch.name !== undefined && {
          name: patch.name.trim(),
          normalizedName: normalizeName(patch.name),
        }),
        ...(patch.quantity !== undefined && {
          quantity: patch.quantity?.toString() ?? null,
        }),
        ...(patch.unit !== undefined && { unit: patch.unit }),
        ...(patch.kind !== undefined && { kind: patch.kind }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        ...(patch.storePref !== undefined && { storePref: patch.storePref }),
        ...(patch.section !== undefined && { section: patch.section }),
        ...(patch.alternatives !== undefined && { alternatives: patch.alternatives }),
        updatedAt: new Date(),
      })
      .where(eq(listItems.id, itemId))
      .returning();
    return { ok: true, item: updated };
  });

  app.delete("/api/items/:id", async (req) => {
    const membership = requireMembership(req.membership);
    const itemId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const { run } = await getItemWithRun(itemId, membership.houseId);
    if (run.state !== "open") {
      throw conflict("Items can only be deleted while the list is open", "LIST_NOT_OPEN");
    }
    await db.delete(listItems).where(eq(listItems.id, itemId));
    return { ok: true };
  });

  app.patch("/api/items/:id/state", async (req) => {
    const membership = requireMembership(req.membership);
    const itemId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const body = z
      .object({
        state: z.enum(ITEM_STATES),
        clientId: z.string().max(80).optional(),
        seq: z.number().int().nonnegative().optional(),
      })
      .parse(req.body);

    const { item, run } = await getItemWithRun(itemId, membership.houseId);
    assertRunAllowsStateChange(run.state);

    if (body.seq != null) {
      const [seen] = await db
        .select({ id: itemSyncOps.id })
        .from(itemSyncOps)
        .where(
          and(
            eq(itemSyncOps.itemId, itemId),
            eq(itemSyncOps.op, "state"),
            eq(itemSyncOps.seq, body.seq),
          ),
        );
      if (seen) {
        const [current] = await db.select().from(listItems).where(eq(listItems.id, itemId));
        return { ok: true, item: current, replayed: true };
      }
    }

    if (body.state === "archived") {
      if (!membership.isAdmin) requireShopper(run, req.authUser!, membership);
    } else {
      requireShopper(run, req.authUser!, membership);
    }

    const allowed = VALID_STATE_TRANSITIONS[item.state] ?? [];
    if (!allowed.includes(body.state)) {
      throw conflict(
        `Cannot transition item from '${item.state}' to '${body.state}'`,
        "BAD_TRANSITION",
      );
    }

    const [updated] = await db
      .update(listItems)
      .set({ state: body.state, updatedAt: new Date() })
      .where(eq(listItems.id, itemId))
      .returning();

    if (body.seq != null && body.clientId) {
      await db
        .insert(itemSyncOps)
        .values({
          itemId,
          op: "state",
          seq: body.seq,
          clientId: body.clientId,
        })
        .onConflictDoNothing();
    }

    return { ok: true, item: updated };
  });

  app.post("/api/items/:id/substitute-request", async (req, reply) => {
    const membership = requireMembership(req.membership);
    const itemId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const { item, run } = await getItemWithRun(itemId, membership.houseId);
    requireShopper(run, req.authUser!, membership);

    if (!["locked", "reconciling"].includes(run.state)) {
      throw conflict(`Substitute requests only while shopping (run is '${run.state}')`, "BAD_STATE");
    }

    const [existing] = await db
      .select({ id: substituteRequests.id })
      .from(substituteRequests)
      .where(
        and(eq(substituteRequests.itemId, itemId), eq(substituteRequests.status, "pending")),
      );
    if (existing) {
      throw conflict("A substitute request is already pending for this item", "ALREADY_PENDING");
    }

    const [request] = await db
      .insert(substituteRequests)
      .values({
        itemId,
        runId: run.id,
        requesterId: item.requesterId,
      })
      .returning();

    const [requester] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, item.requesterId));

    await notifyUser(item.requesterId, "substitute_needed", `substitute:${request.id}`, {
      title: "Substitute needed",
      body: `Can't find "${item.name}" — pick an alternative or respond`,
      url: `/items/${itemId}/substitute`,
    });

    reply.code(201);
    return {
      ok: true,
      request,
      requester: requester ?? { displayName: "Requester" },
    };
  });
}
