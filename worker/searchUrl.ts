interface FilterLike {
  keywords: string;
  location: string;
  experienceLevel: string;
  datePosted: string;
}

const DATE_POSTED: Record<string, string> = {
  "past-24h": "r86400",
  "past-week": "r604800",
  "past-month": "r2592000",
};

const EXPERIENCE: Record<string, string> = {
  internship: "1",
  entry: "2",
  associate: "3",
  "mid-senior": "4",
  director: "5",
  executive: "6",
};

/** Build a LinkedIn jobs-search URL from a search filter. */
export function buildSearchUrl(filter: FilterLike, opts: { easyApplyOnly?: boolean } = {}): string {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", filter.keywords);
  if (filter.location) url.searchParams.set("location", filter.location);
  const tpr = DATE_POSTED[filter.datePosted];
  if (tpr) url.searchParams.set("f_TPR", tpr);
  const exp = EXPERIENCE[filter.experienceLevel];
  if (exp) url.searchParams.set("f_E", exp);
  if (opts.easyApplyOnly) url.searchParams.set("f_AL", "true");
  return url.toString();
}
