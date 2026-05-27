import { execa } from "execa";
import { mkdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

export class CompileError extends Error {}

/**
 * Compile a .tex file to PDF using tectonic. Returns the output PDF path.
 * `bin` is overridable for testing the missing-binary path.
 */
export async function compilePdf(
  texPath: string,
  outDir: string,
  bin = "tectonic",
): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  try {
    await execa(bin, ["-o", outDir, texPath]);
  } catch (err) {
    throw new CompileError(`tectonic failed: ${(err as Error).message}`);
  }
  const stem = basename(texPath).replace(/\.tex$/, "");
  const pdf = join(outDir, `${stem}.pdf`);
  if (!existsSync(pdf)) {
    throw new CompileError(`PDF not produced at ${pdf}`);
  }
  return pdf;
}
