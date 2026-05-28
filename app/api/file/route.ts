import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { NextResponse, type NextRequest } from "next/server";

const TAILORED_ROOT = resolve(homedir(), "job_applications");

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get("path");
  if (!requested) return new NextResponse("missing path", { status: 400 });

  const abs = resolve(requested);
  if (!abs.startsWith(TAILORED_ROOT + "/") && abs !== TAILORED_ROOT) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!existsSync(abs)) return new NextResponse("not found", { status: 404 });

  const buf = readFileSync(abs);
  const ext = abs.split(".").pop()?.toLowerCase();
  const contentType =
    ext === "pdf" ? "application/pdf" : ext === "tex" ? "text/plain; charset=utf-8" : "application/octet-stream";
  return new NextResponse(buf, {
    headers: { "content-type": contentType, "cache-control": "no-store" },
  });
}
