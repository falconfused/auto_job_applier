/**
 * Live ingestion + LLM relevance ranking smoke test.
 * Uses the seeded browser_profile/ session for ingest, and Claude on AWS Bedrock
 * (via lib/llm.ts → lib/rank.ts) for resume-aware ranking. Falls back to a
 * rule-based heuristic if Bedrock fails (missing/expired creds, etc.).
 *
 * Usage: npm run smoke
 */
import "dotenv/config";
// AWS_PROFILE from ~/.zshrc would override the explicit .env creds; force them.
delete process.env.AWS_PROFILE;

import { readFileSync } from "node:fs";
import { openDb, migrate } from "../lib/db.js";
import { loadProfile } from "../lib/config.js";
import { ingest } from "./ingest.js";
import { rank } from "../lib/rank.js";
import { MASTER_RESUME } from "../lib/paths.js";
import type { Posting, ScoredPosting } from "../lib/types.js";

// ----- rule-based fallback (used if LLM rank fails) -----
const HARD_EXCLUDE = [
  /\bintern(ship)?\b/i, /\btrainee\b/i, /\bfresher\b/i, /\bgraduate program\b/i,
  /\bconsultant\b/i, /\bdomain expert\b/i, /\bsales\b/i, /\bmarketing\b/i,
  /\brecruiter\b/i, /\bhuman resources?\b/i, /\bfinance\b/i, /\baccount(ant|ing)\b/i,
];
const TITLE_HITS: { re: RegExp; weight: number }[] = [
  { re: /\bsoftware\s+development\s+engineer\b/i, weight: 5 },
  { re: /\bsoftware\s+engineer\b/i, weight: 4 },
  { re: /\b(sde|swe)\b/i, weight: 4 },
  { re: /\bbackend|back[-\s]?end\b/i, weight: 3 },
  { re: /\bfull[-\s]?stack\b/i, weight: 3 },
  { re: /\bfrontend|front[-\s]?end\b/i, weight: 2 },
  { re: /\b(developer|engineer)\b/i, weight: 2 },
  { re: /\bpython|node|typescript|java|go(lang)?\b/i, weight: 1 },
];

function heuristicRank(postings: Posting[], preferred: string[]): ScoredPosting[] {
  const out: ScoredPosting[] = [];
  for (const p of postings) {
    const title = p.title || "";
    if (HARD_EXCLUDE.some((re) => re.test(title))) continue;
    if (/\b(director|vp|vice president|head of|chief)\b/i.test(title)) continue;
    let score = 0;
    const reasons: string[] = [];
    for (const { re, weight } of TITLE_HITS) {
      if (re.test(title)) { score += weight; reasons.push(`+${weight} ${re.source}`); }
    }
    const loc = (p.location || "").toLowerCase();
    if (preferred.some((pref) => pref && loc.includes(pref.toLowerCase()))) { score += 2; reasons.push("+2 preferred location"); }
    if (p.applyType === "easy_apply") { score += 1; reasons.push("+1 easy_apply"); }
    out.push({ posting: p, fitScore: score, fitReason: reasons.join(", ") });
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}

async function main() {
  const profile = loadProfile() as Record<string, any>;
  const resumeText = readFileSync(MASTER_RESUME, "utf8");
  const preferred: string[] = profile.preferred_locations ?? [];

  const db = openDb(":memory:");
  migrate(db);

  const filters = [
    { keywords: "Software Engineer", location: "India", experienceLevel: "", datePosted: "" },
    { keywords: "Backend Engineer", location: "India", experienceLevel: "", datePosted: "" },
    { keywords: "Full Stack Developer", location: "India", experienceLevel: "", datePosted: "" },
  ];

  const postings = await ingest(db, filters, true);
  console.log(`\nFetched ${postings.length} postings. Ranking with Claude on Bedrock...`);

  let ranked: ScoredPosting[];
  let ranker: string;
  try {
    ranked = await rank(postings, { resumeText, profile, topN: 10 });
    ranker = "LLM (Claude / Bedrock)";
  } catch (err) {
    console.error(`LLM rank failed: ${(err as Error).message}\nFalling back to rule-based heuristic.`);
    ranked = heuristicRank(postings, preferred).slice(0, 10);
    ranker = "rule-based heuristic";
  }

  const top = ranked.slice(0, 10);
  console.log(`\nTop ${top.length} via ${ranker}, for ${profile.name ?? "you"}:\n`);
  for (const [i, s] of top.entries()) {
    const p = s.posting;
    const idMatch = p.url.match(/\/jobs\/view\/(\d+)/);
    const cleanUrl = idMatch ? `https://www.linkedin.com/jobs/view/${idMatch[1]}` : p.url;
    console.log(`${i + 1}. ${p.title}   [fit ${s.fitScore}]`);
    console.log(`   ${p.company} · ${p.location || "(location missing)"}`);
    console.log(`   [${p.applyType}] ${cleanUrl}`);
    console.log(`   why: ${s.fitReason}\n`);
  }
  process.exit(0);
}

main();
