/**
 * Generate a styled HTML dashboard from data/applier.db and open it in your browser.
 * No Next.js / shadcn scaffold required — uses Tailwind via CDN.
 *
 * Usage: npm run dashboard
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { DB_PATH, ROOT } from "../lib/paths.js";

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Run \`npm run e2e\` first to populate it.`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

interface Row { [k: string]: any }
const runs = db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 10").all() as Row[];
const apps = db.prepare(
  `SELECT applications.id, applications.status, applications.resume_path, applications.cover_letter_path,
          applications.applied_at, applications.updated_at, applications.error,
          jobs.title, jobs.company, jobs.location, jobs.url, jobs.apply_type, jobs.linkedin_job_id
   FROM applications JOIN jobs ON jobs.id = applications.job_id
   ORDER BY applications.updated_at DESC`,
).all() as Row[];
const lastRunDate = (db.prepare("SELECT MAX(run_date) AS d FROM suggestions").get() as Row | undefined)?.d as string | undefined;
const suggestions = lastRunDate
  ? (db.prepare(
      `SELECT suggestions.rank, suggestions.fit_score, suggestions.fit_reason,
              jobs.title, jobs.company, jobs.location, jobs.url, jobs.apply_type
       FROM suggestions JOIN jobs ON jobs.id = suggestions.job_id
       WHERE suggestions.run_date = ? ORDER BY suggestions.rank ASC LIMIT 25`,
    ).all(lastRunDate) as Row[])
  : [];
const jobCount = (db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as Row).n as number;
const appCount = (db.prepare("SELECT COUNT(*) AS n FROM applications").get() as Row).n as number;
const statusBreakdown = db
  .prepare("SELECT status, COUNT(*) AS n FROM applications GROUP BY status")
  .all() as Row[];

db.close();

const STATUS_COLOR: Record<string, string> = {
  suggested: "bg-slate-200 text-slate-700",
  dismissed: "bg-zinc-200 text-zinc-700",
  external_sent: "bg-amber-100 text-amber-800",
  tailoring: "bg-sky-100 text-sky-800",
  awaiting_submit: "bg-violet-100 text-violet-800",
  cancelled: "bg-zinc-200 text-zinc-700",
  applied: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  easy_apply: "bg-emerald-100 text-emerald-800",
  external: "bg-amber-100 text-amber-800",
};

const esc = (s: any) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const cleanUrl = (u: string) => {
  const m = u?.match(/\/jobs\/view\/(\d+)/);
  return m ? `https://www.linkedin.com/jobs/view/${m[1]}` : u || "#";
};
const pill = (text: string, key?: string) =>
  `<span class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
    STATUS_COLOR[key ?? text] ?? "bg-slate-100 text-slate-700"
  }">${esc(text)}</span>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Auto Job Applier — Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<style> body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; } </style>
</head>
<body class="bg-slate-50 text-slate-900">
<div class="max-w-6xl mx-auto px-6 py-8 space-y-10">

  <header class="flex items-end justify-between">
    <div>
      <h1 class="text-3xl font-semibold tracking-tight">Auto Job Applier</h1>
      <p class="text-slate-500 mt-1">Local read-only tracker · generated ${esc(new Date().toLocaleString())}</p>
    </div>
    <div class="text-right text-sm text-slate-500">
      <div><span class="font-mono text-slate-700">${jobCount}</span> jobs seen</div>
      <div><span class="font-mono text-slate-700">${appCount}</span> applications</div>
    </div>
  </header>

  <section>
    <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Application status</h2>
    <div class="flex flex-wrap gap-2">
      ${statusBreakdown.length
        ? statusBreakdown.map((s) => pill(`${s.status}: ${s.n}`, s.status)).join(" ")
        : `<span class="text-slate-400 text-sm">none yet</span>`}
    </div>
  </section>

  <section>
    <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Recent runs</h2>
    <div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-slate-600">
          <tr><th class="text-left px-4 py-2">When</th><th class="text-left px-4 py-2">Searched</th><th class="text-left px-4 py-2">Found new</th><th class="text-left px-4 py-2">Suggested</th><th class="text-left px-4 py-2">Status</th></tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${runs.length
            ? runs.map((r) => `
              <tr>
                <td class="px-4 py-2 font-mono text-xs text-slate-600">${esc(r.date)}</td>
                <td class="px-4 py-2">${esc(r.searched)}</td>
                <td class="px-4 py-2">${esc(r.found_new)}</td>
                <td class="px-4 py-2">${esc(r.suggested)}</td>
                <td class="px-4 py-2">${pill(r.status, r.status)}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="5" class="px-4 py-6 text-center text-slate-400">no runs yet — run <code class="bg-slate-100 px-1 rounded">npm run e2e</code></td></tr>`}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Latest suggestions ${lastRunDate ? `<span class="text-slate-400 font-normal normal-case">(run ${esc(lastRunDate)})</span>` : ""}</h2>
    <div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-slate-600">
          <tr>
            <th class="text-left px-4 py-2 w-10">#</th>
            <th class="text-left px-4 py-2">Role</th>
            <th class="text-left px-4 py-2">Company</th>
            <th class="text-left px-4 py-2">Location</th>
            <th class="text-left px-4 py-2">Type</th>
            <th class="text-left px-4 py-2 w-16">Fit</th>
            <th class="text-left px-4 py-2">Reason</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${suggestions.length
            ? suggestions.map((s) => `
              <tr>
                <td class="px-4 py-2 font-mono text-xs text-slate-500">${esc(s.rank)}</td>
                <td class="px-4 py-2 font-medium"><a class="text-sky-700 hover:underline" target="_blank" href="${esc(cleanUrl(s.url))}">${esc(s.title)}</a></td>
                <td class="px-4 py-2">${esc(s.company)}</td>
                <td class="px-4 py-2 text-slate-600">${esc(s.location)}</td>
                <td class="px-4 py-2">${pill(s.apply_type, s.apply_type)}</td>
                <td class="px-4 py-2 font-mono">${esc(Math.round(Number(s.fit_score)))}</td>
                <td class="px-4 py-2 text-slate-600">${esc(s.fit_reason)}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="7" class="px-4 py-6 text-center text-slate-400">no suggestions yet</td></tr>`}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Applications</h2>
    <div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-slate-600">
          <tr>
            <th class="text-left px-4 py-2">Role</th>
            <th class="text-left px-4 py-2">Company</th>
            <th class="text-left px-4 py-2">Status</th>
            <th class="text-left px-4 py-2">Resume</th>
            <th class="text-left px-4 py-2">Cover letter</th>
            <th class="text-left px-4 py-2">Updated</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${apps.length
            ? apps.map((a) => `
              <tr>
                <td class="px-4 py-2 font-medium"><a class="text-sky-700 hover:underline" target="_blank" href="${esc(cleanUrl(a.url))}">${esc(a.title)}</a></td>
                <td class="px-4 py-2">${esc(a.company)}</td>
                <td class="px-4 py-2">${pill(a.status, a.status)}</td>
                <td class="px-4 py-2 text-xs">${a.resume_path ? `<a target="_blank" class="text-sky-700 hover:underline" href="file://${esc(a.resume_path)}">open</a>` : `<span class="text-slate-400">—</span>`}</td>
                <td class="px-4 py-2 text-xs">${a.cover_letter_path ? `<a target="_blank" class="text-sky-700 hover:underline" href="file://${esc(a.cover_letter_path)}">open</a>` : `<span class="text-slate-400">—</span>`}</td>
                <td class="px-4 py-2 font-mono text-xs text-slate-500">${esc(a.updated_at)}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">no applications yet</td></tr>`}
        </tbody>
      </table>
    </div>
  </section>

  <footer class="text-xs text-slate-400 pt-6 border-t border-slate-200">
    Read-only viewer over <code>${esc(DB_PATH)}</code>. Approvals + apply still happen on Telegram. Regenerate with <code>npm run dashboard</code>.
  </footer>
</div>
</body>
</html>`;

const outPath = join(ROOT, "data", "dashboard.html");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, "utf8");
console.log(`Wrote ${outPath}`);
const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
const r = spawnSync(opener, [outPath], { stdio: "ignore" });
if (r.status === 0) console.log("Opened in your default browser.");
else console.log(`Open it manually: file://${outPath}`);
