import { useState } from "react";
import { api, type Me } from "../api";

const ALLERGEN_LABELS: Record<string, string> = {
  peanut: "Peanut",
  tree_nut: "Tree nut",
  dairy: "Dairy",
  egg: "Egg",
  gluten: "Gluten",
  soy: "Soy",
  shellfish: "Shellfish",
  fish: "Fish",
  sesame: "Sesame",
};

export default function Profile({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(me.user.displayName);
  const [fullName, setFullName] = useState(me.user.fullName);
  const [allergens, setAllergens] = useState<string[]>(me.user.allergens);
  const [preferences, setPreferences] = useState(me.user.preferences);
  const [venmo, setVenmo] = useState(me.user.venmoHandle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleAllergen(a: string) {
    setAllergens((cur) =>
      cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a],
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/me", {
        method: "PATCH",
        body: {
          displayName,
          fullName: fullName || displayName,
          allergens,
          preferences,
          venmoHandle: venmo || null,
        },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>{me.profileComplete ? "Edit profile" : "Set up your profile"}</h2>
      <form onSubmit={submit} className="stack">
        <label>
          Display name
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Ben R."
          />
        </label>
        <label>
          Full name
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Only admins see this"
          />
        </label>
        <fieldset>
          <legend>Allergies</legend>
          <div className="chips">
            {me.allergenOptions.map((a) => (
              <label key={a} className={`chip ${allergens.includes(a) ? "on" : ""}`}>
                <input
                  type="checkbox"
                  checked={allergens.includes(a)}
                  onChange={() => toggleAllergen(a)}
                />
                {ALLERGEN_LABELS[a] ?? a}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Food preferences (free text)
          <textarea
            value={preferences}
            onChange={(e) => setPreferences(e.target.value)}
            placeholder="e.g. vegetarian, no cilantro"
            rows={2}
          />
        </label>
        <label>
          Venmo username (optional for now)
          <input
            value={venmo}
            onChange={(e) => setVenmo(e.target.value)}
            placeholder="@your-venmo"
          />
        </label>
        <button type="submit" disabled={busy || !displayName.trim()}>
          {busy ? "Saving…" : "Save profile"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
