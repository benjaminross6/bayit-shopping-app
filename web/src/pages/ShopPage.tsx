import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  doneShopping,
  isShopper,
  type CurrentRun,
  type IssueKind,
  type Item,
  type ItemState,
  type Me,
  type Requester,
  type Store,
} from "../api";
import { getSnapshot, pendingOutboxCount } from "../offline/db";
import {
  isOnline,
  onSyncErrors,
  queueIssue,
  queueStateChange,
  queueSubstituteRequest,
  type SyncError,
} from "../offline/sync";

const SECTION_LABELS: Record<string, string> = {
  produce: "Produce",
  dairy: "Dairy",
  meat: "Meat",
  bakery: "Bakery",
  dry_goods: "Dry goods",
  frozen: "Frozen",
  household: "Household",
  other: "Other",
};

const ISSUE_KINDS: { value: IssueKind; label: string }[] = [
  { value: "not_found", label: "Not found" },
  { value: "out_of_stock", label: "Out of stock" },
  { value: "substituted", label: "Substituted" },
  { value: "price_surprise", label: "Price surprise" },
  { value: "other", label: "Other" },
];

function nextShopState(state: string): ItemState | null {
  if (state === "pending") return "in_cart";
  if (state === "in_cart") return "purchased";
  return null;
}

export default function ShopPage({
  me,
  nav,
}: {
  me: Me;
  nav: (path: string) => void;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [runState, setRunState] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [requesters, setRequesters] = useState<Record<string, Requester>>({});
  const [sections, setSections] = useState<string[]>([]);
  const [storeTab, setStoreTab] = useState<string>("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(!isOnline());
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncErrors, setSyncErrors] = useState<SyncError[]>([]);
  const [issueModal, setIssueModal] = useState<{ item: Item | null } | null>(null);
  const [issueKind, setIssueKind] = useState<IssueKind>("not_found");
  const [issueNote, setIssueNote] = useState("");
  const [toast, setToast] = useState("");

  const refreshQueued = useCallback(async (id: string) => {
    setQueuedCount(await pendingOutboxCount(id));
  }, []);

  const loadFromDexie = useCallback(async (id: string) => {
    const snap = await getSnapshot(id);
    if (!snap) return false;
    setItems(snap.items);
    setStores(snap.stores);
    setRequesters(snap.requesters);
    setSections(snap.sections);
    setRunState(snap.run.state);
    return true;
  }, []);

  const loadFromServer = useCallback(async (id: string) => {
    const r = await api<{ items: Item[]; stores: Store[]; sections: string[] }>(
      `/api/runs/${id}/items`,
    );
    setItems(r.items);
    setStores(r.stores);
    setSections(r.sections);
  }, []);

  useEffect(() => {
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    return onSyncErrors((errors) => {
      setSyncErrors(errors);
      if (runId) void refreshQueued(runId);
    });
  }, [runId, refreshQueued]);

  useEffect(() => {
    api<CurrentRun>("/api/runs/current")
      .then(async (c) => {
        if (!c.run) {
          setError("No active run.");
          return;
        }
        if (!isShopper(me, c.run)) {
          setError("Shop view is for the assigned shopper only.");
          return;
        }
        if (c.run.state !== "locked" && c.run.state !== "reconciling") {
          setError("Shop view is available once the run is locked.");
          return;
        }
        setRunId(c.run.id);
        setRunState(c.run.state);

        const hasSnap = await loadFromDexie(c.run.id);
        if (isOnline()) {
          try {
            await loadFromServer(c.run.id);
          } catch (err) {
            if (!hasSnap) throw err;
          }
        } else if (!hasSnap) {
          setError("No offline snapshot — lock the run while online first.");
        }
        await refreshQueued(c.run.id);
      })
      .catch((err) => setError((err as Error).message));
  }, [me, loadFromDexie, loadFromServer, refreshQueued]);

  const storeLegs = useMemo(() => {
    const legs: { id: string; name: string }[] = [{ id: "", name: "All stores" }];
    for (const s of stores) legs.push({ id: s.id, name: s.name });
    const unknown = items.some((i) => !i.storePref);
    if (unknown && !legs.some((l) => l.id === "any")) {
      legs.push({ id: "any", name: "Any store" });
    }
    return legs;
  }, [stores, items]);

  useEffect(() => {
    if (!storeTab && storeLegs.length > 1) {
      setStoreTab(storeLegs[1]?.id ?? "");
    }
  }, [storeLegs, storeTab]);

  const filteredItems = useMemo(() => {
    if (!storeTab || storeTab === "") return items.filter((i) => i.state !== "archived");
    if (storeTab === "any") return items.filter((i) => !i.storePref && i.state !== "archived");
    return items.filter((i) => i.storePref === storeTab && i.state !== "archived");
  }, [items, storeTab]);

  const grouped = useMemo(() => {
    const secOrder = sections.length ? sections : [...new Set(filteredItems.map((i) => i.section))];
    return secOrder
      .map((section) => ({
        section,
        items: filteredItems.filter((i) => i.section === section),
      }))
      .filter((g) => g.items.length > 0);
  }, [filteredItems, sections]);

  async function toggleItem(item: Item) {
    if (!runId || runState !== "locked") return;
    const next = nextShopState(item.state);
    if (!next) return;
    setError("");
    try {
      const updated = await queueStateChange(runId, item.id, next, items);
      setItems(updated);
      await refreshQueued(runId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function archiveItem(item: Item) {
    if (!runId || runState !== "locked") return;
    setError("");
    try {
      const updated = await queueStateChange(runId, item.id, "archived", items);
      setItems(updated);
      await refreshQueued(runId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function requestSubstitute(item: Item) {
    if (!runId) return;
    setError("");
    try {
      const r = await queueSubstituteRequest(runId, item.id);
      setToast(
        r.offline
          ? "Substitute request queued — will send when back online"
          : "Substitute request sent",
      );
      await refreshQueued(runId);
      window.setTimeout(() => setToast(""), 4000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitIssue() {
    if (!runId) return;
    setBusy(true);
    setError("");
    try {
      const r = await queueIssue(runId, {
        itemId: issueModal?.item?.id,
        kind: issueKind,
        note: issueNote || undefined,
      });
      setIssueModal(null);
      setIssueNote("");
      setToast(
        r.offline ? "Issue queued — will send when back online" : "Issue logged",
      );
      await refreshQueued(runId);
      window.setTimeout(() => setToast(""), 4000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finishShopping() {
    if (!runId) return;
    setBusy(true);
    setError("");
    try {
      const r = await doneShopping(runId);
      setRunState(r.run.state);
      nav("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const archivedCount = items.filter((i) => i.state === "archived").length;
  const doneCount = items.filter((i) => i.state === "purchased").length;

  return (
    <div className="stack">
      <div className="card">
        <button className="link" onClick={() => nav("/")} type="button">
          ← Home
        </button>
        <h2>Shop mode</h2>
        {offline && <p className="offline-banner">Offline — changes queue locally</p>}
        {queuedCount > 0 && (
          <p className="muted small">
            {queuedCount} change{queuedCount === 1 ? "" : "s"} waiting to sync
          </p>
        )}
        {toast && <p className="toast">{toast}</p>}
        <p className="muted">
          {doneCount} purchased · {archivedCount} skipped
        </p>

        <div className="tabs">
          {storeLegs.map((leg) => (
            <button
              key={leg.id || "all"}
              type="button"
              className={`tab ${storeTab === leg.id ? "active" : ""}`}
              onClick={() => setStoreTab(leg.id)}
            >
              {leg.name}
            </button>
          ))}
        </div>

      </div>

      {syncErrors.length > 0 && (
        <div className="card sync-errors">
          <h3>Couldn&apos;t sync {syncErrors.length} change(s)</h3>
          {syncErrors.map((e) => (
            <p key={e.seq} className="error small">
              {e.op} #{e.seq}: {e.message}
            </p>
          ))}
          <button className="link" type="button" onClick={() => setSyncErrors([])}>
            Dismiss
          </button>
        </div>
      )}

      {grouped.map((g) => (
        <div className="card" key={g.section}>
          <h3>{SECTION_LABELS[g.section] ?? g.section}</h3>
          {g.items.map((item) => (
            <ShopItemRow
              key={item.id}
              item={item}
              requester={requesters[item.requesterId]}
              readOnly={runState !== "locked"}
              onToggle={() => toggleItem(item)}
              onSkip={() => archiveItem(item)}
              onSubstitute={() => requestSubstitute(item)}
              onIssue={() => {
                setIssueKind("not_found");
                setIssueModal({ item });
              }}
            />
          ))}
        </div>
      ))}

      {filteredItems.length === 0 && !error && (
        <p className="muted center">No items for this store leg.</p>
      )}

      {runState === "locked" && (
        <div className="card">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setIssueKind("other");
              setIssueModal({ item: null });
            }}
          >
            Log general issue
          </button>
          <button type="button" onClick={finishShopping} disabled={busy}>
            Done shopping
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {issueModal && (
        <div className="modal-backdrop" onClick={() => !busy && setIssueModal(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3>Log issue</h3>
            {issueModal.item && (
              <p className="muted">Item: {issueModal.item.name}</p>
            )}
            <label>
              Kind
              <select
                value={issueKind}
                onChange={(e) => setIssueKind(e.target.value as IssueKind)}
              >
                {ISSUE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note (optional)
              <input
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
                placeholder="Details for the house"
              />
            </label>
            <div className="row">
              <button type="button" disabled={busy} onClick={submitIssue}>
                Save
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setIssueModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShopItemRow({
  item,
  requester,
  readOnly,
  onToggle,
  onSkip,
  onSubstitute,
  onIssue,
}: {
  item: Item;
  requester?: Requester;
  readOnly: boolean;
  onToggle: () => void;
  onSkip: () => void;
  onSubstitute: () => void;
  onIssue: () => void;
}) {
  const stateClass =
    item.state === "purchased"
      ? "shop-item purchased"
      : item.state === "in_cart"
        ? "shop-item in-cart"
        : "shop-item";

  return (
    <div className={`row spread item-row ${stateClass}`}>
      <button
        type="button"
        className="shop-item-main"
        disabled={readOnly || item.state === "purchased"}
        onClick={onToggle}
      >
        <span className="check-icon">
          {item.state === "purchased" ? "✓" : item.state === "in_cart" ? "◉" : "○"}
        </span>
        <span>
          <strong>{item.name}</strong>
          {item.quantity ? ` ×${item.quantity}` : ""}
          {item.unit ? ` ${item.unit}` : ""}{" "}
          <span className={`badge kind-${item.kind}`}>{item.kind}</span>
          {requester && (
            <span className="muted small"> · {requester.displayName}</span>
          )}
          {item.notes && <div className="muted small">{item.notes}</div>}
          {item.alternatives.length > 0 && (
            <div className="muted small">Alt: {item.alternatives.join(", ")}</div>
          )}
        </span>
      </button>
      {!readOnly && item.state !== "purchased" && (
        <div className="shop-actions">
          <button type="button" className="link" onClick={onSubstitute}>
            Can&apos;t find
          </button>
          <button type="button" className="link" onClick={onIssue}>
            Issue
          </button>
          {item.state !== "archived" && (
            <button type="button" className="link danger" onClick={onSkip}>
              Skip
            </button>
          )}
        </div>
      )}
    </div>
  );
}
