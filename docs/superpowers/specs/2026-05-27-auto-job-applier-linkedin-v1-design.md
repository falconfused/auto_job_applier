# Auto Job Applier — LinkedIn v1 Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming) — pending implementation plan
**Owner:** Vivek Goswami

---

## 1. Summary

A personal, single-user system that, once a day, finds the best-matching LinkedIn
jobs for the user, delivers them to a Telegram bot for approval, and — on approval —
tailors a resume + cover letter per job and submits LinkedIn **Easy Apply**
applications via an AI browser agent, pausing for a final human confirmation before
every submit. External (non-Easy-Apply) jobs are forwarded as links for manual
application. All application activity is recorded in a local tracker.

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
- Run locally on the user's Mac; remain portable to a cloud VM later.

### Non-Goals (explicitly out of scope for v1)
- **Other platforms** (Naukri, Indeed, Instahyre) — later sub-projects.
- **External-site auto-apply** + account creation — deferred; external jobs are link-only.
- **Credentials vault** — not needed for a single persistent LinkedIn login. The proven
  Keychain module from `resume-automation` will be re-introduced when external sites
  enter scope.
- **LinkedIn networking / referral connection requests** — parked (highest ban-risk
  vector; deliberately excluded from v1).
- **Multi-user / web UI** — single user, Telegram-only interface.

---

## 3. Key Decisions (and rationale)

| Decision | Choice | Why |
|----------|--------|-----|
| First platform | **LinkedIn only** | User's choice; widest job pool. Highest automation risk, accepted. |
| Apply scope | **Easy Apply auto-submit; external = forward link** | Easy Apply is self-contained (no account creation/vault); external needs the vault subsystem, deferred. |
| Runtime | **Local Mac now, portable to cloud later** | Home IP/browser profile looks natural to LinkedIn → lowest challenge/ban risk. Built portable. |
| Reuse from `resume-automation` | **Only the tailoring pipeline** (`master_resume.tex` + `tectonic` compile) | The rest is being designed fresh for an autonomous architecture. |
| Matching | **Broad config filters → LinkedIn search → LLM ranking → top 10** | Controllable + smart; avoids noise. |
| Apply engine | **Agentic (Claude Agent SDK + browser tool)** | Easy Apply forms have unpredictable screening questions; deterministic selectors are too brittle. Agent answers from profile and escalates when unsure. |
| Ingestion source | **Scrape the user's logged-in LinkedIn session** | No usable LinkedIn jobs API exists for individual seekers (see §9). Best coverage + Easy-Apply detection. |
| Tailoring intelligence | **LLM call (not Claude-in-terminal)** | Must run unattended at 8 PM. The reusable asset is the LaTeX template + `tectonic` compile, not the interactive session. |
| Storage | **SQLite** | Single-user, local, zero-setup; trivially portable to Postgres later. |

---

## 4. Architecture

A single long-running Python service. APScheduler fires the daily pipeline;
`python-telegram-bot` provides the interactive interface; a persistent Chrome profile
stays logged into LinkedIn so the session fingerprint never changes.

```
auto_job_applier/
  main.py                    # entrypoint: starts scheduler + Telegram bot, runs forever
  config/
    settings.yaml            # search filters, schedule time, top-N, daily apply cap, paths
    profile.json             # ported: personal/form-fill data (name, CTC, notice, locations…)
  core/
    scheduler.py             # APScheduler — fires the 8 PM daily pipeline
    ingest.py                # Playwright: drive logged-in LinkedIn, scrape search results
    rank.py                  # LLM scores candidates vs resume/profile → top N
    tailor.py                # LLM: master .tex + JD → tailored .tex + cover letter
    compile.py               # ported: tectonic .tex → PDF
    apply_agent.py           # Claude Agent SDK: drives Easy Apply form, pauses at submit
    tracker.py               # SQLite read/write of application lifecycle
  bot/
    telegram_bot.py          # digest, inline Apply/Deny buttons, approval gates, chat edits
    handlers.py              # button callbacks + text-reply (edit) handlers
  resume/
    master_resume.tex        # ported gold-copy master
    jobs/<slug>/             # per-job: jd.txt, resume.tex/pdf, cover_letter.*, meta
  data/
    applier.db               # SQLite: jobs, suggestions, applications, runs
  browser_profile/           # persistent Chrome user-data-dir (logged-in LinkedIn)
  docs/superpowers/specs/    # this spec
```

### Units (each independently testable)

| Unit | Input → Output | LLM? | Notes |
|------|----------------|------|-------|
| `ingest` | search filters → list of raw postings | No | Pure given HTML; parse-tested against fixtures |
| `rank` | postings + profile → scored top-N | Yes | Pure function; stubbed LLM in tests |
| `tailor` | master `.tex` + JD → tailored `.tex` + cover letter | Yes | Pure function |
| `compile` | `.tex` → PDF | No | Ported, deterministic (`tectonic`) |
| `apply_agent` | job + tailored resume → submit-ready browser state | Agent | Only unit needing a live browser |
| `bot` | Telegram updates → status transitions + messages | No | The stateful/interactive orchestrator |
| `tracker` | — | No | SQLite system of record; everything reads/writes here |

**Design principle:** status flows one direction; each Telegram tap maps to exactly one
status transition. No unit holds business state in memory — SQLite is the source of truth.

---

## 5. Daily Flow

### 8:00 PM — scheduled pipeline
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
     - **Submit** → `apply_agent` opens the job, fills the Easy Apply form from
       `profile.json`, uploads the tailored PDF, and **pauses at the final submit**. If it
       hits a screening question it can't confidently answer, it asks on Telegram. On the
       user's Submit confirmation it clicks submit → `tracker` → `applied` (+ timestamp).

**Two human gates per job:** Apply/Deny on the digest, then Submit/Edit/Cancel on the
tailored materials. The agent never submits without an explicit Submit tap.

---

## 6. Data Model (SQLite — `data/applier.db`)

### `jobs` — every posting ever seen (dedupe source of truth)
- `id` (PK)
- `linkedin_job_id` (unique — LinkedIn's job id, used for dedupe)
- `title`, `company`, `location`
- `url`
- `apply_type` — `easy_apply` | `external`
- `jd_text` — raw JD (fetched at apply time, not ingest, to stay light)
- `first_seen`

### `suggestions` — which jobs were proposed on which run
- `id`, `job_id` (FK), `run_date`, `rank`, `fit_score`, `fit_reason`

### `applications` — lifecycle tracker
- `id`, `job_id` (FK)
- `status` — `suggested` → `dismissed` / `external_sent` / `tailoring` /
  `awaiting_submit` / `cancelled` / `applied` / `failed`
- `resume_path`, `cover_letter_path`
- `edit_notes` (accumulated chat edit instructions)
- `applied_at`, `error`, `updated_at`

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
- `apply_agent` stalls or hits an unanswerable question → pauses and asks on Telegram
  rather than guessing or submitting.
- Service crash/restart → state is in SQLite, not memory; on boot it resumes pending
  approvals. Telegram callbacks are **idempotent** (a double-tap cannot double-submit).

---

## 8. LinkedIn Safety

This is what keeps the account alive — treated as a first-class requirement.
- **One persistent Chrome profile**, real (non-headless) browser, logged in once
  manually; reused for both ingest and apply so the fingerprint never changes.
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

A third-party jobs-aggregator API could supply *listings* without scraping, but (a)
coverage/freshness varies and it may miss LinkedIn postings, and (b) it cannot *apply*.
Decision: **scrape the logged-in LinkedIn session** for best coverage and Easy-Apply
detection. The apply step requires the browser agent regardless of ingestion source.

---

## 10. Testing Strategy

- **Unit (no network/LLM):** `rank` and `tailor` with recorded fixture postings + stubbed
  LLM; `compile` with a sample `.tex`; `tracker` status transitions against a temp SQLite db.
- **Ingest:** against **saved LinkedIn HTML fixtures** (parsing is pure given HTML) — no
  hitting LinkedIn in tests.
- **Bot:** handler logic via simulated Telegram update objects (button callbacks, text
  edits) → assert correct status transition + outgoing message.
- **Apply agent:** verified **manually** against a few real Easy Apply jobs (it pauses at
  submit → safe to dry-run). No automated test drives live LinkedIn.
- **End-to-end smoke:** a `--dry-run` mode runs the full pipeline but stops before any real
  submit, so a full 8 PM cycle can be watched on demand.

---

## 11. Configuration (`config/settings.yaml` — illustrative)

- `schedule.time`: `"20:00"` (local)
- `search.filters`: list of `{ keywords, location, experience_level, date_posted, min_ctc? }`
- `ranking.top_n`: `10`
- `apply.daily_cap`: e.g. `8`
- `apply.easy_apply_only`: `true`
- `paths`: master resume, jobs dir, db, browser profile
- `telegram`: bot token, chat id (secrets via env, not committed)
- `llm`: provider/model for ranking + tailoring

`config/profile.json` is ported from `resume-automation` (name, email, phone, location,
links, current/expected CTC, notice period, preferred locations, relocation flag).

---

## 12. Build Order (for the implementation plan)

1. Project scaffold + config + SQLite schema (`tracker`).
2. Port tailoring pipeline (`master_resume.tex`, `compile`) + `tailor` (LLM).
3. `ingest` (Playwright + persistent profile) against fixtures, then live.
4. `rank` (LLM) → top-N.
5. Telegram bot: digest + Apply/Deny (Gate 1) + tracker wiring.
6. Gate 2: tailored-materials approval + chat edit loop.
7. `apply_agent` (Claude Agent SDK) — Easy Apply fill + pause-at-submit + escalation.
8. `scheduler` + `main.py` wiring + `--dry-run`.
9. LinkedIn-safety hardening (pacing, caps, challenge detection).

Subsequent sub-projects (own spec → plan → build each): credentials vault + external-site
apply; additional platforms (Naukri/Indeed/Instahyre); LinkedIn networking.
