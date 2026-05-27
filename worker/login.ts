import { launchSession } from "./session.js";

/**
 * One-time manual login. Opens LinkedIn; you log in by hand (including 2FA).
 * Press Enter in the terminal once you see your feed/home, and the session is saved
 * to browser_profile/ for reuse by ingest/apply.
 */
async function main() {
  const context = await launchSession({ headless: false });
  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });
  console.log("\n>>> Log into LinkedIn in the opened browser window (handle any 2FA).");
  console.log(">>> When you can see your LinkedIn home feed, press Enter here to save the session.\n");
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
  await context.close();
  console.log("Session saved to browser_profile/. You can close this.");
  process.exit(0);
}

main();
