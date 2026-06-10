import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://bayit:bayit@localhost:5432/bayit",
});

export const db = drizzle(pool, { schema });
