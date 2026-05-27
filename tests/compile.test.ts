import { describe, it, expect } from "vitest";
import { execaSync } from "execa";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePdf, CompileError } from "../lib/compile.js";

function hasTectonic(): boolean {
  try {
    execaSync("tectonic", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

describe("compilePdf", () => {
  it.skipIf(!hasTectonic())("produces a PDF from a .tex", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aja-"));
    const tex = join(dir, "resume.tex");
    writeFileSync(tex, readFileSync("tests/fixtures/sample_resume.tex", "utf8"));
    const pdf = await compilePdf(tex, dir);
    expect(existsSync(pdf)).toBe(true);
    expect(pdf.endsWith(".pdf")).toBe(true);
    expect(statSync(pdf).size).toBeGreaterThan(0);
  }, 60000);

  it("throws CompileError when tectonic binary is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aja-"));
    const tex = join(dir, "resume.tex");
    writeFileSync(tex, "x");
    await expect(compilePdf(tex, dir, "definitely-not-tectonic-xyz")).rejects.toBeInstanceOf(CompileError);
  });
});
