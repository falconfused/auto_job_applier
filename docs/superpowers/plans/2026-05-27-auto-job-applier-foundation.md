# Auto Job Applier — Foundation & Tailoring Implementation Plan (Node/TypeScript)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, unit-testable core of the Auto Job Applier in Node/TypeScript — package scaffold, typed config, SQLite application tracker, the `tectonic` resume-compile step, and the LLM-backed `tailor` + `rank` units — with no browser or live-network dependencies.

**Architecture:** A single Node/TypeScript package. Shared logic lives in `lib/`. All LLM access goes through one thin `lib/llm.ts` seam; `tailor`/`rank` take an injectable `complete` function so tests drive them with a stub and never hit the network. SQLite (`better-sqlite3`) is the system of record; status transitions are explicit and validated. The Next.js + shadcn dashboard and the Playwright worker are scaffolded in later plans — this plan adds no frontend and no browser.

**Tech Stack:** Node.js ≥20, TypeScript, `better-sqlite3` (tracker), `zod` (config validation), `yaml` (settings), `execa` (run `tectonic`), `@anthropic-ai/sdk` (LLM seam), `tectonic` (LaTeX→PDF CLI), `vitest` (tests), `tsx` (run TS). ESM modules throughout.

This is Plan 1 of 5 for LinkedIn v1. Plans 2–5 (ingestion, Telegram bot+scheduler, apply agent, web dashboard) follow and depend on this foundation.

---

## File Structure

```
auto_job_applier/
  package.json                   # type:module, deps, scripts (test, typecheck)
  tsconfig.json
  vitest.config.ts
  .gitignore
  config/
    settings.example.yaml        # committed template (real settings.yaml gitignored)
    profile.json                 # ported personal/form-fill data
  lib/
    paths.ts                     # path constants + ensureDirs()
    types.ts                     # Posting, ScoredPosting, TailoredDocs, ApplyType
    config.ts                    # zod-validated loadSettings() + loadProfile()
    db.ts                        # better-sqlite3 openDb() + migrate()
    tracker.ts                   # jobs/suggestions/applications/runs CRUD + status transitions
    llm.ts                       # completeJson(system, user, opts) -> object (Anthropic seam)
    compile.ts                   # compilePdf(texPath, outDir) via execa+tectonic
    tailor.ts                    # tailor({masterTex, jdText, profile, editNotes, complete})
    rank.ts                      # rank(postings, {resumeText, profile, topN, complete})
  resume/
    master_resume.tex            # ported gold-copy master
  data/                          # applier.db lives here (gitignored)
  tests/
    fixtures/sample_resume.tex
    compile.test.ts
    config.test.ts
    tracker.test.ts
    rank.test.ts
    tailor.test.ts
```

---

## Task 1: Package scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `lib/paths.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "auto-job-applier",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Autonomous LinkedIn job applier (LinkedIn v1).",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "better-sqlite3": "^11.3.0",
    "execa": "^9.4.0",
    "yaml": "^2.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["lib", "tests", "worker", "app"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```gitignore
node_modules/
.next/
dist/
data/*.db
browser_profile/
config/settings.yaml
.env
resume/jobs/
*.log
```

- [ ] **Step 5: Write `lib/paths.ts`**

```typescript
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");
export const CONFIG_DIR = join(ROOT, "config");
export const DATA_DIR = join(ROOT, "data");
export const RESUME_DIR = join(ROOT, "resume");
export const JOBS_DIR = join(RESUME_DIR, "jobs");
export const MASTER_RESUME = join(RESUME_DIR, "master_resume.tex");
export const SETTINGS_PATH = join(CONFIG_DIR, "settings.yaml");
export const PROFILE_PATH = join(CONFIG_DIR, "profile.json");
export const DB_PATH = join(DATA_DIR, "applier.db");

export function ensureDirs(): void {
  for (const d of [DATA_DIR, RESUME_DIR, JOBS_DIR]) {
    mkdirSync(d, { recursive: true });
  }
}
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: installs without error; `better-sqlite3` compiles its native binding (needs Xcode CLT, already present on this Mac).

- [ ] **Step 7: Verify typecheck and that vitest runs**

Run: `npm run typecheck`
Expected: no type errors.
Run: `npx vitest run`
Expected: "No test files found" (exit 0 or a clear no-tests message) — confirms vitest is wired.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore lib/paths.ts
git commit -m "chore: scaffold node/ts package"
```

---

## Task 2: Domain types

**Files:**
- Create: `lib/types.ts`

No standalone test (pure type/interface declarations); exercised by later tasks.

- [ ] **Step 1: Write `lib/types.ts`**

```typescript
export type ApplyType = "easy_apply" | "external";

export interface Posting {
  linkedinJobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  applyType: ApplyType;
  jdText: string;
}

export interface ScoredPosting {
  posting: Posting;
  fitScore: number; // 0..100
  fitReason: string;
}

export interface TailoredDocs {
  resumeTex: string;
  coverLetterTex: string;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: domain types"
```

---

## Task 3: Compile (tectonic) + ported master resume

**Files:**
- Create: `resume/master_resume.tex` (copied from resume-automation)
- Create: `lib/compile.ts`
- Create: `tests/fixtures/sample_resume.tex`
- Create: `tests/compile.test.ts`

- [ ] **Step 1: Port the master resume**

```bash
cp /Users/apple/Desktop/resume-automation/templates/master_resume.tex resume/master_resume.tex
```
Expected: file exists, non-empty (`wc -l resume/master_resume.tex` > 0).

- [ ] **Step 2: Write the compilable fixture `tests/fixtures/sample_resume.tex`**

```latex
\documentclass{article}
\begin{document}
Hello Resume.
\end{document}
```

- [ ] **Step 3: Write the failing test `tests/compile.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { execaSync } from "execa";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePdf, CompileError } from "../lib/compile.js";

function hasTectonic(): boolean {
  try {
    execaSync("tectonic", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

describe("compilePdf", () => {
  it.skipIf(!hasTectonic())("produces a PDF from a .tex", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aja-"));
    const tex = join(dir, "resume.tex");
    writeFileSync(tex, readFileSync("tests/fixtures/sample_resume.tex", "utf8"));
    const pdf = await compilePdf(tex, dir);
    expect(existsSync(pdf)).toBe(true);
    expect(pdf.endsWith(".pdf")).toBe(true);
    expect(statSync(pdf).size).toBeGreaterThan(0);
  });

  it("throws CompileError when tectonic binary is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aja-"));
    const tex = join(dir, "resume.tex");
    writeFileSync(tex, "x");
    // Force the missing-binary path by pointing at a non-existent command.
    await expect(compilePdf(tex, dir, "definitely-not-tectonic-xyz")).rejects.toBeInstanceOf(CompileError);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/compile.test.ts`
Expected: FAIL — cannot import `../lib/compile.js` (module missing).

- [ ] **Step 5: Write `lib/compile.ts`**

```typescript
import { execa } from "execa";
import { mkdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

export class CompileError extends Error {}

/**
 * Compile a .tex file to PDF using tectonic. Returns the output PDF path.
 * `bin` is overridable for testing the missing-binary path.
 */
export async function compilePdf(
  texPath: string,
  outDir: string,
  bin = "tectonic",
): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  try {
    await execa(bin, ["-o", outDir, texPath]);
  } catch (err) {
    throw new CompileError(`tectonic failed: ${(err as Error).message}`);
  }
  const stem = basename(texPath).replace(/\.tex$/, "");
  const pdf = join(outDir, `${stem}.pdf`);
  if (!existsSync(pdf)) {
    throw new CompileError(`PDF not produced at ${pdf}`);
  }
  return pdf;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/compile.test.ts`
Expected: PASS — the missing-binary test passes; the real-compile test PASSES if tectonic is installed, else is SKIPPED.

- [ ] **Step 7: Commit**

```bash
git add resume/master_resume.tex lib/compile.ts tests/fixtures/sample_resume.tex tests/compile.test.ts
git commit -m "feat: port master resume + tectonic compile"
```

---

## Task 4: Config (Settings + Profile)

**Files:**
- Create: `config/settings.example.yaml`
- Create: `config/profile.json` (ported)
- Create: `lib/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Port the profile**

```bash
cp /Users/apple/Desktop/resume-automation/config/profile.json config/profile.json
```
Expected: file exists with the user's personal fields.

- [ ] **Step 2: Write `config/settings.example.yaml`**

```yaml
schedule:
  time: "20:00"            # local time, HH:MM 24h
ranking:
  topN: 10
search:
  filters:
    - keywords: "Software Development Engineer"
      location: "India"
      experienceLevel: "mid-senior"
      datePosted: "past-24h"
apply:
  dailyCap: 8
  easyApplyOnly: true
llm:
  model: "claude-sonnet-4-6"
telegram:
  chatId: 0                # filled in by the user; token comes from env
```

- [ ] **Step 3: Write the failing test `tests/config.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, loadProfile } from "../lib/config.js";

function tmpFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aja-cfg-"));
  const p = join(dir, name);
  writeFileSync(p, contents, "utf8");
  return p;
}

const GOOD = `
schedule:
  time: "20:00"
ranking:
  topN: 5
search:
  filters:
    - keywords: "SDE"
      location: "India"
apply:
  dailyCap: 3
  easyApplyOnly: true
llm:
  model: "claude-sonnet-4-6"
telegram:
  chatId: 42
`;

describe("loadSettings", () => {
  it("parses a valid settings file", () => {
    const s = loadSettings(tmpFile("settings.yaml", GOOD));
    expect(s.schedule.time).toBe("20:00");
    expect(s.ranking.topN).toBe(5);
    expect(s.search.filters[0].keywords).toBe("SDE");
    expect(s.apply.dailyCap).toBe(3);
    expect(s.apply.easyApplyOnly).toBe(true);
    expect(s.llm.model).toBe("claude-sonnet-4-6");
    expect(s.telegram.chatId).toBe(42);
  });

  it("rejects an invalid schedule time", () => {
    const bad = GOOD.replace('"20:00"', '"8pm"');
    expect(() => loadSettings(tmpFile("settings.yaml", bad))).toThrow();
  });
});

describe("loadProfile", () => {
  it("loads the profile json", () => {
    const p = tmpFile("profile.json", JSON.stringify({ name: "Vivek", email: "v@x.com" }));
    const prof = loadProfile(p);
    expect(prof.name).toBe("Vivek");
    expect(prof.email).toBe("v@x.com");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `../lib/config.js` missing.

- [ ] **Step 5: Write `lib/config.ts`**

```typescript
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { SETTINGS_PATH, PROFILE_PATH } from "./paths.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const SearchFilter = z.object({
  keywords: z.string(),
  location: z.string().default(""),
  experienceLevel: z.string().default(""),
  datePosted: z.string().default(""),
  minCtc: z.number().optional(),
});

const SettingsSchema = z.object({
  schedule: z.object({
    time: z.string().regex(TIME_RE, "schedule.time must be HH:MM 24h"),
  }),
  ranking: z.object({ topN: z.number().int().default(10) }),
  search: z.object({ filters: z.array(SearchFilter).default([]) }),
  apply: z.object({
    dailyCap: z.number().int().default(8),
    easyApplyOnly: z.boolean().default(true),
  }),
  llm: z.object({ model: z.string().default("claude-sonnet-4-6") }),
  telegram: z.object({ chatId: z.number().int().default(0) }),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function loadSettings(path: string = SETTINGS_PATH): Settings {
  const raw = parseYaml(readFileSync(path, "utf8")) ?? {};
  return SettingsSchema.parse(raw);
}

export function loadProfile(path: string = PROFILE_PATH): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add config/settings.example.yaml config/profile.json lib/config.ts tests/config.test.ts
git commit -m "feat: zod-validated settings + profile loading"
```

---

## Task 5: Database + tracker

**Files:**
- Create: `lib/db.ts`
- Create: `lib/tracker.ts`
- Create: `tests/tracker.test.ts`

- [ ] **Step 1: Write `lib/db.ts`**

```typescript
import Database from "better-sqlite3";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_job_id TEXT UNIQUE NOT NULL,
  title TEXT, company TEXT, location TEXT, url TEXT,
  apply_type TEXT NOT NULL,
  jd_text TEXT DEFAULT '',
  first_seen TEXT NOT NULL
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

export function migrate(db: DB): void {
  db.exec(SCHEMA);
}
```

- [ ] **Step 2: Write the failing test `tests/tracker.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  linkedinJobId: "123",
  title: "Backend Engineer",
  company: "Acme",
  location: "Bangalore",
  url: "https://linkedin.com/jobs/view/123",
  applyType: "easy_apply",
  jdText: "Build APIs in Python.",
};

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("tracker", () => {
  it("addJob is idempotent on linkedinJobId", () => {
    const id1 = tracker.addJob(db, sample);
    const id2 = tracker.addJob(db, sample);
    expect(id1).toBe(id2);
  });

  it("getJobByLinkedinId returns the row", () => {
    tracker.addJob(db, sample);
    const row = tracker.getJobByLinkedinId(db, "123");
    expect(row?.company).toBe("Acme");
    expect(row?.apply_type).toBe("easy_apply");
  });

  it("createApplication starts as suggested and transitions", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    expect(tracker.getApplication(db, appId)?.status).toBe("suggested");
    tracker.setStatus(db, appId, "tailoring");
    expect(tracker.getApplication(db, appId)?.status).toBe("tailoring");
  });

  it("setStatus rejects an unknown status", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    expect(() => tracker.setStatus(db, appId, "banana" as never)).toThrow();
  });

  it("appendEditNote accumulates notes", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    tracker.appendEditNote(db, appId, "emphasize python");
    tracker.appendEditNote(db, appId, "drop project X");
    const notes = tracker.getApplication(db, appId)?.edit_notes ?? "";
    expect(notes).toContain("emphasize python");
    expect(notes).toContain("drop project X");
  });

  it("setStatus applied sets applied_at", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    tracker.setStatus(db, appId, "applied");
    expect(tracker.getApplication(db, appId)?.applied_at).toBeTruthy();
  });

  it("recordRun stores counts", () => {
    const runId = tracker.recordRun(db, { searched: 3, foundNew: 5, suggested: 5, status: "ok" });
    const run = tracker.getRun(db, runId);
    expect(run?.found_new).toBe(5);
    expect(run?.status).toBe("ok");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/tracker.test.ts`
Expected: FAIL — `../lib/tracker.js` missing.

- [ ] **Step 4: Write `lib/tracker.ts`**

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tracker.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts lib/tracker.ts tests/tracker.test.ts
git commit -m "feat: sqlite db + application tracker"
```

---

## Task 6: LLM seam

**Files:**
- Create: `lib/llm.ts`

The seam is intentionally tiny: one async function that sends a system + user prompt and
returns parsed JSON. `rank`/`tailor` accept an injectable `complete` function (defaulting
to this), so their tests never hit the network. No standalone test for the seam (it is a
thin wrapper over the Anthropic SDK).

- [ ] **Step 1: Write `lib/llm.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";

export type CompleteJson = (system: string, user: string, opts?: { model?: string }) => Promise<any>;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  return JSON.parse(body.trim());
}

/** Send a system+user prompt and parse the reply as JSON. */
export const completeJson: CompleteJson = async (system, user, opts) => {
  const model = opts?.model ?? "claude-sonnet-4-6";
  const resp = await getClient().messages.create({
    model,
    max_tokens: 4096,
    system: `${system}\nRespond with ONLY valid JSON, no prose.`,
    messages: [{ role: "user", content: user }],
  });
  const block = resp.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text : "";
  return extractJson(text);
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/llm.ts
git commit -m "feat: anthropic llm seam (completeJson)"
```

---

## Task 7: Rank unit

**Files:**
- Create: `lib/rank.ts`
- Create: `tests/rank.test.ts`

- [ ] **Step 1: Write the failing test `tests/rank.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { rank } from "../lib/rank.js";
import type { Posting } from "../lib/types.js";

function postings(n: number): Posting[] {
  return Array.from({ length: n }, (_, i) => ({
    linkedinJobId: String(i),
    title: `Job ${i}`,
    company: "Acme",
    location: "Bangalore",
    url: `u${i}`,
    applyType: "easy_apply" as const,
    jdText: "python backend",
  }));
}

describe("rank", () => {
  it("returns top-N sorted by fitScore desc", async () => {
    const complete = async () => ({
      rankings: Array.from({ length: 5 }, (_, i) => ({
        linkedinJobId: String(i),
        fitScore: i * 10,
        fitReason: `reason ${i}`,
      })),
    });
    const result = await rank(postings(5), { resumeText: "x", profile: {}, topN: 3, complete });
    expect(result.map((r) => r.posting.linkedinJobId)).toEqual(["4", "3", "2"]);
    expect(result[0].fitScore).toBe(40);
    expect(result[0].fitReason).toBe("reason 4");
  });

  it("ignores unknown ids returned by the model", async () => {
    const complete = async () => ({
      rankings: [{ linkedinJobId: "999", fitScore: 99, fitReason: "ghost" }],
    });
    const result = await rank(postings(2), { resumeText: "x", profile: {}, topN: 5, complete });
    expect(result).toEqual([]);
  });

  it("returns empty for empty input without calling the model", async () => {
    let called = false;
    const complete = async () => {
      called = true;
      return { rankings: [] };
    };
    const result = await rank([], { resumeText: "x", profile: {}, topN: 5, complete });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rank.test.ts`
Expected: FAIL — `../lib/rank.js` missing.

- [ ] **Step 3: Write `lib/rank.ts`**

```typescript
import { completeJson, type CompleteJson } from "./llm.js";
import type { Posting, ScoredPosting } from "./types.js";

const SYSTEM =
  "You are a career-fit ranker. Given a candidate's resume/profile and a list of job " +
  "postings, score each posting 0-100 for how well it fits the candidate and give a " +
  'one-line reason. Respond ONLY as JSON: {"rankings": [{"linkedinJobId": "<id>", ' +
  '"fitScore": <0-100>, "fitReason": "<one line>"}]}';

interface RankOpts {
  resumeText: string;
  profile: Record<string, unknown>;
  topN: number;
  model?: string;
  complete?: CompleteJson;
}

export async function rank(postings: Posting[], opts: RankOpts): Promise<ScoredPosting[]> {
  if (postings.length === 0) return [];
  const complete = opts.complete ?? completeJson;
  const byId = new Map(postings.map((p) => [p.linkedinJobId, p]));
  const user = JSON.stringify({
    resume: opts.resumeText,
    profile: opts.profile,
    postings: postings.map((p) => ({
      linkedinJobId: p.linkedinJobId,
      title: p.title,
      company: p.company,
      location: p.location,
      jdText: p.jdText,
    })),
  });

  const data = await complete(SYSTEM, user, { model: opts.model });
  const scored: ScoredPosting[] = [];
  for (const r of data?.rankings ?? []) {
    const posting = byId.get(String(r.linkedinJobId));
    if (!posting) continue;
    scored.push({
      posting,
      fitScore: Number(r.fitScore ?? 0),
      fitReason: String(r.fitReason ?? ""),
    });
  }
  scored.sort((a, b) => b.fitScore - a.fitScore);
  return scored.slice(0, opts.topN);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rank.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rank.ts tests/rank.test.ts
git commit -m "feat: llm ranking unit"
```

---

## Task 8: Tailor unit

**Files:**
- Create: `lib/tailor.ts`
- Create: `tests/tailor.test.ts`

- [ ] **Step 1: Write the failing test `tests/tailor.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { tailor } from "../lib/tailor.js";

describe("tailor", () => {
  it("returns a tailored resume and cover letter", async () => {
    const complete = async () => ({
      resumeTex: "\\documentclass{article}\\begin{document}Tailored\\end{document}",
      coverLetterTex: "\\documentclass{article}\\begin{document}Dear\\end{document}",
    });
    const docs = await tailor({
      masterTex: "MASTER",
      jdText: "Build APIs",
      profile: { name: "Vivek" },
      editNotes: "",
      complete,
    });
    expect(docs.resumeTex).toContain("Tailored");
    expect(docs.coverLetterTex).toContain("Dear");
  });

  it("includes edit notes in the prompt", async () => {
    let capturedUser = "";
    const complete = async (_system: string, user: string) => {
      capturedUser = user;
      return { resumeTex: "x", coverLetterTex: "y" };
    };
    await tailor({
      masterTex: "MASTER",
      jdText: "JD",
      profile: {},
      editNotes: "emphasize python",
      complete,
    });
    expect(capturedUser).toContain("emphasize python");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tailor.test.ts`
Expected: FAIL — `../lib/tailor.js` missing.

- [ ] **Step 3: Write `lib/tailor.ts`**

```typescript
import { completeJson, type CompleteJson } from "./llm.js";
import type { TailoredDocs } from "./types.js";

const SYSTEM =
  "You are a resume tailor. You receive a LaTeX master resume, a job description, the " +
  "candidate's profile, and optional edit instructions. Produce a tailored LaTeX resume " +
  "(same document class/structure as the master, truthful — never invent experience) and " +
  "a matching one-page LaTeX cover letter. Respond ONLY as JSON: " +
  '{"resumeTex": "<full latex>", "coverLetterTex": "<full latex>"}';

interface TailorOpts {
  masterTex: string;
  jdText: string;
  profile: Record<string, unknown>;
  editNotes?: string;
  model?: string;
  complete?: CompleteJson;
}

export async function tailor(opts: TailorOpts): Promise<TailoredDocs> {
  const complete = opts.complete ?? completeJson;
  const user = JSON.stringify({
    masterResumeTex: opts.masterTex,
    jdText: opts.jdText,
    profile: opts.profile,
    editInstructions: opts.editNotes ?? "",
  });
  const data = await complete(SYSTEM, user, { model: opts.model });
  return { resumeTex: data.resumeTex, coverLetterTex: data.coverLetterTex };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tailor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all tests pass (the real-tectonic compile test may SKIP if tectonic absent).

- [ ] **Step 6: Commit**

```bash
git add lib/tailor.ts tests/tailor.test.ts
git commit -m "feat: llm resume + cover-letter tailoring unit"
```

---

## Done criteria for Plan 1

- `npm run typecheck && npx vitest run` is green (real-compile test may skip without tectonic).
- `lib/` provides: zod-typed config, SQLite tracker with validated status transitions,
  tectonic compile, and offline-testable `rank` + `tailor` units behind one injectable LLM seam.
- No browser, no Telegram, no live network in any test.
- Next: **Plan 2 — Ingestion** (Playwright + persistent LinkedIn context, fixture-tested
  parsing) builds on `types.Posting` and `tracker.addJob`.

---

## Self-Review notes

- **Spec coverage:** Plan 1 covers spec §4 units `compile`, `tailor`, `rank`, `tracker`,
  `llm`, config (§11), and domain types. Ingestion (§5.1), bot/gates + scheduler (§5),
  apply agent (§5.6), and the shadcn dashboard (§4) are deferred to Plans 2–5 — intentional
  decomposition.
- **Placeholders:** none — every code/test step has full content.
- **Type consistency:** `Posting`/`ScoredPosting`/`TailoredDocs`/`ApplyType` defined in
  Task 2 and used identically in `tracker` (Task 5), `rank` (Task 7), `tailor` (Task 8).
  The `CompleteJson` signature `(system, user, opts?: {model?}) => Promise<any>` is defined
  in the seam (Task 6) and matched by every test stub and by the `complete` injection points
  in `rank`/`tailor`. DB functions all take `db: DB` as the first arg consistently. Tracker
  column names (`apply_type`, `edit_notes`, `applied_at`, `found_new`) match the `db.ts`
  schema and the assertions in `tracker.test.ts`.
```
