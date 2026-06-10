import { sql } from "drizzle-orm";
import { db } from "../db.js";

export const SIMILARITY_THRESHOLD = 0.55;

export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

export type DuplicateCandidate = {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  kind: string;
  similarity: number;
};

/** Fuzzy-match a candidate name against pending items in a run (Brief Q23). */
export async function findDuplicates(
  runId: string,
  normalizedName: string,
): Promise<DuplicateCandidate[]> {
  const result = await db.execute(sql`
    SELECT id, name, quantity, unit, kind,
           similarity(normalized_name, ${normalizedName}) AS similarity
    FROM list_items
    WHERE run_id = ${runId}
      AND state = 'pending'
      AND similarity(normalized_name, ${normalizedName}) > ${SIMILARITY_THRESHOLD}
    ORDER BY similarity DESC
    LIMIT 5
  `);
  return result.rows as DuplicateCandidate[];
}
