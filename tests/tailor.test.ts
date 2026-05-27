import { describe, it, expect } from "vitest";
import { tailor } from "../lib/tailor.js";

describe("tailor", () => {
  it("returns a tailored resume and cover letter", async () => {
    const complete = async () => ({
      resumeTex: "\\documentclass{article}\\begin{document}Tailored\\end{document}",
      coverLetterTex: "\\documentclass{article}\\begin{document}Dear\\end{document}",
    });
    const docs = await tailor({
      masterTex: "MASTER",
      jdText: "Build APIs",
      profile: { name: "Vivek" },
      editNotes: "",
      complete,
    });
    expect(docs.resumeTex).toContain("Tailored");
    expect(docs.coverLetterTex).toContain("Dear");
  });

  it("includes edit notes in the prompt", async () => {
    let capturedUser = "";
    const complete = async (_system: string, user: string) => {
      capturedUser = user;
      return { resumeTex: "x", coverLetterTex: "y" };
    };
    await tailor({
      masterTex: "MASTER",
      jdText: "JD",
      profile: {},
      editNotes: "emphasize python",
      complete,
    });
    expect(capturedUser).toContain("emphasize python");
  });
});
