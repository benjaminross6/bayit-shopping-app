// Outbound email via Resend REST API. In dev (or with no key) the message is
// logged to the console so the magic link is always reachable during solo dev.
import { env } from "../env.js";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!env.isProd) {
    console.log(`\n[email] to=${to} subject=${subject}\n${html}\n`);
  }
  if (!env.emailApiKey) {
    if (env.isProd) console.error("[email] EMAIL_API_KEY not set; email not sent");
    else console.log("[email] EMAIL_API_KEY not set — dev link is in the API response and console above");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.emailApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Resend error ${res.status}: ${body}`);
    if (!env.isProd) {
      console.log(
        "[email] Resend sandbox only delivers to your Resend account email — use the dev link instead",
      );
    }
  } else if (!env.isProd) {
    console.log(`[email] Resend accepted (sandbox may only deliver to your account email)`);
  }
}

export function magicLinkEmail(link: string): { subject: string; html: string } {
  return {
    subject: "Sign in to Bayit Shopping",
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:420px">
        <h2 style="color:#2e7d32">Bayit Shopping</h2>
        <p>Click to sign in. This link expires in 15 minutes.</p>
        <p><a href="${link}" style="display:inline-block;background:#2e7d32;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Sign in</a></p>
        <p style="color:#777;font-size:12px">If you didn't request this, ignore this email.</p>
      </div>`,
  };
}
