import { chromium, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { ROOT } from "../lib/paths.js";

const PROFILE_DIR = join(ROOT, "browser_profile");

/**
 * Launch the persistent, logged-in Chrome context. Headed by default so LinkedIn
 * sees a real browser. Auto-handles LinkedIn login via cookie or email+password.
 */
export async function launchSession(opts: { headless?: boolean } = {}): Promise<BrowserContext> {
  const systemDir = process.env.AJA_CHROME_USER_DATA_DIR;
  let context: BrowserContext;
  if (systemDir) {
    const profile = process.env.AJA_CHROME_PROFILE;
    context = await chromium.launchPersistentContext(systemDir, {
      channel: "chrome",
      headless: opts.headless ?? false,
      viewport: { width: 1280, height: 900 },
      args: profile ? [`--profile-directory=${profile}`] : [],
    });
  } else {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: opts.headless ?? false,
      viewport: { width: 1280, height: 900 },
    });
  }

  // Stealth: Naukri (and others) block sessions where navigator.webdriver === true.
  // Mask it before any page loads.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  // Inject LI_AT cookie if available — typically enough on its own.
  const liAt = process.env.LI_AT?.trim();
  if (liAt) {
    const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    await context.addCookies([
      {
        name: "li_at",
        value: liAt,
        domain: ".linkedin.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "None",
        expires: oneYear,
      },
    ]);
  }

  return context;
}

/**
 * Verify the session is logged in. If not, attempt email+password login using
 * LINKEDIN_EMAIL/LINKEDIN_PASSWORD env vars. Pauses for human if 2FA is required.
 * Returns true if logged in by the end.
 */
export async function ensureLoggedIn(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }).catch(() => {});

    // Already logged in?
    if (await isLoggedIn(page)) return true;

    // Need to log in
    const email = process.env.LINKEDIN_EMAIL?.trim();
    const password = process.env.LINKEDIN_PASSWORD?.trim();
    if (!email || !password) {
      console.warn("[session] Not logged in and LINKEDIN_EMAIL/LINKEDIN_PASSWORD not set");
      return false;
    }

    console.log("[session] Cookie failed — attempting email+password login");
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // LinkedIn renders multiple email/password inputs (some hidden duplicates).
    // Match visible ones via :visible and the modern autocomplete tokens.
    const emailInput = page
      .locator('input[type="email"]:visible, input[autocomplete*="username"]:visible, input[name="session_key"]:visible')
      .first();
    await emailInput.waitFor({ state: "visible", timeout: 15000 });
    await emailInput.fill(email);
    await page.waitForTimeout(400 + Math.random() * 400);

    const passInput = page
      .locator('input[type="password"]:visible, input[autocomplete="current-password"]:visible, input[name="session_password"]:visible')
      .first();
    await passInput.waitFor({ state: "visible", timeout: 5000 });
    await passInput.fill(password);
    await page.waitForTimeout(300 + Math.random() * 400);

    // LinkedIn renders 3 "Sign in" buttons: Google SSO (iframe, empty text),
    // Apple SSO, then the real email/password one. Find the button that's a sibling
    // of the password input we just filled — it's guaranteed to be the right one.
    const submit = passInput.locator(
      'xpath=ancestor::*[self::div or self::section][.//input[@type="password"]][1]//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "sign in") and not(contains(., "Apple")) and not(contains(., "Google")) and not(contains(., "Microsoft"))]',
    ).first();
    const clicked = await submit
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) {
      // Fallback: just press Enter on the password field
      await passInput.press("Enter");
    }

    // Wait for LinkedIn to actually navigate away from /login/.
    // Login redirect can take 5-15 seconds depending on network + LinkedIn's checks.
    await page
      .waitForURL((url) => !/\/login(?:\/|$|\?)/.test(url.toString()), { timeout: 30000 })
      .catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    if (await isLoggedIn(page)) {
      console.log("[session] Auto-login successful");
      return true;
    }

    // Probably 2FA / captcha — give the user time to solve it manually in the visible browser
    const url = page.url();
    if (/checkpoint|verification|two-step|challenge|captcha/i.test(url) || await page.locator("input#input__email_verification_pin, input[name=pin], input[autocomplete=one-time-code]").count() > 0) {
      console.log("[session] 2FA / verification required. You have 120 seconds to complete it in the browser window…");
      const start = Date.now();
      while (Date.now() - start < 120_000) {
        await page.waitForTimeout(2500);
        if (await isLoggedIn(page)) {
          console.log("[session] Verified — logged in");
          return true;
        }
      }
      console.warn("[session] Timed out waiting for 2FA");
      return false;
    }

    console.warn("[session] Login form submitted but not logged in. URL:", url);
    return false;
  } finally {
    await page.close();
  }
}

async function isLoggedIn(page: Page): Promise<boolean> {
  // Logged-out routes: /login, /authwall, /uas/login. Anything else means we're in.
  const url = page.url();
  if (/\/login(?:\/|$|\?)|\/authwall|\/uas\/login|\/checkpoint|\/signup/.test(url)) return false;
  // /feed/ alone is enough — LinkedIn doesn't redirect away from feed when authenticated
  if (/linkedin\.com\/(feed|jobs|in|mypreferences|me)\b/.test(url)) return true;
  // Otherwise look for nav markers
  const hasNav = await page
    .locator('nav.global-nav, [data-test-global-nav], [data-control-name="identity_welcome_message"]')
    .count();
  if (hasNav > 0) return true;
  const html = await page.content().catch(() => "");
  return /global-nav__me|feed-identity-module|"isAuthenticated":true/.test(html);
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
