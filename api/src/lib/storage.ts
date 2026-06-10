import { env } from "../env.js";

const BUCKET = "receipts";

export function storageConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

/** Upload receipt image to Supabase Storage. Returns object key `{runId}/{receiptId}.jpg`. */
export async function uploadReceiptImage(
  runId: string,
  receiptId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  if (!storageConfigured()) {
    throw new Error("Supabase storage not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
  }
  const key = `${runId}/${receiptId}.jpg`;
  const url = `${env.supabaseUrl}/storage/v1/object/${BUCKET}/${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Storage upload failed (${res.status}): ${body}`);
  }
  return key;
}

/** Signed public URL for shopper to view receipt (1h). */
export async function getReceiptImageUrl(key: string): Promise<string | null> {
  if (!storageConfigured()) return null;
  const url = `${env.supabaseUrl}/storage/v1/object/sign/${BUCKET}/${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { signedURL?: string };
  if (!data.signedURL) return null;
  return `${env.supabaseUrl}/storage/v1${data.signedURL}`;
}
