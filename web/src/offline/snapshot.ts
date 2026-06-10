import type { LockResponse } from "../api";
import { saveLockSnapshot } from "./db";

export async function persistLockSnapshot(
  lock: LockResponse,
  sections: string[],
): Promise<void> {
  await saveLockSnapshot({
    runId: lock.run.id,
    run: lock.run,
    items: lock.items,
    stores: lock.stores,
    requesters: lock.requesters,
    sections: lock.sections ?? sections,
  });
}
