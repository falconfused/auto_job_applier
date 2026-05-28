"use server";

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { revalidatePath } from "next/cache";
import { openDb, migrate } from "@/lib/db";
import { DB_PATH, MASTER_RESUME, ensureDirs } from "@/lib/paths";
import { loadProfile, loadSettings } from "@/lib/config";
import { getApplicationDetail } from "@/lib/dashboard";
import * as tracker from "@/lib/tracker";
import { tailorResumeOnly, tailorCoverOnly } from "@/lib/tailorJob";
import type { Posting } from "@/lib/types";

/**
 * Strip LaTeX commands into clean plain text suitable for pasting into a job-application form.
 * Aggressively removes structural / formatting commands, preserves the human-readable text.
 */
function latexToPlainText(tex: string): string {
  let s = tex;

  // 1. Trim to body (between \begin{document} and \end{document})
  s = s.replace(/^[\s\S]*?\\begin\{document\}/m, "");
  s = s.replace(/\\end\{document\}[\s\S]*$/m, "");

  // 2. Drop comments
  s = s.replace(/(^|[^\\])%.*$/gm, "$1");

  // 3. \href{url}{display} → display    \url{x} → x
  s = s.replace(/\\href\s*\{[^}]*\}\s*\{([^}]*)\}/g, "$1");
  s = s.replace(/\\url\s*\{([^}]*)\}/g, "$1");

  // 4. Spacing/formatting commands with one or more brace-args → drop them ENTIRELY.
  //    This is the key fix: \vspace{4pt}, \setlength{...}{4pt}, \hspace{X} should
  //    not leave "4pt" behind.
  const dropTotal = [
    "vspace", "hspace", "vfill", "hfill",
    "setlength", "setcounter", "setcountertype", "addtolength",
    "pagestyle", "thispagestyle",
    "documentclass", "usepackage", "input", "include",
    "newcommand", "renewcommand", "providecommand", "newenvironment", "renewenvironment",
    "label", "ref", "pageref", "cite",
    "today", "maketitle",
  ];
  for (const cmd of dropTotal) {
    // Drop \cmd[opt]{a}{b}{c}... — any number of brace groups
    const re = new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\])?(?:\\s*\\{[^{}]*\\})*`, "g");
    s = s.replace(re, "");
  }

  // 5. \\ (LaTeX line break, optionally followed by [Xpt] spacing) → newline
  s = s.replace(/\\\\\s*(?:\[[^\]]*\])?/g, "\n");

  // 6. ~ → non-breaking space; --- → em dash; -- → en dash; \% → %; \& → &
  s = s.replace(/~/g, " ");
  s = s.replace(/---/g, "—");
  s = s.replace(/--/g, "–");
  s = s.replace(/\\%/g, "%");
  s = s.replace(/\\&/g, "&");
  s = s.replace(/\\\$/g, "$");
  s = s.replace(/\\#/g, "#");
  s = s.replace(/\\_/g, "_");

  // 7. Math-mode shortcuts. Replace common ones, then drop $...$ delimiters.
  s = s.replace(/\\cdot\b\s*/g, "· ");
  s = s.replace(/\\bullet\b\s*/g, "• ");
  s = s.replace(/\\times\b\s*/g, "× ");
  s = s.replace(/\\geq\b\s*/g, "≥ ");
  s = s.replace(/\\leq\b\s*/g, "≤ ");
  s = s.replace(/\$([^$]*)\$/g, "$1");

  // 8. Generic command with brace arg → keep just the inner text.
  //    \textbf{x} → x, \emph{x} → x, \section{x} → x, \item ...
  //    Run twice to handle nested.
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\[a-zA-Z]+\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, "$1");
  }

  // 9. Strip any remaining bare \command tokens
  s = s.replace(/\\[a-zA-Z]+\*?/g, "");

  // 10. Strip remaining braces.
  s = s.replace(/[{}]/g, "");

  // 11. Whitespace cleanup. Preserve paragraph breaks (double-newline).
  s = s.replace(/\r/g, "");
  s = s
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");

  return s.trim();
}

/** Common posting builder + master tex loader. Returns null tuple on missing app. */
function loadJobContext(appId: number) {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  const app = getApplicationDetail(db, appId);
  if (!app) return null;
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
  return { db, app, posting, masterTex, profile, settings };
}

/**
 * Generate the tailored RESUME ONLY. The cover letter is now lazy — generated
 * on demand by the separate "Generate cover letter" button.
 */
export async function tailorApplicationAction(appId: number): Promise<{
  ok: true;
  resumePdfPath: string;
} | {
  ok: false;
  error: string;
}> {
  const ctx = loadJobContext(appId);
  if (!ctx) return { ok: false, error: `application ${appId} not found` };
  const { db, posting, masterTex, profile, settings } = ctx;

  tracker.setStatus(db, appId, "tailoring");
  try {
    const r = await tailorResumeOnly({
      posting,
      masterTex,
      profile,
      model: settings.llm.model,
    });
    // Persist resume path; cover_letter_path is left null until the user generates it
    tracker.setResumePath(db, appId, r.resumePdfPath);
    tracker.setStatus(db, appId, "awaiting_submit");
    revalidatePath(`/applications/${appId}`);
    revalidatePath("/");
    return { ok: true, resumePdfPath: r.resumePdfPath };
  } catch (err) {
    const msg = (err as Error).message;
    tracker.setStatus(db, appId, "failed", `tailor: ${msg}`);
    revalidatePath(`/applications/${appId}`);
    return { ok: false, error: msg };
  }
}

/**
 * Generate the cover letter on demand. Resume must already be tailored
 * (we use the tailored resume + JD as context).
 */
export async function tailorCoverLetterAction(appId: number): Promise<{
  ok: true;
  coverLetterPdfPath: string;
} | {
  ok: false;
  error: string;
}> {
  const ctx = loadJobContext(appId);
  if (!ctx) return { ok: false, error: `application ${appId} not found` };
  const { db, app, posting, masterTex, profile, settings } = ctx;

  if (!app.resume_path) {
    return { ok: false, error: "tailor the resume first (click Apply)" };
  }

  try {
    const r = await tailorCoverOnly({
      posting,
      masterTex,
      profile,
      model: settings.llm.model,
    });
    tracker.setCoverLetterPath(db, appId, r.coverLetterPdfPath);
    revalidatePath(`/applications/${appId}`);
    revalidatePath("/");
    return { ok: true, coverLetterPdfPath: r.coverLetterPdfPath };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
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
