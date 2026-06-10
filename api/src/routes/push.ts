import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { pushSubscriptions } from "../schema.js";
import { requireMembership } from "../lib/context.js";
import { getVapidPublicKey } from "../lib/push.js";

const subscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export function pushRoutes(app: FastifyInstance): void {
  app.get("/api/push/vapid-public-key", async () => {
    const publicKey = getVapidPublicKey();
    if (!publicKey) return { publicKey: null };
    return { publicKey };
  });

  app.post("/api/push/subscribe", async (req) => {
    requireMembership(req.membership);
    const body = subscribeBody.parse(req.body);
    const userId = req.authUser!.id;

    await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: body.endpoint,
        keys: body.keys,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: { keys: body.keys },
      });

    return { ok: true };
  });
}
