import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");
export const CONFIG_DIR = join(ROOT, "config");
export const DATA_DIR = join(ROOT, "data");
export const RESUME_DIR = join(ROOT, "resume");
export const JOBS_DIR = join(RESUME_DIR, "jobs");
export const MASTER_RESUME = join(RESUME_DIR, "master_resume.tex");
export const SETTINGS_PATH = join(CONFIG_DIR, "settings.yaml");
export const PROFILE_PATH = join(CONFIG_DIR, "profile.json");
export const DB_PATH = join(DATA_DIR, "applier.db");

export function ensureDirs(): void {
  for (const d of [DATA_DIR, RESUME_DIR, JOBS_DIR]) {
    mkdirSync(d, { recursive: true });
  }
}
