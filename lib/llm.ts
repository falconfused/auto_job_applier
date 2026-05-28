import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

export type CompleteJson = (system: string, user: string, opts?: { model?: string }) => Promise<any>;

const DEFAULT_MODEL = process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6-v1:0";

let client: AnthropicBedrock | null = null;
function getClient(): AnthropicBedrock {
  if (!client) client = new AnthropicBedrock();
  return client;
}

function extractJson(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("llm: empty response from model");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : trimmed).trim();
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(
      `llm: failed to parse JSON response (${(err as Error).message}); got: ${body.slice(0, 300)}`,
    );
  }
}

/** Send a system+user prompt to Claude on AWS Bedrock and parse the reply as JSON. */
export const completeJson: CompleteJson = async (system, user, opts) => {
  const model = opts?.model ?? DEFAULT_MODEL;
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
