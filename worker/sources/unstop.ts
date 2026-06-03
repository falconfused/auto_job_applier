import * as cheerio from "cheerio";
import type { Posting } from "../../lib/types.js";

/**
 * Unstop URL builder + parser. Unstop has /jobs and /internships top-level routes
 * and supports query filters: oppstatus=open, category, location.
 *
 * The page is an Angular SPA; ingest must allow JS hydration before snapshot.
 */

export type UnstopType = "jobs" | "internships";

export interface UnstopFilter {
  type: UnstopType;
  /** Slug like "engineering", "computer-science-and-it". */
  category?: string;
  /** Free-text location filter, e.g. "delhi", "bangalore", "remote". */
  location?: string;
}

export function buildUnstopUrl(f: UnstopFilter): string {
  const url = new URL(`/${f.type}`, "https://unstop.com");
  url.searchParams.set("oppstatus", "open");
  if (f.category) url.searchParams.set("category", f.category);
  if (f.location) url.searchParams.set("location", f.location);
  return url.toString();
}

export function parseUnstopHtml(
  html: string,
  type: UnstopType = "jobs",
): Posting[] {
  const $ = cheerio.load(html);
  const out: Posting[] = [];
  const seen = new Set<string>();

  // Each card is an <a> with classes including "item" and "opp_<id>"
  $('a[class*="opp_"]').each((_, el) => {
    const $el = $(el);
    const classAttr = $el.attr("class") || "";
    const m = classAttr.match(/opp_(\d+)/);
    const sourceJobId = m ? m[1] : "";
    if (!sourceJobId || seen.has(sourceJobId)) return;

    const title = $el.find("h3[itemprop='name']").first().text().replace(/\s+/g, " ").trim();
    const company = $el.find("p.single-wrap").first().text().replace(/\s+/g, " ").trim();

    let url = $el.find("meta[itemprop='url']").first().attr("content") || "";
    if (!url) {
      const href = $el.attr("href") || "";
      url = href.startsWith("http") ? href : `https://unstop.com${href}`;
    }

    // Salary / stipend may appear in .other_fields blocks; cast a wide net
    const cardText = $el.text();
    const salaryMatch = cardText.match(/[₹$][\d,.]+\s*(?:K|L|LPA|LACS?|Cr|M)?\s*[-–]\s*[₹$]?[\d,.]+\s*(?:K|L|LPA|LACS?|Cr|M)?(?:\s*\/\s*\w+)?/i);
    const stipendMatch = cardText.match(/Stipend[:\s]*([₹$][\d,.]+(?:\s*[-–]\s*[\d,.]+)?\s*(?:\/\s*\w+)?)/i);

    if (!title || !company) return;
    seen.add(sourceJobId);
    const isInternship = type === "internships";
    const pay = (stipendMatch?.[1] || salaryMatch?.[0] || "").trim();
    out.push({
      sourceJobId,
      source: "unstop",
      title,
      company,
      location: "",
      url,
      applyType: "external",
      jdText: "",
      ...(pay && isInternship ? { stipend: pay } : {}),
      ...(pay && !isInternship ? { salary: pay } : {}),
    });
  });

  return out;
}
