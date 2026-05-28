import { execa } from "execa";
import { mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export class CompileError extends Error {}

const AUX_EXTENSIONS = [".aux", ".log", ".out", ".toc", ".lof", ".lot", ".synctex.gz", ".fls", ".fdb_latexmk"];

/**
 * Compile a .tex file to PDF using xelatex (or any LaTeX engine via `bin`).
 * Returns the output PDF path. `bin` is overridable for tests / engine swap.
 * Auxiliary files (.aux, .log, .out, ...) are removed after a successful build.
 */
export async function compilePdf(
  texPath: string,
  outDir: string,
  bin = "xelatex",
): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  try {
    await execa(bin, ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", outDir, texPath]);
  } catch (err) {
    throw new CompileError(`${bin} failed: ${(err as Error).message}`);
  }
  const stem = basename(texPath).replace(/\.tex$/, "");
  const pdf = join(outDir, `${stem}.pdf`);
  if (!existsSync(pdf)) {
    throw new CompileError(`PDF not produced at ${pdf}`);
  }
  // Clean aux files — keep only the .tex source and .pdf output.
  for (const ext of AUX_EXTENSIONS) {
    rmSync(join(outDir, `${stem}${ext}`), { force: true });
  }
  return pdf;
}

/** Count pages in a PDF by counting "/Type /Page" objects in the raw stream. */
export function pdfPageCount(pdfPath: string): number {
  const buf = readFileSync(pdfPath);
  // Most reliable for raw (unencrypted) PDFs from xelatex
  const ascii = buf.toString("latin1");
  const matches = ascii.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}
