import { describe, expect, it, vi } from "vitest";
import { OpenAiClient } from "./openai-client.js";

describe("OpenAiClient", () => {
  it("returns undefined when API key is missing", async () => {
    const client = new OpenAiClient({ apiKey: "" });
    expect(client.enabled).toBe(false);
    await expect(client.complete([{ role: "user", content: "hi" }])).resolves.toBeUndefined();
  });

  it("parses JSON responses and sends a strict json_schema response_format", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"answer":"ok"}' } }]
      })
    });
    const client = new OpenAiClient({ apiKey: "test", fetchImpl });
    const jsonSchema = {
      name: "test_schema",
      schema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false
      }
    };
    await expect(
      client.completeJson<{ answer: string }>([{ role: "user", content: "hi" }], jsonSchema)
    ).resolves.toEqual({ answer: "ok" });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.reasoning_effort).toBe("medium");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "test_schema", strict: true, schema: jsonSchema.schema }
    });
  });

  it("throws when the model refuses the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { refusal: "cannot help with that" } }]
      })
    });
    const client = new OpenAiClient({ apiKey: "test", fetchImpl });
    await expect(
      client.completeJson([{ role: "user", content: "hi" }], {
        name: "x",
        schema: { type: "object", properties: {}, required: [], additionalProperties: false }
      })
    ).rejects.toThrow(/refused/);
  });
});
