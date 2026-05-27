import { chromium, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { ROOT } from "../lib/paths.js";

const PROFILE_DIR = join(ROOT, "browser_profile");

/**
 * Launch the persistent, logged-in Chrome context. Headed by default so LinkedIn
 * sees a real browser.
 *
 * Two modes:
 *  - Default: a dedicated profile under browser_profile/ (bundled Chromium). Used by tests
 *    and the eventual scheduler.
 *  - System Chrome: set AJA_CHROME_USER_DATA_DIR (and optionally AJA_CHROME_PROFILE, e.g.
 *    "Profile 5") to reuse your installed Google Chrome and an existing logged-in profile.
 *    Google Chrome must be fully quit first (it locks the profile directory).
 */
export async function launchSession(opts: { headless?: boolean } = {}): Promise<BrowserContext> {
  const systemDir = process.env.AJA_CHROME_USER_DATA_DIR;
  if (systemDir) {
    const profile = process.env.AJA_CHROME_PROFILE;
    return chromium.launchPersistentContext(systemDir, {
      channel: "chrome",
      headless: opts.headless ?? false,
      viewport: { width: 1280, height: 900 },
      args: profile ? [`--profile-directory=${profile}`] : [],
    });
  }
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: opts.headless ?? false,
    viewport: { width: 1280, height: 900 },
  });
}

/** Navigate to a URL in the persistent session and return the page's HTML. Caller closes the context. */
export async function fetchHtml(context: BrowserContext, url: string, waitSelector?: string): Promise<string> {
  const page: Page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(1500 + Math.random() * 1500); // human-like settle
    return await page.content();
  } finally {
    await page.close();
  }
}
