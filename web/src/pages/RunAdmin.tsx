import { useCallback, useEffect, useState } from "react";
import {
  api,
  doneShopping,
  isShopper,
  lockRun,
  type CurrentRun,
  type Me,
  type Member,
} from "../api";
import { persistLockSnapshot } from "../offline/snapshot";

export default function RunAdmin({
  me,
  nav,
}: {
  me: Me;
  nav: (path: string) => void;
}) {
  const [current, setCurrent] = useState<CurrentRun | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [shopperId, setShopperId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<CurrentRun>("/api/runs/current")
      .then((c) => {
        setCurrent(c);
        if (c.run?.scheduledAt) {
          setScheduledAt(c.run.scheduledAt.slice(0, 16));
        }
        setShopperId(c.run?.shopperId ?? "");
      })
      .catch((err) => setError((err as Error).message));
    api<{ members: Member[] }>("/api/house/members")
      .then((r) => setMembers(r.members))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  async function createDraft() {
    setBusy(true);
    setError("");
    try {
      await api("/api/runs", { method: "POST" });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!current?.run) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/runs/${current.run.id}`, {
        method: "PATCH",
        body: {
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          shopperId: shopperId || null,
        },
      });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openRun() {
    if (!current?.run) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/runs/${current.run.id}/open`, { method: "POST" });
      nav("/list");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
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
      await doneShopping(current.run.id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const run = current?.run ?? null;
  const shopper = isShopper(me, run);

  return (
    <div className="card">
      <button className="link" onClick={() => nav("/")}>
        ← Home
      </button>
      <h2>Manage shopping run</h2>
      {!run && current && (
        <>
          <p className="muted">No active run.</p>
          <button onClick={createDraft} disabled={busy}>
            Create draft run
          </button>
        </>
      )}
      {run && (
        <div className="stack">
          <p>
            State: <span className={`badge state-${run.state}`}>{run.state}</span>
          </p>
          <label>
            Shopping time
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </label>
          <label>
            Shopper
            <select value={shopperId} onChange={(e) => setShopperId(e.target.value)}>
              <option value="">— pick later —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName || m.email}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button className="secondary" onClick={save} disabled={busy}>
              Save
            </button>
            {run.state === "draft" && (
              <button onClick={openRun} disabled={busy}>
                Open list for house
              </button>
            )}
            {run.state === "open" && (
              <button onClick={() => nav("/list")}>Go to list</button>
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
            {shopper && run.state === "reconciling" && (
              <>
                <button onClick={() => nav("/receipts")}>Upload receipts</button>
                <button className="secondary" onClick={() => nav("/reconcile")}>
                  Reconcile
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {me.membership?.isAdmin && <InviteSection />}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function InviteSection() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  async function createInvite() {
    setError("");
    try {
      const r = await api<{ url: string }>("/api/invites", { method: "POST" });
      setUrl(r.url);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="invite-section">
      <h3>Invite a housemate</h3>
      {url ? (
        <div className="stack">
          <input readOnly value={url} onFocus={(e) => e.target.select()} />
          <button
            className="secondary"
            onClick={() => navigator.clipboard.writeText(url)}
          >
            Copy link
          </button>
        </div>
      ) : (
        <button className="secondary" onClick={createInvite}>
          Create invite link
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
