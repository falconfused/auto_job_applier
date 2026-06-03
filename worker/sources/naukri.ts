import * as cheerio from "cheerio";
import type { Posting } from "../../lib/types.js";

/**
 * Naukri.com URL builder + HTML parser.
 *
 * Naukri uses a slug-based URL: /<keyword-slug>-jobs-in-<location-slug>?k=<csv>&l=<csv>&experience=<years>
 * Example:
 *   /backend-developer-jobs-in-noida?k=backend%20developer&l=noida&experience=0
 *
 * Anti-bot caveat: Naukri returns 403 to Playwright unless we run non-headless and mask
 * navigator.webdriver. The session.ts launchSession() runs non-headless by default; the
 * webdriver mask is added in fetchHtml() via page.addInitScript.
 */

export interface NaukriFilter {
  /** Comma-separated keywords. */
  keywords: string;
  /** Comma-separated locations. */
  location: string;
  /** Years of experience: "0" for fresher, "0-1", "1-3", etc. */
  experience?: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildNaukriUrl(f: NaukriFilter): string {
  const kwSlug = f.keywords.split(",").map((k) => slugify(k.trim())).filter(Boolean).join("-");
  const locSlug = slugify(f.location.split(",")[0].trim());
  const path = `/${kwSlug}-jobs-in-${locSlug}`;
  const url = new URL(path, "https://www.naukri.com");
  url.searchParams.set("k", f.keywords);
  url.searchParams.set("l", f.location);
  if (f.experience !== undefined) url.searchParams.set("experience", f.experience);
  return url.toString();
}

const CARD = ".srp-jobtuple-wrapper";
const TITLE = "h2 > a.title, .title";
const COMPANY = "a.comp-name";
const LOCATION = ".loc-wrap .locWdth";
const EXPERIENCE = ".exp-wrap .expwdth";
const SALARY = ".sal-wrap .salwdth, .salary";
const JD_PREVIEW = ".job-desc";

function text($el: cheerio.Cheerio<any>): string {
  return $el.first().text().replace(/\s+/g, " ").trim();
}

export function parseNaukriHtml(html: string): Posting[] {
  const $ = cheerio.load(html);
  const out: Posting[] = [];
  const seen = new Set<string>();

  $(CARD).each((_, el) => {
    const $el = $(el);
    const sourceJobId = ($el.attr("data-job-id") || "").trim();
    if (!sourceJobId || seen.has(sourceJobId)) return;

    const $title = $el.find(TITLE).first();
    const title = $title.text().replace(/\s+/g, " ").trim();
    let url = $title.attr("href") || "";
    if (url.startsWith("/")) url = `https://www.naukri.com${url}`;
    if (!url) url = `https://www.naukri.com/job-listings-${sourceJobId}`;

    const company = text($el.find(COMPANY));
    let location = text($el.find(LOCATION));
    // Sometimes location renders as multiple chunks separated by spaces; collapse
    location = location.replace(/\s*,\s*/g, ", ");

    const experience = text($el.find(EXPERIENCE));
    const salary = text($el.find(SALARY));
    const jdPreview = text($el.find(JD_PREVIEW));
    const jdText = [experience ? `Experience: ${experience}` : null, jdPreview]
      .filter(Boolean)
      .join("\n");

    if (!title || !company) return;
    seen.add(sourceJobId);
    out.push({
      sourceJobId,
      source: "naukri",
      title,
      company,
      location,
      url,
      applyType: "external",
      jdText,
      ...(salary ? { salary } : {}),
    });
  });

  return out;
}
