import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiFail,
  type CurrentRun,
  type Duplicate,
  type Item,
  type Me,
  type Store,
} from "../api";
import SubstituteRequests from "../components/SubstituteRequests";

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

type AddForm = {
  name: string;
  quantity: string;
  unit: string;
  kind: "communal" | "personal";
  notes: string;
  section: string;
  storePref: string;
  alternatives: string;
};

const emptyForm: AddForm = {
  name: "",
  quantity: "",
  unit: "",
  kind: "communal",
  notes: "",
  section: "other",
  storePref: "",
  alternatives: "",
};

export default function ListPage({
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
  const [sections, setSections] = useState<string[]>([]);
  const [form, setForm] = useState<AddForm>(emptyForm);
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadItems = useCallback((id: string) => {
    api<{ items: Item[]; stores: Store[]; sections: string[] }>(
      `/api/runs/${id}/items`,
    )
      .then((r) => {
        setItems(r.items);
        setStores(r.stores);
        setSections(r.sections);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    api<CurrentRun>("/api/runs/current")
      .then((c) => {
        if (!c.run) {
          setError("No active run.");
          return;
        }
        setRunId(c.run.id);
        setRunState(c.run.state);
        loadItems(c.run.id);
      })
      .catch((err) => setError((err as Error).message));
  }, [loadItems]);

  function buildBody(force: boolean) {
    return {
      name: form.name,
      quantity: form.quantity ? Number(form.quantity) : undefined,
      unit: form.unit || undefined,
      kind: form.kind,
      notes: form.notes || undefined,
      section: form.section,
      storePref: form.storePref || null,
      alternatives: form.alternatives
        ? form.alternatives.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      force,
    };
  }

  async function addItem(force = false) {
    if (!runId || !form.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/runs/${runId}/items`, { method: "POST", body: buildBody(force) });
      setForm(emptyForm);
      setDuplicates(null);
      loadItems(runId);
    } catch (err) {
      if (err instanceof ApiFail && err.code === "DUPLICATES") {
        setDuplicates(
          (err.details as { duplicates: Duplicate[] } | undefined)?.duplicates ?? [],
        );
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function mergeInto(itemId: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/items/${itemId}/merge`, {
        method: "POST",
        body: { quantity: form.quantity ? Number(form.quantity) : 1 },
      });
      setForm(emptyForm);
      setDuplicates(null);
      if (runId) loadItems(runId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId: string) {
    setError("");
    try {
      await api(`/api/items/${itemId}`, { method: "DELETE" });
      if (runId) loadItems(runId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const grouped = sections
    .map((s) => ({ section: s, items: items.filter((i) => i.section === s) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="stack">
      <SubstituteRequests />
      <div className="card">
        <button className="link" onClick={() => nav("/")}>
          ← Home
        </button>
        <h2>Shopping list</h2>
        {runState && runState !== "open" && (
          <p className="muted">List is read-only (run is {runState}).</p>
        )}
        {runState === "open" && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              addItem(false);
            }}
          >
            <input
              required
              placeholder="Item name, e.g. Eggs"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <div className="row">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Qty"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                style={{ width: "5rem" }}
              />
              <input
                placeholder="Unit"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                style={{ width: "6rem" }}
              />
              <select
                value={form.kind}
                onChange={(e) =>
                  setForm({ ...form, kind: e.target.value as AddForm["kind"] })
                }
              >
                <option value="communal">Communal</option>
                <option value="personal">Personal</option>
              </select>
            </div>
            <div className="row">
              <select
                value={form.section}
                onChange={(e) => setForm({ ...form, section: e.target.value })}
              >
                {sections.map((s) => (
                  <option key={s} value={s}>
                    {SECTION_LABELS[s] ?? s}
                  </option>
                ))}
              </select>
              <select
                value={form.storePref}
                onChange={(e) => setForm({ ...form, storePref: e.target.value })}
              >
                <option value="">Any store</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <input
              placeholder="Acceptable alternatives, comma-separated (optional)"
              value={form.alternatives}
              onChange={(e) => setForm({ ...form, alternatives: e.target.value })}
            />
            <input
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <button type="submit" disabled={busy || !form.name.trim()}>
              Add to list
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {duplicates && (
        <div className="modal-backdrop" onClick={() => setDuplicates(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3>Already on the list?</h3>
            <p className="muted">Similar items found:</p>
            {duplicates.map((d) => (
              <div key={d.id} className="row spread dup-row">
                <span>
                  {d.name}
                  {d.quantity ? ` ×${d.quantity}` : ""} ({d.kind})
                </span>
                <button className="secondary" onClick={() => mergeInto(d.id)}>
                  Merge into this
                </button>
              </div>
            ))}
            <div className="row">
              <button onClick={() => addItem(true)} disabled={busy}>
                Add anyway
              </button>
              <button className="secondary" onClick={() => setDuplicates(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {grouped.map((g) => (
        <div className="card" key={g.section}>
          <h3>{SECTION_LABELS[g.section] ?? g.section}</h3>
          {g.items.map((item) => (
            <div key={item.id} className="row spread item-row">
              <span>
                <strong>{item.name}</strong>
                {item.quantity ? ` ×${item.quantity}` : ""}
                {item.unit ? ` ${item.unit}` : ""}{" "}
                <span className={`badge kind-${item.kind}`}>{item.kind}</span>
                {item.requesterId === me.user.id && (
                  <span className="muted small"> (you)</span>
                )}
                {item.notes && <div className="muted small">{item.notes}</div>}
              </span>
              {runState === "open" && (
                <button className="link danger" onClick={() => removeItem(item.id)}>
                  remove
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {items.length === 0 && runState === "open" && (
        <p className="muted center">List is empty — add the first item.</p>
      )}
    </div>
  );
}
