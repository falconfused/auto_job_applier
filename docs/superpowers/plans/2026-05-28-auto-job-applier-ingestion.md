# Auto Job Applier — Ingestion Implementation Plan (Node/TypeScript)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch LinkedIn job postings matching the user's configured search filters by driving a persistent, logged-in Playwright Chrome session, parse the results into `Posting` objects, and persist new (deduped) jobs via the tracker.

**Architecture:** A persistent Playwright Chrome context (`browser_profile/`) that the user logs into once manually. A pure `buildSearchUrl()` turns each `SearchFilter` into a LinkedIn jobs-search URL. A pure `parseSearchHtml()` turns a results page's HTML into `Posting[]` (using `cheerio`). An `ingest()` orchestrator ties them together with dependency-injected `fetchHtml` + `parse` so its dedupe logic is testable offline. Everything that touches a real LinkedIn DOM is exercised against a **captured HTML fixture**, never live LinkedIn, in tests.

**Tech Stack:** adds `playwright` (browser automation) and `cheerio` (server-side HTML parsing) to the existing Node/TS + Vitest stack. Builds on Plan 1's `lib/types.ts` (`Posting`), `lib/config.ts` (`SearchFilter`/`Settings`), `lib/db.ts`, `lib/tracker.ts`.

This is Plan 2 of 5 for LinkedIn v1. It depends on Plan 1 (merged). Plans 3–5 (Telegram bot+scheduler, apply agent, dashboard) follow.

---

## ⚠️ Human-in-the-loop checkpoint (Task 4)

LinkedIn's job-search DOM cannot be parsed blind and requires authentication. **Task 4 is a manual step the user performs**: log into LinkedIn once in the Playwright-controlled browser (handling any 2FA), then run the capture script to save one real search-results page to `tests/fixtures/linkedin_search.html`. Task 5 (the parser) is implemented and tested **against that captured fixture** — its CSS selectors are confirmed by inspecting the real captured HTML, which is the legitimate, unavoidable reality of scraping (not a hand-wave). Tasks 1, 2, 6 are fully agent-buildable without the browser.

---

## File Structure

```
auto_job_applier/
  worker/
    session.ts        # launch/close persistent Playwright Chrome context; fetchHtml(url)
    login.ts          # one-time manual-login script (npm run login)
    capture.ts        # capture a search results page to a fixture (npm run capture -- <url>)
    searchUrl.ts      # buildSearchUrl(filter) -> LinkedIn jobs search URL (pure)
    parseSearch.ts    # parseSearchHtml(html) -> Posting[] (pure, cheerio)
    ingest.ts         # ingest({settings, db, fetchHtml?, parse?}) -> Posting[] (new jobs)
  tests/
    fixtures/
      linkedin_search.html   # CAPTURED in Task 4 (gitignored — may contain account-specific data)
    searchUrl.test.ts
    parseSearch.test.ts
    ingest.test.ts
```

Add to `.gitignore`: `tests/fixtures/linkedin_search.html` (a real LinkedIn page tied to the user's session should not be committed).

---

## Task 1: Add Playwright + cheerio

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add dependencies**

Run:
```bash
cd /Users/apple/Desktop/Work/auto_job_applier
npm install playwright cheerio
npx playwright install chromium
```
Expected: installs without error; Chromium browser downloads.

- [ ] **Step 2: Add npm scripts to `package.json`**

In the `"scripts"` block, add:
```json
    "login": "tsx worker/login.ts",
    "capture": "tsx worker/capture.ts",
    "ingest": "tsx worker/ingest.ts"
```

- [ ] **Step 3: Gitignore the captured fixture**

Append to `.gitignore`:
```gitignore
tests/fixtures/linkedin_search.html
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors (no new source yet; scripts referenced don't need to exist for typecheck).
Run: `node -e "require('cheerio'); console.log('cheerio ok')"`
Expected: `cheerio ok`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add playwright + cheerio for ingestion"
```

---

## Task 2: Search-URL builder (pure, fully testable)

**Files:**
- Create: `worker/searchUrl.ts`
- Create: `tests/searchUrl.test.ts`

- [ ] **Step 1: Write the failing test `tests/searchUrl.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { buildSearchUrl } from "../worker/searchUrl.js";

describe("buildSearchUrl", () => {
  it("encodes keywords and location", () => {
    const url = new URL(buildSearchUrl({ keywords: "Backend Engineer", location: "Bangalore", experienceLevel: "", datePosted: "" }));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/jobs/search/");
    expect(url.searchParams.get("keywords")).toBe("Backend Engineer");
    expect(url.searchParams.get("location")).toBe("Bangalore");
  });

  it("adds f_AL=true when easyApplyOnly is set", () => {
    const url = new URL(buildSearchUrl({ keywords: "x", location: "", experienceLevel: "", datePosted: "" }, { easyApplyOnly: true }));
    expect(url.searchParams.get("f_AL")).toBe("true");
  });

  it("maps datePosted past-24h to f_TPR=r86400", () => {
    const url = new URL(buildSearchUrl({ keywords: "x", location: "", experienceLevel: "", datePosted: "past-24h" }));
    expect(url.searchParams.get("f_TPR")).toBe("r86400");
  });

  it("maps experienceLevel mid-senior to f_E=4", () => {
    const url = new URL(buildSearchUrl({ keywords: "x", location: "", experienceLevel: "mid-senior", datePosted: "" }));
    expect(url.searchParams.get("f_E")).toBe("4");
  });

  it("omits optional params when not provided", () => {
    const url = new URL(buildSearchUrl({ keywords: "x", location: "", experienceLevel: "", datePosted: "" }));
    expect(url.searchParams.has("f_TPR")).toBe(false);
    expect(url.searchParams.has("f_E")).toBe(false);
    expect(url.searchParams.has("f_AL")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/searchUrl.test.ts`
Expected: FAIL — `../worker/searchUrl.js` missing.

- [ ] **Step 3: Write `worker/searchUrl.ts`**

```typescript
interface FilterLike {
  keywords: string;
  location: string;
  experienceLevel: string;
  datePosted: string;
}

const DATE_POSTED: Record<string, string> = {
  "past-24h": "r86400",
  "past-week": "r604800",
  "past-month": "r2592000",
};

const EXPERIENCE: Record<string, string> = {
  internship: "1",
  entry: "2",
  associate: "3",
  "mid-senior": "4",
  director: "5",
  executive: "6",
};

/** Build a LinkedIn jobs-search URL from a search filter. */
export function buildSearchUrl(filter: FilterLike, opts: { easyApplyOnly?: boolean } = {}): string {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", filter.keywords);
  if (filter.location) url.searchParams.set("location", filter.location);
  const tpr = DATE_POSTED[filter.datePosted];
  if (tpr) url.searchParams.set("f_TPR", tpr);
  const exp = EXPERIENCE[filter.experienceLevel];
  if (exp) url.searchParams.set("f_E", exp);
  if (opts.easyApplyOnly) url.searchParams.set("f_AL", "true");
  return url.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/searchUrl.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/searchUrl.ts tests/searchUrl.test.ts
git commit -m "feat: linkedin jobs search-url builder"
```

---

## Task 3: Persistent session launcher + login script

**Files:**
- Create: `worker/session.ts`
- Create: `worker/login.ts`

No automated test (drives a real browser); verified manually in Task 4.

- [ ] **Step 1: Write `worker/session.ts`**

```typescript
import { chromium, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { ROOT } from "../lib/paths.js";

const PROFILE_DIR = join(ROOT, "browser_profile");

/** Launch the persistent, logged-in Chrome context. Headed by default so LinkedIn sees a real browser. */
export async function launchSession(opts: { headless?: boolean } = {}): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: opts.headless ?? false,
    viewport: { width: 1280, height: 900 },
  });
}

/** Navigate to a URL in the persistent session and return the page's HTML. Caller closes the context. */
export async function fetchHtml(context: BrowserContext, url: string, waitSelector?: string): Promise<string> {
  const page: Page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(1500 + Math.random() * 1500); // human-like settle
    return await page.content();
  } finally {
    await page.close();
  }
}
```

- [ ] **Step 2: Write `worker/login.ts`**

```typescript
import { launchSession } from "./session.js";

/**
 * One-time manual login. Opens LinkedIn; you log in by hand (including 2FA).
 * Press Enter in the terminal once you see your feed/home, and the session is saved
 * to browser_profile/ for reuse by ingest/apply.
 */
async function main() {
  const context = await launchSession({ headless: false });
  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });
  console.log("\n>>> Log into LinkedIn in the opened browser window (handle any 2FA).");
  console.log(">>> When you can see your LinkedIn home feed, press Enter here to save the session.\n");
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
  await context.close();
  console.log("Session saved to browser_profile/. You can close this.");
  process.exit(0);
}

main();
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add worker/session.ts worker/login.ts
git commit -m "feat: persistent playwright session + manual login script"
```

---

## Task 4: Capture a real search-results fixture (MANUAL — user runs this)

**Files:**
- Create: `worker/capture.ts`
- Produces: `tests/fixtures/linkedin_search.html` (gitignored)

- [ ] **Step 1: Write `worker/capture.ts`**

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchSession, fetchHtml } from "./session.js";
import { ROOT } from "../lib/paths.js";

/**
 * Capture a LinkedIn jobs search-results page to a fixture for parser development.
 * Usage: npm run capture -- "https://www.linkedin.com/jobs/search/?keywords=..."
 * Requires a prior `npm run login`.
 */
async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npm run capture -- "<linkedin jobs search url>"');
    process.exit(1);
  }
  const context = await launchSession({ headless: false });
  const html = await fetchHtml(context, url, "body");
  await context.close();
  const out = join(ROOT, "tests", "fixtures", "linkedin_search.html");
  mkdirSync(join(ROOT, "tests", "fixtures"), { recursive: true });
  writeFileSync(out, html, "utf8");
  console.log(`Saved ${html.length} bytes to ${out}`);
  process.exit(0);
}

main();
```

- [ ] **Step 2: Commit the capture script (not the fixture)**

```bash
git add worker/capture.ts
git commit -m "feat: search-results capture script"
```

- [ ] **Step 3: USER runs login + capture**

```bash
npm run login
# (log in by hand, press Enter)
npm run capture -- "https://www.linkedin.com/jobs/search/?keywords=Software%20Development%20Engineer&location=India&f_AL=true"
```
Expected: `tests/fixtures/linkedin_search.html` exists and is large (tens to hundreds of KB). Confirm it contains job cards (search the file for the job titles you saw in the browser).

---

## Task 5: Parser (TDD against the captured fixture)

**Files:**
- Create: `worker/parseSearch.ts`
- Create: `tests/parseSearch.test.ts`

> **Scraping reality:** the exact CSS selectors depend on the structure of the page captured in Task 4. The implementation below targets LinkedIn's common job-card markup (`data-job-id` / `job-card-container` on the logged-in results list, with `base-card` / `data-entity-urn` as the guest-page fallback). **Open `tests/fixtures/linkedin_search.html`, confirm which structure was captured, and adjust the selector constants at the top of `parseSearch.ts` so the test passes.** This inspect-then-confirm step is intrinsic to the task, not a placeholder.

- [ ] **Step 1: Write the test `tests/parseSearch.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseSearchHtml } from "../worker/parseSearch.js";

const FIXTURE = join(__dirname, "fixtures", "linkedin_search.html");

describe("parseSearchHtml", () => {
  it.skipIf(!existsSync(FIXTURE))("extracts postings with required fields from the captured page", () => {
    const html = readFileSync(FIXTURE, "utf8");
    const postings = parseSearchHtml(html);
    expect(postings.length).toBeGreaterThan(0);
    for (const p of postings) {
      expect(p.linkedinJobId).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.company).toBeTruthy();
      expect(p.url).toMatch(/^https?:\/\//);
      expect(["easy_apply", "external"]).toContain(p.applyType);
    }
    // job ids must be unique within one page
    const ids = postings.map((p) => p.linkedinJobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns [] for HTML with no job cards", () => {
    expect(parseSearchHtml("<html><body>no jobs here</body></html>")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to confirm the no-cards case fails (module missing)**

Run: `npx vitest run tests/parseSearch.test.ts`
Expected: FAIL — `../worker/parseSearch.js` missing. (The fixture test will SKIP if the fixture wasn't captured.)

- [ ] **Step 3: Write `worker/parseSearch.ts`**

```typescript
import * as cheerio from "cheerio";
import type { Posting, ApplyType } from "../lib/types.js";

// Selectors — CONFIRM against tests/fixtures/linkedin_search.html (see note above).
const CARD = "div.job-card-container, li.jobs-search-results__list-item, div.base-card";
const TITLE = ".job-card-list__title, .base-search-card__title, a.job-card-container__link";
const COMPANY = ".job-card-container__primary-description, .base-search-card__subtitle, .artdeco-entity-lockup__subtitle";
const LOCATION = ".job-card-container__metadata-item, .job-search-card__location";
const LINK = "a.job-card-container__link, a.base-card__full-link";
const EASY_APPLY_HINT = "Easy Apply";

function text($el: cheerio.Cheerio<any>): string {
  return $el.first().text().replace(/\s+/g, " ").trim();
}

/** Extract the numeric LinkedIn job id from a card element's attributes. */
function jobIdOf($: cheerio.CheerioAPI, el: any): string {
  const $el = $(el);
  const direct = $el.attr("data-job-id") || $el.find("[data-job-id]").first().attr("data-job-id");
  if (direct) return direct.trim();
  const urn = $el.attr("data-entity-urn") || $el.find("[data-entity-urn]").first().attr("data-entity-urn");
  const m = urn?.match(/(\d{6,})/);
  if (m) return m[1];
  const href = $el.find(LINK).first().attr("href") || "";
  const hm = href.match(/\/jobs\/view\/(\d+)/) || href.match(/currentJobId=(\d+)/);
  return hm ? hm[1] : "";
}

export function parseSearchHtml(html: string): Posting[] {
  const $ = cheerio.load(html);
  const out: Posting[] = [];
  const seen = new Set<string>();

  $(CARD).each((_, el) => {
    const $el = $(el);
    const linkedinJobId = jobIdOf($, el);
    if (!linkedinJobId || seen.has(linkedinJobId)) return;

    const title = text($el.find(TITLE));
    const company = text($el.find(COMPANY));
    const location = text($el.find(LOCATION));
    let url = $el.find(LINK).first().attr("href") || "";
    if (url.startsWith("/")) url = "https://www.linkedin.com" + url;
    if (!url) url = `https://www.linkedin.com/jobs/view/${linkedinJobId}`;

    const applyType: ApplyType = $el.text().includes(EASY_APPLY_HINT) ? "easy_apply" : "external";

    if (!title || !company) return; // skip malformed cards
    seen.add(linkedinJobId);
    out.push({ linkedinJobId, title, company, location, url, applyType, jdText: "" });
  });

  return out;
}
```

- [ ] **Step 4: Run the test, inspect the fixture, adjust selectors until green**

Run: `npx vitest run tests/parseSearch.test.ts`
Expected: the no-cards test PASSES immediately. The fixture test PASSES once the selector constants match the captured HTML — open `tests/fixtures/linkedin_search.html`, find the repeating job-card element and its title/company/link nodes, and edit the `CARD`/`TITLE`/`COMPANY`/`LOCATION`/`LINK` constants accordingly. Iterate until the fixture test is green (or skipped if no fixture).

- [ ] **Step 5: Commit**

```bash
git add worker/parseSearch.ts tests/parseSearch.test.ts
git commit -m "feat: parse linkedin search results into postings"
```

---

## Task 6: Ingest orchestrator

**Files:**
- Create: `worker/ingest.ts`
- Create: `tests/ingest.test.ts`

- [ ] **Step 1: Write the failing test `tests/ingest.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { ingestWith } from "../worker/ingest.js";
import type { Posting } from "../lib/types.js";

function posting(id: string): Posting {
  return { linkedinJobId: id, title: `T${id}`, company: "Acme", location: "Remote", url: `https://x/${id}`, applyType: "easy_apply", jdText: "" };
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

const filters = [{ keywords: "SDE", location: "India", experienceLevel: "", datePosted: "" }];

describe("ingestWith", () => {
  it("adds new postings and returns only the new ones", async () => {
    const fetchHtml = async () => "<html></html>";
    const parse = () => [posting("1"), posting("2")];
    const result = await ingestWith({ db, filters, easyApplyOnly: true, fetchHtml, parse });
    expect(result.map((p) => p.linkedinJobId).sort()).toEqual(["1", "2"]);
    expect(tracker.getJobByLinkedinId(db, "1")).toBeTruthy();
  });

  it("dedupes postings already in the db across runs", async () => {
    const fetchHtml = async () => "<html></html>";
    const parse = () => [posting("1"), posting("2")];
    await ingestWith({ db, filters, easyApplyOnly: true, fetchHtml, parse });
    const second = await ingestWith({ db, filters, easyApplyOnly: true, fetchHtml, parse: () => [posting("2"), posting("3")] });
    expect(second.map((p) => p.linkedinJobId)).toEqual(["3"]); // 2 already seen
  });

  it("dedupes within a single run across multiple filters", async () => {
    const twoFilters = [filters[0], { keywords: "Backend", location: "India", experienceLevel: "", datePosted: "" }];
    const fetchHtml = async () => "<html></html>";
    const parse = () => [posting("1")];
    const result = await ingestWith({ db, filters: twoFilters, easyApplyOnly: true, fetchHtml, parse });
    expect(result.map((p) => p.linkedinJobId)).toEqual(["1"]); // same id from both filters -> once
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingest.test.ts`
Expected: FAIL — `../worker/ingest.js` missing.

- [ ] **Step 3: Write `worker/ingest.ts`**

```typescript
import type { DB } from "../lib/db.js";
import type { Posting } from "../lib/types.js";
import * as tracker from "../lib/tracker.js";
import { buildSearchUrl } from "./searchUrl.js";
import { parseSearchHtml } from "./parseSearch.js";
import { launchSession, fetchHtml as realFetchHtml } from "./session.js";

interface FilterLike {
  keywords: string;
  location: string;
  experienceLevel: string;
  datePosted: string;
}

interface IngestArgs {
  db: DB;
  filters: FilterLike[];
  easyApplyOnly: boolean;
  fetchHtml: (url: string) => Promise<string>;
  parse?: (html: string) => Posting[];
}

/** Testable core: fetch+parse each filter, dedupe (in-run and against db), persist new jobs. */
export async function ingestWith(args: IngestArgs): Promise<Posting[]> {
  const parse = args.parse ?? parseSearchHtml;
  const newPostings: Posting[] = [];
  const seenThisRun = new Set<string>();

  for (const filter of args.filters) {
    const url = buildSearchUrl(filter, { easyApplyOnly: args.easyApplyOnly });
    const html = await args.fetchHtml(url);
    for (const p of parse(html)) {
      if (seenThisRun.has(p.linkedinJobId)) continue;
      seenThisRun.add(p.linkedinJobId);
      if (tracker.getJobByLinkedinId(args.db, p.linkedinJobId)) continue; // already known
      tracker.addJob(args.db, p);
      newPostings.push(p);
    }
  }
  return newPostings;
}

/** Production entry: open a real persistent session and run ingestWith against live LinkedIn. */
export async function ingest(db: DB, filters: FilterLike[], easyApplyOnly: boolean): Promise<Posting[]> {
  const context = await launchSession();
  try {
    const fetchHtml = (url: string) => realFetchHtml(context, url, "body");
    return await ingestWith({ db, filters, easyApplyOnly, fetchHtml });
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite + typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all tests pass (the captured-fixture parser test passes if a fixture exists, else skips).

- [ ] **Step 6: Commit**

```bash
git add worker/ingest.ts tests/ingest.test.ts
git commit -m "feat: ingest orchestrator with dedupe"
```

---

## Done criteria for Plan 2

- `npm run typecheck && npx vitest run` green.
- `buildSearchUrl`, `parseSearchHtml`, and `ingestWith` are unit-tested; the parser is verified against a real captured LinkedIn page (or skipped where no fixture exists).
- `npm run login` establishes a reusable session; `ingest(db, filters, easyApplyOnly)` returns deduped new postings from live LinkedIn.
- Next: **Plan 3 — Telegram bot & orchestration** consumes `ingest()` output + Plan 1's `rank`/`tailor`/`tracker` to build the 8 PM digest and approval gates.

---

## Self-Review notes

- **Spec coverage:** implements spec §5.1 (ingest: drive logged-in LinkedIn, scrape search results, dedupe by `linkedin_job_id`) and §8's "ingest only reads search pages" + human-like settle delay. Easy-Apply-vs-external detection (§4 apply_type) is in `parseSearch.ts`. JD text is intentionally left empty at ingest (spec §6: "jd_text fetched at apply time, not ingest").
- **Placeholders:** none of the forbidden kind. The parser-selector "confirm against fixture" step is the inherent inspect-then-implement reality of scraping a DOM that can't be known in advance; concrete starting code is provided, not a stub.
- **Type consistency:** `Posting` fields (`linkedinJobId`, `title`, `company`, `location`, `url`, `applyType`, `jdText`) match Plan 1's `lib/types.ts` exactly. `tracker.getJobByLinkedinId`/`addJob` signatures `(db, ...)` match Plan 1. `FilterLike` mirrors `config.ts`'s `SearchFilter` shape (the four string fields used here). `ingestWith` vs production `ingest` are distinct names; tests target `ingestWith` (the injectable core), avoiding any live browser in tests.
