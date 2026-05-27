export type ApplyType = "easy_apply" | "external";

export interface Posting {
  linkedinJobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  applyType: ApplyType;
  jdText: string;
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
