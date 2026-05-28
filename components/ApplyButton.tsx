"use client";

import { useState, useTransition } from "react";
import { tailorApplicationAction } from "@/app/applications/actions";

export function ApplyButton({
  appId,
  alreadyTailored,
  size = "default",
}: {
  appId: number;
  alreadyTailored: boolean;
  size?: "default" | "sm";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await tailorApplicationAction(appId);
      if (!res.ok) setError(res.error);
    });
  };

  const label = pending ? "tailoring…" : alreadyTailored ? "re-tailor" : "apply";

  const baseSize = size === "sm" ? "h-8 px-4 text-[11px]" : "h-11 px-6 text-[12px]";

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={onClick}
        disabled={pending}
        className={`relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full border font-mono uppercase tracking-[0.2em] transition-all ${baseSize} ${
          pending
            ? "pulse-violet border-[var(--violet)] bg-[var(--violet)] text-[var(--ink-0)]"
            : alreadyTailored
              ? "border-[var(--line)] bg-transparent text-[var(--paper-2)] hover:border-[var(--violet)] hover:text-[var(--violet)]"
              : "border-[var(--violet)] bg-[var(--violet)] text-[var(--ink-0)] hover:bg-[var(--violet-glow)] hover:shadow-[0_0_24px_-2px_oklch(0.68_0.22_295/0.6)]"
        } disabled:cursor-not-allowed disabled:opacity-90`}
      >
        {pending && <SpinnerDot />}
        <span>{label}</span>
        {!pending && !alreadyTailored && <span aria-hidden>→</span>}
      </button>
      {error && (
        <span className="max-w-[200px] text-right font-mono text-[10px] leading-tight text-[var(--rose)]">
          {error.slice(0, 80)}
        </span>
      )}
    </div>
  );
}

function SpinnerDot() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className="animate-spin"
      style={{ animationDuration: "900ms" }}
    >
      <circle
        cx="5"
        cy="5"
        r="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="6 16"
        strokeLinecap="round"
      />
    </svg>
  );
}
