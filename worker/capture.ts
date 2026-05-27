import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchSession, fetchHtml } from "./session.js";
import { ROOT } from "../lib/paths.js";

/**
 * Capture a LinkedIn jobs search-results page to a fixture for parser development.
 * Usage: npm run capture -- "https://www.linkedin.com/jobs/search/?keywords=..."
 * Requires a prior `npm run login`.
 */
async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npm run capture -- "<linkedin jobs search url>"');
    process.exit(1);
  }
  const context = await launchSession({ headless: false });
  const html = await fetchHtml(context, url, "body");
  await context.close();
  const out = join(ROOT, "tests", "fixtures", "linkedin_search.html");
  mkdirSync(join(ROOT, "tests", "fixtures"), { recursive: true });
  writeFileSync(out, html, "utf8");
  console.log(`Saved ${html.length} bytes to ${out}`);
  process.exit(0);
}

main();
