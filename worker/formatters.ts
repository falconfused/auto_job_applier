import type { ScoredPosting } from "../lib/types.js";

export function formatDigest(scored: ScoredPosting[]): string {
  if (scored.length === 0) return "No matches found in tonight's run.";
  // Telegram caps messages at 4096 chars; cap the digest to the top 20
  // (full list is in the dashboard).
  const TELEGRAM_TOP_N = 20;
  const top = scored.slice(0, TELEGRAM_TOP_N);
  const lines = top.map((s, i) => {
    const tag = s.posting.applyType === "external" ? " 🔗" : "";
    return [
      `${i + 1}. ${s.posting.title} — ${s.posting.company}${tag}`,
      `   📍 ${s.posting.location}   •   fit: ${s.fitScore}/100`,
    ].join("\n");
  });
  const header = `Tonight's top ${top.length} (of ${scored.length}) matches:`;
  const footer = scored.length > top.length ? `\n…and ${scored.length - top.length} more — see the dashboard.` : "";
  return [header, "", ...lines].join("\n") + footer;
}

export function formatExternalMessage(s: ScoredPosting): string {
  return [
    `🔗 External job — apply manually:`,
    `${s.posting.title} — ${s.posting.company}`,
    s.posting.url,
  ].join("\n");
}

export function formatGate2Message(
  s: ScoredPosting,
  paths: { resumePath: string; coverLetterPath: string },
): string {
  return [
    `Tailored for: ${s.posting.title} — ${s.posting.company}`,
    `Resume: ${paths.resumePath}`,
    `Cover letter: ${paths.coverLetterPath}`,
    "",
    "Reply with:",
    "  ✅ Submit  — go ahead and apply",
    "  ✏️ Edit    — reply with what to change",
    "  ❌ Cancel  — drop this one",
  ].join("\n");
}
