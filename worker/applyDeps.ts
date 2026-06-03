import { z } from "zod";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { Page } from "playwright";
import { launchSession } from "./session.js";
import type { ApplyDeps } from "./applyAgent.js";

const SYSTEM = `You drive a LinkedIn Easy Apply form via the provided browser tools.
Goal: walk through the Easy Apply modal step-by-step, filling fields from the
candidate profile (provided as JSON), uploading the resume PDF (already on disk
at the path provided), and clicking Next/Continue until you reach the FINAL REVIEW
screen. Then call ready() — DO NOT click "Submit application" yourself.

If a screening question's answer is not clearly derivable from the profile,
call escalate(question) with the exact question text — do not guess or fabricate.

Be patient: forms paginate. Use getDom to read state between actions.`;

export function buildApplyDeps(opts: { sendMessage: ApplyDeps["sendMessage"]; model?: string }): ApplyDeps {
  const model = opts.model ?? "claude-sonnet-4-6";

  return {
    sendMessage: opts.sendMessage,

    async openJobPage(url) {
      const context = await launchSession();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1500 + Math.random() * 1500);
      const easy = page.locator('button:has-text("Easy Apply")').first();
      if (await easy.count()) await easy.click().catch(() => {});
      const html = await page.content();
      return {
        html,
        page,
        close: async () => {
          await page.close().catch(() => {});
          await context.close().catch(() => {});
        },
      };
    },

    async runFillingAgent(page: Page, args) {
      let escalation: string | undefined;
      let ready = false;

      const browserServer = createSdkMcpServer({
        name: "linkedin-browser",
        version: "1.0.0",
        tools: [
          tool(
            "getDom",
            "Return the current page HTML so you can decide the next action.",
            {},
            async () => {
              const dom = await page.content();
              return { content: [{ type: "text", text: dom.slice(0, 60_000) }] };
            },
          ),
          tool(
            "click",
            "Click the first element matching the given Playwright selector.",
            { selector: z.string() },
            async (a) => {
              await page.locator(a.selector).first().click({ timeout: 10_000 });
              await page.waitForTimeout(800);
              return { content: [{ type: "text", text: "ok" }] };
            },
          ),
          tool(
            "fill",
            "Fill a form field. selector targets the input; value is the text.",
            { selector: z.string(), value: z.string() },
            async (a) => {
              await page.locator(a.selector).first().fill(a.value, { timeout: 10_000 });
              return { content: [{ type: "text", text: "ok" }] };
            },
          ),
          tool(
            "uploadFile",
            "Upload a file to a file input.",
            { selector: z.string(), path: z.string() },
            async (a) => {
              await page.locator(a.selector).first().setInputFiles(a.path);
              return { content: [{ type: "text", text: "ok" }] };
            },
          ),
          tool(
            "pressKey",
            "Press a single key, e.g. Tab, Enter.",
            { key: z.string() },
            async (a) => {
              await page.keyboard.press(a.key);
              return { content: [{ type: "text", text: "ok" }] };
            },
          ),
          tool(
            "escalate",
            "Use when a screening question cannot be answered from the profile. Pass the exact question text.",
            { question: z.string() },
            async (a) => {
              escalation = a.question;
              return { content: [{ type: "text", text: "escalated" }] };
            },
          ),
          tool(
            "ready",
            "Call when the Easy Apply form is fully filled and you are ON the final review screen. Do not click Submit.",
            {},
            async () => {
              ready = true;
              return { content: [{ type: "text", text: "ready" }] };
            },
          ),
        ],
      });

      const userMessage = JSON.stringify({
        jobUrl: args.jobUrl,
        resumePath: args.resumePath,
        profile: args.profile,
      });

      const stream = query({
        prompt: userMessage,
        options: {
          model,
          systemPrompt: SYSTEM,
          mcpServers: { browser: browserServer },
          maxTurns: 30,
        } as any,
      });

      for await (const _msg of stream) {
        if (ready || escalation) break;
      }

      return { ready, escalation };
    },

    async finalizeSubmit(page: Page) {
      const submit = page.locator('button:has-text("Submit application")').first();
      await submit.click({ timeout: 10_000 });
      await page.waitForTimeout(2000);
    },
  };
}
