// Loads the repo-root .env regardless of cwd (npm workspaces run with cwd=api/).
// Platform env vars (Render/Docker) always take precedence: dotenv never overrides.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env") });
dotenv.config();

export const env = {
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://bayit:bayit@localhost:5432/bayit",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-in-prod",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:5173",
  emailApiKey: process.env.EMAIL_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "Bayit <onboarding@resend.dev>",
  port: Number(process.env.PORT ?? 3001),
  isProd: process.env.NODE_ENV === "production",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:bayit@example.com",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
};
