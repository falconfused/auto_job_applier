import type { DB } from "./db.js";

export interface AppRow {
  id: number;
  job_id: number;
  status: string;
  resume_path: string | null;
  cover_letter_path: string | null;
  applied_at: string | null;
  updated_at: string;
  title: string;
  company: string;
  location: string;
  url: string;
  apply_type: string;
  source: string;
  source_job_id: string;
}

export function listApplications(db: DB): AppRow[] {
  return db
    .prepare(
      `SELECT a.id, a.job_id, a.status, a.resume_path, a.cover_letter_path,
              a.applied_at, a.updated_at,
              j.title, j.company, j.location, j.url, j.apply_type, j.source, j.source_job_id
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         ORDER BY a.updated_at DESC`,
    )
    .all() as AppRow[];
}

export interface RunRow {
  id: number;
  date: string;
  searched: number;
  found_new: number;
  suggested: number;
  status: string;
  error: string | null;
}

export function listRuns(db: DB): RunRow[] {
  return db.prepare(`SELECT * FROM runs ORDER BY date DESC`).all() as RunRow[];
}

export interface AppDetail extends AppRow {
  jd_text: string;
  fit_score: number | null;
  fit_reason: string | null;
  rank: number | null;
}

export function getApplicationDetail(db: DB, appId: number): AppDetail | undefined {
  return db
    .prepare(
      `SELECT a.id, a.job_id, a.status, a.resume_path, a.cover_letter_path,
              a.applied_at, a.updated_at,
              j.title, j.company, j.location, j.url, j.apply_type,
              j.source, j.source_job_id, j.jd_text,
              s.fit_score, s.fit_reason, s.rank
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN suggestions s
           ON s.job_id = j.id
          AND s.id = (SELECT MAX(id) FROM suggestions WHERE job_id = j.id)
        WHERE a.id = ?`,
    )
    .get(appId) as AppDetail | undefined;
}
