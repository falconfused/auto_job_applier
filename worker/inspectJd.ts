/** One-off: probe a real /jobs/view/<id> page for stable text anchors. */
import "dotenv/config";
delete process.env.AWS_PROFILE;
import * as cheerio from "cheerio";
import { launchSession, fetchHtml } from "./session.js";

async function main() {
  const url = process.argv[2];
  if (!url) { console.error("usage: tsx worker/inspectJd.ts <url>"); process.exit(1); }
  const ctx = await launchSession();
  const html = await fetchHtml(ctx, url, "body");
  await ctx.close();
  const $ = cheerio.load(html);

  console.log(`HTML length: ${html.length}`);

  console.log("\n=== headings under main ===");
  $("main h1, main h2, main h3").each((_: any, el: any) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t) console.log(`  [${el.name}] "${t.slice(0, 100)}"`);
  });

  console.log("\n=== long leaf-ish sections under main ===");
  $("main section, main div").each((_: any, el: any) => {
    const $el = $(el);
    if ($el.find("section,div").length > 4) return;
    const t = $el.text().replace(/\s+/g, " ").trim();
    if (t.length > 600 && t.length < 9000) {
      const cls = ($el.attr("class") || "").split(/\s+/).slice(0, 3).join(".");
      console.log(`  [${el.name}${cls ? "." + cls : ""} len=${t.length}] ${t.slice(0, 180)}…`);
    }
  });

  const mainTxt = $("main").text().replace(/\s+/g, " ").trim();
  console.log(`\nmain text length: ${mainTxt.length}`);
  console.log("[chars 400-1500]:", mainTxt.slice(400, 1500));
  console.log("\n[chars 1500-2500]:", mainTxt.slice(1500, 2500));
}
main();
