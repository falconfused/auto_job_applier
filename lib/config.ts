import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { SETTINGS_PATH, PROFILE_PATH } from "./paths.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const SearchFilter = z.object({
  keywords: z.string(),
  location: z.string().default(""),
  experienceLevel: z.string().default(""),
  datePosted: z.string().default(""),
  minCtc: z.number().optional(),
});

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
