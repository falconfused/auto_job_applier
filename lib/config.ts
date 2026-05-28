import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { SETTINGS_PATH, PROFILE_PATH } from "./paths";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const SearchFilter = z.object({
  keywords: z.string(),
  location: z.string().default(""),
  experienceLevel: z.string().default(""),
  datePosted: z.string().default(""),
  minCtc: z.number().optional(),
});

const InternshalaFilter = z.object({
  type: z.enum(["internship", "job"]),
  category: z.string().optional(),
  location: z.string().optional(),
  keywords: z.string().optional(),
});

const NaukriFilter = z.object({
  keywords: z.string(),
  location: z.string(),
  experience: z.string().optional(),
});

const UnstopFilter = z.object({
  type: z.enum(["jobs", "internships"]),
  category: z.string().optional(),
  location: z.string().optional(),
});

const CutshortFilter = z.object({
  role: z.string().optional(),
  location: z.string().optional(),
});

const SourcesSchema = z
  .object({
    internshala: z
      .object({
        enabled: z.boolean().default(false),
        filters: z.array(InternshalaFilter).default([]),
      })
      .optional(),
    naukri: z
      .object({
        enabled: z.boolean().default(false),
        filters: z.array(NaukriFilter).default([]),
      })
      .optional(),
    unstop: z
      .object({
        enabled: z.boolean().default(false),
        filters: z.array(UnstopFilter).default([]),
      })
      .optional(),
    cutshort: z
      .object({
        enabled: z.boolean().default(false),
        filters: z.array(CutshortFilter).default([]),
      })
      .optional(),
  })
  .optional()
  .default({});

const SettingsSchema = z.object({
  schedule: z.object({
    time: z.string().regex(TIME_RE, "schedule.time must be HH:MM 24h"),
  }),
  ranking: z.object({ topN: z.number().int().default(10) }),
  search: z.object({ filters: z.array(SearchFilter).default([]) }),
  apply: z.object({
    dailyCap: z.number().int().default(8),
    easyApplyOnly: z.boolean().default(true),
  }),
  sources: SourcesSchema.optional(),
  llm: z.object({ model: z.string().default("claude-sonnet-4-6") }),
  telegram: z.object({ chatId: z.number().int().default(0) }),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function loadSettings(path: string = SETTINGS_PATH): Settings {
  const raw = parseYaml(readFileSync(path, "utf8")) ?? {};
  return SettingsSchema.parse(raw);
}

export function loadProfile(path: string = PROFILE_PATH): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}
