export type ReasoningEffort = "low" | "medium" | "high";

export interface OpenAiClientOptions {
  apiKey?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  fetchImpl?: typeof fetch;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
}

export type MessageContent = string | Array<TextContent | ImageContent>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

// OpenAI Structured Outputs (response_format: json_schema, strict: true) guarantees the model's
// JSON matches this shape exactly, so callers no longer need to defensively re-validate enum
// fields or bounding-box shapes after the fact. See
// https://developers.openai.com/api/docs/guides/structured-outputs
export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export class OpenAiClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? "gpt-5.4-mini";
    this.reasoningEffort = options.reasoningEffort ?? "medium";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  // Uses OpenAI Structured Outputs so the response is guaranteed to match `jsonSchema` exactly
  // (every property in `required`, `additionalProperties: false` throughout). This eliminates
  // malformed-shape bugs (missing fields, wrong types, extra keys) at the source instead of
  // catching them after `JSON.parse`.
  async completeJson<T>(
    messages: ChatMessage[],
    jsonSchema: JsonSchemaSpec
  ): Promise<T | undefined> {
    const text = await this.complete(messages, { jsonSchema });
    if (!text) {
      return undefined;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  async complete(
    messages: ChatMessage[],
    options: { jsonSchema?: JsonSchemaSpec } = {}
  ): Promise<string | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    const response = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        reasoning_effort: this.reasoningEffort,
        response_format: options.jsonSchema
          ? {
              type: "json_schema",
              json_schema: {
                name: options.jsonSchema.name,
                strict: true,
                schema: options.jsonSchema.schema
              }
            }
          : undefined,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content
        }))
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 240)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
    };
    const message = data.choices?.[0]?.message;
    if (message?.refusal) {
      throw new Error(`OpenAI refused the request: ${message.refusal}`);
    }
    return typeof message?.content === "string" ? message.content.trim() : undefined;
  }
}
