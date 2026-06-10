import { useState } from "react";
import { api } from "../api";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ ok: boolean; devLink?: string }>("/api/auth/magic-link", {
        method: "POST",
        body: { email },
      });
      setDevLink(res.devLink ?? null);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card center">
        <h2>Check your email</h2>
        <p className="muted">
          We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
        </p>
        {devLink ? (
          <div className="stack dev-sign-in">
            <p className="muted small">
              Local dev: Resend sandbox only emails your Resend account address. Use this link
              instead:
            </p>
            <a href={devLink}>Sign in now →</a>
          </div>
        ) : (
          <p className="muted small">Check spam if it does not arrive within a minute.</p>
        )}
      </div>
    );
  }

  return (
    <div className="card center">
      <img src="/icon.svg" alt="" width={64} height={64} />
      <h1>Bayit Shopping</h1>
      <p className="muted">Sign in with your email — no password needed.</p>
      <form onSubmit={submit} className="stack">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send sign-in link"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
