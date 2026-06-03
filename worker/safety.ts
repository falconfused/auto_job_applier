import type { DB } from "../lib/db.js";

export function checkDailyCap(db: DB, cap: number): { ok: boolean; appliedToday: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'applied' AND applied_at >= ?")
    .get(start.toISOString()) as { n: number };
  return { ok: row.n < cap, appliedToday: row.n };
}

const CHALLENGE_HINTS = [
  /security check/i,
  /captcha/i,
  /checkpoint/i,
  /verify your identity/i,
  /unusual activity/i,
];

export function detectChallenge(html: string): boolean {
  return CHALLENGE_HINTS.some((re) => re.test(html));
}

export async function pacingDelay(minMs = 1500, maxMs = 4000): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  await new Promise((r) => setTimeout(r, ms));
}
