/**
 * Live ingestion smoke test with a rule-based relevance filter.
 * Runs the full ingest pipeline against LinkedIn using the seeded browser_profile/
 * session, then filters/ranks the results for fit against the user's profile
 * (no LLM key required). Prints the top 10.
 *
 * Usage: npm run smoke
 *
 * NOTE: this heuristic ranker is a stop-gap for when ANTHROPIC_API_KEY is unset.
 * The proper LLM ranker (lib/rank.ts) will replace it as soon as a key is provided.
 */
import { openDb, migrate } from "../lib/db.js";
import { loadProfile } from "../lib/config.js";
import { ingest } from "./ingest.js";
import type { Posting } from "../lib/types.js";

interface Scored {
  posting: Posting;
  score: number;
  reasons: string[];
}

// Words that disqualify a posting outright for an SDE2 with ~2.5 years' experience.
const HARD_EXCLUDE = [
  /\bintern(ship)?\b/i,
  /\btrainee\b/i,
  /\bfresher\b/i,
  /\bgraduate program\b/i,
  /\bconsultant\b/i,
  /\bdomain expert\b/i,
  /\bsales\b/i,
  /\bmarketing\b/i,
  /\brecruiter\b/i,
  /\bhuman resources?\b/i,
  /\bfinance\b/i,
  /\baccount(ant|ing)\b/i,
];

// Title keywords that signal a good fit.
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

function scorePosting(p: Posting, preferredLocations: string[]): Scored {
  const reasons: string[] = [];
  const title = p.title || "";

  for (const re of HARD_EXCLUDE) {
    if (re.test(title)) return { posting: p, score: -1, reasons: [`excluded: matches ${re}`] };
  }
  // Also exclude obviously-misaligned senior-leadership titles for a 2.5-yr SDE.
  if (/\b(director|vp|vice president|head of|chief)\b/i.test(title)) {
    return { posting: p, score: -1, reasons: [`excluded: leadership title`] };
  }

  let score = 0;
  for (const { re, weight } of TITLE_HITS) {
    if (re.test(title)) {
      score += weight;
      reasons.push(`+${weight} title: ${re.source}`);
    }
  }
  const loc = (p.location || "").toLowerCase();
  for (const pref of preferredLocations) {
    if (pref && loc.includes(pref.toLowerCase())) {
      score += 2;
      reasons.push(`+2 location: ${pref}`);
      break;
    }
  }
  if (p.applyType === "easy_apply") {
    score += 1;
    reasons.push("+1 easy_apply");
  }
  return { posting: p, score, reasons };
}

async function main() {
  const profile = loadProfile() as Record<string, any>;
  const preferred: string[] = profile.preferred_locations ?? [];

  const db = openDb(":memory:");
  migrate(db);

  const filters = [
    { keywords: "Software Engineer", location: "India", experienceLevel: "", datePosted: "" },
    { keywords: "Backend Engineer", location: "India", experienceLevel: "", datePosted: "" },
    { keywords: "Full Stack Developer", location: "India", experienceLevel: "", datePosted: "" },
  ];

  const postings = await ingest(db, filters, true);

  const ranked = postings
    .map((p) => scorePosting(p, preferred))
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, 10);
  const excluded = postings.length - ranked.length;

  console.log(`\nFetched ${postings.length} postings, kept ${ranked.length} relevant, ${excluded} excluded.`);
  console.log(`Top ${top.length} for ${profile.name ?? "you"}:\n`);
  for (const [i, s] of top.entries()) {
    const p = s.posting;
    const idMatch = p.url.match(/\/jobs\/view\/(\d+)/);
    const cleanUrl = idMatch ? `https://www.linkedin.com/jobs/view/${idMatch[1]}` : p.url;
    console.log(`${i + 1}. ${p.title}   [score ${s.score}]`);
    console.log(`   ${p.company} · ${p.location || "(location missing)"}`);
    console.log(`   [${p.applyType}] ${cleanUrl}`);
    console.log(`   why: ${s.reasons.join(", ")}\n`);
  }
  process.exit(0);
}

main();
