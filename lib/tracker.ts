import type { DB } from "./db.js";
import type { Posting } from "./types.js";

export const VALID_STATUSES = [
  "suggested",
  "dismissed",
  "external_sent",
  "tailoring",
  "awaiting_submit",
  "cancelled",
  "applied",
  "failed",
] as const;
export type Status = (typeof VALID_STATUSES)[number];

const now = () => new Date().toISOString();

export function addJob(db: DB, p: Posting): number {
  const existing = db
    .prepare("SELECT id FROM jobs WHERE linkedin_job_id = ?")
    .get(p.linkedinJobId) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare(
      "INSERT INTO jobs (linkedin_job_id, title, company, location, url, apply_type, jd_text, first_seen) " +
        "VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(p.linkedinJobId, p.title, p.company, p.location, p.url, p.applyType, p.jdText, now());
  return Number(info.lastInsertRowid);
}

export function getJobByLinkedinId(db: DB, linkedinJobId: string): Record<string, any> | undefined {
  return db.prepare("SELECT * FROM jobs WHERE linkedin_job_id = ?").get(linkedinJobId) as
    | Record<string, any>
    | undefined;
}

export function createApplication(db: DB, jobId: number): number {
  const info = db
    .prepare("INSERT INTO applications (job_id, status, updated_at) VALUES (?, 'suggested', ?)")
    .run(jobId, now());
  return Number(info.lastInsertRowid);
}

export function getApplication(db: DB, appId: number): Record<string, any> | undefined {
  return db.prepare("SELECT * FROM applications WHERE id = ?").get(appId) as
    | Record<string, any>
    | undefined;
}

export function setStatus(db: DB, appId: number, status: Status, error?: string): void {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`unknown status ${status}; valid: ${VALID_STATUSES.join(", ")}`);
  }
  const appliedAt = status === "applied" ? now() : null;
  db.prepare(
    "UPDATE applications SET status = ?, error = COALESCE(?, error), " +
      "applied_at = COALESCE(?, applied_at), updated_at = ? WHERE id = ?",
  ).run(status, error ?? null, appliedAt, now(), appId);
}

export function setResumePaths(db: DB, appId: number, resumePath: string, coverLetterPath: string): void {
  db.prepare(
    "UPDATE applications SET resume_path = ?, cover_letter_path = ?, updated_at = ? WHERE id = ?",
  ).run(resumePath, coverLetterPath, now(), appId);
}

export function appendEditNote(db: DB, appId: number, note: string): void {
  const row = db.prepare("SELECT edit_notes FROM applications WHERE id = ?").get(appId) as
    | { edit_notes: string | null }
    | undefined;
  const existing = row?.edit_notes ?? "";
  const combined = existing ? `${existing}\n${note}` : note;
  db.prepare("UPDATE applications SET edit_notes = ?, updated_at = ? WHERE id = ?").run(
    combined,
    now(),
    appId,
  );
}

export function addSuggestion(
  db: DB,
  jobId: number,
  runDate: string,
  rank: number,
  fitScore: number,
  fitReason: string,
): number {
  const info = db
    .prepare(
      "INSERT INTO suggestions (job_id, run_date, rank, fit_score, fit_reason) VALUES (?,?,?,?,?)",
    )
    .run(jobId, runDate, rank, fitScore, fitReason);
  return Number(info.lastInsertRowid);
}

export function recordRun(
  db: DB,
  r: { searched: number; foundNew: number; suggested: number; status: string; error?: string },
): number {
  const info = db
    .prepare(
      "INSERT INTO runs (date, searched, found_new, suggested, status, error) VALUES (?,?,?,?,?,?)",
    )
    .run(now(), r.searched, r.foundNew, r.suggested, r.status, r.error ?? null);
  return Number(info.lastInsertRowid);
}

export function getRun(db: DB, runId: number): Record<string, any> | undefined {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Record<string, any> | undefined;
}
