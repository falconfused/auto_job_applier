import * as cheerio from "cheerio";
import type { Posting } from "../../lib/types.js";

/**
 * Internshala URL builder + HTML parser.
 *
 * Internshala has TWO listing types:
 *   - /internships/...    (paid stipends, 3-6 months)
 *   - /jobs/...           (full-time fresher jobs)
 *
 * Categories use slugs like 'computer-science-internship' and we hit the
 * /work-from-home/ + city-name variants. The site is server-rendered HTML
 * with stable DOM ids — easy to parse, no anti-bot.
 */

export type InternshalaListingType = "internship" | "job";

export interface InternshalaFilter {
  /** Listing type. "internship" (paid stipend) or "job" (full-time fresher). */
  type: InternshalaListingType;
  /** Category slug. e.g. "computer-science", "backend-development", "full-stack-development". */
  category?: string;
  /** Optional location. "work-from-home", or a city slug like "delhi", "gurgaon", "noida", "bangalore". */
  location?: string;
  /** Free-text keyword search added as ?search=... */
  keywords?: string;
}

export function buildInternshalaUrl(f: InternshalaFilter): string {
  const segments: string[] = [];
  const base = f.type === "job" ? "jobs" : "internships";
  const cat = f.category ? `${f.category}-${f.type === "job" ? "jobs" : "internship"}` : "";
  if (cat) segments.push(cat);
  if (f.location) segments.push(f.location);
  const path = segments.length > 0 ? `${base}/${segments.join("/")}/` : `${base}/`;
  const url = new URL(path, "https://internshala.com");
  if (f.keywords) url.searchParams.set("search", f.keywords);
  return url.toString();
}

/** Parse an Internshala search-results HTML page into Postings. */
export function parseInternshalaHtml(
  html: string,
  type: InternshalaListingType = "internship",
): Posting[] {
  const $ = cheerio.load(html);
  const out: Posting[] = [];
  const seen = new Set<string>();

  $("[internshipid]").each((_, el) => {
    const $el = $(el);
    const sourceJobId = ($el.attr("internshipid") || "").trim();
    if (!sourceJobId || seen.has(sourceJobId)) return;
    // Filter out ads — they have id="image_ad_*", not "individual_internship_*"
    const id = $el.attr("id") || "";
    if (!id.startsWith("individual_internship_")) return;

    const title = $el.find(".job-title-href").first().text().trim();
    const company = $el.find(".company-name").first().text().trim();
    let location = $el.find(".row-1-item.locations span").first().text().trim();
    location = location.replace(/\s+/g, " ").trim();

    let urlPath = $el.attr("data-href") || $el.find(".job-title-href").attr("href") || "";
    let url = urlPath;
    if (urlPath && urlPath.startsWith("/")) url = `https://internshala.com${urlPath}`;
    if (!url) url = `https://internshala.com/${type === "job" ? "job" : "internship"}/detail/${sourceJobId}`;

    const jdText = $el.find(".about_job .text").first().text().replace(/\s+/g, " ").trim();

    if (!title || !company) return;
    seen.add(sourceJobId);
    out.push({
      sourceJobId,
      source: "internshala",
      title,
      company,
      location,
      url,
      // Internshala has its own apply flow (login required) — treat as external
      // since we'll click through and apply on their portal.
      applyType: "external",
      jdText,
    });
  });

  return out;
}
