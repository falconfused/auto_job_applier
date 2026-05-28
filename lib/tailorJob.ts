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

  // Decide: over a page, or significantly under-filled?
  const masterWords = countWords(opts.masterTex);
  const decision = (): "ok" | "trim" | "expand" => {
    const resumePages = pdfPageCount(resumePdfPath);
    const coverPages = pdfPageCount(coverLetterPdfPath);
    if (resumePages > 1 || coverPages > 1) return "trim";
    const tailoredWords = countWords(docs.resumeTex);
    // If tailored is < 80% of master AND fits on 1 page → likely over-trimmed
    if (tailoredWords < masterWords * 0.8) return "expand";
    return "ok";
  };

  let action = decision();
  if (action !== "ok") {
    const resumePages = pdfPageCount(resumePdfPath);
    const coverPages = pdfPageCount(coverLetterPdfPath);
    const tailoredWords = countWords(docs.resumeTex);
    console.log(
      `[tailor] retry (${action}) — resume=${resumePages}p cover=${coverPages}p ` +
        `tailored=${tailoredWords}w master=${masterWords}w`,
    );

    const editNotes =
      action === "trim"
        ? `URGENT TRIM: previous output was resume=${resumePages} pages, cover=${coverPages} pages. ` +
          `BOTH MUST be exactly 1 page. Drop the weakest 1-2 bullets, tighten paragraphs.`
        : `EXPAND: the previous tailored resume was only ${tailoredWords} words versus the ` +
          `master's ${masterWords} words — that leaves a half-empty page. Restore the missing ` +
          `bullets and content from the master, but keep them re-worded for THIS job description. ` +
          `The page should look full top-to-bottom. Cover letter: 3 substantive paragraphs (~300-400 words).`;

    docs = await tailor({
      // For "expand", give the model the master so it can pull missing content back.
      masterTex: action === "trim" ? docs.resumeTex : opts.masterTex,
      jdText: opts.posting.jdText,
      profile: opts.profile,
      model: opts.model,
      editNotes,
    });
    writeFileSync(resumeTexPath, docs.resumeTex, "utf8");
    writeFileSync(coverLetterTexPath, docs.coverLetterTex, "utf8");
    resumePdfPath = await compilePdf(resumeTexPath, outDir);
    coverLetterPdfPath = await compilePdf(coverLetterTexPath, outDir);

    const r2 = pdfPageCount(resumePdfPath);
    const c2 = pdfPageCount(coverLetterPdfPath);
    const w2 = countWords(docs.resumeTex);
    console.log(`[tailor] post-retry: resume=${r2}p cover=${c2}p tailored=${w2}w`);
    if (r2 > 1 || c2 > 1) {
      console.warn(`[tailor] still over 1 page after retry — keeping anyway`);
    }
  }

  return { outDir, resumeTexPath, resumePdfPath, coverLetterTexPath, coverLetterPdfPath };
}

/** Count "words" in LaTeX content — strip commands first to avoid counting \textbf etc. */
function countWords(tex: string): number {
  const stripped = tex
    .replace(/^[\s\S]*?\\begin\{document\}/m, "")
    .replace(/\\end\{document\}[\s\S]*$/m, "")
    .replace(/\\[a-zA-Z]+\*?/g, " ")
    .replace(/[{}]/g, " ");
  return stripped.split(/\s+/).filter(Boolean).length;
}
