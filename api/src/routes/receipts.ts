import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import {
  listItems,
  receiptLines,
  receipts,
  shoppingRuns,
  stores,
  users,
} from "../schema.js";
import { requireMembership, requireShopper } from "../lib/context.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  parseReceiptImage,
  type ListContextItem,
  geminiConfigured,
} from "../lib/gemini.js";
import {
  AUTO_MATCH_CONFIDENCE,
  applyLineResolution,
  countUnresolvedForRun,
  writeLedgerRow,
} from "../lib/receipt-resolution.js";
import { storageConfigured, uploadReceiptImage } from "../lib/storage.js";

async function getHouseRun(runId: string, houseId: string) {
  const [run] = await db
    .select()
    .from(shoppingRuns)
    .where(and(eq(shoppingRuns.id, runId), eq(shoppingRuns.houseId, houseId)));
  if (!run) throw notFound("Run not found");
  return run;
}

async function getReceiptForHouse(receiptId: string, houseId: string) {
  const [row] = await db
    .select({ receipt: receipts, run: shoppingRuns })
    .from(receipts)
    .innerJoin(shoppingRuns, eq(receipts.runId, shoppingRuns.id))
    .where(and(eq(receipts.id, receiptId), eq(shoppingRuns.houseId, houseId)));
  if (!row) throw notFound("Receipt not found");
  return row;
}

async function resolveStoreId(
  houseId: string,
  storeGuess: string,
): Promise<string | null> {
  const houseStores = await db
    .select()
    .from(stores)
    .where(eq(stores.houseId, houseId));
  if (storeGuess === "safeway") {
    return houseStores.find((s) => /safeway/i.test(s.name))?.id ?? null;
  }
  if (storeGuess === "trader_joes") {
    return houseStores.find((s) => /trader/i.test(s.name))?.id ?? null;
  }
  return null;
}

export function receiptRoutes(app: FastifyInstance): void {
  app.get("/api/runs/:id/receipts", async (req) => {
    const membership = requireMembership(req.membership);
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    await getHouseRun(runId, membership.houseId);

    const runReceipts = await db
      .select()
      .from(receipts)
      .where(eq(receipts.runId, runId))
      .orderBy(asc(receipts.createdAt));

    const result = [];
    for (const receipt of runReceipts) {
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(receiptLines)
        .where(
          and(eq(receiptLines.receiptId, receipt.id), isNull(receiptLines.resolution)),
        );
      result.push({
        ...receipt,
        unresolvedCount: count?.n ?? 0,
        integrityWarning: Boolean(
          (receipt.geminiRaw as Record<string, unknown> | null)?._integrityMismatch,
        ),
      });
    }
    return { receipts: result };
  });

  app.post("/api/runs/:id/receipts", async (req, reply) => {
    const membership = requireMembership(req.membership);
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const run = await getHouseRun(runId, membership.houseId);
    requireShopper(run, req.authUser!, membership);

    if (!["locked", "reconciling"].includes(run.state)) {
      throw conflict(`Cannot upload receipts while run is '${run.state}'`, "BAD_STATE");
    }

    const data = await req.file();
    if (!data) throw badRequest("Expected multipart file field");

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const mimeType = data.mimetype || "image/jpeg";
    if (!mimeType.startsWith("image/")) throw badRequest("File must be an image");

    if (!geminiConfigured()) {
      throw badRequest("GEMINI_API_KEY not configured — use manual line entry after creating a blank receipt");
    }
    if (!storageConfigured()) {
      throw badRequest("Supabase storage not configured");
    }

    const listRows = await db
      .select({
        item: listItems,
        requester: users.displayName,
      })
      .from(listItems)
      .innerJoin(users, eq(listItems.requesterId, users.id))
      .where(eq(listItems.runId, runId));

    const listContext: ListContextItem[] = listRows.map(({ item, requester }) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      kind: item.kind,
      requester,
    }));

    const { parsed, raw, integrityOk } = await parseReceiptImage(
      buffer,
      mimeType,
      listContext,
    );

    const receiptId = randomUUID();
    const imagePath = await uploadReceiptImage(runId, receiptId, buffer, mimeType);
    const storeId = await resolveStoreId(membership.houseId, parsed.store_guess);

    const geminiRaw = {
      ...(raw as object),
      _integrityMismatch: !integrityOk,
    };

    const [receipt] = await db
      .insert(receipts)
      .values({
        id: receiptId,
        runId,
        storeId,
        imagePath,
        purchasedAt: parsed.purchased_at ? new Date(parsed.purchased_at) : null,
        subtotalCents: parsed.subtotal_cents,
        taxCents: parsed.tax_cents,
        totalCents: parsed.total_cents,
        geminiRaw,
      })
      .returning();

    if (run.state === "locked") {
      await db
        .update(shoppingRuns)
        .set({ state: "reconciling" })
        .where(eq(shoppingRuns.id, runId));
    }

    const insertedLines = [];
    for (const line of parsed.lines) {
      const matchId = line.match.list_item_id;
      const validMatch =
        matchId && listContext.some((i) => i.id === matchId) ? matchId : null;
      const autoMatch =
        validMatch && line.match.confidence >= AUTO_MATCH_CONFIDENCE;

      const [row] = await db
        .insert(receiptLines)
        .values({
          receiptId: receipt.id,
          rawText: line.raw_text,
          parsedName: line.parsed_name,
          quantity: line.quantity.toString(),
          unitPriceCents: line.unit_price_cents ?? null,
          totalCents: line.total_cents,
          isDiscount: line.is_discount,
          isFee: line.is_fee,
          matchedItemId: autoMatch ? validMatch : null,
          matchConfidence: validMatch ? line.match.confidence : null,
          resolution: autoMatch ? "auto_matched" : null,
          resolvedKind: autoMatch
            ? (listRows.find((r) => r.item.id === validMatch)?.item.kind ?? null)
            : null,
          resolvedUserId: autoMatch
            ? listRows.find((r) => r.item.id === validMatch)?.item.kind === "personal"
              ? listRows.find((r) => r.item.id === validMatch)?.item.requesterId
              : null
            : null,
        })
        .returning();

      if (autoMatch && validMatch) {
        const [item] = await db
          .select()
          .from(listItems)
          .where(eq(listItems.id, validMatch));
        if (item?.state === "in_cart") {
          await db
            .update(listItems)
            .set({ state: "purchased", updatedAt: new Date() })
            .where(eq(listItems.id, validMatch));
        }
      }

      if (row.resolution) {
        await writeLedgerRow(membership.houseId, receipt, row);
      }
      insertedLines.push(row);
    }

    reply.code(201);
    return {
      ok: true,
      receipt: {
        ...receipt,
        integrityWarning: !integrityOk,
      },
      lines: insertedLines,
      unresolvedCount: insertedLines.filter((l) => !l.resolution).length,
    };
  });

  app.get("/api/receipts/:id/lines", async (req) => {
    const membership = requireMembership(req.membership);
    const receiptId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const { receipt, run } = await getReceiptForHouse(receiptId, membership.houseId);

    const lines = await db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, receiptId))
      .orderBy(asc(receiptLines.id));

    const unmatchedItems = await db
      .select({
        item: listItems,
        requesterDisplayName: users.displayName,
      })
      .from(listItems)
      .innerJoin(users, eq(listItems.requesterId, users.id))
      .where(
        and(
          eq(listItems.runId, run.id),
          sql`${listItems.state} IN ('pending', 'in_cart')`,
        ),
      );

    return {
      receipt: {
        ...receipt,
        integrityWarning: Boolean(
          (receipt.geminiRaw as Record<string, unknown> | null)?._integrityMismatch,
        ),
      },
      lines,
      unmatchedItems: unmatchedItems.map(({ item, requesterDisplayName }) => ({
        ...item,
        requesterDisplayName,
      })),
      unresolvedCount: lines.filter((l) => !l.resolution).length,
    };
  });

  app.patch("/api/receipt-lines/:id", async (req) => {
    const membership = requireMembership(req.membership);
    const lineId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const body = z
      .object({
        resolution: z.enum([
          "manually_matched",
          "assigned_communal",
          "assigned_personal",
          "skipped",
        ]),
        matchedItemId: z.string().uuid().nullable().optional(),
        resolvedKind: z.enum(["communal", "personal"]).nullable().optional(),
        resolvedUserId: z.string().uuid().nullable().optional(),
        parsedName: z.string().min(1).optional(),
        totalCents: z.number().int().optional(),
      })
      .parse(req.body);

    const [ctx] = await db
      .select({ run: shoppingRuns })
      .from(receiptLines)
      .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
      .innerJoin(shoppingRuns, eq(receipts.runId, shoppingRuns.id))
      .where(
        and(
          eq(receiptLines.id, lineId),
          eq(shoppingRuns.houseId, membership.houseId),
        ),
      );
    if (!ctx) throw notFound("Receipt line not found");
    requireShopper(ctx.run, req.authUser!, membership);

    const { line } = await applyLineResolution(lineId, membership.houseId, {
      resolution: body.resolution,
      matchedItemId: body.matchedItemId,
      resolvedKind: body.resolvedKind,
      resolvedUserId: body.resolvedUserId,
      parsedName: body.parsedName,
      totalCents: body.totalCents,
    });

    const [lineReceipt] = await db
      .select({ receipt: receipts })
      .from(receiptLines)
      .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
      .where(eq(receiptLines.id, lineId));

    if (
      lineReceipt?.receipt &&
      line.resolution &&
      line.resolution !== "skipped"
    ) {
      await writeLedgerRow(membership.houseId, lineReceipt.receipt, line);
    }

    return { ok: true, line };
  });

  app.delete("/api/receipts/:id", async (req) => {
    const membership = requireMembership(req.membership);
    const receiptId = z.string().uuid().parse((req.params as Record<string, string>).id);
    const { run } = await getReceiptForHouse(receiptId, membership.houseId);
    requireShopper(run, req.authUser!, membership);

    if (run.state !== "reconciling") {
      throw conflict("Can only delete receipts before finalize", "BAD_STATE");
    }

    await db.delete(receiptLines).where(eq(receiptLines.receiptId, receiptId));
    await db.delete(receipts).where(eq(receipts.id, receiptId));
    return { ok: true };
  });

  app.get("/api/runs/:id/reconcile-status", async (req) => {
    const membership = requireMembership(req.membership);
    const runId = z.string().uuid().parse((req.params as Record<string, string>).id);
    await getHouseRun(runId, membership.houseId);
    const unresolved = await countUnresolvedForRun(runId);
    return { unresolvedCount: unresolved, canFinalize: unresolved === 0 };
  });
}
