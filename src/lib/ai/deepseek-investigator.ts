import { createHash } from "node:crypto";

import {
  completeChat,
  createDeepSeekClient,
  getDeepSeekModel,
  type ChatMessage,
  type JsonChatClient,
} from "@/lib/ai/deepseek-client";
import {
  getAgentMaxSteps,
  type InvestigateInput,
  type InvestigateResult,
  type ResearchInvestigator,
  type ToolCallLog,
} from "@/lib/ai/investigator";
import type { ResearchSource } from "@/lib/domain/research";
import { canonicalizeUrl } from "@/lib/search/url";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "搜索一条公开网页资料。每个竞品的基础搜索已经做过，只在明显缺口时再搜。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          product: { type: "string", description: "对应用户给出的竞品名" },
        },
        required: ["query", "product"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description: "读取一个 HTTP(S) 页面正文。只读已有来源或刚搜到的 URL。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
        },
        required: ["url"],
      },
    },
  },
];

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function matchProduct(value: string, competitors: string[]): string {
  const found = competitors.find((item) => item.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  return found ?? competitors[0] ?? value;
}

export class DeepSeekResearchInvestigator implements ResearchInvestigator {
  readonly name = "deepseek";
  private readonly client: JsonChatClient;
  private readonly model: string;
  private readonly maxSteps: number;

  constructor(options: { client?: JsonChatClient; model?: string; maxSteps?: number } = {}) {
    this.client = options.client ?? (createDeepSeekClient() as unknown as JsonChatClient);
    this.model = options.model ?? getDeepSeekModel();
    this.maxSteps = options.maxSteps ?? getAgentMaxSteps();
  }

  async investigate(input: InvestigateInput): Promise<InvestigateResult> {
    const toolCalls: ToolCallLog[] = [];
    let sources = input.sources;
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "你是竞品调研研究员。基础搜索结果已经提供。",
          "只有资料明显不足时才调用 web_search 或 read_page。",
          "不要编造 URL。读页只使用已出现的 http/https 链接。",
          "资料足够时直接用自然语言说明可以结束，不要再调用工具。",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          topic: input.task.topic,
          competitors: input.task.competitors,
          focus: input.task.focus,
          sources: sources.map((source) => ({
            id: source.id,
            product: source.product,
            title: source.title,
            url: source.url,
            snippet: source.snippet,
          })),
        }),
      },
    ];

    for (let step = 0; step < this.maxSteps; step += 1) {
      const completion = await completeChat(this.client, {
        model: this.model,
        messages,
        tools: TOOLS,
      });
      const calls = completion.message.tool_calls ?? [];
      if (calls.length === 0) break;

      messages.push({
        role: "assistant",
        content: completion.message.content ?? null,
        tool_calls: calls,
      });

      for (const call of calls) {
        const log = await this.runTool(call.function.name, call.function.arguments, input, sources);
        toolCalls.push(log);
        sources = await input.repository.listSources(input.task.id, input.runId);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: log.detail,
        });
      }
    }

    return { sources, toolCalls };
  }

  private async runTool(
    name: string,
    rawArgs: string,
    input: InvestigateInput,
    sources: ResearchSource[],
  ): Promise<ToolCallLog> {
    let args: { query?: string; product?: string; url?: string } = {};
    try {
      args = JSON.parse(rawArgs) as { query?: string; product?: string; url?: string };
    } catch {
      return { name, ok: false, detail: "工具参数不是合法 JSON" };
    }

    if (name === "web_search") {
      const query = args.query?.trim();
      if (!query) return { name, ok: false, detail: "缺少 query" };
      const product = matchProduct(args.product ?? "", input.task.competitors);
      const results = await input.searchProvider.search({ query, count: 3 });
      const pending = [];
      for (const result of results) {
        const canonicalUrl = canonicalizeUrl(result.url);
        if (!canonicalUrl) continue;
        pending.push({
          product,
          title: result.title,
          url: result.url,
          canonicalUrl,
          snippet: result.snippet,
          sourceType: "search_result" as const,
          isOfficial: false,
          metadata: { query, rank: result.rank, via: "tool" },
        });
      }
      if (pending.length > 0) {
        await input.repository.saveSources(input.task.id, input.runId, pending);
      }
      return { name, ok: true, detail: JSON.stringify({ query, product, saved: pending.length }) };
    }

    if (name === "read_page") {
      const url = args.url?.trim();
      if (!url) return { name, ok: false, detail: "缺少 url" };
      const canonicalUrl = canonicalizeUrl(url);
      if (!canonicalUrl) return { name, ok: false, detail: "URL 不是合法 HTTP(S)" };
      let source = sources.find((item) => item.canonicalUrl === canonicalUrl);
      if (!source) {
        const created = await input.repository.saveSources(input.task.id, input.runId, [
          {
            product: input.task.competitors[0] ?? "综合",
            title: canonicalUrl,
            url,
            canonicalUrl,
            snippet: "",
            sourceType: "web_page",
            isOfficial: false,
            metadata: { via: "tool" },
          },
        ]);
        source = created.find((item) => item.canonicalUrl === canonicalUrl);
      }
      if (!source) return { name, ok: false, detail: "无法保存来源" };
      const read = await input.pageReader.read(source.url);
      if (!read.ok) {
        await input.repository.updateSourceFetch(source.id, {
          fetchStatus: "skipped",
          fetchError: read.reason,
          extractedText: null,
        });
        return { name, ok: false, detail: read.reason };
      }
      await input.repository.updateSourceFetch(source.id, {
        fetchStatus: "ok",
        extractedText: read.text,
        fetchError: null,
        contentHash: hashText(read.text),
      });
      return { name, ok: true, detail: JSON.stringify({ url: source.url, chars: read.text.length }) };
    }

    return { name, ok: false, detail: `未知工具：${name}` };
  }
}
