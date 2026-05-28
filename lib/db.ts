import Database from "better-sqlite3";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'linkedin',
  source_job_id TEXT NOT NULL,
  title TEXT, company TEXT, location TEXT, url TEXT,
  apply_type TEXT NOT NULL,
  jd_text TEXT DEFAULT '',
  salary TEXT,
  stipend TEXT,
  first_seen TEXT NOT NULL,
  UNIQUE (source, source_job_id)
);
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  run_date TEXT NOT NULL,
  rank INTEGER, fit_score REAL, fit_reason TEXT
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL,
  resume_path TEXT, cover_letter_path TEXT,
  edit_notes TEXT DEFAULT '',
  applied_at TEXT, error TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  searched INTEGER, found_new INTEGER, suggested INTEGER,
  status TEXT, error TEXT
);
`;

export function openDb(path = ":memory:"): DB {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * Idempotent migration: creates the schema, and upgrades any pre-existing v1 DB
 * (which had `jobs.linkedin_job_id`) to the multi-source v2 shape.
 */
export function migrate(db: DB): void {
  db.exec(SCHEMA);
  // v1 → v2 migration: rename linkedin_job_id → source_job_id and add source column.
  const cols = db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (colNames.has("linkedin_job_id") && !colNames.has("source_job_id")) {
    db.exec(`
      ALTER TABLE jobs RENAME COLUMN linkedin_job_id TO source_job_id;
      ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'linkedin';
    `);
  }
  // v2 → v3 migration: add salary + stipend (nullable, additive).
  if (!colNames.has("salary")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN salary TEXT`);
  }
  if (!colNames.has("stipend")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN stipend TEXT`);
  }
}
