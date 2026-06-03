import { openDb, migrate } from "@/lib/db";
import { DB_PATH, ensureDirs } from "@/lib/paths";
import { listRuns } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function RunsPage() {
  ensureDirs();
  const db = openDb(DB_PATH);
  migrate(db);
  const rows = listRuns(db);

  const okCount = rows.filter((r) => r.status === "ok").length;
  const failedCount = rows.length - okCount;

  return (
    <div className="reveal">
      {/* masthead */}
      <header className="mb-14">
        <div className="mono-label">№ {String(rows.length).padStart(3, "0")} · pipeline runs</div>
        <h1 className="mt-3 font-display text-[clamp(48px,7vw,96px)] font-medium leading-[0.92] tracking-[-0.02em]">
          Pipeline <em className="text-[var(--violet)]">Runs.</em>
        </h1>

        <div className="mt-8 grid max-w-2xl grid-cols-3 gap-8 border-t border-[var(--line-soft)] pt-6">
          <div>
            <div className="mono-label">total</div>
            <div className="font-display text-4xl italic">{rows.length}</div>
          </div>
          <div>
            <div className="mono-label">ok</div>
            <div className="font-display text-4xl italic text-[var(--jade)]">{okCount}</div>
          </div>
          <div>
            <div className="mono-label">failed</div>
            <div className="font-display text-4xl italic text-[var(--rose)]">{failedCount}</div>
          </div>
        </div>
      </header>

      {/* roster */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line)] p-12 text-center">
          <div className="mono-label mb-2">empty</div>
          <p className="font-display text-2xl italic text-[var(--paper-2)]">
            No runs recorded yet.
          </p>
        </div>
      ) : (
        <div className="border-t border-[var(--line-soft)]">
          {rows.map((r, i) => {
            const ok = r.status === "ok";
            return (
              <article
                key={r.id}
                className="reveal grid grid-cols-[160px_1fr_auto] items-baseline gap-8 border-b border-[var(--line-soft)] py-6"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                {/* date */}
                <div>
                  <div className="mono-label">{String(i + 1).padStart(3, "0")}</div>
                  <div className="font-mono text-[12px] text-[var(--paper-2)]">{fmtDate(r.date)}</div>
                </div>

                {/* metrics */}
                <div className="flex items-baseline gap-10">
                  <div>
                    <div className="mono-label">searched</div>
                    <div className="font-display text-2xl italic">{r.searched}</div>
                  </div>
                  <div>
                    <div className="mono-label">new</div>
                    <div className="font-display text-2xl italic text-[var(--paper)]">
                      {r.found_new}
                    </div>
                  </div>
                  <div>
                    <div className="mono-label">suggested</div>
                    <div className="font-display text-2xl italic text-[var(--violet)]">
                      {r.suggested}
                    </div>
                  </div>
                </div>

                {/* status */}
                <div className="text-right">
                  <div
                    className="mono-label"
                    style={{ color: ok ? "var(--jade)" : "var(--rose)" }}
                  >
                    {r.status}
                  </div>
                  {r.error && (
                    <div className="mt-1 max-w-md font-mono text-[11px] leading-relaxed text-[var(--rose)]">
                      {r.error.slice(0, 140)}
                      {r.error.length > 140 ? "…" : ""}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
