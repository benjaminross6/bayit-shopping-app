import { useEffect, useState } from "react";
import { api } from "../api";

export default function Invite({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("Missing invite token.");
      return;
    }
    api(`/api/invites/${token}/accept`, { method: "POST" })
      .then(() => {
        setOk(true);
        window.history.replaceState(null, "", "/");
        setTimeout(onDone, 1500);
      })
      .catch((err) => setError((err as Error).message));
  }, [onDone]);

  return (
    <div className="card center">
      {ok ? (
        <p>Joined the house — redirecting…</p>
      ) : error ? (
        <>
          <h2>Invite failed</h2>
          <p className="error">{error}</p>
          <a href="/">Go home</a>
        </>
      ) : (
        <p>Accepting invite…</p>
      )}
    </div>
  );
}
