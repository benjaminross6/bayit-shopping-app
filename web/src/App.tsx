import { useEffect, useState } from "react";

type Health = { ok: boolean; db: boolean; version: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "4rem 1.5rem",
        textAlign: "center",
      }}
    >
      <img src="/icon.svg" alt="" width={72} height={72} />
      <h1 style={{ marginBottom: "0.25rem" }}>Bayit Shopping App</h1>
      <p style={{ color: "#5a6b5f", marginTop: 0 }}>
        Shopping, receipts, and settlement for the Berkeley Bayit.
      </p>
      <div
        style={{
          display: "inline-block",
          padding: "0.5rem 1rem",
          borderRadius: 8,
          background: "#fff",
          border: "1px solid #dde5dd",
          fontSize: "0.9rem",
        }}
      >
        {error && <span>API unreachable</span>}
        {!error && !health && <span>Checking API…</span>}
        {health && (
          <span>
            API {health.ok ? "up" : "down"} · DB {health.db ? "connected" : "down"} · v
            {health.version}
          </span>
        )}
      </div>
    </main>
  );
}
