import type { DB } from "../lib/db.js";
import type { Posting } from "../lib/types.js";
import * as tracker from "../lib/tracker.js";
import { buildSearchUrl } from "./searchUrl.js";
import { parseSearchHtml } from "./parseSearch.js";
import { launchSession, fetchHtml as realFetchHtml } from "./session.js";
import { buildInternshalaUrl, parseInternshalaHtml } from "./sources/internshala.js";
import { buildNaukriUrl, parseNaukriHtml } from "./sources/naukri.js";
import { buildUnstopUrl, parseUnstopHtml } from "./sources/unstop.js";
import { buildCutshortUrl, parseCutshortHtml } from "./sources/cutshort.js";

interface FilterLike {
  keywords: string;
  location: string;
  experienceLevel: string;
  datePosted: string;
}

interface IngestArgs {
  db: DB;
  filters: FilterLike[];
  easyApplyOnly: boolean;
  fetchHtml: (url: string) => Promise<string>;
  parse?: (html: string) => Posting[];
}

/** Testable core: fetch+parse each filter, dedupe (in-run and against db), persist new jobs.
 *  This is the LinkedIn-specific ingest used by tests; live runs go through ingestSources. */
export async function ingestWith(args: IngestArgs): Promise<Posting[]> {
  const parse = args.parse ?? parseSearchHtml;
  const newPostings: Posting[] = [];
  const seenThisRun = new Set<string>();

  for (const filter of args.filters) {
    const url = buildSearchUrl(filter, { easyApplyOnly: args.easyApplyOnly });
    const html = await args.fetchHtml(url);
    for (const p of parse(html)) {
      const dedupKey = `${p.source}:${p.sourceJobId}`;
      if (seenThisRun.has(dedupKey)) continue;
      seenThisRun.add(dedupKey);
      if (tracker.getJobBySource(args.db, p.source, p.sourceJobId)) continue;
      tracker.addJob(args.db, p);
      newPostings.push(p);
    }
  }
  return newPostings;
}

interface InternshalaFilter {
  type: "internship" | "job";
  category?: string;
  location?: string;
  keywords?: string;
}

interface NaukriFilter {
  keywords: string;
  location: string;
  experience?: string;
}

interface UnstopFilter {
  type: "jobs" | "internships";
  category?: string;
  location?: string;
}

interface CutshortFilter {
  role?: string;
  location?: string;
}

interface IngestSourcesArgs {
  db: DB;
  fetchHtml: (url: string) => Promise<string>;
  linkedin?: {
    filters: FilterLike[];
    easyApplyOnly: boolean;
  };
  internshala?: {
    enabled: boolean;
    filters: InternshalaFilter[];
  };
  naukri?: {
    enabled: boolean;
    filters: NaukriFilter[];
  };
  unstop?: {
    enabled: boolean;
    filters: UnstopFilter[];
  };
  cutshort?: {
    enabled: boolean;
    filters: CutshortFilter[];
  };
  /** Test hooks. */
  parsers?: {
    linkedin?: (html: string) => Posting[];
    internshala?: (html: string, type: "internship" | "job") => Posting[];
    naukri?: (html: string) => Posting[];
    unstop?: (html: string, type: "jobs" | "internships") => Posting[];
    cutshort?: (html: string) => Posting[];
  };
}

/** Multi-source ingest. Iterates each enabled source, dedups across the run + db. */
export async function ingestSources(args: IngestSourcesArgs): Promise<{
  newPostings: Posting[];
  searched: number;
}> {
  const seenThisRun = new Set<string>();
  const newPostings: Posting[] = [];
  let searched = 0;

  const lkParse = args.parsers?.linkedin ?? parseSearchHtml;
  const isParse = args.parsers?.internshala ?? parseInternshalaHtml;
  const nkParse = args.parsers?.naukri ?? parseNaukriHtml;
  const usParse = args.parsers?.unstop ?? parseUnstopHtml;
  const csParse = args.parsers?.cutshort ?? parseCutshortHtml;

  // LinkedIn
  if (args.linkedin && args.linkedin.filters.length > 0) {
    for (const filter of args.linkedin.filters) {
      const url = buildSearchUrl(filter, { easyApplyOnly: args.linkedin.easyApplyOnly });
      searched += 1;
      try {
        const html = await args.fetchHtml(url);
        for (const p of lkParse(html)) {
          if (commitPosting(args.db, p, seenThisRun)) newPostings.push(p);
        }
      } catch (err) {
        console.warn(`[ingest] linkedin filter failed: ${(err as Error).message}`);
      }
    }
  }

  // Internshala
  if (args.internshala?.enabled && args.internshala.filters.length > 0) {
    for (const filter of args.internshala.filters) {
      const url = buildInternshalaUrl(filter);
      searched += 1;
      try {
        const html = await args.fetchHtml(url);
        for (const p of isParse(html, filter.type)) {
          if (commitPosting(args.db, p, seenThisRun)) newPostings.push(p);
        }
      } catch (err) {
        console.warn(
          `[ingest] internshala filter failed (${filter.type}/${filter.category ?? ""}/${filter.location ?? ""}): ${(err as Error).message}`,
        );
      }
    }
  }

  // Naukri
  if (args.naukri?.enabled && args.naukri.filters.length > 0) {
    for (const filter of args.naukri.filters) {
      const url = buildNaukriUrl(filter);
      searched += 1;
      try {
        const html = await args.fetchHtml(url);
        for (const p of nkParse(html)) {
          if (commitPosting(args.db, p, seenThisRun)) newPostings.push(p);
        }
      } catch (err) {
        console.warn(`[ingest] naukri filter failed: ${(err as Error).message}`);
      }
    }
  }

  // Unstop
  if (args.unstop?.enabled && args.unstop.filters.length > 0) {
    for (const filter of args.unstop.filters) {
      const url = buildUnstopUrl(filter);
      searched += 1;
      try {
        const html = await args.fetchHtml(url);
        for (const p of usParse(html, filter.type)) {
          if (commitPosting(args.db, p, seenThisRun)) newPostings.push(p);
        }
      } catch (err) {
        console.warn(`[ingest] unstop filter failed: ${(err as Error).message}`);
      }
    }
  }

  // Cutshort
  if (args.cutshort?.enabled && args.cutshort.filters.length > 0) {
    for (const filter of args.cutshort.filters) {
      const url = buildCutshortUrl(filter);
      searched += 1;
      try {
        const html = await args.fetchHtml(url);
        for (const p of csParse(html)) {
          if (commitPosting(args.db, p, seenThisRun)) newPostings.push(p);
        }
      } catch (err) {
        console.warn(`[ingest] cutshort filter failed: ${(err as Error).message}`);
      }
    }
  }

  return { newPostings, searched };
}

function commitPosting(db: DB, p: Posting, seen: Set<string>): boolean {
  const key = `${p.source}:${p.sourceJobId}`;
  if (seen.has(key)) return false;
  seen.add(key);
  if (tracker.getJobBySource(db, p.source, p.sourceJobId)) return false;
  tracker.addJob(db, p);
  return true;
}

/** Production entry: open a real persistent session and run ingestWith against live LinkedIn. */
export async function ingest(db: DB, filters: FilterLike[], easyApplyOnly: boolean): Promise<Posting[]> {
  const context = await launchSession();
  try {
    const fetchHtml = (url: string) => realFetchHtml(context, url, "body");
    return await ingestWith({ db, filters, easyApplyOnly, fetchHtml });
  } finally {
    await context.close();
  }
}
