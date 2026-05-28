# Auto Job Applier — Read-only Dashboard Implementation Plan (Next.js + shadcn)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A read-only Next.js (App Router) + Tailwind + shadcn dashboard that visualizes the SQLite tracker — applications with status + job + paths, plus daily run history. Same package, same DB; the dashboard never writes.

**Architecture:** Next.js App Router project added to the existing package root (`app/`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `app/globals.css`). Server components query `lib/dashboard.ts` (a pure thin reader) which selects from the same `data/applier.db` the worker writes to. shadcn primitives are vendored under `components/ui/`. No client-side state management; the page just re-renders on navigation.

**Tech Stack:** adds `next`, `react`, `react-dom`, `tailwindcss`, `postcss`, `autoprefixer`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. Builds on Plans 1–4.

This is Plan 5 of 5. Final plan for LinkedIn v1.

---

## File Structure

```
auto_job_applier/
  app/
    layout.tsx
    globals.css
    page.tsx                # Tracker — applications table
    runs/page.tsx           # Run history
  components/
    ui/
      table.tsx             # shadcn-style table primitives
      badge.tsx             # status badges
      card.tsx
  lib/
    dashboard.ts            # read-only selectors: listApplications(), listRuns()
    cn.ts                   # tailwind-merge helper
  next.config.mjs
  tailwind.config.ts
  postcss.config.mjs
  components.json
  tests/
    dashboard.test.ts
```

---

## Task 1: Add Next.js + Tailwind + shadcn deps

**Files:**
- Modify: `package.json`
- Create: `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `app/globals.css`

- [ ] **Step 1: Install**

```bash
npm install next@latest react@latest react-dom@latest \
  tailwindcss postcss autoprefixer \
  class-variance-authority clsx tailwind-merge lucide-react
npm install -D @types/react @types/react-dom
```

- [ ] **Step 2: Add scripts**

```json
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
```

- [ ] **Step 3: Write `next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ["better-sqlite3"] },
};
export default nextConfig;
```

- [ ] **Step 4: Write `postcss.config.mjs`**

```javascript
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 5: Write `tailwind.config.ts`**

```typescript
import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

- [ ] **Step 6: Write `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
:root { color-scheme: dark light; }
body { @apply bg-zinc-950 text-zinc-100 antialiased; }
```

- [ ] **Step 7: Write `lib/cn.ts`**

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

- [ ] **Step 8: Update `tsconfig.json` to include `app/` and `components/`**

Add to `include`: `"app"`, `"components"`. Add `"jsx": "preserve"` to compilerOptions.

- [ ] **Step 9: Typecheck**

`npm run typecheck` — clean.

- [ ] **Step 10: Commit**

`git commit -m "chore: add nextjs + tailwind + shadcn deps"`

---

## Task 2: Read-only dashboard data layer + tests

**Files:**
- Create: `lib/dashboard.ts`
- Create: `tests/dashboard.test.ts`

- [ ] **Step 1: Write the failing test `tests/dashboard.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, migrate, type DB } from "../lib/db.js";
import * as tracker from "../lib/tracker.js";
import { listApplications, listRuns } from "../lib/dashboard.js";
import type { Posting } from "../lib/types.js";

const sample: Posting = {
  linkedinJobId: "1", title: "Backend Engineer", company: "Acme", location: "Bangalore",
  url: "https://linkedin.com/jobs/view/1", applyType: "easy_apply", jdText: "",
};

let db: DB;
beforeEach(() => { db = openDb(":memory:"); migrate(db); });

describe("listApplications", () => {
  it("joins job + application fields", () => {
    const jobId = tracker.addJob(db, sample);
    const appId = tracker.createApplication(db, jobId);
    tracker.setStatus(db, appId, "applied");
    const rows = listApplications(db);
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Backend Engineer");
    expect(rows[0].status).toBe("applied");
    expect(rows[0].apply_type).toBe("easy_apply");
  });

  it("returns newest first", async () => {
    const a = tracker.addJob(db, sample);
    await new Promise((r) => setTimeout(r, 5));
    const b = tracker.addJob(db, { ...sample, linkedinJobId: "2", title: "Newer" });
    tracker.createApplication(db, a);
    tracker.createApplication(db, b);
    const rows = listApplications(db);
    expect(rows[0].title).toBe("Newer");
  });
});

describe("listRuns", () => {
  it("returns runs newest first", () => {
    tracker.recordRun(db, { searched: 1, foundNew: 2, suggested: 2, status: "ok" });
    tracker.recordRun(db, { searched: 1, foundNew: 0, suggested: 0, status: "failed", error: "boom" });
    const rows = listRuns(db);
    expect(rows.length).toBe(2);
    expect(rows[0].status).toBe("failed");
  });
});
```

- [ ] **Step 2: Write `lib/dashboard.ts`**

```typescript
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
  linkedin_job_id: string;
}

export function listApplications(db: DB): AppRow[] {
  return db
    .prepare(
      `SELECT a.id, a.job_id, a.status, a.resume_path, a.cover_letter_path,
              a.applied_at, a.updated_at,
              j.title, j.company, j.location, j.url, j.apply_type, j.linkedin_job_id
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
```

- [ ] **Step 3: Run test**

`npx vitest run tests/dashboard.test.ts` — 3 tests PASS.

- [ ] **Step 4: Commit**

`git commit -m "feat: read-only dashboard data layer"`

---

## Task 3: shadcn-style UI primitives

**Files:**
- Create: `components/ui/table.tsx`, `components/ui/badge.tsx`, `components/ui/card.tsx`

- [ ] **Step 1: Write `components/ui/table.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { type HTMLAttributes } from "react";

export const Table = ({ className, ...p }: HTMLAttributes<HTMLTableElement>) => (
  <table className={cn("w-full caption-bottom text-sm", className)} {...p} />
);
export const THead = ({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn("border-b border-zinc-800 text-zinc-400", className)} {...p} />
);
export const TBody = ({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn("divide-y divide-zinc-800", className)} {...p} />
);
export const Tr = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("hover:bg-zinc-900", className)} {...p} />
);
export const Th = ({ className, ...p }: HTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("px-3 py-2 text-left font-medium", className)} {...p} />
);
export const Td = ({ className, ...p }: HTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-2 align-top", className)} {...p} />
);
```

- [ ] **Step 2: Write `components/ui/badge.tsx`**

```tsx
import { cn } from "@/lib/cn";

const STATUS_COLOR: Record<string, string> = {
  suggested: "bg-zinc-700 text-zinc-100",
  dismissed: "bg-zinc-800 text-zinc-400",
  external_sent: "bg-blue-900 text-blue-200",
  tailoring: "bg-amber-900 text-amber-200",
  awaiting_submit: "bg-purple-900 text-purple-200",
  cancelled: "bg-zinc-800 text-zinc-400",
  applied: "bg-green-900 text-green-200",
  failed: "bg-red-900 text-red-200",
  ok: "bg-green-900 text-green-200",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-medium", STATUS_COLOR[status] ?? "bg-zinc-800")}>
      {status}
    </span>
  );
}
```

- [ ] **Step 3: Write `components/ui/card.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { type HTMLAttributes } from "react";

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900 p-4", className)} {...p} />
);
```

- [ ] **Step 4: Typecheck**

`npm run typecheck` — clean.

- [ ] **Step 5: Commit**

`git commit -m "feat: shadcn-style table/badge/card primitives"`

---

## Task 4: App layout + tracker page

**Files:**
- Create: `app/layout.tsx`, `app/page.tsx`

- [ ] **Step 1: Write `app/layout.tsx`**

```tsx
import "./globals.css";
import Link from "next/link";

export const metadata = { title: "Auto Job Applier", description: "LinkedIn tracker" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-zinc-800 px-6 py-4">
          <div className="mx-auto flex max-w-6xl items-center gap-6">
            <h1 className="text-lg font-semibold">Auto Job Applier</h1>
            <nav className="flex gap-4 text-sm text-zinc-400">
              <Link href="/" className="hover:text-zinc-100">Tracker</Link>
              <Link href="/runs" className="hover:text-zinc-100">Runs</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Write `app/page.tsx`**

```tsx
import { openDb, migrate } from "@/lib/db";
import { DB_PATH, ensureDirs } from "@/lib/paths";
import { listApplications } from "@/lib/dashboard";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function TrackerPage() {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  const rows = listApplications(db);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Applications</h2>
          <span className="text-xs text-zinc-500">{rows.length} total</span>
        </div>
      </Card>
      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-400">No applications yet — run <code className="text-zinc-200">npm run worker</code> or <code className="text-zinc-200">npm run pipeline:once</code>.</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Job</Th>
                <Th>Company</Th>
                <Th>Location</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-zinc-100 hover:underline">{r.title}</a>
                  </Td>
                  <Td>{r.company}</Td>
                  <Td className="text-zinc-400">{r.location}</Td>
                  <Td><StatusBadge status={r.apply_type} /></Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td className="text-xs text-zinc-500">{new Date(r.updated_at).toLocaleString()}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

`git commit -m "feat: tracker dashboard page"`

---

## Task 5: Runs page

**Files:**
- Create: `app/runs/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { openDb, migrate } from "@/lib/db";
import { DB_PATH, ensureDirs } from "@/lib/paths";
import { listRuns } from "@/lib/dashboard";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  const rows = listRuns(db);

  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold">Daily runs</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">No runs yet.</p>
      ) : (
        <Table>
          <THead>
            <Tr><Th>Date</Th><Th>Searched</Th><Th>New</Th><Th>Suggested</Th><Th>Status</Th><Th>Error</Th></Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="text-xs">{new Date(r.date).toLocaleString()}</Td>
                <Td>{r.searched}</Td>
                <Td>{r.found_new}</Td>
                <Td>{r.suggested}</Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td className="text-xs text-red-300">{r.error ?? ""}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Verify**

`npm run typecheck && npx vitest run` — clean + green.

`npm run dev` — starts on http://localhost:3000 with both pages reachable. (Manual verification.)

- [ ] **Step 3: Commit**

`git commit -m "feat: runs dashboard page"`

---

## Done criteria for Plan 5

- `npm run typecheck && npx vitest run` green (≈53 tests).
- `npm run dev` serves a read-only tracker at `/` and `/runs`, both backed by the same SQLite the worker writes.
- The dashboard never writes; all approvals remain on Telegram.

## Self-Review notes

- Spec coverage: §2 read-only dashboard + no auth + no writes. §6 data model: tracker table joins jobs+applications; runs page shows the §6 `runs` rows. Tailwind/shadcn (§3 stack).
- Type consistency: `AppRow` matches the `applications` + `jobs` schema columns from `db.ts`. `RunRow` matches the `runs` schema. Pages call only `listApplications`/`listRuns` — no DB writes.
