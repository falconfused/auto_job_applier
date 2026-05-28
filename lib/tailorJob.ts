import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { tailor } from "./tailor";
import { compilePdf, pdfPageCount } from "./compile";
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

  // First pass
  let docs = await tailor({
    masterTex: opts.masterTex,
    jdText: opts.posting.jdText,
    profile: opts.profile,
    model: opts.model,
  });

  const resumeTexPath = join(outDir, "resume.tex");
  const coverLetterTexPath = join(outDir, "cover_letter.tex");
  writeFileSync(resumeTexPath, docs.resumeTex, "utf8");
  writeFileSync(coverLetterTexPath, docs.coverLetterTex, "utf8");

  let resumePdfPath = await compilePdf(resumeTexPath, outDir);
  let coverLetterPdfPath = await compilePdf(coverLetterTexPath, outDir);

  // If either spilled to a 2nd page, retry once with explicit trim instructions
  const resumePages = pdfPageCount(resumePdfPath);
  const coverPages = pdfPageCount(coverLetterPdfPath);
  if (resumePages > 1 || coverPages > 1) {
    console.log(
      `[tailor] retry — resume=${resumePages}p cover=${coverPages}p (target 1 page each)`,
    );
    docs = await tailor({
      masterTex: docs.resumeTex, // start from the over-long version, trim it down
      jdText: opts.posting.jdText,
      profile: opts.profile,
      model: opts.model,
      editNotes:
        `URGENT TRIM: previous output was resume=${resumePages} pages, cover=${coverPages} pages. ` +
        `BOTH MUST be exactly 1 page. Drop the weakest 1-2 bullets, drop 1 project, ` +
        `tighten paragraphs. Keep the strongest content for THIS job description.`,
    });
    writeFileSync(resumeTexPath, docs.resumeTex, "utf8");
    writeFileSync(coverLetterTexPath, docs.coverLetterTex, "utf8");
    resumePdfPath = await compilePdf(resumeTexPath, outDir);
    coverLetterPdfPath = await compilePdf(coverLetterTexPath, outDir);
    const r2 = pdfPageCount(resumePdfPath);
    const c2 = pdfPageCount(coverLetterPdfPath);
    if (r2 > 1 || c2 > 1) {
      console.warn(
        `[tailor] still over 1 page after retry: resume=${r2}p cover=${c2}p — keeping anyway`,
      );
    }
  }

  return { outDir, resumeTexPath, resumePdfPath, coverLetterTexPath, coverLetterPdfPath };
}
