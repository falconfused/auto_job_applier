import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { tailor } from "./tailor";
import { compilePdf } from "./compile";
import type { Posting } from "./types";

export const TAILORED_ROOT = join(homedir(), "job_applications");

/** Sanitize a company name for safe use as a directory name. */
export function slugifyCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "unknown-company";
}

export interface TailorJobOpts {
  posting: Posting;
  masterTex: string;
  profile: Record<string, unknown>;
  model?: string;
}

export interface TailorJobResult {
  outDir: string;
  resumeTexPath: string;
  resumePdfPath: string;
  coverLetterTexPath: string;
  coverLetterPdfPath: string;
}

/**
 * Tailor a resume + cover letter for a single posting and compile both to PDF.
 * Output goes to ~/job_applications/<company-slug>-<source>-<sourceJobId>/.
 * Including source + job id keeps multiple postings from the same company across sources separate.
 */
export async function tailorAndCompile(opts: TailorJobOpts): Promise<TailorJobResult> {
  const slug = slugifyCompany(opts.posting.company);
  const outDir = join(
    TAILORED_ROOT,
    `${slug}-${opts.posting.source}-${opts.posting.sourceJobId}`,
  );
  mkdirSync(outDir, { recursive: true });

  const docs = await tailor({
    masterTex: opts.masterTex,
    jdText: opts.posting.jdText,
    profile: opts.profile,
    model: opts.model,
  });

  const resumeTexPath = join(outDir, "resume.tex");
  const coverLetterTexPath = join(outDir, "cover_letter.tex");
  writeFileSync(resumeTexPath, docs.resumeTex, "utf8");
  writeFileSync(coverLetterTexPath, docs.coverLetterTex, "utf8");

  const resumePdfPath = await compilePdf(resumeTexPath, outDir);
  const coverLetterPdfPath = await compilePdf(coverLetterTexPath, outDir);

  return { outDir, resumeTexPath, resumePdfPath, coverLetterTexPath, coverLetterPdfPath };
}
