import Dexie, { type Table } from "dexie";
import type { Item, Requester, Run, Store } from "../api";

export type OutboxOp =
  | "state_change"
  | "substitute_request"
  | "issue";

export type OutboxEntry = {
  id?: number;
  runId: string;
  op: OutboxOp;
  itemId?: string;
  payload: Record<string, unknown>;
  clientTs: number;
  seq: number;
  clientId: string;
};

export type RunSnapshot = {
  runId: string;
  run: Run;
  items: Item[];
  stores: Store[];
  requesters: Record<string, Requester>;
  sections: string[];
  savedAt: number;
};

export type MetaEntry = {
  key: string;
  value: string;
};

class BayitOfflineDb extends Dexie {
  snapshots!: Table<RunSnapshot, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("bayit-offline");
    this.version(1).stores({
      snapshots: "runId",
      outbox: "++id, runId, seq",
      meta: "key",
    });
  }
}

export const offlineDb = new BayitOfflineDb();

const CLIENT_ID_KEY = "clientId";
const SEQ_KEY = "seq";

export async function getClientId(): Promise<string> {
  const existing = await offlineDb.meta.get(CLIENT_ID_KEY);
  if (existing?.value) return existing.value;
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await offlineDb.meta.put({ key: CLIENT_ID_KEY, value: id });
  return id;
}

export async function nextSeq(): Promise<number> {
  const existing = await offlineDb.meta.get(SEQ_KEY);
  const next = (existing ? parseInt(existing.value, 10) : 0) + 1;
  await offlineDb.meta.put({ key: SEQ_KEY, value: String(next) });
  return next;
}

export async function saveLockSnapshot(snapshot: Omit<RunSnapshot, "savedAt">): Promise<void> {
  await offlineDb.snapshots.put({
    ...snapshot,
    savedAt: Date.now(),
  });
}

export async function getSnapshot(runId: string): Promise<RunSnapshot | undefined> {
  return offlineDb.snapshots.get(runId);
}

export async function updateSnapshotItems(runId: string, items: Item[]): Promise<void> {
  const snap = await offlineDb.snapshots.get(runId);
  if (snap) {
    await offlineDb.snapshots.put({ ...snap, items });
  }
}

export async function appendOutbox(entry: Omit<OutboxEntry, "id">): Promise<OutboxEntry> {
  const id = await offlineDb.outbox.add(entry as OutboxEntry);
  return { ...entry, id };
}

export async function listOutbox(runId?: string): Promise<OutboxEntry[]> {
  if (runId) {
    return offlineDb.outbox.where("runId").equals(runId).sortBy("seq");
  }
  return offlineDb.outbox.orderBy("seq").toArray();
}

export async function removeOutboxEntry(id: number): Promise<void> {
  await offlineDb.outbox.delete(id);
}

export async function pendingOutboxCount(runId?: string): Promise<number> {
  if (runId) {
    return offlineDb.outbox.where("runId").equals(runId).count();
  }
  return offlineDb.outbox.count();
}
