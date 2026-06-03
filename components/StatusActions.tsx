"use client";

import { useState, useTransition } from "react";
import { markAppliedAction, dismissAction, unmarkAction } from "@/app/applications/actions";

interface Props {
  appId: number;
  status: string; // current status: suggested / awaiting_submit / applied / dismissed / failed / etc.
  size?: "default" | "sm";
}

const SIZE_CLASS = {
  default: "h-11 px-5 text-[12px]",
  sm: "h-8 px-3.5 text-[11px]",
};

export function StatusActions({ appId, status, size = "sm" }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok && res.error) setError(res.error);
    });
  };

  const sizeCls = SIZE_CLASS[size];
  const isApplied = status === "applied";
  const isDismissed = status === "dismissed";
  const isInactive = isApplied || isDismissed;

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex items-center gap-1.5">
        {!isInactive && (
          <>
            <button
              onClick={() => run(() => markAppliedAction(appId))}
              disabled={pending}
              title="Mark this as submitted on the source site"
              className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--jade)] bg-transparent font-mono uppercase tracking-[0.18em] text-[var(--jade)] transition-all hover:bg-[var(--jade)] hover:text-[var(--ink-0)] disabled:cursor-not-allowed disabled:opacity-50 ${sizeCls}`}
            >
              ✓ applied
            </button>
            <button
              onClick={() => run(() => dismissAction(appId))}
              disabled={pending}
              title="Hide this from the active list"
              className={`inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-transparent font-mono uppercase tracking-[0.18em] text-[var(--paper-3)] transition-all hover:border-[var(--paper-2)] hover:text-[var(--paper-2)] disabled:cursor-not-allowed disabled:opacity-50 ${sizeCls}`}
            >
              dismiss
            </button>
          </>
        )}
        {isInactive && (
          <button
            onClick={() => run(() => unmarkAction(appId))}
            disabled={pending}
            title="Reopen this application"
            className={`inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-transparent font-mono uppercase tracking-[0.18em] text-[var(--paper-3)] transition-all hover:border-[var(--violet)] hover:text-[var(--violet)] disabled:cursor-not-allowed disabled:opacity-50 ${sizeCls}`}
          >
            ↺ reopen
          </button>
        )}
      </div>
      {error && (
        <span className="max-w-[220px] text-right font-mono text-[10px] leading-tight text-[var(--rose)]">
          {error.slice(0, 80)}
        </span>
      )}
    </div>
  );
}
