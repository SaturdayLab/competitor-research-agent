import OpenAI from "openai";

import { ConfigurationError } from "@/lib/errors";

export type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
};

export type JsonChatCompletion = {
  choices: Array<{
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: ChatToolCall[];
    };
  }>;
};

export type JsonChatClient = {
  chat: {
    completions: {
      create: (body: Record<string, unknown>) => Promise<JsonChatCompletion>;
    };
  };
};

export type CompleteJsonInput = {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
};

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_MAX_TOKENS = 16_384;

export function getDeepSeekModel(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
}

export function getDeepSeekBaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

export function getDeepSeekMaxTokens(environment: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(environment.DEEPSEEK_MAX_TOKENS ?? DEFAULT_MAX_TOKENS);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_TOKENS;
  return Math.min(Math.max(Math.trunc(parsed), 1_024), 65_536);
}

export function createDeepSeekClient(environment: NodeJS.ProcessEnv = process.env): OpenAI {
  const apiKey = environment.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigurationError("RESEARCH_PROVIDER=deepseek 时必须设置 DEEPSEEK_API_KEY。");
  }
  return new OpenAI({
    apiKey,
    baseURL: getDeepSeekBaseUrl(environment),
    maxRetries: 2,
    timeout: 180_000,
  });
}

function parseJsonContent(content: string): unknown {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new Error("DeepSeek 返回了无法解析的 JSON");
  }
}

export async function completeJsonObject(
  client: JsonChatClient,
  input: CompleteJsonInput,
): Promise<unknown> {
  const response = await client.chat.completions.create({
    model: input.model,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    temperature: 0.2,
    max_tokens: input.maxTokens ?? getDeepSeekMaxTokens(),
  });
  const choice = response.choices[0];
  if (!choice) throw new Error("DeepSeek 未返回任何结果");
  const content = choice.message?.content?.trim();
  if (content) {
    try {
      return parseJsonContent(content);
    } catch (error) {
      if (choice.finish_reason === "length") {
        throw new Error("DeepSeek 输出被截断，请提高 max_tokens 或缩短输入");
      }
      throw error;
    }
  }
  if (choice.finish_reason === "length") {
    throw new Error("DeepSeek 输出被截断，请提高 max_tokens 或缩短输入");
  }
  throw new Error("DeepSeek 未返回 JSON 正文");
}

export async function completeChat(
  client: JsonChatClient,
  input: {
    model: string;
    messages: ChatMessage[];
    tools?: unknown[];
    maxTokens?: number;
  },
): Promise<{ finish_reason: string | null; message: ChatMessage }> {
  const response = await client.chat.completions.create({
    model: input.model,
    messages: input.messages,
    tools: input.tools,
    thinking: { type: "disabled" },
    temperature: 0.2,
    max_tokens: input.maxTokens ?? getDeepSeekMaxTokens(),
  });
  const choice = response.choices[0];
  if (!choice) throw new Error("DeepSeek 未返回任何结果");
  const toolCalls = choice.message?.tool_calls ?? [];
  if (choice.finish_reason === "length" && toolCalls.length === 0) {
    throw new Error("DeepSeek 输出被截断，请提高 max_tokens 或缩短输入");
  }
  return {
    finish_reason: choice.finish_reason ?? null,
    message: {
      role: "assistant",
      content: choice.message?.content ?? null,
      tool_calls: toolCalls.length > 0 ? toolCalls : choice.message?.tool_calls,
    },
  };
}
