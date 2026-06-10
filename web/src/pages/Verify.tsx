import { useEffect, useState } from "react";
import { api } from "../api";

export default function Verify({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("Missing token in link.");
      return;
    }
    api(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .then(() => {
        window.history.replaceState(null, "", "/");
        onDone();
      })
      .catch((err) => setError((err as Error).message));
  }, [onDone]);

  return (
    <div className="card center">
      {error ? (
        <>
          <h2>Sign-in failed</h2>
          <p className="error">{error}</p>
          <a href="/">Request a new link</a>
        </>
      ) : (
        <p>Signing you in…</p>
      )}
    </div>
  );
}
