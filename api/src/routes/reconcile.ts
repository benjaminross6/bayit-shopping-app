import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import {
  listItems,
  receiptLines,
  receipts,
  shoppingRuns,
  users,
} from "../schema.js";
import { requireMembership, requireShopper } from "../lib/context.js";
import { badRequest, notFound } from "../lib/errors.js";
import {
  reconcileChatTurn,
  type ChatMessage,
  geminiConfigured,
} from "../lib/gemini.js";
import { applyLineResolution, type AppliedMutation } from "../lib/receipt-resolution.js";

async function getReceiptForHouse(receiptId: string, houseId: string) {
  const [row] = await db
    .select({ receipt: receipts, run: shoppingRuns })
    .from(receipts)
    .innerJoin(shoppingRuns, eq(receipts.runId, shoppingRuns.id))
    .where(and(eq(receipts.id, receiptId), eq(shoppingRuns.houseId, houseId)));
  if (!row) throw notFound("Receipt not found");
  return row;
}

function buildReconcileContext(
  lines: (typeof receiptLines.$inferSelect)[],
  unmatched: Array<{ item: typeof listItems.$inferSelect; requesterDisplayName: string }>,
): string {
  const unresolved = lines
    .filter((l) => !l.resolution)
    .map(
      (l) =>
        `- line_id=${l.id} raw="${l.rawText}" parsed="${l.parsedName}" total_cents=${l.totalCents}`,
    )
    .join("\n");
  const items = unmatched
    .map(
      (u) =>
        `- item_id=${u.item.id} name="${u.item.name}" kind=${u.item.kind} requester=${u.requesterDisplayName}`,
    )
    .join("\n");
  return `Unresolved receipt lines:\n${unresolved || "(none)"}\n\nUnmatched list items:\n${items || "(none)"}`;
}

export function reconcileRoutes(app: FastifyInstance): void {
  app.post("/api/receipts/:id/chat", async (req) => {
    const membership = requireMembership(req.membership);
    const receiptId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const body = z
      .object({
        message: z.string().min(1).max(4000),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "model"]),
              text: z.string(),
            }),
          )
          .max(20)
          .default([]),
      })
      .parse(req.body);

    const { receipt, run } = await getReceiptForHouse(receiptId, membership.houseId);
    requireShopper(run, req.authUser!, membership);

    if (run.state !== "reconciling") {
      throw badRequest(`Chat reconciliation requires run in reconciling (got ${run.state})`);
    }
    if (!geminiConfigured()) {
      throw badRequest("GEMINI_API_KEY not configured — use the table to resolve lines manually");
    }

    const lines = await db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, receiptId))
      .orderBy(asc(receiptLines.id));

    const unmatchedRows = await db
      .select({
        item: listItems,
        requesterDisplayName: users.displayName,
      })
      .from(listItems)
      .innerJoin(users, eq(listItems.requesterId, users.id))
      .where(eq(listItems.runId, run.id));

    const context = buildReconcileContext(lines, unmatchedRows);
    const { reply, toolCalls } = await reconcileChatTurn(
      context,
      body.history as ChatMessage[],
      body.message,
    );

    const mutations: AppliedMutation[] = [];
    for (const call of toolCalls) {
      if (call.name === "match_line") {
        const { line_id, item_id } = call.args;
        const { mutation } = await applyLineResolution(line_id, membership.houseId, {
          resolution: "manually_matched",
          matchedItemId: item_id,
        });
        mutations.push(mutation);
      } else if (call.name === "assign_line") {
        const { line_id, kind, user_id } = call.args;
        const { mutation } = await applyLineResolution(line_id, membership.houseId, {
          resolution: kind === "communal" ? "assigned_communal" : "assigned_personal",
          resolvedKind: kind as "communal" | "personal",
          resolvedUserId: user_id ?? null,
        });
        mutations.push(mutation);
      } else if (call.name === "skip_line") {
        const { mutation } = await applyLineResolution(call.args.line_id, membership.houseId, {
          resolution: "skipped",
        });
        mutations.push(mutation);
      } else if (call.name === "edit_line") {
        const { line_id, parsed_name, total_cents } = call.args;
        const [updated] = await db
          .update(receiptLines)
          .set({
            ...(parsed_name !== undefined && { parsedName: parsed_name }),
            ...(total_cents !== undefined && { totalCents: total_cents }),
          })
          .where(eq(receiptLines.id, line_id))
          .returning();
        if (updated) {
          mutations.push({
            lineId: line_id,
            action: "edit_line",
            detail: `Edited \`${updated.rawText}\``,
          });
        }
      }
    }

    return { ok: true, reply, mutations };
  });
}
