import type { DB } from "../lib/db.js";
import type { Settings } from "../lib/config.js";
import * as tracker from "../lib/tracker.js";
import { checkDailyCap, detectChallenge } from "./safety.js";

export interface ApplyDeps {
  sendMessage: (chatId: number, text: string) => Promise<void>;
  openJobPage: (url: string) => Promise<{ html: string; close: () => Promise<void>; page?: any }>;
  runFillingAgent: (
    page: any,
    args: { jobUrl: string; resumePath: string; profile: Record<string, unknown> },
  ) => Promise<{ ready: boolean; escalation?: string }>;
  finalizeSubmit: (page: any) => Promise<void>;
}

export interface ApplyArgs {
  db: DB;
  appId: number;
  settings: Settings;
  profile: Record<string, unknown>;
  deps: ApplyDeps;
}

export type ApplyOutcome = "applied" | "cap_hit" | "challenge" | "escalated" | "error";

export async function applyToJobWith(
  args: ApplyArgs,
): Promise<{ outcome: ApplyOutcome; error?: string }> {
  const { db, appId, settings, profile, deps } = args;
  const app = tracker.getApplication(db, appId);
  if (!app) return { outcome: "error", error: "no application" };

  const cap = checkDailyCap(db, settings.apply.dailyCap);
  if (!cap.ok) {
    await deps.sendMessage(
      settings.telegram.chatId,
      `Daily apply cap reached (${cap.appliedToday}/${settings.apply.dailyCap}). Skipping app #${appId}.`,
    );
    return { outcome: "cap_hit" };
  }

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(app.job_id) as any;
  const session = await deps.openJobPage(job.url);

  try {
    if (detectChallenge(session.html)) {
      tracker.setStatus(db, appId, "failed", "linkedin challenge/captcha");
      await deps.sendMessage(
        settings.telegram.chatId,
        `LinkedIn challenge detected on app #${appId} (captcha/checkpoint). Resolve in the browser, then re-tap Submit.`,
      );
      return { outcome: "challenge" };
    }

    const filled = await deps.runFillingAgent(session.page, {
      jobUrl: job.url,
      resumePath: app.resume_path,
      profile,
    });

    if (!filled.ready) {
      await deps.sendMessage(
        settings.telegram.chatId,
        `App #${appId} needs your input: ${filled.escalation ?? "unknown question"}`,
      );
      return { outcome: "escalated" };
    }

    await deps.finalizeSubmit(session.page);
    tracker.setStatus(db, appId, "applied");
    await deps.sendMessage(settings.telegram.chatId, `✅ Submitted app #${appId} to ${job.company}.`);
    return { outcome: "applied" };
  } catch (err) {
    tracker.setStatus(db, appId, "failed", (err as Error).message);
    await deps.sendMessage(settings.telegram.chatId, `App #${appId} failed: ${(err as Error).message}`);
    return { outcome: "error", error: (err as Error).message };
  } finally {
    await session.close();
  }
}
