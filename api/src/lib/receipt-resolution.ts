import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  listItems,
  purchaseLedger,
  receiptLines,
  receipts,
  shoppingRuns,
} from "../schema.js";
import { badRequest, notFound } from "./errors.js";

export const AUTO_MATCH_CONFIDENCE = 0.85;

export type LineResolutionInput = {
  resolution:
    | "auto_matched"
    | "manually_matched"
    | "assigned_communal"
    | "assigned_personal"
    | "skipped";
  matchedItemId?: string | null;
  resolvedKind?: "communal" | "personal" | null;
  resolvedUserId?: string | null;
  parsedName?: string;
  totalCents?: number;
};

export type AppliedMutation = {
  lineId: string;
  action: string;
  detail: string;
};

async function getLineWithReceipt(lineId: string, houseId: string) {
  const [row] = await db
    .select({ line: receiptLines, receipt: receipts, run: shoppingRuns })
    .from(receiptLines)
    .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
    .innerJoin(shoppingRuns, eq(receipts.runId, shoppingRuns.id))
    .where(and(eq(receiptLines.id, lineId), eq(shoppingRuns.houseId, houseId)));
  if (!row) throw notFound("Receipt line not found");
  return row;
}

export async function applyLineResolution(
  lineId: string,
  houseId: string,
  input: LineResolutionInput,
): Promise<{ line: typeof receiptLines.$inferSelect; mutation: AppliedMutation }> {
  const { line, receipt, run } = await getLineWithReceipt(lineId, houseId);

  if (!["reconciling", "settling"].includes(run.state)) {
    throw badRequest(`Cannot resolve lines while run is '${run.state}'`);
  }
  if (run.state === "settling") {
    throw badRequest("Run is already finalized");
  }

  let matchedItemId = input.matchedItemId ?? null;
  let resolvedKind = input.resolvedKind ?? null;
  let resolvedUserId = input.resolvedUserId ?? null;

  if (
    input.resolution === "auto_matched" ||
    input.resolution === "manually_matched"
  ) {
    if (!matchedItemId) throw badRequest("matchedItemId required for match");
    const [item] = await db
      .select()
      .from(listItems)
      .where(and(eq(listItems.id, matchedItemId), eq(listItems.runId, run.id)));
    if (!item) throw badRequest("List item not found on this run");
    resolvedKind = item.kind;
    resolvedUserId = item.kind === "personal" ? item.requesterId : null;

    if (item.state === "in_cart") {
      await db
        .update(listItems)
        .set({ state: "purchased", updatedAt: new Date() })
        .where(eq(listItems.id, item.id));
    }
  } else if (input.resolution === "assigned_communal") {
    matchedItemId = null;
    resolvedKind = "communal";
    resolvedUserId = null;
  } else if (input.resolution === "assigned_personal") {
    if (!resolvedUserId) throw badRequest("resolvedUserId required for personal assign");
    matchedItemId = null;
    resolvedKind = "personal";
  } else if (input.resolution === "skipped") {
    matchedItemId = null;
    resolvedKind = null;
    resolvedUserId = null;
  }

  const [updated] = await db
    .update(receiptLines)
    .set({
      resolution: input.resolution,
      matchedItemId,
      resolvedKind,
      resolvedUserId,
      ...(input.parsedName !== undefined && { parsedName: input.parsedName }),
      ...(input.totalCents !== undefined && { totalCents: input.totalCents }),
    })
    .where(eq(receiptLines.id, lineId))
    .returning();

  const detail = describeMutation(updated, input);
  return { line: updated, mutation: { lineId, action: input.resolution, detail } };
}

function describeMutation(
  line: typeof receiptLines.$inferSelect,
  input: LineResolutionInput,
): string {
  if (input.resolution === "skipped") return `Skipped \`${line.rawText}\``;
  if (input.parsedName) return `Edited to "${input.parsedName}"`;
  if (input.matchedItemId) return `Matched \`${line.rawText}\` → item`;
  if (input.resolution === "assigned_communal") return `Assigned \`${line.rawText}\` as communal`;
  if (input.resolution === "assigned_personal") return `Assigned \`${line.rawText}\` as personal`;
  return `Updated \`${line.rawText}\``;
}

export async function writeLedgerRow(
  houseId: string,
  receipt: typeof receipts.$inferSelect,
  line: typeof receiptLines.$inferSelect,
): Promise<void> {
  if (line.isDiscount || line.isFee) return;
  await db.insert(purchaseLedger).values({
    houseId,
    storeId: receipt.storeId,
    itemName: line.parsedName,
    unitPriceCents: line.unitPriceCents,
    totalCents: line.totalCents,
    quantity: line.quantity,
    purchasedAt: receipt.purchasedAt ?? new Date(),
    receiptLineId: line.id,
  });
}

export async function countUnresolvedForRun(runId: string): Promise<number> {
  const rows = await db
    .select({ id: receiptLines.id })
    .from(receiptLines)
    .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
    .where(and(eq(receipts.runId, runId), sql`resolution IS NULL`));
  return rows.length;
}
