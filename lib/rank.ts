import { completeJson, type CompleteJson } from "./llm.js";
import type { Posting, ScoredPosting } from "./types.js";

const SYSTEM =
  "You are a career-fit ranker. Given a candidate's resume/profile and a list of job " +
  "postings, score each posting 0-100 for how well it fits the candidate and give a " +
  'one-line reason. Respond ONLY as JSON: {"rankings": [{"linkedinJobId": "<id>", ' +
  '"fitScore": <0-100>, "fitReason": "<one line>"}]}';

interface RankOpts {
  resumeText: string;
  profile: Record<string, unknown>;
  topN: number;
  model?: string;
  complete?: CompleteJson;
}

export async function rank(postings: Posting[], opts: RankOpts): Promise<ScoredPosting[]> {
  if (postings.length === 0) return [];
  const complete = opts.complete ?? completeJson;
  const byId = new Map(postings.map((p) => [p.linkedinJobId, p]));
  const user = JSON.stringify({
    resume: opts.resumeText,
    profile: opts.profile,
    postings: postings.map((p) => ({
      linkedinJobId: p.linkedinJobId,
      title: p.title,
      company: p.company,
      location: p.location,
      jdText: p.jdText,
    })),
  });

  const data = await complete(SYSTEM, user, { model: opts.model });
  const scored: ScoredPosting[] = [];
  for (const r of data?.rankings ?? []) {
    const posting = byId.get(String(r.linkedinJobId));
    if (!posting) continue;
    scored.push({
      posting,
      fitScore: Number(r.fitScore ?? 0),
      fitReason: String(r.fitReason ?? ""),
    });
  }
  scored.sort((a, b) => b.fitScore - a.fitScore);
  return scored.slice(0, opts.topN);
}
