import { completeJson, type CompleteJson } from "./llm";
import type { TailoredDocs } from "./types";

const SYSTEM =
  "You are a resume tailor. You receive a LaTeX master resume, a job description, the " +
  "candidate's profile, and optional edit instructions. Produce a tailored LaTeX resume " +
  "(same document class/structure as the master, truthful — never invent experience) and " +
  "a matching LaTeX cover letter.\n\n" +
  "HARD CONSTRAINT: BOTH the resume and the cover letter MUST fit on EXACTLY ONE PAGE. " +
  "This is non-negotiable for entry-level candidates. To stay within one page:\n" +
  "  - Drop bullet points or whole sub-bullets that are weakest for THIS posting\n" +
  "  - Trim wordy bullets to ≤ 2 lines each\n" +
  "  - Drop projects/experiences that are least relevant to the JD (keep 2-3 strongest)\n" +
  "  - Compress whitespace if needed (smaller \\vspace, tighter \\setlength{\\parskip})\n" +
  "  - For the cover letter: 3 paragraphs max, ~250 words total, no closing fluff\n" +
  "Never go to a second page just to fit more content. Less is more.\n\n" +
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
