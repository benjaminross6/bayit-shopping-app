import { useCallback, useEffect, useState } from "react";
import { api, ApiFail, type Me } from "./api";
import SignIn from "./pages/SignIn";
import Verify from "./pages/Verify";
import Profile from "./pages/Profile";
import Home from "./pages/Home";
import ListPage from "./pages/ListPage";
import RunAdmin from "./pages/RunAdmin";
import ShopPage from "./pages/ShopPage";
import ReceiptsPage from "./pages/ReceiptsPage";
import ReconcilePage from "./pages/ReconcilePage";
import Invite from "./pages/Invite";
import { registerPushSubscription } from "./push/subscribe";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const nav = useCallback((to: string) => {
    window.history.pushState(null, "", to);
    setPath(to);
  }, []);

  const loadMe = useCallback(() => {
    setLoading(true);
    api<Me>("/api/me")
      .then((m) => {
        setMe(m);
        void registerPushSubscription();
      })
      .catch((err) => {
        if (err instanceof ApiFail && err.status === 401) setMe(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      if (event.data?.type === "NAVIGATE" && typeof event.data.url === "string") {
        nav(event.data.url);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [nav]);

  useEffect(() => {
    if (path !== "/auth/verify" && path !== "/invite") loadMe();
    else setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (path === "/invite") {
    return (
      <Shell>
        <Invite
          onDone={() => {
            setPath("/");
            loadMe();
          }}
        />
      </Shell>
    );
  }

  if (path === "/auth/verify") {
    return (
      <Shell>
        <Verify
          onDone={() => {
            setPath("/");
            loadMe();
          }}
        />
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <p className="muted center">Loading…</p>
      </Shell>
    );
  }

  if (!me) {
    return (
      <Shell>
        <SignIn />
      </Shell>
    );
  }

  if (!me.profileComplete || path === "/profile") {
    return (
      <Shell>
        <Profile
          me={me}
          onSaved={() => {
            nav("/");
            loadMe();
          }}
        />
      </Shell>
    );
  }

  let page: React.ReactNode;
  switch (path) {
    case "/list":
      page = <ListPage me={me} nav={nav} />;
      break;
    case "/run":
      page = <RunAdmin me={me} nav={nav} />;
      break;
    case "/shop":
      page = <ShopPage me={me} nav={nav} />;
      break;
    case "/receipts":
      page = <ReceiptsPage me={me} nav={nav} />;
      break;
    case "/reconcile":
      page = <ReconcilePage me={me} nav={nav} />;
      break;
    default:
      page = <Home me={me} nav={nav} />;
  }

  const wide = path === "/reconcile";
  return <Shell wide={wide}>{page}</Shell>;
}

function Shell({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return <main className={`shell${wide ? " shell-wide" : ""}`}>{children}</main>;
}
