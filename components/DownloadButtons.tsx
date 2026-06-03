"use client";

import { useState, useTransition } from "react";
import { getCoverLetterText, tailorCoverLetterAction } from "@/app/applications/actions";

interface Props {
  appId: number;
  resumePath: string;
  /** May be null until the user clicks "Generate cover letter". */
  coverLetterPath: string | null;
  size?: "default" | "sm";
}

const SIZE_CLASS = {
  default: "h-11 px-5 text-[12px]",
  sm: "h-8 px-3.5 text-[11px]",
};

function fileUrl(absPath: string): string {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

export function DownloadButtons({ appId, resumePath, coverLetterPath, size = "sm" }: Props) {
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const sizeCls = SIZE_CLASS[size];

  const generateCover = () => {
    setToast(null);
    startTransition(async () => {
      const res = await tailorCoverLetterAction(appId);
      if (!res.ok) setToast({ kind: "err", text: res.error });
      // On success, server-action revalidates the page → re-render with coverLetterPath set
    });
  };

  const copyCoverLetter = () => {
    setToast(null);
    startTransition(async () => {
      const res = await getCoverLetterText(appId);
      if (!res.ok) {
        setToast({ kind: "err", text: res.error });
        return;
      }
      try {
        await navigator.clipboard.writeText(res.text);
        setToast({ kind: "ok", text: "copied to clipboard" });
        setTimeout(() => setToast(null), 2200);
      } catch (e) {
        setToast({ kind: "err", text: "clipboard blocked — try the PDF" });
      }
    });
  };

  const hasCover = !!coverLetterPath;

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
        {/* Resume download — always available once tailored */}
        <a
          href={fileUrl(resumePath)}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex items-center justify-center rounded-full border border-[var(--violet)] bg-[var(--violet)] font-mono uppercase tracking-[0.18em] text-[var(--ink-0)] transition-all hover:bg-[var(--violet-glow)] hover:shadow-[0_0_18px_-4px_oklch(0.68_0.22_295/0.55)] ${sizeCls}`}
          title="Download tailored resume PDF"
        >
          resume ↓
        </a>

        {hasCover ? (
          <>
            <a
              href={fileUrl(coverLetterPath)}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-transparent font-mono uppercase tracking-[0.18em] text-[var(--paper-2)] transition-all hover:border-[var(--violet)] hover:text-[var(--violet)] ${sizeCls}`}
              title="Download cover letter PDF"
            >
              cover ↓
            </a>
            <button
              onClick={copyCoverLetter}
              disabled={pending}
              className={`inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-transparent font-mono uppercase tracking-[0.18em] text-[var(--paper-2)] transition-all hover:border-[var(--amber)] hover:text-[var(--amber)] disabled:cursor-not-allowed disabled:opacity-50 ${sizeCls}`}
              title="Copy cover letter as plain text"
            >
              {pending ? "…" : "cover ⧉ text"}
            </button>
          </>
        ) : (
          <button
            onClick={generateCover}
            disabled={pending}
            className={`inline-flex items-center justify-center rounded-full border border-dashed border-[var(--amber)] bg-transparent font-mono uppercase tracking-[0.18em] text-[var(--amber)] transition-all hover:bg-[var(--amber)] hover:text-[var(--ink-0)] disabled:cursor-not-allowed disabled:opacity-60 ${sizeCls}`}
            title="Generate the cover letter for this posting (uses Bedrock)"
          >
            {pending ? "generating…" : "+ cover letter"}
          </button>
        )}
      </div>
      {toast && (
        <span
          className={`max-w-[260px] text-right font-mono text-[10px] leading-tight ${
            toast.kind === "ok" ? "text-[var(--jade)]" : "text-[var(--rose)]"
          }`}
        >
          {toast.text}
        </span>
      )}
    </div>
  );
}
