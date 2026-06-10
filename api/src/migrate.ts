import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, pool } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from both src/ (tsx) and dist/ (compiled in Docker)
const migrationsFolder = path.resolve(here, "../drizzle");

await migrate(db, { migrationsFolder });
console.log("Migrations applied.");
await pool.end();
