import Anthropic from "@anthropic-ai/sdk";

export type CompleteJson = (system: string, user: string, opts?: { model?: string }) => Promise<any>;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  return JSON.parse(body.trim());
}

/** Send a system+user prompt and parse the reply as JSON. */
export const completeJson: CompleteJson = async (system, user, opts) => {
  const model = opts?.model ?? "claude-sonnet-4-6";
  const resp = await getClient().messages.create({
    model,
    max_tokens: 4096,
    system: `${system}\nRespond with ONLY valid JSON, no prose.`,
    messages: [{ role: "user", content: user }],
  });
  const block = resp.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text : "";
  return extractJson(text);
};
