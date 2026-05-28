"use server";

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { revalidatePath } from "next/cache";
import { openDb, migrate } from "@/lib/db";
import { DB_PATH, MASTER_RESUME, ensureDirs } from "@/lib/paths";
import { loadProfile, loadSettings } from "@/lib/config";
import { getApplicationDetail } from "@/lib/dashboard";
import * as tracker from "@/lib/tracker";
import { tailorAndCompile } from "@/lib/tailorJob";
import type { Posting } from "@/lib/types";

/** Strip LaTeX commands and structure into a plain-text cover letter. */
function latexToPlainText(tex: string): string {
  let s = tex;
  // Drop everything before \begin{document} / after \end{document}
  s = s.replace(/^[\s\S]*?\\begin\{document\}/m, "");
  s = s.replace(/\\end\{document\}[\s\S]*$/m, "");
  // Drop common envelope commands
  s = s.replace(/\\(maketitle|today|noindent|raggedright|signature|begin|end)\s*\{[^}]*\}/g, "");
  s = s.replace(/\\\w+\s*\{([^}]*)\}/g, "$1");
  s = s.replace(/\\\w+/g, "");
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\$([^$]+)\$/g, "$1");
  s = s.replace(/&/g, "&");
  s = s.replace(/~/g, " ");
  // Collapse whitespace, keep paragraph breaks
  s = s.replace(/\r/g, "");
  s = s.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
  return s.trim();
}

export async function tailorApplicationAction(appId: number): Promise<{
  ok: true;
  resumePdfPath: string;
  coverLetterPdfPath: string;
} | {
  ok: false;
  error: string;
}> {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  const app = getApplicationDetail(db, appId);
  if (!app) return { ok: false, error: `application ${appId} not found` };

  const settings = loadSettings();
  const profile = loadProfile();
  const masterTex = readFileSync(MASTER_RESUME, "utf8");

  const posting: Posting = {
    sourceJobId: app.source_job_id,
    source: app.source as Posting["source"],
    title: app.title,
    company: app.company,
    location: app.location,
    url: app.url,
    applyType: app.apply_type as Posting["applyType"],
    jdText: app.jd_text ?? "",
  };

  tracker.setStatus(db, appId, "tailoring");
  try {
    const r = await tailorAndCompile({
      posting,
      masterTex,
      profile,
      model: settings.llm.model,
    });
    tracker.setResumePaths(db, appId, r.resumePdfPath, r.coverLetterPdfPath);
    tracker.setStatus(db, appId, "awaiting_submit");
    revalidatePath(`/applications/${appId}`);
    revalidatePath("/");
    return { ok: true, resumePdfPath: r.resumePdfPath, coverLetterPdfPath: r.coverLetterPdfPath };
  } catch (err) {
    const msg = (err as Error).message;
    tracker.setStatus(db, appId, "failed", `tailor: ${msg}`);
    revalidatePath(`/applications/${appId}`);
    return { ok: false, error: msg };
  }
}

export async function markAppliedAction(appId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  try {
    tracker.setStatus(db, appId, "applied");
    revalidatePath(`/applications/${appId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function dismissAction(appId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  try {
    tracker.setStatus(db, appId, "dismissed");
    revalidatePath(`/applications/${appId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function getCoverLetterText(
  appId: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  const app = getApplicationDetail(db, appId);
  if (!app) return { ok: false, error: `application ${appId} not found` };
  if (!app.cover_letter_path) {
    return { ok: false, error: "no cover letter — click Apply first to tailor one" };
  }
  // Find the .tex sibling of the .pdf
  const pdfPath = app.cover_letter_path;
  const texPath = join(dirname(pdfPath), "cover_letter.tex");
  if (!existsSync(texPath)) return { ok: false, error: `cover_letter.tex missing at ${texPath}` };
  const tex = readFileSync(texPath, "utf8");
  return { ok: true, text: latexToPlainText(tex) };
}

export async function unmarkAction(appId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  try {
    // "Reopen" — clears applied/dismissed status, returns to suggested or awaiting_submit.
    const app = getApplicationDetail(db, appId);
    if (!app) return { ok: false, error: `application ${appId} not found` };
    const next = app.resume_path ? "awaiting_submit" : "suggested";
    tracker.setStatus(db, appId, next);
    revalidatePath(`/applications/${appId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
