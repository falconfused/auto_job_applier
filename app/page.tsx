import Link from "next/link";
import { openDb, migrate } from "@/lib/db";
import { DB_PATH, ensureDirs } from "@/lib/paths";
import { type AppRow } from "@/lib/dashboard";
import { ApplyButton } from "@/components/ApplyButton";
import { StatusActions } from "@/components/StatusActions";
import { DownloadButtons } from "@/components/DownloadButtons";

export const dynamic = "force-dynamic";

interface Row extends AppRow {
  fit_score: number | null;
  fit_reason: string | null;
}

function fitBand(score: number | null): { word: string; tone: string } {
  if (score == null) return { word: "—", tone: "var(--paper-4)" };
  if (score >= 80) return { word: "strong", tone: "var(--violet)" };
  if (score >= 65) return { word: "good", tone: "var(--amber)" };
  if (score >= 50) return { word: "weak", tone: "var(--paper-3)" };
  return { word: "skip", tone: "var(--paper-4)" };
}

const ACTIVE_STATUSES = new Set(["suggested", "tailoring", "awaiting_submit", "external_sent", "failed"]);

export default function TrackerPage() {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);

  const rows = db
    .prepare(
      `SELECT a.id, a.job_id, a.status, a.resume_path, a.cover_letter_path,
              a.applied_at, a.updated_at,
              j.title, j.company, j.location, j.url, j.apply_type,
              j.source, j.source_job_id, j.salary, j.stipend,
              s.fit_score, s.fit_reason
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN suggestions s
           ON s.job_id = j.id
          AND s.id = (SELECT MAX(id) FROM suggestions WHERE job_id = j.id)
         ORDER BY COALESCE(s.fit_score, 0) DESC, a.updated_at DESC`,
    )
    .all() as Row[];

  const active = rows.filter((r) => ACTIVE_STATUSES.has(r.status));
  const applied = rows.filter((r) => r.status === "applied");
  const dismissed = rows.filter((r) => r.status === "dismissed" || r.status === "cancelled");

  const tailoredCount = active.filter((r) => !!r.resume_path).length;
  const strongCount = active.filter((r) => (r.fit_score ?? 0) >= 80).length;

  return (
    <div>
      <header className="mb-14">
        <div className="mono-label">
          № {String(active.length).padStart(3, "0")} · suggested postings
        </div>
        <h1 className="mt-3 font-display text-[clamp(48px,7vw,96px)] font-medium leading-[0.92] tracking-[-0.02em]">
          The <em className="text-[var(--violet)]">Applications</em>
          <br />
          <span className="text-[var(--paper-2)]">Tracker.</span>
        </h1>

        <div className="mt-8 grid max-w-3xl grid-cols-4 gap-8 border-t border-[var(--line-soft)] pt-6">
          <div>
            <div className="mono-label">active</div>
            <div className="font-display text-4xl italic">{active.length}</div>
          </div>
          <div>
            <div className="mono-label">applied</div>
            <div className="font-display text-4xl italic text-[var(--jade)]">{applied.length}</div>
          </div>
          <div>
            <div className="mono-label">tailored</div>
            <div className="font-display text-4xl italic text-[var(--violet)]">
              {tailoredCount}
            </div>
          </div>
          <div>
            <div className="mono-label">strong fit</div>
            <div className="font-display text-4xl italic text-[var(--amber)]">{strongCount}</div>
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line)] p-12 text-center">
          <div className="mono-label mb-2">empty</div>
          <p className="font-display text-2xl italic text-[var(--paper-2)]">
            Nothing's been ingested yet.
          </p>
          <p className="mt-2 font-mono text-xs text-[var(--paper-3)]">
            run <span className="text-[var(--paper)]">npm run pipeline:once</span>
          </p>
        </div>
      ) : (
        <>
          {/* ACTIVE */}
          {active.length > 0 && (
            <section>
              <SectionHeader label="To act on" count={active.length} />
              <div className="border-t border-[var(--line-soft)]">
                {active.map((r, i) => (
                  <ActiveRow key={r.id} r={r} i={i} />
                ))}
              </div>
            </section>
          )}

          {/* APPLIED */}
          {applied.length > 0 && (
            <section className="mt-20">
              <SectionHeader label="Applied" count={applied.length} tone="var(--jade)" />
              <div className="border-t border-[var(--line-soft)]">
                {applied.map((r, i) => (
                  <CompactRow key={r.id} r={r} i={i} />
                ))}
              </div>
            </section>
          )}

          {/* DISMISSED */}
          {dismissed.length > 0 && (
            <section className="mt-20">
              <details className="group">
                <summary className="flex cursor-pointer items-baseline justify-between border-b border-[var(--line-soft)] py-3 list-none">
                  <span className="mono-label">
                    Dismissed · {dismissed.length}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--paper-4)] group-open:hidden">
                    expand ↓
                  </span>
                  <span className="hidden font-mono text-[10px] text-[var(--paper-4)] group-open:inline">
                    collapse ↑
                  </span>
                </summary>
                <div>
                  {dismissed.map((r, i) => (
                    <CompactRow key={r.id} r={r} i={i} muted />
                  ))}
                </div>
              </details>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ label, count, tone }: { label: string; count: number; tone?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="font-display text-2xl italic" style={tone ? { color: tone } : undefined}>
        {label}
      </h2>
      <span className="mono-label">{count}</span>
    </div>
  );
}

function ActiveRow({ r, i }: { r: Row; i: number }) {
  const fit = fitBand(r.fit_score);
  const tailored = !!r.resume_path;
  return (
    <article
      className="reveal group grid grid-cols-[1fr_auto_220px] items-center gap-8 border-b border-[var(--line-soft)] py-7 transition-colors hover:bg-[var(--ink-1)]"
      style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
    >
      <div className="min-w-0 pl-2">
        <div className="mono-label mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{String(i + 1).padStart(2, "0")}</span>
          <span className="text-[var(--paper-4)]">·</span>
          <span>{r.source}</span>
          <span className="text-[var(--paper-4)]">·</span>
          <span>{r.apply_type === "easy_apply" ? "easy apply" : "external"}</span>
          {tailored && (
            <>
              <span className="text-[var(--paper-4)]">·</span>
              <span className="text-[var(--violet)]">tailored</span>
            </>
          )}
          {r.status === "failed" && (
            <>
              <span className="text-[var(--paper-4)]">·</span>
              <span className="text-[var(--rose)]">failed</span>
            </>
          )}
        </div>
        <Link
          href={`/applications/${r.id}`}
          className="link-grow font-display text-3xl leading-tight tracking-tight"
        >
          {r.title}
        </Link>
        <div className="mt-1 text-sm text-[var(--paper-2)]">
          <span className="text-[var(--paper)]">{r.company}</span>
          {r.location && (
            <>
              <span className="mx-2 text-[var(--paper-4)]">/</span>
              <span>{r.location}</span>
            </>
          )}
          {(r.salary || r.stipend) && (
            <>
              <span className="mx-2 text-[var(--paper-4)]">·</span>
              <span className="font-mono text-[12px] text-[var(--amber)]">
                {r.salary || r.stipend}
              </span>
            </>
          )}
        </div>
        {r.fit_reason && (
          <p className="mt-3 max-w-2xl text-[13px] italic leading-relaxed text-[var(--paper-3)]">
            “{r.fit_reason}”
          </p>
        )}
      </div>

      <div className="text-right">
        <div className="fit-num text-[88px]" style={{ color: fit.tone }}>
          {r.fit_score != null ? Math.round(r.fit_score) : "—"}
        </div>
        <div className="mono-label" style={{ color: fit.tone }}>
          {fit.word}
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <ApplyButton appId={r.id} alreadyTailored={tailored} size="sm" />
        {tailored && r.resume_path && r.cover_letter_path && (
          <DownloadButtons
            appId={r.id}
            resumePath={r.resume_path}
            coverLetterPath={r.cover_letter_path}
            size="sm"
          />
        )}
        <StatusActions appId={r.id} status={r.status} size="sm" />
        <div className="font-mono text-[10px] text-[var(--paper-4)]">
          {r.source} · #{r.source_job_id.slice(0, 8)}
        </div>
      </div>
    </article>
  );
}

function CompactRow({ r, i, muted = false }: { r: Row; i: number; muted?: boolean }) {
  const opacity = muted ? "opacity-55" : "opacity-90";
  return (
    <article
      className={`group grid grid-cols-[40px_1fr_auto_180px] items-center gap-6 border-b border-[var(--line-soft)] py-3 transition-colors hover:bg-[var(--ink-1)] ${opacity}`}
    >
      <div className="font-mono text-[10px] text-[var(--paper-4)]">
        {String(i + 1).padStart(2, "0")}
      </div>
      <div className="min-w-0">
        <Link href={`/applications/${r.id}`} className="block truncate">
          <span className="font-display text-lg italic">{r.title}</span>
          <span className="ml-3 text-sm text-[var(--paper-3)]">{r.company}</span>
        </Link>
      </div>
      <div className="text-right font-mono text-[10px] text-[var(--paper-3)]">
        {r.applied_at ? `applied ${new Date(r.applied_at).toLocaleDateString("en-IN")}` : r.status}
      </div>
      <div className="flex justify-end">
        <StatusActions appId={r.id} status={r.status} size="sm" />
      </div>
    </article>
  );
}
