import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  finalizeRun,
  formatCents,
  getReceiptLines,
  getReconcileStatus,
  isShopper,
  listReceipts,
  patchReceiptLine,
  sendReconcileChat,
  type ChatMessage,
  type CurrentRun,
  type LineResolution,
  type Me,
  type Receipt,
  type ReceiptLine,
  type UnmatchedItem,
  ApiFail,
} from "../api";

function receiptFromQuery(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("receipt");
}

export default function ReconcilePage({
  me,
  nav,
}: {
  me: Me;
  nav: (path: string) => void;
}) {
  const [current, setCurrent] = useState<CurrentRun | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [activeReceiptId, setActiveReceiptId] = useState<string | null>(
    receiptFromQuery(),
  );
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [members, setMembers] = useState<Array<{ id: string; displayName: string }>>(
    [],
  );
  const [unresolvedRun, setUnresolvedRun] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = current?.run ?? null;
  const shopper = isShopper(me, run);

  const loadRun = useCallback(() => {
    api<CurrentRun>("/api/runs/current")
      .then(setCurrent)
      .catch((err) => setError((err as Error).message));
    api<{ members: Array<{ id: string; displayName: string; email: string }> }>(
      "/api/house/members",
    )
      .then((r) =>
        setMembers(
          r.members.map((m) => ({
            id: m.id,
            displayName: m.displayName || m.email,
          })),
        ),
      )
      .catch(() => {});
  }, []);

  const loadReceipts = useCallback((runId: string) => {
    listReceipts(runId).then((list) => {
      setReceipts(list);
      setActiveReceiptId((prev) => {
        if (prev && list.some((r) => r.id === prev)) return prev;
        const firstOpen = list.find((r) => (r.unresolvedCount ?? 0) > 0);
        return firstOpen?.id ?? list[0]?.id ?? null;
      });
    });
  }, []);

  const loadLines = useCallback((receiptId: string) => {
    getReceiptLines(receiptId)
      .then((r) => {
        setLines(r.lines);
        setUnmatched(r.unmatchedItems);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  const refreshStatus = useCallback((runId: string) => {
    getReconcileStatus(runId)
      .then((s) => setUnresolvedRun(s.unresolvedCount))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (run?.id) {
      loadReceipts(run.id);
      refreshStatus(run.id);
    }
  }, [run?.id, loadReceipts, refreshStatus]);

  useEffect(() => {
    if (activeReceiptId) loadLines(activeReceiptId);
  }, [activeReceiptId, loadLines]);

  const itemById = useMemo(
    () => Object.fromEntries(unmatched.map((i) => [i.id, i])),
    [unmatched],
  );

  async function resolveLine(
    line: ReceiptLine,
    resolution: Exclude<LineResolution, "auto_matched">,
    extra: {
      matchedItemId?: string | null;
      resolvedUserId?: string | null;
    } = {},
  ) {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      await patchReceiptLine(line.id, {
        resolution,
        ...extra,
        resolvedKind:
          resolution === "assigned_communal"
            ? "communal"
            : resolution === "assigned_personal"
              ? "personal"
              : undefined,
      });
      if (activeReceiptId) loadLines(activeReceiptId);
      loadReceipts(run.id);
      refreshStatus(run.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    if (!activeReceiptId || !chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatBusy(true);
    setError("");
    const nextHistory: ChatMessage[] = [
      ...chatHistory,
      { role: "user", text: userMsg },
    ];
    setChatHistory(nextHistory);
    try {
      const { reply, mutations } = await sendReconcileChat(
        activeReceiptId,
        userMsg,
        chatHistory,
      );
      setChatHistory([...nextHistory, { role: "model", text: reply }]);
      if (mutations.length > 0 && run?.id) {
        loadLines(activeReceiptId);
        loadReceipts(run.id);
        refreshStatus(run.id);
      }
    } catch (err) {
      if (err instanceof ApiFail && err.status === 400) {
        setError(
          (err as Error).message +
            " — use the table on the right to resolve lines manually.",
        );
      } else {
        setError((err as Error).message);
      }
    } finally {
      setChatBusy(false);
    }
  }

  async function doFinalize() {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      await finalizeRun(run.id);
      nav("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!run) {
    return (
      <div className="card">
        <p className="muted">Loading…</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (!shopper) {
    return (
      <div className="card">
        <button className="link" onClick={() => nav("/")}>
          ← Home
        </button>
        <p className="muted">Only the shopper can reconcile receipts.</p>
      </div>
    );
  }

  return (
    <div className="reconcile-layout">
      <div className="card reconcile-header">
        <button className="link" onClick={() => nav("/receipts")}>
          ← Receipts
        </button>
        <div className="row spread">
          <h2>Reconcile</h2>
          <span className="badge state-reconciling">
            {unresolvedRun === 0 ? "Ready to finalize" : `${unresolvedRun} unresolved`}
          </span>
        </div>
        {receipts.length > 1 && (
          <label>
            Receipt
            <select
              value={activeReceiptId ?? ""}
              onChange={(e) => setActiveReceiptId(e.target.value || null)}
            >
              {receipts.map((r, i) => (
                <option key={r.id} value={r.id}>
                  Receipt {i + 1}
                  {(r.unresolvedCount ?? 0) > 0
                    ? ` (${r.unresolvedCount} open)`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="reconcile-panes">
        <div className="card reconcile-chat stack">
          <h3>Chat assistant</h3>
          <p className="muted small">
            Ask Gemini to match lines to list items, assign communal/personal, or skip
            non-grocery charges. Works without chat if you use the table.
          </p>
          <div className="chat-log">
            {chatHistory.length === 0 && (
              <p className="muted small">
                e.g. &quot;Match the milk line to Sarah&apos;s oat milk&quot;
              </p>
            )}
            {chatHistory.map((m, i) => (
              <div key={i} className={`chat-bubble chat-${m.role}`}>
                {m.text}
              </div>
            ))}
          </div>
          <div className="row">
            <input
              value={chatInput}
              placeholder="Message…"
              disabled={chatBusy || !activeReceiptId}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendChat();
                }
              }}
            />
            <button disabled={chatBusy || !chatInput.trim()} onClick={() => void sendChat()}>
              Send
            </button>
          </div>
        </div>

        <div className="card reconcile-table stack">
          <h3>Lines</h3>
          {lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              unmatched={unmatched}
              members={members}
              itemById={itemById}
              busy={busy}
              onResolve={resolveLine}
            />
          ))}
          {lines.length === 0 && <p className="muted">No lines yet.</p>}
        </div>
      </div>

      {run.state === "reconciling" && (
        <div className="card">
          <button
            disabled={unresolvedRun > 0 || busy}
            onClick={() => void doFinalize()}
          >
            Finalize run
          </button>
          {unresolvedRun > 0 && (
            <p className="muted small">Resolve all lines before finalizing.</p>
          )}
        </div>
      )}
    </div>
  );
}

function LineRow({
  line,
  unmatched,
  members,
  itemById,
  busy,
  onResolve,
}: {
  line: ReceiptLine;
  unmatched: UnmatchedItem[];
  members: Array<{ id: string; displayName: string }>;
  itemById: Record<string, UnmatchedItem>;
  busy: boolean;
  onResolve: (
    line: ReceiptLine,
    resolution: Exclude<LineResolution, "auto_matched">,
    extra?: { matchedItemId?: string | null; resolvedUserId?: string | null },
  ) => void;
}) {
  const [matchId, setMatchId] = useState("");
  const [personalUserId, setPersonalUserId] = useState("");

  const resolved = Boolean(line.resolution);
  const statusLabel = line.resolution ?? "unresolved";

  return (
    <div className={`line-row ${resolved ? "resolved" : "open"}`}>
      <div className="row spread">
        <strong>{line.parsedName}</strong>
        <span>{formatCents(line.totalCents)}</span>
      </div>
      <p className="muted small">{line.rawText}</p>
      <span className={`badge ${resolved ? "" : "state-reconciling"}`}>{statusLabel}</span>
      {!resolved && (
        <div className="stack line-actions">
          <label>
            Match to list item
            <select value={matchId} onChange={(e) => setMatchId(e.target.value)}>
              <option value="">— pick —</option>
              {unmatched.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.kind}, {i.requesterDisplayName})
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary small-btn"
            disabled={busy || !matchId}
            onClick={() =>
              onResolve(line, "manually_matched", { matchedItemId: matchId })
            }
          >
            Match
          </button>
          <div className="row">
            <button
              className="secondary small-btn"
              disabled={busy}
              onClick={() => onResolve(line, "assigned_communal")}
            >
              Communal
            </button>
            <select
              aria-label="Assign personal line to member"
              value={personalUserId}
              onChange={(e) => setPersonalUserId(e.target.value)}
            >
              <option value="">Personal for…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <button
              className="secondary small-btn"
              disabled={busy || !personalUserId}
              onClick={() =>
                onResolve(line, "assigned_personal", {
                  resolvedUserId: personalUserId,
                })
              }
            >
              Assign
            </button>
            <button
              className="secondary small-btn"
              disabled={busy}
              onClick={() => onResolve(line, "skipped")}
            >
              Skip
            </button>
          </div>
        </div>
      )}
      {resolved && line.matchedItemId && itemById[line.matchedItemId] && (
        <p className="muted small">
          → {itemById[line.matchedItemId].name}
        </p>
      )}
    </div>
  );
}
