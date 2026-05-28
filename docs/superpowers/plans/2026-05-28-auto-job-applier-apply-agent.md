# Auto Job Applier — Apply Agent + Safety Implementation Plan (Node/TypeScript)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `startApply` stub from Plan 3 with a Claude-Agent-SDK-driven Easy-Apply submitter that fills the LinkedIn form from `profile.json`, uploads the tailored PDF, **pauses at the final submit**, and escalates unanswerable screening questions to Telegram. Add LinkedIn safety: daily apply cap, human-like pacing, login-challenge detection.

**Architecture:** A new `worker/applyAgent.ts` exposes `applyToJob({ db, appId, settings, profile, deps })` that opens the persistent Playwright context, navigates to the job's LinkedIn URL, opens the Easy Apply modal, and walks each step using a small set of Playwright-driven tools. Plan 3's `startApply` is rewired in `worker/index.ts` to call this. Safety lives in `worker/safety.ts`: `checkDailyCap()` reads applications applied today; `detectChallenge(html)` is pure and tested against fixtures. The agent never auto-clicks the final "Submit" button — instead it returns to the bot, which sends a confirmation message; only the user's "✅ Confirm submit" callback fires the actual click.

**Tech Stack:** adds `@anthropic-ai/claude-agent-sdk` (Claude Agent SDK for the form-filling agent). Reuses the persistent `browser_profile/` Chromium context. No new test fixtures beyond a couple of synthetic challenge-page HTMLs.

This is Plan 4 of 5. Depends on Plans 1–3 merged. Plan 5 (dashboard) follows.

---

## File Structure

```
auto_job_applier/
  worker/
    applyAgent.ts        # applyToJob({db, appId, settings, profile, deps}): drives Easy Apply
    safety.ts            # checkDailyCap(db, cap), detectChallenge(html), pacingDelay()
  tests/
    safety.test.ts
    applyAgent.test.ts   # offline test of the orchestration: cap/challenge/escalation paths
    fixtures/
      linkedin_challenge.html  # synthetic challenge page (small, committed)
```

---

## Task 1: Add @anthropic-ai/claude-agent-sdk

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install @anthropic-ai/claude-agent-sdk
```
Expected: installs without error.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add claude-agent-sdk for apply agent"
```

---

## Task 2: Safety primitives (cap, challenge detection, pacing)

**Files:**
- Create: `worker/safety.ts`
- Create: `tests/safety.test.ts`
- Create: `tests/fixtures/linkedin_challenge.html`

- [ ] **Step 1: Write `tests/fixtures/linkedin_challenge.html`**

```html
<!doctype html>
<html><body>
  <h1>Let's do a quick security check</h1>
  <form id="captcha-internal-challenge"><input name="captcha" /></form>
</body></html>
```

- [ ] **Step 2: Write the failing test `tests/safety.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { checkDailyCap, detectChallenge } from "../worker/safety.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  linkedinJobId: "x", title: "T", company: "C", location: "L", url: "u", applyType: "easy_apply", jdText: "",
};

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("checkDailyCap", () => {
  it("allows when under cap", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    tracker.setStatus(db, appId, "applied");
    expect(checkDailyCap(db, 5)).toEqual({ ok: true, appliedToday: 1 });
  });

  it("blocks when at or over cap", () => {
    for (let i = 0; i < 3; i++) {
      const jobId = tracker.addJob(db, { ...sample, linkedinJobId: `j${i}` });
      const appId = tracker.createApplication(db, jobId);
      tracker.setStatus(db, appId, "applied");
    }
    expect(checkDailyCap(db, 3)).toEqual({ ok: false, appliedToday: 3 });
  });
});

describe("detectChallenge", () => {
  it("flags a captcha/checkpoint page", () => {
    const html = readFileSync(join(__dirname, "fixtures", "linkedin_challenge.html"), "utf8");
    expect(detectChallenge(html)).toBe(true);
  });

  it("does not flag a normal page", () => {
    expect(detectChallenge("<html><body>jobs feed</body></html>")).toBe(false);
  });
});
```

- [ ] **Step 3: Write `worker/safety.ts`**

```typescript
import type { DB } from "../lib/db.js";

export function checkDailyCap(db: DB, cap: number): { ok: boolean; appliedToday: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'applied' AND applied_at >= ?")
    .get(start.toISOString()) as { n: number };
  return { ok: row.n < cap, appliedToday: row.n };
}

const CHALLENGE_HINTS = [
  /security check/i,
  /captcha/i,
  /checkpoint/i,
  /verify your identity/i,
  /unusual activity/i,
];

export function detectChallenge(html: string): boolean {
  return CHALLENGE_HINTS.some((re) => re.test(html));
}

export async function pacingDelay(minMs = 1500, maxMs = 4000): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  await new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/safety.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/safety.ts tests/safety.test.ts tests/fixtures/linkedin_challenge.html
git commit -m "feat: linkedin safety primitives (daily cap + challenge detection)"
```

---

## Task 3: Apply agent orchestrator (offline-tested cap/challenge paths)

**Files:**
- Create: `worker/applyAgent.ts`
- Create: `tests/applyAgent.test.ts`

The agent has three injection points so its control flow can be unit-tested:
- `openJobPage(url) -> { html, page }` — wraps Playwright nav
- `runFillingAgent(page, args) -> { ready: bool, escalation?: string }` — wraps the Claude Agent SDK call
- `sendMessage(chatId, text)` — Telegram

A real run is wired in `index.ts` (Task 4); tests drive the orchestrator with stubs.

- [ ] **Step 1: Write the failing test `tests/applyAgent.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { applyToJobWith } from "../worker/applyAgent.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  linkedinJobId: "55", title: "Backend Engineer", company: "Acme", location: "Bangalore",
  url: "https://linkedin.com/jobs/view/55", applyType: "easy_apply", jdText: "",
};

let db: DB;
let appId: number;
let sent: string[];

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
  const jobId = tracker.addJob(db, sample);
  appId = tracker.createApplication(db, jobId);
  tracker.setStatus(db, appId, "awaiting_submit");
  tracker.setResumePaths(db, appId, "/tmp/r.pdf", "/tmp/c.pdf");
  sent = [];
});

const settings = {
  schedule: { time: "20:00" },
  ranking: { topN: 10 },
  search: { filters: [] },
  apply: { dailyCap: 5, easyApplyOnly: true },
  llm: { model: "claude-sonnet-4-6" },
  telegram: { chatId: 42 },
};

function deps(over: any = {}) {
  return {
    sendMessage: async (_id: number, t: string) => { sent.push(t); },
    openJobPage: async (_url: string) => ({ html: "<html>job page</html>", close: async () => {} }),
    runFillingAgent: async (_page: any, _args: any) => ({ ready: true }),
    finalizeSubmit: async (_page: any) => {},
    ...over,
  };
}

describe("applyToJobWith", () => {
  it("blocks when daily cap is hit and notifies", async () => {
    // pre-fill 5 applied today
    for (let i = 0; i < 5; i++) {
      const jid = tracker.addJob(db, { ...sample, linkedinJobId: `pre${i}` });
      const aid = tracker.createApplication(db, jid);
      tracker.setStatus(db, aid, "applied");
    }
    const result = await applyToJobWith({ db, appId, settings, profile: {}, deps: deps() });
    expect(result.outcome).toBe("cap_hit");
    expect(sent.some((s) => /cap/i.test(s))).toBe(true);
    expect(tracker.getApplication(db, appId)?.status).toBe("awaiting_submit"); // unchanged
  });

  it("aborts on challenge page and notifies", async () => {
    const result = await applyToJobWith({
      db, appId, settings, profile: {},
      deps: deps({ openJobPage: async () => ({ html: "<html>security check captcha</html>", close: async () => {} }) }),
    });
    expect(result.outcome).toBe("challenge");
    expect(sent.some((s) => /challenge|captcha|checkpoint|security/i.test(s))).toBe(true);
    expect(tracker.getApplication(db, appId)?.status).toBe("failed");
  });

  it("escalates when the filling agent returns an unanswerable question", async () => {
    const result = await applyToJobWith({
      db, appId, settings, profile: {},
      deps: deps({ runFillingAgent: async () => ({ ready: false, escalation: "What is your annual sales quota?" }) }),
    });
    expect(result.outcome).toBe("escalated");
    expect(sent.some((s) => /annual sales quota/.test(s))).toBe(true);
    expect(tracker.getApplication(db, appId)?.status).toBe("awaiting_submit"); // stays for user reply
  });

  it("submits on happy path and marks applied", async () => {
    let submitted = false;
    const result = await applyToJobWith({
      db, appId, settings, profile: {},
      deps: deps({ finalizeSubmit: async () => { submitted = true; } }),
    });
    expect(result.outcome).toBe("applied");
    expect(submitted).toBe(true);
    expect(tracker.getApplication(db, appId)?.status).toBe("applied");
  });
});
```

- [ ] **Step 2: Write `worker/applyAgent.ts`**

```typescript
import type { DB } from "../lib/db.js";
import type { Settings } from "../lib/config.js";
import * as tracker from "../lib/tracker.js";
import { checkDailyCap, detectChallenge } from "./safety.js";

export interface ApplyDeps {
  sendMessage: (chatId: number, text: string) => Promise<void>;
  openJobPage: (url: string) => Promise<{ html: string; close: () => Promise<void>; page?: any }>;
  runFillingAgent: (
    page: any,
    args: { jobUrl: string; resumePath: string; profile: Record<string, unknown> },
  ) => Promise<{ ready: boolean; escalation?: string }>;
  finalizeSubmit: (page: any) => Promise<void>;
}

export interface ApplyArgs {
  db: DB;
  appId: number;
  settings: Settings;
  profile: Record<string, unknown>;
  deps: ApplyDeps;
}

export type ApplyOutcome = "applied" | "cap_hit" | "challenge" | "escalated" | "error";

export async function applyToJobWith(args: ApplyArgs): Promise<{ outcome: ApplyOutcome; error?: string }> {
  const { db, appId, settings, profile, deps } = args;
  const app = tracker.getApplication(db, appId);
  if (!app) return { outcome: "error", error: "no application" };

  const cap = checkDailyCap(db, settings.apply.dailyCap);
  if (!cap.ok) {
    await deps.sendMessage(
      settings.telegram.chatId,
      `Daily apply cap reached (${cap.appliedToday}/${settings.apply.dailyCap}). Skipping app #${appId}.`,
    );
    return { outcome: "cap_hit" };
  }

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(app.job_id) as any;
  const session = await deps.openJobPage(job.url);

  try {
    if (detectChallenge(session.html)) {
      tracker.setStatus(db, appId, "failed", "linkedin challenge/captcha");
      await deps.sendMessage(
        settings.telegram.chatId,
        `LinkedIn challenge detected on app #${appId} (captcha/checkpoint). Resolve in the browser, then re-tap Submit.`,
      );
      return { outcome: "challenge" };
    }

    const filled = await deps.runFillingAgent(session.page, {
      jobUrl: job.url,
      resumePath: app.resume_path,
      profile,
    });

    if (!filled.ready) {
      await deps.sendMessage(
        settings.telegram.chatId,
        `App #${appId} needs your input: ${filled.escalation ?? "unknown question"}`,
      );
      return { outcome: "escalated" };
    }

    await deps.finalizeSubmit(session.page);
    tracker.setStatus(db, appId, "applied");
    await deps.sendMessage(settings.telegram.chatId, `✅ Submitted app #${appId} to ${job.company}.`);
    return { outcome: "applied" };
  } catch (err) {
    tracker.setStatus(db, appId, "failed", (err as Error).message);
    await deps.sendMessage(settings.telegram.chatId, `App #${appId} failed: ${(err as Error).message}`);
    return { outcome: "error", error: (err as Error).message };
  } finally {
    await session.close();
  }
}
```

- [ ] **Step 3: Run test**

Run: `npx vitest run tests/applyAgent.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add worker/applyAgent.ts tests/applyAgent.test.ts
git commit -m "feat: apply agent orchestrator (cap/challenge/escalate/submit)"
```

---

## Task 4: Wire production deps (Playwright + Claude Agent SDK)

**Files:**
- Create: `worker/applyDeps.ts`  — production `ApplyDeps` factory using the persistent context + Claude Agent SDK
- Modify: `worker/index.ts`     — replace the `startApply` stub with `applyToJobWith` using these deps

The Claude Agent SDK gets a small toolset: `getDom`, `click(selector)`, `fill(selector, value)`, `uploadFile(selector, path)`, `pressKey(key)`, plus `escalate(question)` and `ready()`. The agent's task is to walk the Easy Apply modal until the final review screen, then call `ready()`. It never clicks "Submit application" itself — that's `finalizeSubmit`, which the orchestrator calls only when the user has confirmed.

- [ ] **Step 1: Write `worker/applyDeps.ts`**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Page } from "playwright";
import { launchSession } from "./session.js";
import type { ApplyDeps } from "./applyAgent.js";

const SYSTEM = `You drive a LinkedIn Easy Apply form via the provided browser tools.
Goal: walk through the Easy Apply modal step-by-step, filling fields from the
candidate profile (provided as JSON), uploading the resume PDF (already on disk
at the path provided), and clicking Next/Continue until you reach the FINAL REVIEW
screen. Then call ready() — DO NOT click "Submit application" yourself.

If a screening question's answer is not clearly derivable from the profile,
call escalate(question) with the exact question text — do not guess or fabricate.

Be patient: forms paginate. Use getDom to read state between actions.`;

export function buildApplyDeps(opts: { sendMessage: ApplyDeps["sendMessage"]; model?: string }): ApplyDeps {
  const model = opts.model ?? "claude-sonnet-4-6";

  return {
    sendMessage: opts.sendMessage,

    async openJobPage(url) {
      const context = await launchSession();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1500 + Math.random() * 1500);
      // Click Easy Apply if visible
      const easy = await page.locator('button:has-text("Easy Apply")').first();
      if (await easy.count()) await easy.click().catch(() => {});
      const html = await page.content();
      return {
        html,
        page,
        close: async () => {
          await page.close().catch(() => {});
          await context.close().catch(() => {});
        },
      };
    },

    async runFillingAgent(page: Page, args) {
      let escalation: string | undefined;
      let ready = false;

      const tools = {
        async getDom() {
          return { dom: await page.content() };
        },
        async click({ selector }: { selector: string }) {
          await page.locator(selector).first().click({ timeout: 10000 });
          await page.waitForTimeout(800);
          return { ok: true };
        },
        async fill({ selector, value }: { selector: string; value: string }) {
          await page.locator(selector).first().fill(value, { timeout: 10000 });
          return { ok: true };
        },
        async uploadFile({ selector, path }: { selector: string; path: string }) {
          await page.locator(selector).first().setInputFiles(path);
          return { ok: true };
        },
        async pressKey({ key }: { key: string }) {
          await page.keyboard.press(key);
          return { ok: true };
        },
        async escalate({ question }: { question: string }) {
          escalation = question;
          return { ok: true };
        },
        async ready() {
          ready = true;
          return { ok: true };
        },
      };

      const userMessage = JSON.stringify({
        jobUrl: args.jobUrl,
        resumePath: args.resumePath,
        profile: args.profile,
      });

      // Drive the agent. The SDK's exact API may differ between versions; if so, adapt
      // to the current `query` signature (system, user, tools, model).
      const stream = query({
        prompt: userMessage,
        options: {
          model,
          systemPrompt: SYSTEM,
          // @ts-expect-error - tool schemas accept loose types here; we keep this simple.
          tools,
          maxTurns: 30,
        },
      });

      for await (const _ of stream) {
        if (ready || escalation) break;
      }

      return { ready, escalation };
    },

    async finalizeSubmit(page: Page) {
      const submit = page.locator('button:has-text("Submit application")').first();
      await submit.click({ timeout: 10000 });
      await page.waitForTimeout(2000);
    },
  };
}
```

- [ ] **Step 2: Wire it in `worker/index.ts`**

Replace the `startApply` stub:

```typescript
import { applyToJobWith } from "./applyAgent.js";
import { buildApplyDeps } from "./applyDeps.js";

// ... inside main(), where startApply was:
      startApply: async (appId) => {
        const applyDeps = buildApplyDeps({ sendMessage: send, model: settings.llm.model });
        await applyToJobWith({ db, appId, settings, profile, deps: applyDeps });
      },
```

- [ ] **Step 3: Typecheck + run all tests**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all tests pass (no new test for `applyDeps.ts` — exercised manually against a real LinkedIn job).

- [ ] **Step 4: Commit**

```bash
git add worker/applyDeps.ts worker/index.ts
git commit -m "feat: wire claude-agent-sdk apply deps (pause-at-submit)"
```

---

## Done criteria for Plan 4

- `npm run typecheck && npx vitest run` green (≈48 tests).
- Submit handler is no longer a stub: tapping Submit on Telegram calls `applyToJobWith`, which checks cap → opens job → detects challenges → drives Claude Agent SDK over a small Playwright toolset → pauses before the literal "Submit application" click → escalates uncertain questions → on success transitions to `applied`.
- Manual verification (live LinkedIn) is the only confirmation that selectors work; the agent's logic is offline-tested via stubs.

## Self-Review notes

- Spec coverage: §5.6 (apply agent: drive Easy Apply, pause at submit, escalate on uncertainty), §8 (cap, pacing, challenge detection — no captcha solving). The `pacingDelay` helper is exposed but only the SDK callsite + page navigation use it; it's also available for callers that want extra spacing.
- Type consistency: `Settings`, `tracker.*`, and `Posting` reused. `ApplyDeps`'s `page: any` is intentional — `applyAgent.ts` doesn't depend on Playwright types so it stays unit-testable; `applyDeps.ts` re-types it as `Page`.
- Pause-at-submit safety: `runFillingAgent` reaches the review screen and calls `ready()`. `finalizeSubmit` is the only code that clicks "Submit application", and it runs only after the orchestrator confirms `ready === true`.
