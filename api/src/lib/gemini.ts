import { z } from "zod";
import { env } from "../env.js";

export type ListContextItem = {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  kind: string;
  requester: string;
};

const matchSchema = z.object({
  list_item_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const lineSchema = z.object({
  raw_text: z.string(),
  parsed_name: z.string(),
  quantity: z.number(),
  unit_price_cents: z.number().int().nullable().optional(),
  total_cents: z.number().int(),
  is_discount: z.boolean(),
  is_fee: z.boolean(),
  match: matchSchema,
});

export const receiptParseSchema = z.object({
  store_guess: z.enum(["safeway", "trader_joes", "unknown"]),
  purchased_at: z.string().nullable(),
  subtotal_cents: z.number().int(),
  tax_cents: z.number().int(),
  total_cents: z.number().int(),
  lines: z.array(lineSchema),
});

export type ReceiptParseResult = z.infer<typeof receiptParseSchema>;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  required: ["store_guess", "purchased_at", "subtotal_cents", "tax_cents", "total_cents", "lines"],
  properties: {
    store_guess: { type: "string", enum: ["safeway", "trader_joes", "unknown"] },
    purchased_at: { type: "string", nullable: true },
    subtotal_cents: { type: "integer" },
    tax_cents: { type: "integer" },
    total_cents: { type: "integer" },
    lines: {
      type: "array",
      items: {
        type: "object",
        required: [
          "raw_text",
          "parsed_name",
          "quantity",
          "total_cents",
          "is_discount",
          "is_fee",
          "match",
        ],
        properties: {
          raw_text: { type: "string" },
          parsed_name: { type: "string" },
          quantity: { type: "number" },
          unit_price_cents: { type: "integer", nullable: true },
          total_cents: { type: "integer" },
          is_discount: { type: "boolean" },
          is_fee: { type: "boolean" },
          match: {
            type: "object",
            required: ["list_item_id", "confidence"],
            properties: {
              list_item_id: { type: "string", nullable: true },
              confidence: { type: "number" },
            },
          },
        },
      },
    },
  },
};

export function geminiConfigured(): boolean {
  return Boolean(env.geminiApiKey);
}

/** ±5¢ integrity check per SDD §6.3 */
export function checkReceiptIntegrity(parsed: ReceiptParseResult): boolean {
  const lineSum = parsed.lines.reduce((s, l) => s + l.total_cents, 0);
  const subOk = Math.abs(lineSum - parsed.subtotal_cents) <= 5;
  const totalOk =
    Math.abs(parsed.subtotal_cents + parsed.tax_cents - parsed.total_cents) <= 5;
  return subOk && totalOk;
}

async function callGemini(
  imageBase64: string,
  mimeType: string,
  listItems: ListContextItem[],
  retryHint?: string,
): Promise<unknown> {
  const listJson = JSON.stringify(listItems);
  const prompt = `Parse this grocery receipt image. Match lines to list items when possible.
List context (use these ids in match.list_item_id):
${listJson}
${retryHint ? `\nPrevious response failed validation. ${retryHint}` : ""}
Return structured JSON only.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_JSON_SCHEMA,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${err}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response");
  return JSON.parse(text);
}

/** Parse receipt image with one retry on schema failure (SDD §6.1). */
export async function parseReceiptImage(
  buffer: Buffer,
  mimeType: string,
  listItems: ListContextItem[],
): Promise<{ parsed: ReceiptParseResult; raw: unknown; integrityOk: boolean }> {
  if (!geminiConfigured()) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  const b64 = buffer.toString("base64");
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callGemini(
        b64,
        mimeType,
        listItems,
        attempt > 0 ? "Fix schema and numeric fields." : undefined,
      );
      const parsed = receiptParseSchema.parse(raw);
      return {
        parsed,
        raw,
        integrityOk: checkReceiptIntegrity(parsed),
      };
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error("Gemini parse failed");
}

export type ChatMessage = { role: "user" | "model"; text: string };

export type ReconcileToolCall =
  | { name: "match_line"; args: { line_id: string; item_id: string } }
  | { name: "assign_line"; args: { line_id: string; kind: string; user_id?: string } }
  | { name: "skip_line"; args: { line_id: string } }
  | { name: "edit_line"; args: { line_id: string; parsed_name?: string; total_cents?: number } };

const RECONCILE_TOOLS = [
  {
    name: "match_line",
    description: "Match a receipt line to a list item",
    parameters: {
      type: "object",
      properties: {
        line_id: { type: "string" },
        item_id: { type: "string" },
      },
      required: ["line_id", "item_id"],
    },
  },
  {
    name: "assign_line",
    description: "Assign unresolved line to communal or personal payer",
    parameters: {
      type: "object",
      properties: {
        line_id: { type: "string" },
        kind: { type: "string", enum: ["communal", "personal"] },
        user_id: { type: "string" },
      },
      required: ["line_id", "kind"],
    },
  },
  {
    name: "skip_line",
    description: "Skip line from settlement",
    parameters: {
      type: "object",
      properties: { line_id: { type: "string" } },
      required: ["line_id"],
    },
  },
  {
    name: "edit_line",
    description: "Fix OCR misread on a line",
    parameters: {
      type: "object",
      properties: {
        line_id: { type: "string" },
        parsed_name: { type: "string" },
        total_cents: { type: "integer" },
      },
      required: ["line_id"],
    },
  },
];

export async function reconcileChatTurn(
  context: string,
  history: ChatMessage[],
  message: string,
): Promise<{ reply: string; toolCalls: ReconcileToolCall[] }> {
  if (!geminiConfigured()) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

  const contents = [
    { role: "user", parts: [{ text: `Context:\n${context}` }] },
    ...history.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.text }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      tools: [{ functionDeclarations: RECONCILE_TOOLS }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini chat error (${res.status}): ${err}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name: string; args: Record<string, unknown> };
        }>;
      };
    }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  let reply = "";
  const toolCalls: ReconcileToolCall[] = [];
  for (const part of parts) {
    if (part.text) reply += part.text;
    if (part.functionCall) {
      const { name, args } = part.functionCall;
      toolCalls.push({ name, args } as ReconcileToolCall);
    }
  }
  if (!reply && toolCalls.length > 0) {
    reply = `Applied ${toolCalls.length} change(s).`;
  }
  return { reply: reply || "Done.", toolCalls };
}
