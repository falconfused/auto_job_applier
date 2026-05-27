import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, loadProfile } from "../lib/config.js";

function tmpFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aja-cfg-"));
  const p = join(dir, name);
  writeFileSync(p, contents, "utf8");
  return p;
}

const GOOD = `
schedule:
  time: "20:00"
ranking:
  topN: 5
search:
  filters:
    - keywords: "SDE"
      location: "India"
apply:
  dailyCap: 3
  easyApplyOnly: true
llm:
  model: "claude-sonnet-4-6"
telegram:
  chatId: 42
`;

describe("loadSettings", () => {
  it("parses a valid settings file", () => {
    const s = loadSettings(tmpFile("settings.yaml", GOOD));
    expect(s.schedule.time).toBe("20:00");
    expect(s.ranking.topN).toBe(5);
    expect(s.search.filters[0].keywords).toBe("SDE");
    expect(s.apply.dailyCap).toBe(3);
    expect(s.apply.easyApplyOnly).toBe(true);
    expect(s.llm.model).toBe("claude-sonnet-4-6");
    expect(s.telegram.chatId).toBe(42);
  });

  it("rejects an invalid schedule time", () => {
    const bad = GOOD.replace('"20:00"', '"8pm"');
    expect(() => loadSettings(tmpFile("settings.yaml", bad))).toThrow();
  });
});

describe("loadProfile", () => {
  it("loads the profile json", () => {
    const p = tmpFile("profile.json", JSON.stringify({ name: "Vivek", email: "v@x.com" }));
    const prof = loadProfile(p);
    expect(prof.name).toBe("Vivek");
    expect(prof.email).toBe("v@x.com");
  });
});
