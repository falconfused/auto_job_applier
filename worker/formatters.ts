import type { ScoredPosting } from "../lib/types.js";

export function formatDigest(scored: ScoredPosting[]): string {
  if (scored.length === 0) return "No matches found in tonight's run.";
  const lines = scored.map((s, i) => {
    const tag = s.posting.applyType === "external" ? " 🔗 external" : "";
    return [
      `${i + 1}. ${s.posting.title} — ${s.posting.company}${tag}`,
      `   📍 ${s.posting.location}   •   fit: ${s.fitScore}/100`,
      `   ${s.fitReason}`,
    ].join("\n");
  });
  return ["Tonight's top matches:", "", ...lines].join("\n");
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
