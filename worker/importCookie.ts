import { launchSession, fetchHtml } from "./session.js";

/**
 * Seed the tool's dedicated browser profile with a LinkedIn session by injecting the
 * `li_at` auth cookie copied from your own Chrome (DevTools > Application > Cookies).
 * Usage: LI_AT="<value>" npm run import-cookie
 * No need to quit Chrome; this writes to browser_profile/, not your Chrome profile.
 */
async function main() {
  const value = process.env.LI_AT?.trim();
  if (!value) {
    console.error('Set LI_AT to your linkedin li_at cookie value: LI_AT="..." npm run import-cookie');
    process.exit(1);
  }
  const context = await launchSession({ headless: true });
  const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  await context.addCookies([
    {
      name: "li_at",
      value,
      domain: ".linkedin.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "None",
      expires: oneYear,
    },
  ]);

  // Verify: an authenticated feed load should not bounce to the login/auth wall.
  const html = await fetchHtml(context, "https://www.linkedin.com/feed/");
  await context.close();

  const loggedOut = /\/uas\/login|Sign in to LinkedIn|join now/i.test(html) && !/feed-identity-module|global-nav__me/i.test(html);
  if (loggedOut) {
    console.error("Cookie injected but the session looks logged OUT — the li_at value may be wrong/expired.");
    process.exit(2);
  }
  console.log("Session seeded into browser_profile/ — LinkedIn looks logged IN.");
  process.exit(0);
}

main();
