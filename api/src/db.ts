import { env } from "./env.js";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export const pool = new pg.Pool({ connectionString: env.databaseUrl });

export const db = drizzle(pool, { schema });
