/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ url, request }) =>
    request.method === "GET" && /^\/api\/runs\/[^/]+\/items/.test(url.pathname),
  new NetworkFirst({
    cacheName: "run-items",
    networkTimeoutSeconds: 5,
  }),
);

self.addEventListener("sync", (event: Event) => {
  const syncEvent = event as ExtendableEvent & { tag: string };
  if (syncEvent.tag === "outbox-replay") {
    syncEvent.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "REPLAY_OUTBOX" }));
      }),
    );
  }
});

self.addEventListener("push", (event: PushEvent) => {
  const data = event.data?.json() as
    | { title?: string; body?: string; request?: unknown }
    | undefined;
  const title = data?.title ?? "Bayit Shopping";
  const body = data?.body ?? "You have a new notification";

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, { body, data });
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((client) =>
        client.postMessage({
          type: "SUBSTITUTE_REQUEST",
          request: data?.request,
        }),
      );
    })(),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
        clients[0].postMessage({ type: "SUBSTITUTE_REQUEST" });
      } else if (self.clients.openWindow) {
        return self.clients.openWindow("/");
      }
    }),
  );
});

clientsClaim();
