import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { listItems, receiptLines, receipts } from "../schema.js";
import type { ClassifiedLine } from "./settlement.js";

/** Map resolved receipt lines to settlement buckets for a run. */
export async function classifyRunLines(runId: string): Promise<{
  lines: ClassifiedLine[];
  taxCents: number;
  receiptSubtotalCents: number;
}> {
  const runReceipts = await db.select().from(receipts).where(eq(receipts.runId, runId));

  let taxCents = 0;
  let receiptSubtotalCents = 0;
  const classified: ClassifiedLine[] = [];

  for (const receipt of runReceipts) {
    taxCents += receipt.taxCents ?? 0;
    receiptSubtotalCents += receipt.subtotalCents ?? 0;

    const lines = await db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, receipt.id));

    for (const line of lines) {
      if (!line.resolution || line.resolution === "skipped") {
        classified.push({
          totalCents: line.totalCents,
          kind: "skipped",
          isDiscount: line.isDiscount,
          isFee: line.isFee,
        });
        continue;
      }

      if (line.resolution === "assigned_communal" || line.isFee) {
        classified.push({
          totalCents: line.totalCents,
          kind: "communal",
          isDiscount: line.isDiscount,
          isFee: line.isFee,
        });
        continue;
      }

      if (line.resolution === "assigned_personal") {
        classified.push({
          totalCents: line.totalCents,
          kind: "personal",
          userId: line.resolvedUserId ?? undefined,
          isDiscount: line.isDiscount,
          isFee: line.isFee,
        });
        continue;
      }

      if (
        line.resolution === "auto_matched" ||
        line.resolution === "manually_matched"
      ) {
        let kind: "communal" | "personal" = "communal";
        let userId: string | undefined;
        if (line.matchedItemId) {
          const [item] = await db
            .select()
            .from(listItems)
            .where(eq(listItems.id, line.matchedItemId));
          if (item) {
            kind = item.kind;
            userId = item.kind === "personal" ? item.requesterId : undefined;
          }
        } else if (line.resolvedKind === "personal") {
          kind = "personal";
          userId = line.resolvedUserId ?? undefined;
        }
        classified.push({
          totalCents: line.totalCents,
          kind,
          userId,
          isDiscount: line.isDiscount,
          isFee: line.isFee,
        });
      }
    }
  }

  return { lines: classified, taxCents, receiptSubtotalCents };
}
