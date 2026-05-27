import type { BrowserContext } from "playwright";
import { launchSession } from "./session.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to log in by hand
const POLL_MS = 3000;

/** LinkedIn sets the `li_at` auth cookie once a session is established. */
async function isLoggedIn(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies("https://www.linkedin.com");
  return cookies.some((c) => c.name === "li_at" && !!c.value);
}

/**
 * One-time manual login. Opens LinkedIn; you log in by hand (including 2FA) in the
 * opened window. The script polls for the `li_at` auth cookie and saves the session
 * to browser_profile/ automatically — no terminal interaction needed.
 */
async function main() {
  const context = await launchSession({ headless: false });
  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });
  console.log("\n>>> Log into LinkedIn in the opened browser window (handle any 2FA).");
  console.log(">>> Waiting for login to complete (up to 5 minutes)...\n");

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isLoggedIn(context)) {
      console.log("Login detected. Saving session to browser_profile/.");
      await context.close();
      process.exit(0);
    }
    await page.waitForTimeout(POLL_MS);
  }

  console.log("Timed out waiting for login. Run `npm run login` again.");
  await context.close();
  process.exit(1);
}

main();
