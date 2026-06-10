import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { env } from "../env.js";
import { notificationLog, pushSubscriptions } from "../schema.js";

let configured = false;

function ensureVapid(): boolean {
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
    configured = true;
  }
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/** Channel-abstracted notification dispatcher (push now; email later). */
export async function notifyUser(
  userId: string,
  kind: string,
  dedupeKey: string,
  payload: PushPayload,
): Promise<{ pushSent: number }> {
  const [existing] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(eq(notificationLog.dedupeKey, dedupeKey));
  if (existing) return { pushSent: 0 };

  let pushSent = 0;
  if (ensureVapid()) {
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    const body = JSON.stringify(payload);
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys as webpush.PushSubscription["keys"] },
          body,
        );
        pushSent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, sub.endpoint));
        }
      }
    }
  }

  await db.insert(notificationLog).values({ userId, kind, dedupeKey });
  return { pushSent };
}

export function getVapidPublicKey(): string | null {
  return env.vapidPublicKey || null;
}

/** Convenience wrapper used by route handlers. */
export async function sendPushToUser(
  userId: string,
  opts: {
    kind: string;
    title: string;
    body: string;
    url?: string;
    dedupeKey?: string;
  },
): Promise<{ pushSent: number }> {
  const dedupeKey = opts.dedupeKey ?? `${opts.kind}:${userId}:${Date.now()}`;
  return notifyUser(userId, opts.kind, dedupeKey, {
    title: opts.title,
    body: opts.body,
    url: opts.url,
  });
}
