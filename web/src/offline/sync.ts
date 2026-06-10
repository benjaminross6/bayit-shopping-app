import {
  createSubstituteRequest,
  logRunIssue,
  patchItemState,
  type Item,
  type ItemState,
} from "../api";
import {
  appendOutbox,
  getClientId,
  listOutbox,
  nextSeq,
  removeOutboxEntry,
  updateSnapshotItems,
  type OutboxEntry,
} from "./db";

export type SyncError = {
  seq: number;
  op: string;
  itemId?: string;
  message: string;
};

let replaying = false;
const errorListeners = new Set<(errors: SyncError[]) => void>();

export function onSyncErrors(listener: (errors: SyncError[]) => void): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

function notifyErrors(errors: SyncError[]): void {
  if (errors.length > 0) {
    errorListeners.forEach((fn) => fn(errors));
  }
}

export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

async function replayEntry(entry: OutboxEntry): Promise<void> {
  const idempotency = { clientId: entry.clientId, seq: entry.seq };

  switch (entry.op) {
    case "state_change": {
      const state = entry.payload.state as ItemState;
      await patchItemState(entry.itemId!, state, idempotency);
      break;
    }
    case "substitute_request":
      await createSubstituteRequest(entry.itemId!, idempotency);
      break;
    case "issue":
      await logRunIssue(entry.runId, {
        itemId: entry.itemId,
        kind: entry.payload.kind as Parameters<typeof logRunIssue>[1]["kind"],
        note: entry.payload.note as string | undefined,
        ...idempotency,
      });
      break;
  }
}

export async function replayOutbox(runId?: string): Promise<SyncError[]> {
  if (replaying || !isOnline()) return [];
  replaying = true;
  const errors: SyncError[] = [];

  try {
    const entries = await listOutbox(runId);
    for (const entry of entries) {
      if (!entry.id) continue;
      try {
        await replayEntry(entry);
        await removeOutboxEntry(entry.id);
      } catch (err) {
        errors.push({
          seq: entry.seq,
          op: entry.op,
          itemId: entry.itemId,
          message: (err as Error).message,
        });
      }
    }
  } finally {
    replaying = false;
  }

  notifyErrors(errors);
  return errors;
}

export async function queueStateChange(
  runId: string,
  itemId: string,
  state: ItemState,
  items: Item[],
): Promise<Item[]> {
  const clientId = await getClientId();
  const seq = await nextSeq();
  const updated = items.map((i) => (i.id === itemId ? { ...i, state } : i));
  await updateSnapshotItems(runId, updated);
  await appendOutbox({
    runId,
    op: "state_change",
    itemId,
    payload: { state },
    clientTs: Date.now(),
    seq,
    clientId,
  });

  if (isOnline()) {
    void replayOutbox(runId);
  } else {
    void requestBackgroundSync();
  }

  return updated;
}

export async function queueSubstituteRequest(
  runId: string,
  itemId: string,
): Promise<{ queued: true; offline: boolean }> {
  const clientId = await getClientId();
  const seq = await nextSeq();
  await appendOutbox({
    runId,
    op: "substitute_request",
    itemId,
    payload: {},
    clientTs: Date.now(),
    seq,
    clientId,
  });

  const offline = !isOnline();
  if (isOnline()) {
    void replayOutbox(runId);
  } else {
    void requestBackgroundSync();
  }
  return { queued: true, offline };
}

export async function queueIssue(
  runId: string,
  payload: { itemId?: string; kind: string; note?: string },
): Promise<{ queued: true; offline: boolean }> {
  const clientId = await getClientId();
  const seq = await nextSeq();
  await appendOutbox({
    runId,
    op: "issue",
    itemId: payload.itemId,
    payload,
    clientTs: Date.now(),
    seq,
    clientId,
  });

  const offline = !isOnline();
  if (isOnline()) {
    void replayOutbox(runId);
  } else {
    void requestBackgroundSync();
  }
  return { queued: true, offline };
}

export async function requestBackgroundSync(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("sync" in reg) {
      await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(
        "outbox-replay",
      );
    }
  } catch {
    // Background Sync unsupported (iOS) — foreground replay handles it
  }
}

export function setupSyncListeners(): () => void {
  const onOnline = () => void replayOutbox();
  const onVisible = () => {
    if (document.visibilityState === "visible") void replayOutbox();
  };
  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === "REPLAY_OUTBOX") void replayOutbox();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  navigator.serviceWorker?.addEventListener("message", onMessage);

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.removeEventListener("message", onMessage);
  };
}
