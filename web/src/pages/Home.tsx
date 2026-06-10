import { useEffect, useState } from "react";
import {
  api,
  isShopper,
  lockRun,
  doneShopping,
  type CurrentRun,
  type Me,
} from "../api";
import { persistLockSnapshot } from "../offline/snapshot";
import SubstituteRequests from "../components/SubstituteRequests";

const STATE_LABELS: Record<string, string> = {
  draft: "Draft — not open yet",
  open: "List is open",
  locked: "Shopper is out shopping",
  reconciling: "Receipts being processed",
  settling: "Waiting on payments",
};

export default function Home({
  me,
  nav,
}: {
  me: Me;
  nav: (path: string) => void;
}) {
  const [current, setCurrent] = useState<CurrentRun | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = me.membership?.isAdmin || me.membership?.isManager;

  useEffect(() => {
    api<CurrentRun>("/api/runs/current")
      .then(setCurrent)
      .catch((err) => setError((err as Error).message));
  }, []);

  async function startRun() {
    setError("");
    try {
      await api("/api/runs", { method: "POST" });
      nav("/run");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function headingToStore() {
    if (!current?.run) return;
    setBusy(true);
    setError("");
    try {
      const lock = await lockRun(current.run.id);
      await persistLockSnapshot(lock, lock.sections ?? []);
      nav("/shop");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finishShopping() {
    if (!current?.run) return;
    setBusy(true);
    setError("");
    try {
      const r = await doneShopping(current.run.id);
      setCurrent((c) => (c ? { ...c, run: r.run } : c));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!me.membership) {
    return (
      <div className="card center">
        <h2>No house yet</h2>
        <p className="muted">Ask your house admin for an invite link.</p>
      </div>
    );
  }

  const run = current?.run ?? null;
  const pending = current?.itemCounts?.pending ?? 0;
  const shopper = isShopper(me, run);

  return (
    <div className="stack">
      <SubstituteRequests />
      <div className="card">
        <h2>{me.house?.name ?? "House"}</h2>
        {!current && !error && <p className="muted">Loading…</p>}
        {run ? (
          <>
            <p>
              <span className={`badge state-${run.state}`}>
                {STATE_LABELS[run.state] ?? run.state}
              </span>
            </p>
            {run.scheduledAt && (
              <p className="muted">
                Shopping: {new Date(run.scheduledAt).toLocaleString()}
              </p>
            )}
            {current?.shopper && (
              <p className="muted">Shopper: {current.shopper.displayName}</p>
            )}
            <p className="muted">{pending} item(s) on the list</p>
            <div className="row">
              {run.state === "open" && (
                <button onClick={() => nav("/list")}>Open list</button>
              )}
              {shopper && run.state === "open" && (
                <button onClick={headingToStore} disabled={busy}>
                  Heading to store
                </button>
              )}
              {shopper && run.state === "locked" && (
                <>
                  <button onClick={() => nav("/shop")}>Continue shopping</button>
                  <button className="secondary" onClick={finishShopping} disabled={busy}>
                    Done shopping
                  </button>
                </>
              )}
              {canManage && (
                <button className="secondary" onClick={() => nav("/run")}>
                  Manage run
                </button>
              )}
            </div>
          </>
        ) : (
          current && (
            <>
              <p className="muted">No active shopping run.</p>
              {canManage && <button onClick={startRun}>Start new run</button>}
            </>
          )
        )}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="card">
        <div className="row spread">
          <span>
            Signed in as <strong>{me.user.displayName || me.user.email}</strong>
          </span>
          <button className="link" onClick={() => nav("/profile")}>
            Edit profile
          </button>
        </div>
      </div>
    </div>
  );
}
