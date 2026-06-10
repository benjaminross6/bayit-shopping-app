import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  deleteReceipt,
  formatCents,
  isShopper,
  listReceipts,
  type CurrentRun,
  type Me,
  type Receipt,
  uploadReceipt,
} from "../api";

export default function ReceiptsPage({
  me,
  nav,
}: {
  me: Me;
  nav: (path: string) => void;
}) {
  const [current, setCurrent] = useState<CurrentRun | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = current?.run ?? null;
  const shopper = isShopper(me, run);

  const load = useCallback(() => {
    api<CurrentRun>("/api/runs/current")
      .then(setCurrent)
      .catch((err) => setError((err as Error).message));
  }, []);

  const loadReceipts = useCallback((runId: string) => {
    listReceipts(runId)
      .then(setReceipts)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (run?.id) loadReceipts(run.id);
  }, [run?.id, loadReceipts]);

  async function onFile(file: File | undefined) {
    if (!file || !run) return;
    setBusy(true);
    setError("");
    try {
      await uploadReceipt(run.id, file);
      loadReceipts(run.id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeReceipt(id: string) {
    if (!run || !confirm("Delete this receipt and re-upload?")) return;
    setBusy(true);
    setError("");
    try {
      await deleteReceipt(id);
      loadReceipts(run.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalUnresolved = receipts.reduce((n, r) => n + (r.unresolvedCount ?? 0), 0);

  return (
    <div className="stack">
      <div className="card">
        <button className="link" onClick={() => nav("/")}>
          ← Home
        </button>
        <h2>Receipts</h2>
        {!run && !error && <p className="muted">Loading…</p>}
        {run && !shopper && (
          <p className="muted">Only the shopper can upload receipts.</p>
        )}
        {run && shopper && ["locked", "reconciling"].includes(run.state) && (
          <div className="stack">
            <p className="muted small">
              Photograph the full receipt in good light. Include store name, date, line
              items, subtotal, tax, and total. One receipt per photo.
            </p>
            <label>
              Receipt photo
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
          </div>
        )}
        {run && run.state === "settling" && (
          <p className="muted">Run finalized — receipts are read-only.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {run && receipts.length > 0 && (
        <div className="card stack">
          <div className="row spread">
            <h3>Uploaded ({receipts.length})</h3>
            {totalUnresolved > 0 && (
              <span className="badge state-reconciling">
                {totalUnresolved} unresolved
              </span>
            )}
          </div>
          {receipts.map((r) => (
            <div key={r.id} className="receipt-row stack">
              <div className="row spread">
                <strong>
                  {r.purchasedAt
                    ? new Date(r.purchasedAt).toLocaleString()
                    : new Date(r.createdAt).toLocaleString()}
                </strong>
                <span className="muted small">
                  {r.totalCents != null ? formatCents(r.totalCents) : "—"}
                </span>
              </div>
              {r.integrityWarning && (
                <p className="banner-warn small">
                  Totals may not match line items — review before finalizing.
                </p>
              )}
              <p className="muted small">
                {(r.unresolvedCount ?? 0) > 0
                  ? `${r.unresolvedCount} line(s) need resolution`
                  : "All lines resolved"}
              </p>
              <div className="row">
                {(r.unresolvedCount ?? 0) > 0 && run.state === "reconciling" && (
                  <button onClick={() => nav(`/reconcile?receipt=${r.id}`)}>
                    Reconcile
                  </button>
                )}
                {shopper && run.state === "reconciling" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void removeReceipt(r.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
          {shopper && run.state === "reconciling" && totalUnresolved === 0 && (
            <button onClick={() => nav("/reconcile")}>Review & finalize</button>
          )}
        </div>
      )}
    </div>
  );
}
