import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { tailorResume, tailorCoverLetter } from "./tailor";
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

export interface ResumeResult {
  outDir: string;
  resumeTexPath: string;
  resumePdfPath: string;
}

export interface CoverResult {
  outDir: string;
  coverLetterTexPath: string;
  coverLetterPdfPath: string;
}

/** Combined result kept for backward compat with the existing tailorAndCompile contract. */
export interface TailorJobResult extends ResumeResult, CoverResult {}

function outDirFor(posting: Posting): string {
  const slug = slugifyCompany(posting.company);
  return join(TAILORED_ROOT, `${slug}-${posting.source}-${posting.sourceJobId}`);
}

/**
 * Tailor + compile JUST the resume. This is the primary "Apply" action — fast and
 * cheap. The cover letter is generated lazily on a separate click.
 */
export async function tailorResumeOnly(opts: TailorJobOpts): Promise<ResumeResult> {
  const outDir = outDirFor(opts.posting);
  mkdirSync(outDir, { recursive: true });

  let { resumeTex } = await tailorResume({
    masterTex: opts.masterTex,
    jdText: opts.posting.jdText,
    profile: opts.profile,
    model: opts.model,
  });

  const resumeTexPath = join(outDir, "resume.tex");
  writeFileSync(resumeTexPath, resumeTex, "utf8");
  let resumePdfPath = await compilePdf(resumeTexPath, outDir);

  // Density / page-fit retry (resume only)
  const masterWords = countWords(opts.masterTex);
  const pages = pdfPageCount(resumePdfPath);
  const tailoredWords = countWords(resumeTex);
  const action: "ok" | "trim" | "expand" =
    pages > 1 ? "trim" : tailoredWords < masterWords * 0.8 ? "expand" : "ok";

  if (action !== "ok") {
    console.log(
      `[tailor] retry (${action}) — resume=${pages}p tailored=${tailoredWords}w master=${masterWords}w`,
    );
    const editNotes =
      action === "trim"
        ? `URGENT TRIM: previous resume was ${pages} pages. Must be exactly 1 page. Drop the ` +
          `weakest 1-2 bullets, tighten paragraphs.`
        : `EXPAND: previous tailored resume was only ${tailoredWords} words vs master ${masterWords} ` +
          `words — that leaves a half-empty page. Restore missing bullets/content from the master, ` +
          `re-worded for THIS job description. The page should look full top-to-bottom.`;
    const next = await tailorResume({
      masterTex: action === "trim" ? resumeTex : opts.masterTex,
      jdText: opts.posting.jdText,
      profile: opts.profile,
      model: opts.model,
      editNotes,
    });
    resumeTex = next.resumeTex;
    writeFileSync(resumeTexPath, resumeTex, "utf8");
    resumePdfPath = await compilePdf(resumeTexPath, outDir);
    const p2 = pdfPageCount(resumePdfPath);
    const w2 = countWords(resumeTex);
    console.log(`[tailor] post-retry: resume=${p2}p tailored=${w2}w`);
    if (p2 > 1) console.warn(`[tailor] resume still over 1 page after retry — keeping anyway`);
  }

  return { outDir, resumeTexPath, resumePdfPath };
}

/**
 * Tailor + compile JUST the cover letter. Requires that the resume has already been
 * tailored (we read the tailored resume.tex and use it as additional context).
 */
export async function tailorCoverOnly(opts: TailorJobOpts): Promise<CoverResult> {
  const outDir = outDirFor(opts.posting);
  mkdirSync(outDir, { recursive: true });

  // Use the tailored resume if it exists; otherwise fall back to the master.
  const tailoredResumePath = join(outDir, "resume.tex");
  const resumeTex = existsSync(tailoredResumePath)
    ? readFileSync(tailoredResumePath, "utf8")
    : opts.masterTex;

  let { coverLetterTex } = await tailorCoverLetter({
    resumeTex,
    masterTex: opts.masterTex,
    jdText: opts.posting.jdText,
    profile: opts.profile,
    model: opts.model,
  });

  const coverLetterTexPath = join(outDir, "cover_letter.tex");
  writeFileSync(coverLetterTexPath, coverLetterTex, "utf8");
  let coverLetterPdfPath = await compilePdf(coverLetterTexPath, outDir);

  // Page-fit retry (cover letter only)
  const pages = pdfPageCount(coverLetterPdfPath);
  if (pages > 1) {
    console.log(`[tailor] cover retry — was ${pages} pages`);
    const next = await tailorCoverLetter({
      resumeTex,
      masterTex: opts.masterTex,
      jdText: opts.posting.jdText,
      profile: opts.profile,
      model: opts.model,
      editNotes: `TRIM: previous cover letter was ${pages} pages. Must be exactly 1 page. ` +
        `Tighten paragraphs to ~280 words total. Drop fluff but keep specifics about company + role.`,
    });
    coverLetterTex = next.coverLetterTex;
    writeFileSync(coverLetterTexPath, coverLetterTex, "utf8");
    coverLetterPdfPath = await compilePdf(coverLetterTexPath, outDir);
    const p2 = pdfPageCount(coverLetterPdfPath);
    if (p2 > 1) console.warn(`[tailor] cover still over 1 page after retry — keeping anyway`);
  }

  return { outDir, coverLetterTexPath, coverLetterPdfPath };
}

/**
 * Backward-compat wrapper: tailor BOTH resume + cover letter.
 * Used by older code paths and tests; new flow uses tailorResumeOnly / tailorCoverOnly.
 */
export async function tailorAndCompile(opts: TailorJobOpts): Promise<TailorJobResult> {
  const r = await tailorResumeOnly(opts);
  const c = await tailorCoverOnly(opts);
  return {
    outDir: r.outDir,
    resumeTexPath: r.resumeTexPath,
    resumePdfPath: r.resumePdfPath,
    coverLetterTexPath: c.coverLetterTexPath,
    coverLetterPdfPath: c.coverLetterPdfPath,
  };
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
