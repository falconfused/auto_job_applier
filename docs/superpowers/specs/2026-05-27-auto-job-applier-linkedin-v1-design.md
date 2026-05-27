# Auto Job Applier — LinkedIn v1 Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming) — implementation in progress
**Owner:** Vivek Goswami

---

## 1. Summary

A personal, single-user system that, once a day, finds the best-matching LinkedIn
jobs for the user, delivers them to a Telegram bot for approval, and — on approval —
tailors a resume + cover letter per job and submits LinkedIn **Easy Apply**
applications via an AI browser agent, pausing for a final human confirmation before
every submit. External (non-Easy-Apply) jobs are forwarded as links for manual
application. A read-only **shadcn web dashboard** shows the tracker/history. All
application activity is recorded in a local SQLite database.

This document covers **v1 only**: LinkedIn, one platform, run locally.

---

## 2. Goals & Non-Goals

### Goals (v1)
- Ingest LinkedIn job postings matching configurable search filters.
- Rank candidates against the user's resume/profile via an LLM; surface the top 10/day.
- Deliver a daily digest at **8:00 PM** to a Telegram bot with per-job Apply/Deny controls.
- For **Easy Apply** jobs: tailor resume + cover letter, get human approval of the
  tailored materials (with a chat-based edit loop), then auto-fill and submit via an
  AI browser agent that pauses at the final submit.
- For **external** jobs: forward the link for manual application.
- Track every job through its lifecycle in a local database.
- Provide a **read-only web dashboard** (shadcn) to view applications, statuses, and runs.
- Run locally on the user's Mac; remain portable to a cloud VM later.

### Non-Goals (explicitly out of scope for v1)
- **Other platforms** (Naukri, Indeed, Instahyre) — later sub-projects.
- **External-site auto-apply** + account creation — deferred; external jobs are link-only.
- **Credentials vault** — not needed for a single persistent LinkedIn login. The proven
  Keychain approach from `resume-automation` will be re-introduced when external sites
  enter scope.
- **LinkedIn networking / referral connection requests** — parked (highest ban-risk
  vector; deliberately excluded from v1).
- **Write actions from the web dashboard** — the dashboard is read-only in v1; all
  approvals happen via Telegram. **No multi-user / auth** (single local user).

---

## 3. Key Decisions (and rationale)

| Decision | Choice | Why |
|----------|--------|-----|
| First platform | **LinkedIn only** | User's choice; widest job pool. Highest automation risk, accepted. |
| Apply scope | **Easy Apply auto-submit; external = forward link** | Easy Apply is self-contained (no account creation/vault); external needs the vault subsystem, deferred. |
| Runtime | **Local Mac now, portable to cloud later** | Home IP/browser profile looks natural to LinkedIn → lowest challenge/ban risk. Built portable. |
| Reuse from `resume-automation` | **Only the tailoring pipeline** (`master_resume.tex` + `tectonic` compile) | The rest is being designed fresh. `tectonic` is a CLI, invoked from Node via a child process. |
| Matching | **Broad config filters → LinkedIn search → LLM ranking → top 10** | Controllable + smart; avoids noise. |
| Apply engine | **Agentic (Claude Agent SDK, TypeScript)** | Easy Apply forms have unpredictable screening questions; deterministic selectors are too brittle. Agent answers from profile and escalates when unsure. |
| Ingestion source | **Scrape the user's logged-in LinkedIn session (Playwright/Node)** | No usable LinkedIn jobs API exists for individual seekers (see §9). Best coverage + Easy-Apply detection. |
| **Tech stack** | **Node.js + TypeScript** | User directive. |
| **App structure** | **Next.js (App Router) dashboard + shared `lib/` core + standalone Node `worker/`** | shadcn's best-supported setup; the worker is a persistent process (Playwright/bot/scheduler) that can't run as serverless routes. Both share the SQLite DB. |
| **Frontend** | **shadcn/ui (read-only tracker dashboard)** | User directive. Telegram remains the primary approval interface; the web app only visualizes the tracker/history. |
| Tailoring/ranking LLM | **Anthropic SDK (configurable model)** | Single provider alongside the Claude Agent SDK apply engine. |
| Storage | **SQLite (`better-sqlite3`)** | Single-user, local, zero-setup, synchronous & simple; portable to Postgres later. |
| Tests | **Vitest** | TS-native, fast; fits the Node stack. |

---

## 4. Architecture

A single Next.js (App Router) project with a shared core library and a standalone
long-running worker. APScheduler-equivalent (`node-cron`) inside the worker fires the
daily pipeline; `grammy` provides the Telegram interface; a persistent Playwright Chrome
context stays logged into LinkedIn so the session fingerprint never changes. The Next.js
app reads the same SQLite DB to render the dashboard.

```
auto_job_applier/                 # Node + TypeScript, single package
  package.json                    # deps + scripts (dev:web, worker, test)
  tsconfig.json
  next.config.mjs                 # Next.js (App Router)
  tailwind.config.ts              # shadcn/ui + Tailwind
  components.json                 # shadcn config
  .env                            # secrets: ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN (gitignored)
  config/
    settings.yaml                 # search filters, schedule, top-N, caps (gitignored)
    settings.example.yaml         # committed template
    profile.json                  # ported personal/form-fill data
  lib/                            # shared core (imported by web + worker)
    paths.ts                      # path constants
    config.ts                     # zod-validated Settings + Profile loaders
    types.ts                      # Posting, ScoredPosting, TailoredDocs
    db.ts                         # better-sqlite3 connection + migrate()
    tracker.ts                    # jobs/suggestions/applications/runs CRUD + status transitions
    llm.ts                        # completeJson(system, user) -> object  (Anthropic seam)
    compile.ts                    # tectonic .tex -> PDF (via execa)
    tailor.ts                     # LLM: master .tex + JD -> tailored .tex + cover letter
    rank.ts                       # LLM: postings + resume/profile -> scored top-N
  worker/                         # standalone long-running process (run via tsx)
    index.ts                      # boot: scheduler + Telegram bot
    scheduler.ts                  # node-cron — fires the 8 PM pipeline
    ingest.ts                     # Playwright: drive logged-in LinkedIn, scrape results
    bot.ts                        # grammy: digest, Apply/Deny, gates, chat edits
    applyAgent.ts                 # Claude Agent SDK: drives Easy Apply, pauses at submit
  app/                            # Next.js App Router — read-only shadcn dashboard
    layout.tsx
    page.tsx                      # tracker table: applications + statuses
    runs/page.tsx                 # daily run history
  components/ui/                  # shadcn components
  resume/
    master_resume.tex             # ported gold-copy master
    jobs/<slug>/                  # per-job: jd.txt, resume.tex/pdf, cover_letter.*, meta
  data/
    applier.db                    # SQLite (gitignored)
  browser_profile/                # persistent Chrome user-data-dir (gitignored)
  tests/                          # vitest
  docs/superpowers/{specs,plans}/ # this spec + plans
```

### Units (each independently testable)

| Unit | Location | Input → Output | LLM? | Notes |
|------|----------|----------------|------|-------|
| `ingest` | worker | search filters → list of raw postings | No | Pure given HTML; parse-tested against fixtures |
| `rank` | lib | postings + profile → scored top-N | Yes | Pure function; stubbed LLM in tests |
| `tailor` | lib | master `.tex` + JD → tailored `.tex` + cover letter | Yes | Pure function |
| `compile` | lib | `.tex` → PDF | No | `tectonic` via `execa`, deterministic |
| `applyAgent` | worker | job + tailored resume → submit-ready browser state | Agent | Only unit needing a live browser |
| `bot` | worker | Telegram updates → status transitions + messages | No | The stateful/interactive orchestrator |
| `tracker` | lib | — | No | SQLite system of record; everything reads/writes here |
| dashboard | app | SQLite → rendered tables | No | Read-only; Next.js server components |

**Design principle:** status flows one direction; each Telegram tap maps to exactly one
status transition. No unit holds business state in memory — SQLite is the source of truth,
shared between worker and web.

---

## 5. Daily Flow

### 8:00 PM — scheduled pipeline (worker)
1. `ingest` opens the persistent LinkedIn session, runs each configured search filter,
   scrapes result cards (title, company, location, JD link, Easy-Apply vs external flag).
   Dedupes against `jobs` (by `linkedin_job_id`) so a job is never shown twice.
2. `rank` sends new postings + resume/profile to the LLM → top 10 by fit, each with a
   one-line "why it fits."
3. `tracker` records all 10 as `suggested` (+ a `runs` row for the night).
4. `bot` sends a Telegram digest: 10 cards (title/company/fit-reason), each with
   **`✅ Apply` / `❌ Deny`**. External jobs tagged "🔗 external — apply manually" + link.

### On a button tap (any time, from phone)
- **Deny** → `tracker` → `dismissed`.
- **Apply (external job)** → bot replies with the direct link; `external_sent`.
- **Apply (Easy Apply job)** → start per-job apply pipeline:
  5. `tailor` generates a JD-tailored `.tex` + cover letter from the master →
     `compile` → per-job PDF. Status `tailoring`.
  6. **Gate 2:** bot sends tailored resume PDF + cover letter + a summary of what will be
     submitted, with **`✅ Submit` / `✏️ Edit` / `❌ Cancel`**. Status `awaiting_submit`.
     - **Edit** → user replies free-text ("drop project X, emphasize Python"). `tailor`
       re-runs with the note (accumulated in `edit_notes`) → recompile → re-send Gate 2.
       Loops until Submit or Cancel.
     - **Cancel** → `cancelled`.
     - **Submit** → `applyAgent` opens the job, fills the Easy Apply form from
       `profile.json`, uploads the tailored PDF, and **pauses at the final submit**. If it
       hits a screening question it can't confidently answer, it asks on Telegram. On the
       user's Submit confirmation it clicks submit → `tracker` → `applied` (+ timestamp).

**Two human gates per job:** Apply/Deny on the digest, then Submit/Edit/Cancel on the
tailored materials. The agent never submits without an explicit Submit tap. The web
dashboard reflects every status change but never initiates one.

---

## 6. Data Model (SQLite — `data/applier.db`, `better-sqlite3`)

### `jobs` — every posting ever seen (dedupe source of truth)
- `id` (PK), `linkedin_job_id` (unique — dedupe), `title`, `company`, `location`, `url`
- `apply_type` — `easy_apply` | `external`
- `jd_text` — raw JD (fetched at apply time, not ingest, to stay light)
- `first_seen`

### `suggestions` — which jobs were proposed on which run
- `id`, `job_id` (FK), `run_date`, `rank`, `fit_score`, `fit_reason`

### `applications` — lifecycle tracker
- `id`, `job_id` (FK)
- `status` — `suggested` → `dismissed` / `external_sent` / `tailoring` /
  `awaiting_submit` / `cancelled` / `applied` / `failed`
- `resume_path`, `cover_letter_path`, `edit_notes`, `applied_at`, `error`, `updated_at`

### `runs` — one row per 8 PM execution
- `id`, `date`, `searched`, `found_new`, `suggested` (counts), `status`, `error`

Per-job artifacts (jd, tex, pdfs) live in `resume/jobs/<slug>/`; the DB stores **paths,
not blobs**. No credentials table in v1 (single persistent login).

---

## 7. Error Handling

Each stage is isolated; failures never cascade.
- `ingest` fails (layout change/blocked) → run marked `failed`, Telegram alert, nothing
  downstream runs; prior data untouched.
- `rank` / `tailor` LLM error → retry once, then surface the error on Telegram for that
  job; other jobs proceed.
- `compile` (tectonic) fails → job `failed` with the LaTeX error; user notified; no
  broken PDF sent.
- `applyAgent` stalls or hits an unanswerable question → pauses and asks on Telegram
  rather than guessing or submitting.
- Worker crash/restart → state is in SQLite, not memory; on boot it resumes pending
  approvals. Telegram callbacks are **idempotent** (a double-tap cannot double-submit).

---

## 8. LinkedIn Safety

This is what keeps the account alive — treated as a first-class requirement.
- **One persistent Chrome context** (`browser_profile/`), headed (non-headless), logged in
  once manually; reused for both ingest and apply so the fingerprint never changes.
- **Human-like pacing** — randomized action delays; a configurable **daily apply cap**
  (default ~5–10). Ingest only reads search pages (low-risk) vs apply (rarer, higher-risk).
- **Login-challenge detection** — on captcha/2FA/checkpoint the agent does **not** try to
  solve it; it pauses and pings the user on Telegram, then resumes.
- **No auto-connection-requests** in v1 (networking parked) — the single biggest ban
  vector, deliberately excluded.

> **Acknowledged risk:** automating a LinkedIn session — including read-only scraping —
> violates LinkedIn's User Agreement and carries a real risk of account restriction or
> ban. There is no fully sanctioned path for this use case. The user accepts this risk for
> personal use.

---

## 9. LinkedIn API Investigation (why we scrape)

No usable LinkedIn API exists for an individual job seeker:
- **Sign In with LinkedIn (OAuth/OpenID):** basic profile only (name, email, photo). No
  jobs, no applying.
- **Marketing / Share APIs:** posting & ads; partner-gated; irrelevant.
- **Talent Solutions / Jobs API + Apply Connect:** the actual jobs API, but **partner-only**
  (ATS vendors / large job boards), requires a registered company + signed agreement +
  LinkedIn approval, and is **employer-side** (post jobs, receive applicants). There is **no
  public API for a seeker to search jobs or submit applications.**

Decision: **scrape the logged-in LinkedIn session** for best coverage and Easy-Apply
detection. The apply step requires the browser agent regardless of ingestion source.

---

## 10. Testing Strategy (Vitest)

- **Unit (no network/LLM):** `rank` and `tailor` with recorded fixture postings + stubbed
  `llm.completeJson`; `compile` with a sample `.tex`; `tracker` status transitions against a
  temp SQLite db.
- **Ingest:** against **saved LinkedIn HTML fixtures** (parsing is pure given HTML) — no
  hitting LinkedIn in tests.
- **Bot:** handler logic via simulated grammy update/context objects (button callbacks, text
  edits) → assert correct status transition + outgoing message.
- **Apply agent:** verified **manually** against a few real Easy Apply jobs (it pauses at
  submit → safe to dry-run). No automated test drives live LinkedIn.
- **Dashboard:** component render tests against a seeded temp DB (read-only).
- **End-to-end smoke:** a `--dry-run` worker mode that runs the full pipeline but stops
  before any real submit, so a full 8 PM cycle can be watched on demand.

---

## 11. Configuration

`config/settings.yaml` (illustrative; real file gitignored, `settings.example.yaml` committed):
- `schedule.time`: `"20:00"` (local)
- `search.filters`: list of `{ keywords, location, experienceLevel, datePosted, minCtc? }`
- `ranking.topN`: `10`
- `apply.dailyCap`: e.g. `8`; `apply.easyApplyOnly`: `true`
- `llm.model`: Anthropic model id for ranking + tailoring
- `telegram.chatId`: the user's chat id

Secrets via `.env` (not committed): `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`.

`config/profile.json` is ported from `resume-automation` (name, email, phone, location,
links, current/expected CTC, notice period, preferred locations, relocation flag).

---

## 12. Build Order (plans)

1. **Foundation & Tailoring** — Node/TS package scaffold + shared `lib/` (config, types,
   db/tracker, `compile` via tectonic, `llm` seam, `rank`, `tailor`); all Vitest-tested,
   no browser/network. (Next.js + shadcn scaffold deferred to Plan 5.) ← Plan 1
2. **Ingestion** — Playwright + persistent LinkedIn context, fixture-tested parsing. ← Plan 2
3. **Telegram bot & orchestration** — grammy digest, both approval gates, edit loop,
   `node-cron` 8 PM scheduler, `--dry-run`. ← Plan 3
4. **Apply agent & safety** — Claude Agent SDK Easy Apply fill + pause-at-submit +
   escalation; LinkedIn pacing/caps/challenge detection. ← Plan 4
5. **Web dashboard** — shadcn read-only tracker + run-history pages. ← Plan 5

Subsequent sub-projects (own spec → plan → build each): credentials vault + external-site
apply; additional platforms (Naukri/Indeed/Instahyre); LinkedIn networking.
