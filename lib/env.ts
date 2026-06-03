import "dotenv/config";

export class MissingEnvError extends Error {}

export function getEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new MissingEnvError(`Missing required env var ${key}. Add it to .env`);
  return v;
}

export function getEnvOptional(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}
