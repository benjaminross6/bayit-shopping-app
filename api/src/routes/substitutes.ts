import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import { listItems, shoppingRuns, substituteRequests, users } from "../schema.js";
import { requireMembership } from "../lib/context.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { notifyUser } from "../lib/push.js";

const respondBody = z.object({
  responseKind: z.enum(["alternative", "free_text", "none"]),
  responseText: z.string().max(500).optional(),
});

export function substituteRoutes(app: FastifyInstance): void {
  app.get("/api/substitute-requests/pending", async (req) => {
    const membership = requireMembership(req.membership);
    const authUser = req.authUser!;

    const rows = await db
      .select({
        request: substituteRequests,
        itemName: listItems.name,
        alternatives: listItems.alternatives,
      })
      .from(substituteRequests)
      .innerJoin(shoppingRuns, eq(substituteRequests.runId, shoppingRuns.id))
      .innerJoin(listItems, eq(substituteRequests.itemId, listItems.id))
      .where(
        and(
          eq(shoppingRuns.houseId, membership.houseId),
          eq(substituteRequests.requesterId, authUser.id),
          eq(substituteRequests.status, "pending"),
        ),
      );

    return {
      requests: rows.map(({ request, itemName, alternatives }) => ({
        ...request,
        item: { id: request.itemId, name: itemName, alternatives },
        alternatives,
      })),
    };
  });

  app.post("/api/substitute-requests/:id/respond", async (req) => {
    const requestId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const body = respondBody.parse(req.body);
    const authUser = req.authUser!;

    const [row] = await db
      .select({
        request: substituteRequests,
        run: shoppingRuns,
        shopperId: shoppingRuns.shopperId,
      })
      .from(substituteRequests)
      .innerJoin(shoppingRuns, eq(substituteRequests.runId, shoppingRuns.id))
      .where(eq(substituteRequests.id, requestId));

    if (!row) throw notFound("Substitute request not found");
    if (!req.membership || row.run.houseId !== req.membership.houseId) {
      throw forbidden("Not a member of this house");
    }
    if (row.request.requesterId !== authUser.id) {
      throw forbidden("Only the requester can respond");
    }
    if (row.request.status !== "pending") {
      throw badRequest("This substitute request was already answered");
    }

    if (body.responseKind === "alternative" && !body.responseText?.trim()) {
      throw badRequest("Pick an alternative from the list");
    }
    if (body.responseKind === "free_text" && !body.responseText?.trim()) {
      throw badRequest("Free-text response required");
    }

    const status = body.responseKind === "none" ? "skipped" : "answered";
    const [updated] = await db
      .update(substituteRequests)
      .set({
        status,
        responseKind: body.responseKind,
        responseText: body.responseText?.trim() ?? null,
        answeredAt: new Date(),
      })
      .where(eq(substituteRequests.id, requestId))
      .returning();

    if (row.shopperId) {
      const [requester] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, authUser.id));
      const label = requester?.displayName ?? "Requester";
      let detail = "No substitute — skip item";
      if (body.responseKind === "alternative") detail = `Alternative: ${body.responseText}`;
      if (body.responseKind === "free_text") detail = body.responseText ?? "";

      await notifyUser(
        row.shopperId,
        "substitute_response",
        `substitute_response:${requestId}`,
        {
          title: "Substitute response",
          body: `${label}: ${detail}`,
          url: `/shop`,
        },
      );
    }

    return { ok: true, request: updated };
  });
}
