import { join } from "node:path";
import type { DB } from "../lib/db.js";
import type { Settings } from "../lib/config.js";
import type { TailoredDocs } from "../lib/types.js";
import * as tracker from "../lib/tracker.js";
import { JOBS_DIR } from "../lib/paths.js";
import { formatExternalMessage, formatGate2Message } from "./formatters.js";

export interface BotDeps {
  sendMessage: (chatId: number, text: string) => Promise<void>;
  tailorFn: (args: {
    masterTex: string;
    jdText: string;
    profile: Record<string, unknown>;
    editNotes?: string;
    model?: string;
  }) => Promise<TailoredDocs>;
  compileFn: (texPath: string, outDir: string) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  startApply: (appId: number) => Promise<void>;
}

export interface BotArgs {
  db: DB;
  settings: Settings;
  profile: Record<string, unknown>;
  resumeText: string;
  deps: BotDeps;
}

interface PendingEdit {
  appId: number;
}
const pendingEditByChat = new Map<number, PendingEdit>();

function slugFor(jobId: number): string {
  return `job-${jobId}`;
}

function postingFromJobRow(job: any) {
  return {
    sourceJobId: job.source_job_id,
    source: (job.source ?? "linkedin") as "linkedin" | "internshala" | "naukri" | "wellfound" | "hirist",
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    applyType: job.apply_type as "easy_apply" | "external",
    jdText: job.jd_text || "",
  };
}

export function buildBot(args: BotArgs) {
  const { db, settings, profile, resumeText, deps } = args;

  async function tailorAndCompile(appId: number, jobId: number, editNotes: string) {
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as any;
    const docs = await deps.tailorFn({
      masterTex: resumeText,
      jdText: job.jd_text || "",
      profile,
      editNotes,
      model: settings.llm.model,
    });
    const slug = slugFor(jobId);
    const outDir = join(JOBS_DIR, slug);
    const resumeTex = join(outDir, "resume.tex");
    const coverTex = join(outDir, "cover_letter.tex");
    await deps.writeFile(resumeTex, docs.resumeTex);
    await deps.writeFile(coverTex, docs.coverLetterTex);
    const resumePdf = await deps.compileFn(resumeTex, outDir);
    const coverPdf = await deps.compileFn(coverTex, outDir);
    tracker.setResumePaths(db, appId, resumePdf, coverPdf);
    tracker.setStatus(db, appId, "awaiting_submit");
    return { resumePath: resumePdf, coverLetterPath: coverPdf };
  }

  async function handleApply(chatId: number, appId: number) {
    const app = tracker.getApplication(db, appId);
    if (!app) return;
    if (app.status !== "suggested") return;
    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(app.job_id) as any;
    if (job.apply_type === "external") {
      tracker.setStatus(db, appId, "external_sent");
      await deps.sendMessage(
        chatId,
        formatExternalMessage({ posting: postingFromJobRow(job), fitScore: 0, fitReason: "" }),
      );
      return;
    }
    tracker.setStatus(db, appId, "tailoring");
    const paths = await tailorAndCompile(appId, app.job_id, "");
    await deps.sendMessage(
      chatId,
      formatGate2Message({ posting: postingFromJobRow(job), fitScore: 0, fitReason: "" }, paths),
    );
  }

  async function handleDeny(chatId: number, appId: number) {
    const app = tracker.getApplication(db, appId);
    if (!app) return;
    if (app.status !== "suggested") return;
    tracker.setStatus(db, appId, "dismissed");
    await deps.sendMessage(chatId, `Dismissed application #${appId}.`);
  }

  async function handleCancel(chatId: number, appId: number) {
    const app = tracker.getApplication(db, appId);
    if (!app) return;
    if (app.status === "cancelled" || app.status === "applied") return;
    tracker.setStatus(db, appId, "cancelled");
    await deps.sendMessage(chatId, `Cancelled application #${appId}.`);
  }

  async function handleEditPrompt(chatId: number, appId: number) {
    pendingEditByChat.set(chatId, { appId });
    await deps.sendMessage(
      chatId,
      `Reply with edit instructions for app #${appId} (e.g. "emphasize Python").`,
    );
  }

  async function handleSubmit(chatId: number, appId: number) {
    const app = tracker.getApplication(db, appId);
    if (!app) return;
    if (app.status !== "awaiting_submit") return;
    await deps.sendMessage(chatId, `Submitting application #${appId}…`);
    await deps.startApply(appId);
  }

  return {
    async onCallback(chatId: number, data: string) {
      const [action, idStr] = data.split(":");
      const appId = Number(idStr);
      if (!Number.isFinite(appId)) return;
      switch (action) {
        case "apply": return handleApply(chatId, appId);
        case "deny": return handleDeny(chatId, appId);
        case "submit": return handleSubmit(chatId, appId);
        case "edit": return handleEditPrompt(chatId, appId);
        case "cancel": return handleCancel(chatId, appId);
      }
    },

    async onText(chatId: number, text: string, replyToAppId?: number) {
      const pending =
        replyToAppId !== undefined ? { appId: replyToAppId } : pendingEditByChat.get(chatId);
      if (!pending) return;
      const app = tracker.getApplication(db, pending.appId);
      if (!app || app.status === "cancelled" || app.status === "applied") return;
      pendingEditByChat.delete(chatId);
      tracker.appendEditNote(db, pending.appId, text);
      tracker.setStatus(db, pending.appId, "tailoring");
      const updated = tracker.getApplication(db, pending.appId)!;
      const paths = await tailorAndCompile(pending.appId, updated.job_id, updated.edit_notes ?? "");
      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(updated.job_id) as any;
      await deps.sendMessage(
        chatId,
        formatGate2Message({ posting: postingFromJobRow(job), fitScore: 0, fitReason: "" }, paths),
      );
    },
  };
}
