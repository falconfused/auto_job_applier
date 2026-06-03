import * as cheerio from "cheerio";
import type { Posting, ApplyType } from "../lib/types.js";

// Selectors target LinkedIn's common job-card markup (logged-in results list + guest fallback).
const CARD = "div.job-card-container, li.jobs-search-results__list-item, div.base-card";
const TITLE = ".job-card-list__title, .base-search-card__title, a.job-card-container__link";
const COMPANY = ".job-card-container__primary-description, .base-search-card__subtitle, .artdeco-entity-lockup__subtitle";
const LOCATION = ".artdeco-entity-lockup__caption ul.job-card-container__metadata-wrapper li, .job-card-container__metadata-wrapper li, .job-card-container__metadata-item, .job-search-card__location";
const LINK = "a.job-card-container__link, a.base-card__full-link";
const EASY_APPLY_HINT = "Easy Apply";

function text($el: cheerio.Cheerio<any>): string {
  return $el.first().text().replace(/\s+/g, " ").trim();
}

function jobIdOf($: cheerio.CheerioAPI, el: any): string {
  const $el = $(el);
  const direct = $el.attr("data-job-id") || $el.find("[data-job-id]").first().attr("data-job-id");
  if (direct) return direct.trim();
  const urn = $el.attr("data-entity-urn") || $el.find("[data-entity-urn]").first().attr("data-entity-urn");
  const m = urn?.match(/(\d{6,})/);
  if (m) return m[1];
  const href = $el.find(LINK).first().attr("href") || "";
  const hm = href.match(/\/jobs\/view\/(\d+)/) || href.match(/currentJobId=(\d+)/);
  return hm ? hm[1] : "";
}

export function parseSearchHtml(html: string): Posting[] {
  const $ = cheerio.load(html);
  const out: Posting[] = [];
  const seen = new Set<string>();

  $(CARD).each((_, el) => {
    const $el = $(el);
    const sourceJobId = jobIdOf($, el);
    if (!sourceJobId || seen.has(sourceJobId)) return;

    const title = text($el.find(TITLE));
    const company = text($el.find(COMPANY));
    const location = text($el.find(LOCATION));
    let url = $el.find(LINK).first().attr("href") || "";
    if (url.startsWith("/")) url = "https://www.linkedin.com" + url;
    if (!url) url = `https://www.linkedin.com/jobs/view/${sourceJobId}`;

    const applyType: ApplyType = $el.text().includes(EASY_APPLY_HINT) ? "easy_apply" : "external";

    // Extract salary if visible on the card. LinkedIn surfaces this as a metadata item
    // when the poster opted to show pay; format examples: "$80K/yr - $120K/yr", "₹4-8 LPA".
    const cardText = $el.text();
    const salaryMatch =
      cardText.match(/[₹$€£][\d,.]+\s*(?:K|L|LPA|LACS?|Cr|M)?\s*[-–]\s*[₹$€£]?[\d,.]+\s*(?:K|L|LPA|LACS?|Cr|M)?(?:\s*\/\s*\w+)?/i) ||
      cardText.match(/[₹$][\d,]+\s*(?:K|L|LPA)?\s*\/\s*(?:yr|hr|month|year)/i);
    const salary = salaryMatch?.[0]?.trim() || undefined;

    if (!title || !company) return;
    seen.add(sourceJobId);
    out.push({
      sourceJobId,
      source: "linkedin",
      title,
      company,
      location,
      url,
      applyType,
      jdText: "",
      ...(salary ? { salary } : {}),
    });
  });

  return out;
}
