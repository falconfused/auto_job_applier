import type { DB } from "../lib/db.js";
import type { Posting } from "../lib/types.js";
import * as tracker from "../lib/tracker.js";
import { buildSearchUrl } from "./searchUrl.js";
import { parseSearchHtml } from "./parseSearch.js";
import { launchSession, fetchHtml as realFetchHtml } from "./session.js";

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

/** Testable core: fetch+parse each filter, dedupe (in-run and against db), persist new jobs. */
export async function ingestWith(args: IngestArgs): Promise<Posting[]> {
  const parse = args.parse ?? parseSearchHtml;
  const newPostings: Posting[] = [];
  const seenThisRun = new Set<string>();

  for (const filter of args.filters) {
    const url = buildSearchUrl(filter, { easyApplyOnly: args.easyApplyOnly });
    const html = await args.fetchHtml(url);
    for (const p of parse(html)) {
      if (seenThisRun.has(p.linkedinJobId)) continue;
      seenThisRun.add(p.linkedinJobId);
      if (tracker.getJobByLinkedinId(args.db, p.linkedinJobId)) continue;
      tracker.addJob(args.db, p);
      newPostings.push(p);
    }
  }
  return newPostings;
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
