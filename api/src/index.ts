import "dotenv/config";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { db } from "./db.js";

const app = Fastify({ logger: true });

await app.register(fastifyCookie, { secret: process.env.JWT_SECRET });

app.get("/api/health", async () => {
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    // health endpoint reports degraded state instead of throwing
  }
  return { ok: true, db: dbOk, version: "0.1.0" };
});

// In production the Docker image serves the built PWA from the same process.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  // SPA fallback for client-side routes
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
