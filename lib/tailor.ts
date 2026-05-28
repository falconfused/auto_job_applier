import { completeJson, type CompleteJson } from "./llm";
import type { TailoredDocs } from "./types";

const SYSTEM =
  "You are a resume tailor. You receive a LaTeX master resume, a job description, the " +
  "candidate's profile, and optional edit instructions. Produce a tailored LaTeX resume " +
  "(same document class/structure as the master, truthful — never invent experience) and " +
  "a matching LaTeX cover letter.\n\n" +
  "TAILORING APPROACH:\n" +
  "  - Default to KEEPING all bullets, projects, and experiences from the master resume.\n" +
  "  - REWORD bullets to emphasize keywords/tech from THIS job description (don't invent — only re-frame).\n" +
  "  - Reorder so the most JD-relevant content appears first within each section.\n" +
  "  - PRESERVE bullet count and word count — match the master's density. The reader expects " +
  "    a full one-page resume, not a half-page one.\n\n" +
  "PAGE LIMIT (ONLY trigger if necessary):\n" +
  "  - BOTH the resume and cover letter must fit on EXACTLY ONE PAGE.\n" +
  "  - DO NOT pre-emptively trim. Only drop content if you are confident the master is too long.\n" +
  "  - If you must trim: drop the LEAST JD-relevant bullet first, never a whole project unless " +
  "    nothing else can fit.\n\n" +
  "COVER LETTER:\n" +
  "  - 3 substantive paragraphs (~300-400 words). Specific to the company and role.\n" +
  "  - Don't be brief just to be brief; fill the page when you have signal to share.\n\n" +
  "Respond ONLY as JSON: " +
  '{"resumeTex": "<full latex>", "coverLetterTex": "<full latex>"}';

interface TailorOpts {
  masterTex: string;
  jdText: string;
  profile: Record<string, unknown>;
  editNotes?: string;
  model?: string;
  complete?: CompleteJson;
}

export async function tailor(opts: TailorOpts): Promise<TailoredDocs> {
  const complete = opts.complete ?? completeJson;
  const user = JSON.stringify({
    masterResumeTex: opts.masterTex,
    jdText: opts.jdText,
    profile: opts.profile,
    editInstructions: opts.editNotes ?? "",
  });
  const data = await complete(SYSTEM, user, { model: opts.model });
  if (typeof data?.resumeTex !== "string" || typeof data?.coverLetterTex !== "string") {
    throw new Error("tailor: malformed LLM response (expected string resumeTex and coverLetterTex)");
  }
  return { resumeTex: data.resumeTex, coverLetterTex: data.coverLetterTex };
}
