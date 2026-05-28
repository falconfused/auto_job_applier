export type ApplyType = "easy_apply" | "external";

export type JobSource = "linkedin" | "internshala" | "unstop" | "cutshort" | "naukri" | "wellfound" | "hirist";

export interface Posting {
  /** Stable id within the source (e.g. LinkedIn job-id, Internshala internship-id). */
  sourceJobId: string;
  /** Where this posting came from. */
  source: JobSource;
  title: string;
  company: string;
  location: string;
  url: string;
  applyType: ApplyType;
  jdText: string;
  /** Optional: full-time salary if listed (e.g. "₹6-12 LPA", "$80k-100k"). */
  salary?: string;
  /** Optional: internship stipend if listed (e.g. "₹15,000-20,000 /month"). */
  stipend?: string;
}

export interface ScoredPosting {
  posting: Posting;
  fitScore: number; // 0..100
  fitReason: string;
}

export interface TailoredDocs {
  resumeTex: string;
  coverLetterTex: string;
}
