import type { DB } from "../lib/db.js";
import type { Posting, ScoredPosting } from "../lib/types.js";
import type { Settings } from "../lib/config.js";
import * as tracker from "../lib/tracker.js";
import { ingestWith } from "./ingest.js";
import { formatDigest, formatExternalMessage } from "./formatters.js";

export interface PipelineDeps {
  fetchHtml: (url: string) => Promise<string>;
  parseHtml?: (html: string) => Posting[];
  rankFn: (
    postings: Posting[],
    opts: { resumeText: string; profile: Record<string, unknown>; topN: number; model?: string },
  ) => Promise<ScoredPosting[]>;
  sendMessage: (chatId: number, text: string) => Promise<void>;
}

export interface PipelineArgs {
  db: DB;
  settings: Settings;
  profile: Record<string, unknown>;
  resumeText: string;
  deps: PipelineDeps;
  dryRun?: boolean;
}

export interface PipelineResult {
  runId: number;
  searched: number;
  foundNew: number;
  suggested: number;
  status: "ok" | "failed";
  error?: string;
}

export async function runDailyPipeline(args: PipelineArgs): Promise<PipelineResult> {
  const { db, settings, profile, resumeText, deps, dryRun } = args;
  let foundNew = 0;
  let scored: ScoredPosting[] = [];

  try {
    const newPostings = await ingestWith({
      db,
      filters: settings.search.filters,
      easyApplyOnly: settings.apply.easyApplyOnly,
      fetchHtml: deps.fetchHtml,
      parse: deps.parseHtml,
    });
    foundNew = newPostings.length;

    if (newPostings.length > 0) {
      scored = await deps.rankFn(newPostings, {
        resumeText,
        profile,
        topN: settings.ranking.topN,
        model: settings.llm.model,
      });
    }

    if (!dryRun) {
      const runDate = new Date().toISOString();
      for (let i = 0; i < scored.length; i++) {
        const s = scored[i];
        const job = tracker.getJobByLinkedinId(db, s.posting.linkedinJobId);
        if (!job) continue;
        tracker.addSuggestion(db, job.id, runDate, i + 1, s.fitScore, s.fitReason);
        tracker.createApplication(db, job.id);
      }
    }
  } catch (err) {
    const runId = tracker.recordRun(db, {
      searched: settings.search.filters.length,
      foundNew,
      suggested: 0,
      status: "failed",
      error: (err as Error).message,
    });
    if (!dryRun) {
      await deps
        .sendMessage(settings.telegram.chatId, `Pipeline FAILED: ${(err as Error).message}`)
        .catch(() => {});
    }
    return {
      runId,
      searched: settings.search.filters.length,
      foundNew,
      suggested: 0,
      status: "failed",
      error: (err as Error).message,
    };
  }

  const runId = tracker.recordRun(db, {
    searched: settings.search.filters.length,
    foundNew,
    suggested: scored.length,
    status: "ok",
  });

  if (!dryRun && scored.length > 0) {
    await deps.sendMessage(settings.telegram.chatId, formatDigest(scored));
    for (const s of scored) {
      if (s.posting.applyType === "external") {
        await deps.sendMessage(settings.telegram.chatId, formatExternalMessage(s));
      }
    }
  }

  return {
    runId,
    searched: settings.search.filters.length,
    foundNew,
    suggested: scored.length,
    status: "ok",
  };
}
