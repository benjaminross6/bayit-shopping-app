import { env } from "./env.js";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { db } from "./db.js";
import { ApiError } from "./lib/errors.js";
import { registerAuthHook } from "./lib/context.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { inviteRoutes } from "./routes/invites.js";
import { runRoutes } from "./routes/runs.js";
import { itemRoutes } from "./routes/items.js";
import { pushRoutes } from "./routes/push.js";
import { substituteRoutes } from "./routes/substitutes.js";
import { receiptRoutes } from "./routes/receipts.js";
import { reconcileRoutes } from "./routes/reconcile.js";

const app = Fastify({ logger: true });

await app.register(fastifyCookie, { secret: env.jwtSecret });
await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply
      .code(400)
      .send({ error: "Invalid request", code: "VALIDATION", details: err.issues });
  }
  if (err instanceof ApiError) {
    return reply
      .code(err.statusCode)
      .send({ error: err.message, code: err.code, details: err.details });
  }
  const e = err as { statusCode?: number; code?: string; message?: string };
  const statusCode = e.statusCode ?? 500;
  if (statusCode >= 500) app.log.error(err);
  return reply.code(statusCode).send({
    error: statusCode >= 500 ? "Internal server error" : e.message ?? "Error",
    ...(e.code && statusCode < 500 ? { code: e.code } : {}),
  });
});

registerAuthHook(app);

app.get("/api/health", async () => {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // health endpoint reports degraded state instead of throwing
  }
  return { ok: true, db: dbOk, version: "0.2.0" };
});

authRoutes(app);
meRoutes(app);
inviteRoutes(app);
runRoutes(app);
itemRoutes(app);
pushRoutes(app);
substituteRoutes(app);
receiptRoutes(app);
reconcileRoutes(app);

// In production the Docker image serves the built PWA from the same process.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (env.isProd && fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  // SPA fallback for client-side routes
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
}

await app.listen({ port: env.port, host: "0.0.0.0" });
