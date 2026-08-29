import { describe, expect, it, vi } from "vitest";

import { DeepSeekResearchInvestigator } from "@/lib/ai/deepseek-investigator";
import { DisabledResearchInvestigator } from "@/lib/ai/investigator";
import { MemoryResearchRepository } from "@/lib/research/memory-repository";
import type { PageReader } from "@/lib/read/page-reader";
import type { SearchProvider } from "@/lib/search/provider";

async function seededRun() {
  const repository = new MemoryResearchRepository();
  const task = await repository.createTask({
    topic: "AI Coding 产品分析",
    competitors: ["Cursor", "Claude Code", "Codex"],
  });
  const run = await repository.claimNextRun("investigator-worker");
  if (!run) throw new Error("expected run");
  const sources = await repository.saveSources(task.id, run.id, [
    {
      product: "Cursor",
      title: "Cursor home",
      url: "https://cursor.com",
      canonicalUrl: "https://cursor.com/",
      snippet: "Editor",
      sourceType: "search_result",
      isOfficial: true,
      metadata: {},
    },
  ]);
  return { repository, task, run, sources };
}

function searchProvider(url: string): SearchProvider {
  return {
    name: "brave",
    async search({ query }) {
      return [
        {
          title: `${query} extra`,
          url,
          snippet: "extra snippet",
          rank: 1,
          canonicalUrl: url,
        },
      ];
    },
  };
}

function pageReader(): PageReader {
  return {
    name: "test",
    async read(url) {
      return {
        ok: true,
        url,
        finalUrl: url,
        title: "Page",
        text: `Body for ${url}`,
        contentType: "text/html",
        status: 200,
      };
    },
  };
}

describe("DisabledResearchInvestigator", () => {
  it("does not call tools", async () => {
    const { repository, task, run, sources } = await seededRun();
    const result = await new DisabledResearchInvestigator().investigate({
      task,
      sources,
      searchProvider: searchProvider("https://example.com/extra"),
      pageReader: pageReader(),
      repository,
      runId: run.id,
    });
    expect(result.toolCalls).toEqual([]);
    expect(result.sources).toHaveLength(1);
  });
});

describe("DeepSeekResearchInvestigator", () => {
  it("executes web_search and then stops", async () => {
    const { repository, task, run, sources } = await seededRun();
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "web_search",
                    arguments: JSON.stringify({ query: "Cursor pricing", product: "Cursor" }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "足够了" } }],
      });

    const investigator = new DeepSeekResearchInvestigator({
      client: { chat: { completions: { create } } },
      model: "deepseek-chat",
      maxSteps: 4,
    });
    const result = await investigator.investigate({
      task,
      sources,
      searchProvider: searchProvider("https://cursor.com/pricing"),
      pageReader: pageReader(),
      repository,
      runId: run.id,
    });

    expect(result.toolCalls.map((item) => item.name)).toEqual(["web_search"]);
    expect(result.sources.map((source) => source.canonicalUrl)).toContain("https://cursor.com/pricing");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("stops after maxSteps even if the model keeps requesting tools", async () => {
    const { repository, task, run, sources } = await seededRun();
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "call-loop",
                type: "function",
                function: { name: "web_search", arguments: JSON.stringify({ query: "more", product: "Cursor" }) },
              },
            ],
          },
        },
      ],
    });
    const investigator = new DeepSeekResearchInvestigator({
      client: { chat: { completions: { create } } },
      maxSteps: 2,
    });
    await investigator.investigate({
      task,
      sources,
      searchProvider: searchProvider("https://example.com/more"),
      pageReader: pageReader(),
      repository,
      runId: run.id,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
