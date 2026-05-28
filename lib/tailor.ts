import { completeJson, type CompleteJson } from "./llm";
import type { TailoredDocs } from "./types";

const RESUME_SYSTEM =
  "You are a resume tailor. You receive a LaTeX master resume, a job description, " +
  "the candidate's profile, and optional edit instructions. Produce a tailored LaTeX " +
  "resume (same document class/structure as the master, truthful — never invent " +
  "experience).\n\n" +
  "TAILORING APPROACH:\n" +
  "  - Default to KEEPING all bullets, projects, and experiences from the master resume.\n" +
  "  - REWORD bullets to emphasize keywords/tech from THIS job description (don't invent — only re-frame).\n" +
  "  - Reorder so the most JD-relevant content appears first within each section.\n" +
  "  - PRESERVE bullet count and word count — match the master's density. The reader expects " +
  "    a full one-page resume, not a half-page one.\n\n" +
  "PAGE LIMIT (ONLY trigger if necessary):\n" +
  "  - The resume MUST fit on EXACTLY ONE PAGE.\n" +
  "  - DO NOT pre-emptively trim. Only drop content if you are confident the master is too long.\n" +
  "  - If you must trim: drop the LEAST JD-relevant bullet first, never a whole project unless " +
  "    nothing else can fit.\n\n" +
  'Respond ONLY as JSON: {"resumeTex": "<full latex>"}';

const COVER_SYSTEM =
  "You are a cover-letter writer. You receive a LaTeX resume, a job description, " +
  "the candidate's profile, and optional edit instructions. Produce a tailored LaTeX " +
  "cover letter — truthful, specific to THIS company and role.\n\n" +
  "REQUIREMENTS:\n" +
  "  - 3 substantive paragraphs (~300-400 words).\n" +
  "  - Reference specific tech / responsibilities from the JD; pull concrete proof points " +
  "    from the resume (projects, metrics, technologies).\n" +
  "  - Don't be brief just to be brief — fill the page when you have signal to share.\n" +
  "  - Must fit on exactly one page.\n" +
  "  - Use clean LaTeX (article class, parskip, hyperref). No exotic packages.\n\n" +
  'Respond ONLY as JSON: {"coverLetterTex": "<full latex>"}';

// Legacy combined prompt — used by existing tailor() for backward compat with tests.
const COMBINED_SYSTEM =
  RESUME_SYSTEM.replace(
    'Respond ONLY as JSON: {"resumeTex": "<full latex>"}',
    "",
  ).trim() +
  "\n\nALSO produce a matching cover letter — 3 substantive paragraphs (~300-400 words), " +
  "specific to the company and role.\n\n" +
  'Respond ONLY as JSON: {"resumeTex": "<full latex>", "coverLetterTex": "<full latex>"}';

interface BaseOpts {
  masterTex: string;
  jdText: string;
  profile: Record<string, unknown>;
  editNotes?: string;
  model?: string;
  complete?: CompleteJson;
}

/** Tailor resume only — used by the on-click "Apply" button. */
export async function tailorResume(opts: BaseOpts): Promise<{ resumeTex: string }> {
  const complete = opts.complete ?? completeJson;
  const user = JSON.stringify({
    masterResumeTex: opts.masterTex,
    jdText: opts.jdText,
    profile: opts.profile,
    editInstructions: opts.editNotes ?? "",
  });
  const data = await complete(RESUME_SYSTEM, user, { model: opts.model });
  if (typeof data?.resumeTex !== "string") {
    throw new Error("tailorResume: malformed LLM response (expected string resumeTex)");
  }
  return { resumeTex: data.resumeTex };
}

interface CoverOpts extends BaseOpts {
  /** The TAILORED resume (LaTeX) to derive the cover letter from. */
  resumeTex: string;
}

/** Tailor cover letter only — used by the on-click "Generate cover letter" button. */
export async function tailorCoverLetter(opts: CoverOpts): Promise<{ coverLetterTex: string }> {
  const complete = opts.complete ?? completeJson;
  const user = JSON.stringify({
    tailoredResumeTex: opts.resumeTex,
    masterResumeTex: opts.masterTex,
    jdText: opts.jdText,
    profile: opts.profile,
    editInstructions: opts.editNotes ?? "",
  });
  const data = await complete(COVER_SYSTEM, user, { model: opts.model });
  if (typeof data?.coverLetterTex !== "string") {
    throw new Error("tailorCoverLetter: malformed LLM response (expected string coverLetterTex)");
  }
  return { coverLetterTex: data.coverLetterTex };
}

/** Legacy combined call — tests still rely on this contract. Returns BOTH docs in one call. */
export async function tailor(opts: BaseOpts): Promise<TailoredDocs> {
  const complete = opts.complete ?? completeJson;
  const user = JSON.stringify({
    masterResumeTex: opts.masterTex,
    jdText: opts.jdText,
    profile: opts.profile,
    editInstructions: opts.editNotes ?? "",
  });
  const data = await complete(COMBINED_SYSTEM, user, { model: opts.model });
  if (typeof data?.resumeTex !== "string" || typeof data?.coverLetterTex !== "string") {
    throw new Error("tailor: malformed LLM response (expected string resumeTex and coverLetterTex)");
  }
  return { resumeTex: data.resumeTex, coverLetterTex: data.coverLetterTex };
}
