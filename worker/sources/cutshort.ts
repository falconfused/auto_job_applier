import * as cheerio from "cheerio";
import type { Posting } from "../../lib/types.js";

/**
 * Cutshort URL builder + parser.
 *
 * Cutshort URLs follow /jobs/<slug>-jobs-in-india pattern. CSS classes are
 * styled-components hashed (sc-XXXXX), so the parser keys off href patterns
 * rather than class names.
 *
 * Each card root is the closest container of a /job/<title>-<id> anchor.
 * The id is the last hyphen-segment of the slug.
 */

export interface CutshortFilter {
  /** Slug like "full-stack-developer", "backend-developer", "fullstack-engineer". */
  role?: string;
  /** Location slug. Default "india" for nation-wide. */
  location?: string;
}

export function buildCutshortUrl(f: CutshortFilter): string {
  if (f.role) {
    const loc = f.location ?? "india";
    return `https://cutshort.io/jobs/${f.role}-jobs-in-${loc}`;
  }
  return "https://cutshort.io/jobs";
}

const JOB_LINK_RE = /^https?:\/\/cutshort\.io\/job\/.+-([A-Za-z0-9]+)$/;

export function parseCutshortHtml(html: string): Posting[] {
  const $ = cheerio.load(html);
  const out: Posting[] = [];
  const seen = new Set<string>();

  // Each job card has a title <a> pointing at /job/<title>-<id>.
  // Use the anchor href as the anchor point, then climb up to the card row.
  $('a[href*="cutshort.io/job/"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";
    const m = href.match(JOB_LINK_RE);
    const sourceJobId = m ? m[1] : "";
    if (!sourceJobId || seen.has(sourceJobId)) return;

    const title = $a.text().replace(/\s+/g, " ").trim();
    if (!title) return;

    // Walk up to the row container (~6 ancestors up reliably hits the card).
    // Easier: take the closest ancestor that has both title-anchor + ≥1 sibling text element.
    let $card: cheerio.Cheerio<any> = $a;
    for (let i = 0; i < 8; i++) {
      const $parent = $card.parent();
      if ($parent.length === 0) break;
      $card = $parent;
      // Stop when card text contains both the title and something else (company/location)
      const cardText = $card.text();
      if (cardText.length > title.length + 20) break;
    }
    const cardText = $card.text().replace(/\s+/g, " ");

    // Heuristic company: first non-title block text inside the card. Cutshort
    // renders company name very near the title. Fallback to "" if can't isolate.
    const after = cardText.split(title)[1] ?? "";
    // First "Company at <co>" or strip common chrome
    const companyMatch = after.match(/^[\s|,•·-]*([A-Z][\w& .,'-]{2,60}?)(?=[\s|,•·-]+\s|$|\d|At\s)/);
    const company = companyMatch?.[1]?.trim() || "";

    // Salary: ₹X-Y LPA / $X-Y / etc.
    const salaryMatch = cardText.match(/[₹$][\d,.]+\s*(?:K|L|LPA|LACS?|Cr|M)?\s*[-–]\s*[₹$]?[\d,.]+\s*(?:K|L|LPA|LACS?|Cr|M)?/i);
    const salary = salaryMatch?.[0]?.trim();

    seen.add(sourceJobId);
    out.push({
      sourceJobId,
      source: "cutshort",
      title,
      company: company || "(unknown)",
      location: "",
      url: href,
      applyType: "external",
      jdText: "",
      ...(salary ? { salary } : {}),
    });
  });

  return out;
}
