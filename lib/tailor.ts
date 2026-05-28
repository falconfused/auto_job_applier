import { completeJson, type CompleteJson } from "./llm";
import type { TailoredDocs } from "./types";

const SYSTEM =
  "You are a resume tailor. You receive a LaTeX master resume, a job description, the " +
  "candidate's profile, and optional edit instructions. Produce a tailored LaTeX resume " +
  "(same document class/structure as the master, truthful — never invent experience) and " +
  "a matching one-page LaTeX cover letter. Respond ONLY as JSON: " +
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
