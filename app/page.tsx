import Link from "next/link";
import { openDb, migrate } from "@/lib/db";
import { DB_PATH, ensureDirs } from "@/lib/paths";
import { listApplications, type AppRow } from "@/lib/dashboard";
import { ApplyButton } from "@/components/ApplyButton";

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

export default function TrackerPage() {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);

  // Pull rows + most-recent suggestion data with one query
  const rows = db
    .prepare(
      `SELECT a.id, a.job_id, a.status, a.resume_path, a.cover_letter_path,
              a.applied_at, a.updated_at,
              j.title, j.company, j.location, j.url, j.apply_type, j.linkedin_job_id,
              s.fit_score, s.fit_reason
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN suggestions s
           ON s.job_id = j.id
          AND s.id = (SELECT MAX(id) FROM suggestions WHERE job_id = j.id)
         ORDER BY COALESCE(s.fit_score, 0) DESC, a.updated_at DESC`,
    )
    .all() as Row[];

  // header counts
  const tailoredCount = rows.filter((r) => !!r.resume_path).length;
  const strongCount = rows.filter((r) => (r.fit_score ?? 0) >= 80).length;

  // back-fill listApplications usage for tree-shaking sanity
  void listApplications;

  return (
    <div>
      {/* page header — editorial masthead */}
      <header className="mb-14">
        <div className="mono-label">№ {String(rows.length).padStart(3, "0")} · suggested postings</div>
        <h1 className="mt-3 font-display text-[clamp(48px,7vw,96px)] font-medium leading-[0.92] tracking-[-0.02em]">
          The <em className="text-[var(--violet)]">Applications</em>
          <br />
          <span className="text-[var(--paper-2)]">Tracker.</span>
        </h1>

        <div className="mt-8 grid max-w-2xl grid-cols-3 gap-8 border-t border-[var(--line-soft)] pt-6">
          <div>
            <div className="mono-label">total</div>
            <div className="font-display text-4xl italic">{rows.length}</div>
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

      {/* roster */}
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
        <div className="border-t border-[var(--line-soft)]">
          {rows.map((r, i) => {
            const fit = fitBand(r.fit_score);
            const tailored = !!r.resume_path;
            return (
              <article
                key={r.id}
                className="reveal group grid grid-cols-[1fr_auto_140px] items-center gap-8 border-b border-[var(--line-soft)] py-7 transition-colors hover:bg-[var(--ink-1)]"
                style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
              >
                {/* left: title + company */}
                <div className="min-w-0 pl-2">
                  <div className="mono-label mb-1.5 flex items-center gap-3">
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[var(--paper-4)]">·</span>
                    <span>{r.apply_type === "easy_apply" ? "easy apply" : "external"}</span>
                    {tailored && (
                      <>
                        <span className="text-[var(--paper-4)]">·</span>
                        <span className="text-[var(--violet)]">tailored</span>
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
                  </div>
                  {r.fit_reason && (
                    <p className="mt-3 max-w-2xl text-[13px] italic leading-relaxed text-[var(--paper-3)]">
                      “{r.fit_reason}”
                    </p>
                  )}
                </div>

                {/* middle: fit score (big serif) */}
                <div className="text-right">
                  <div
                    className="fit-num text-[88px]"
                    style={{ color: fit.tone }}
                  >
                    {r.fit_score != null ? Math.round(r.fit_score) : "—"}
                  </div>
                  <div className="mono-label" style={{ color: fit.tone }}>
                    {fit.word}
                  </div>
                </div>

                {/* right: action */}
                <div className="flex flex-col items-end gap-2">
                  <ApplyButton appId={r.id} alreadyTailored={tailored} size="sm" />
                  <div className="font-mono text-[10px] text-[var(--paper-4)]">
                    #{r.linkedin_job_id.slice(0, 8)}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
