"use server";

import { readFileSync } from "node:fs";
import { revalidatePath } from "next/cache";
import { openDb, migrate } from "@/lib/db";
import { DB_PATH, MASTER_RESUME, ensureDirs } from "@/lib/paths";
import { loadProfile, loadSettings } from "@/lib/config";
import { getApplicationDetail } from "@/lib/dashboard";
import * as tracker from "@/lib/tracker";
import { tailorAndCompile } from "@/lib/tailorJob";
import type { Posting } from "@/lib/types";

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
    linkedinJobId: app.linkedin_job_id,
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
