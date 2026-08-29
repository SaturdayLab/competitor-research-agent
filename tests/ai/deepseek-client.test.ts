import { describe, expect, it, vi } from "vitest";

import { completeJsonObject, createDeepSeekClient } from "@/lib/ai/deepseek-client";
import { ConfigurationError } from "@/lib/errors";

describe("createDeepSeekClient", () => {
  it("requires DEEPSEEK_API_KEY", () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      expect(() => createDeepSeekClient()).toThrow(ConfigurationError);
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previous;
    }
  });
});

describe("completeJsonObject", () => {
  it("parses json_object chat completions and rejects truncated output", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: '{"title":"ok"}' },
        },
      ],
    });

    const parsed = await completeJsonObject(
      { chat: { completions: { create } } },
      {
        model: "deepseek-chat",
        system: "Return json.",
        user: '{"topic":"test"}',
      },
    );

    expect(parsed).toEqual({ title: "ok" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-chat",
        response_format: { type: "json_object" },
      }),
    );

    const truncated = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "length", message: { content: '{"title":' } }],
    });
    await expect(
      completeJsonObject(
        { chat: { completions: { create: truncated } } },
        { model: "deepseek-chat", system: "json", user: "{}" },
      ),
    ).rejects.toThrow("截断");

    const completeDespiteLength = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "length", message: { content: '{"title":"ok"}' } }],
    });
    await expect(
      completeJsonObject(
        { chat: { completions: { create: completeDespiteLength } } },
        { model: "deepseek-chat", system: "json", user: "{}" },
      ),
    ).resolves.toEqual({ title: "ok" });
  });
});
