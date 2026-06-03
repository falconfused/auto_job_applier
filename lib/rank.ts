import { completeJson, type CompleteJson } from "./llm.js";
import type { Posting, ScoredPosting } from "./types.js";

const SYSTEM =
  "You are a career-fit ranker. Given a candidate's resume, profile, and a list of job " +
  "postings, score each posting 0-100 for how well it fits THIS candidate.\n\n" +
  "CRITICAL: The candidate's profile contains a `ranking_preferences` field with HARD " +
  "constraints (auto-skip rules) and STRONG preferences. You MUST obey these — they " +
  "override generic skill matching. If a posting violates a hard constraint (e.g. " +
  "requires work experience the candidate doesn't have, or has a senior-level title), " +
  "score it 0-15 even if the skills match perfectly.\n\n" +
  "Also weight target_roles, preferred_locations, and preferred_regions from the profile.\n\n" +
  "Respond ONLY as JSON: " +
  '{"rankings": [{"sourceJobId": "<id>", "fitScore": <0-100>, "fitReason": "<one line>"}]}';

interface RankOpts {
  resumeText: string;
  profile: Record<string, unknown>;
  topN: number;
  model?: string;
  complete?: CompleteJson;
  /** Max postings to send to the model per call. Larger = fewer calls, but risks output truncation. */
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 40;

export async function rank(postings: Posting[], opts: RankOpts): Promise<ScoredPosting[]> {
  if (postings.length === 0) return [];
  const complete = opts.complete ?? completeJson;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  const allScored: ScoredPosting[] = [];
  for (let i = 0; i < postings.length; i += batchSize) {
    const batch = postings.slice(i, i + batchSize);
    const scored = await rankBatch(batch, opts, complete);
    allScored.push(...scored);
  }
  allScored.sort((a, b) => b.fitScore - a.fitScore);
  return allScored.slice(0, opts.topN);
}

async function rankBatch(
  postings: Posting[],
  opts: RankOpts,
  complete: CompleteJson,
): Promise<ScoredPosting[]> {
  const user = JSON.stringify({
    resume: opts.resumeText,
    profile: opts.profile,
    postings: postings.map((p) => ({
      sourceJobId: p.sourceJobId,
      source: p.source,
      title: p.title,
      company: p.company,
      location: p.location,
      // Truncate JD to keep prompt size + output bounded
      jdText: (p.jdText || "").slice(0, 800),
    })),
  });

  const data = await complete(SYSTEM, user, { model: opts.model });
  const scored: ScoredPosting[] = [];
  for (const r of data?.rankings ?? []) {
    const sourceJobId = String(r.sourceJobId ?? r.linkedinJobId ?? "");
    const posting = postings.find((p) => p.sourceJobId === sourceJobId);
    if (!posting) continue;
    scored.push({
      posting,
      fitScore: Number(r.fitScore ?? 0),
      fitReason: String(r.fitReason ?? ""),
    });
  }
  return scored;
}
