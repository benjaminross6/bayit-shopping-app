import { useCallback, useEffect, useState } from "react";
import {
  fetchPendingSubstituteRequests,
  respondToSubstituteRequest,
  type SubstituteRequest,
  type SubstituteResponseKind,
} from "../api";

export default function SubstituteRequests() {
  const [requests, setRequests] = useState<SubstituteRequest[]>([]);
  const [active, setActive] = useState<SubstituteRequest | null>(null);
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetchPendingSubstituteRequests().then(setRequests).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const onPush = (event: MessageEvent) => {
      if (event.data?.type === "SUBSTITUTE_REQUEST") {
        load();
        if (event.data.request) setActive(event.data.request as SubstituteRequest);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onPush);
    const interval = window.setInterval(load, 60_000);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onPush);
      window.clearInterval(interval);
    };
  }, [load]);

  async function respond(kind: SubstituteResponseKind, text?: string) {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      await respondToSubstituteRequest(active.id, kind, text);
      setActive(null);
      setFreeText("");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (requests.length === 0 && !active) return null;

  return (
    <>
      {requests.length > 0 && !active && (
        <button
          className="substitute-badge"
          onClick={() => setActive(requests[0])}
          type="button"
        >
          {requests.length} substitute request{requests.length === 1 ? "" : "s"}
        </button>
      )}

      {active && (
        <div className="modal-backdrop" onClick={() => !busy && setActive(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3>Substitute needed</h3>
            <p>
              Shopper can&apos;t find{" "}
              <strong>{active.item?.name ?? "an item"}</strong>.
            </p>
            {(active.item?.alternatives ?? active.alternatives ?? []).length > 0 && (
              <div className="stack">
                <p className="muted">Pick an alternative:</p>
                {(active.item?.alternatives ?? active.alternatives ?? []).map((alt) => (
                  <button
                    key={alt}
                    className="secondary"
                    disabled={busy}
                    onClick={() => respond("alternative", alt)}
                  >
                    {alt}
                  </button>
                ))}
              </div>
            )}
            <label>
              Or suggest something else
              <input
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="e.g. different brand is fine"
              />
            </label>
            <div className="row">
              {freeText.trim() && (
                <button disabled={busy} onClick={() => respond("free_text", freeText.trim())}>
                  Send suggestion
                </button>
              )}
              <button
                className="secondary"
                disabled={busy}
                onClick={() => respond("none")}
              >
                No substitute — skip it
              </button>
              <button className="link" disabled={busy} onClick={() => setActive(null)}>
                Later
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
