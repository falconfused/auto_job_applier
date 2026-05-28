import { notFound } from "next/navigation";
import Link from "next/link";
import { openDb, migrate } from "@/lib/db";
import { DB_PATH, ensureDirs } from "@/lib/paths";
import { getApplicationDetail } from "@/lib/dashboard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ApplyButton } from "@/components/ApplyButton";
import { StatusActions } from "@/components/StatusActions";
import { DownloadButtons } from "@/components/DownloadButtons";

export const dynamic = "force-dynamic";

function fileUrl(absPath: string): string {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

function fitTone(score: number | null) {
  if (score == null) return "var(--paper-4)";
  if (score >= 80) return "var(--violet)";
  if (score >= 65) return "var(--amber)";
  return "var(--paper-3)";
}

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isFinite(appId)) notFound();

  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  const app = getApplicationDetail(db, appId);
  if (!app) notFound();

  const hasTailored = !!(app.resume_path && app.cover_letter_path);

  return (
    <div className="reveal">
      {/* breadcrumb */}
      <Link href="/" className="mono-label inline-flex items-center gap-2 transition-colors hover:text-[var(--violet)]">
        ← back to tracker
      </Link>

      {/* editorial masthead */}
      <header className="mt-8 grid grid-cols-[1fr_auto] items-end gap-8 border-b border-[var(--line-soft)] pb-8">
        <div>
          <div className="mono-label mb-3 flex items-center gap-3">
            <span>application · {String(app.id).padStart(4, "0")}</span>
            <span className="text-[var(--paper-4)]">·</span>
            <span>{app.source} · #{app.source_job_id}</span>
          </div>
          <h1 className="font-display text-[clamp(36px,5vw,64px)] font-medium leading-[0.95] tracking-[-0.02em]">
            {app.title}
          </h1>
          <div className="mt-3 font-display text-2xl italic text-[var(--paper-2)]">
            at <span className="not-italic font-sans-soft text-[18px] text-[var(--paper)]">{app.company}</span>
            {app.location && (
              <>
                {" — "}
                <span className="not-italic font-sans-soft text-[18px] text-[var(--paper-2)]">
                  {app.location}
                </span>
              </>
            )}
          </div>
          {(app.salary || app.stipend) && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--amber)] px-3 py-1 font-mono text-[12px] text-[var(--amber)]">
              <span className="opacity-60">{app.stipend ? "stipend" : "salary"}</span>
              <span>{app.salary || app.stipend}</span>
            </div>
          )}
        </div>

        {/* fit score block */}
        <div className="text-right">
          <div className="mono-label">fit score</div>
          <div className="fit-num text-[120px]" style={{ color: fitTone(app.fit_score) }}>
            {app.fit_score != null ? Math.round(app.fit_score) : "—"}
          </div>
          <div className="mono-label" style={{ color: fitTone(app.fit_score) }}>
            {app.status}
          </div>
        </div>
      </header>

      {/* fit reason — pull-quote */}
      {app.fit_reason && (
        <blockquote className="mt-10 border-l-2 border-[var(--violet)] pl-6">
          <div className="mono-label mb-2">why this fit</div>
          <p className="font-display text-2xl italic leading-snug text-[var(--paper)]">
            “{app.fit_reason}”
          </p>
        </blockquote>
      )}

      {/* actions strip */}
      <div className="mt-10 flex flex-wrap items-center gap-6">
        <ApplyButton appId={app.id} alreadyTailored={hasTailored} size="default" />
        <StatusActions appId={app.id} status={app.status} size="default" />

        <a
          href={app.url}
          target="_blank"
          rel="noreferrer"
          className="link-grow mono-label hover:text-[var(--paper)]"
        >
          open on {app.source} ↗
        </a>

        {hasTailored && (
          <DownloadButtons
            appId={app.id}
            resumePath={app.resume_path!}
            coverLetterPath={app.cover_letter_path!}
            size="default"
          />
        )}
      </div>

      {/* main content — tabs */}
      {hasTailored ? (
        <Tabs defaultValue="resume" className="mt-12">
          <TabsList className="mb-6 inline-flex gap-6 border-b border-[var(--line-soft)] bg-transparent p-0">
            <TabsTrigger
              value="resume"
              className="border-b-2 border-transparent bg-transparent px-0 pb-3 font-display text-2xl italic text-[var(--paper-3)] data-[state=active]:border-[var(--violet)] data-[state=active]:text-[var(--paper)] data-[state=active]:bg-transparent"
            >
              Tailored Resume
            </TabsTrigger>
            <TabsTrigger
              value="cover"
              className="border-b-2 border-transparent bg-transparent px-0 pb-3 font-display text-2xl italic text-[var(--paper-3)] data-[state=active]:border-[var(--violet)] data-[state=active]:text-[var(--paper)] data-[state=active]:bg-transparent"
            >
              Cover Letter
            </TabsTrigger>
            <TabsTrigger
              value="jd"
              className="border-b-2 border-transparent bg-transparent px-0 pb-3 font-display text-2xl italic text-[var(--paper-3)] data-[state=active]:border-[var(--violet)] data-[state=active]:text-[var(--paper)] data-[state=active]:bg-transparent"
            >
              Job Description
            </TabsTrigger>
          </TabsList>
          <TabsContent value="resume">
            <div className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--ink-1)]">
              <iframe
                src={fileUrl(app.resume_path!)}
                className="block h-[85vh] w-full"
                title="Tailored resume"
              />
            </div>
          </TabsContent>
          <TabsContent value="cover">
            <div className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--ink-1)]">
              <iframe
                src={fileUrl(app.cover_letter_path!)}
                className="block h-[85vh] w-full"
                title="Cover letter"
              />
            </div>
          </TabsContent>
          <TabsContent value="jd">
            <article className="rounded-md border border-[var(--line-soft)] bg-[var(--ink-1)] p-8">
              <div className="mono-label mb-4">posting · raw</div>
              <pre className="whitespace-pre-wrap font-sans-soft text-[15px] leading-[1.7] text-[var(--paper-2)]">
                {app.jd_text || "(no JD captured)"}
              </pre>
            </article>
          </TabsContent>
        </Tabs>
      ) : (
        <section className="mt-12">
          <div className="mb-4 flex items-baseline justify-between border-b border-[var(--line-soft)] pb-3">
            <h2 className="font-display text-3xl italic">Job Description</h2>
            <div className="mono-label">not yet tailored</div>
          </div>
          <p className="mb-8 max-w-2xl font-display text-xl italic leading-snug text-[var(--paper-2)]">
            Click <span className="text-[var(--violet)]">Apply</span> above and the agent will
            generate a custom resume and cover letter for this posting.
          </p>
          <article className="rounded-md border border-[var(--line-soft)] bg-[var(--ink-1)] p-8">
            <div className="mono-label mb-4">posting · raw</div>
            <pre className="whitespace-pre-wrap font-sans-soft text-[15px] leading-[1.7] text-[var(--paper-2)]">
              {app.jd_text || "(no JD captured)"}
            </pre>
          </article>
        </section>
      )}
    </div>
  );
}
