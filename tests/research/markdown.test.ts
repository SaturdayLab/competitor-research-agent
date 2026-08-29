import { describe, expect, it } from "vitest";

import type { ResearchDraft, ResearchEvidence, ResearchSource } from "../../src/lib/domain/research";
import { renderResearchMarkdown } from "../../src/lib/research/markdown";

const draft: ResearchDraft = {
  title: "AI Coding 产品竞品分析",
  executiveSummary: "三款产品分别侧重编辑器、终端代理与云端协作。",
  products: [
    {
      name: "Cursor",
      positioning: "AI 原生代码编辑器",
      strengths: ["编辑体验完整"],
      limitations: ["高级功能需要订阅"],
      bestFor: "希望在 IDE 内完成工作的开发者",
    },
    {
      name: "Claude Code",
      positioning: "终端式 Coding Agent",
      strengths: ["适合终端工作流"],
      limitations: ["不提供完整 IDE"],
      bestFor: "偏好 CLI 的开发者",
    },
    {
      name: "Codex",
      positioning: "云端与本地协作的编码代理",
      strengths: ["任务执行边界清晰"],
      limitations: ["依赖具体运行环境"],
      bestFor: "需要委派开发任务的团队",
    },
  ],
  dimensions: [
    {
      name: "交互形态",
      summary: "三者分别从 IDE、CLI 和任务委派切入。",
      leaders: ["Cursor", "Claude Code", "Codex"],
    },
  ],
  conclusion: "选择应由现有开发工作流决定。",
  limitations: ["V1 尚未接入公开资料搜索。"],
};

describe("renderResearchMarkdown", () => {
  it("renders the expected report sections and every product", () => {
    const markdown = renderResearchMarkdown(draft);

    expect(markdown).toContain("# AI Coding 产品竞品分析");
    expect(markdown).toContain("## Executive Summary");
    expect(markdown).toContain("## 竞品概览");
    expect(markdown).toContain("Cursor");
    expect(markdown).toContain("Claude Code");
    expect(markdown).toContain("Codex");
    expect(markdown).toContain("## 局限与来源说明");
  });

  it("escapes raw HTML from generated fields", () => {
    const markdown = renderResearchMarkdown({
      ...draft,
      conclusion: "<script>alert('xss')</script>",
    });

    expect(markdown).not.toContain("<script>");
    expect(markdown).toContain("&lt;script&gt;");
  });

  it("appends a numbered sources index when sources are provided", () => {
    const sources: ResearchSource[] = [
      {
        id: "src-1",
        taskId: "task-1",
        runId: "run-1",
        product: "Cursor",
        title: "Cursor pricing",
        url: "https://cursor.com/pricing",
        canonicalUrl: "https://cursor.com/pricing",
        snippet: "Plans for individuals and teams.",
        sourceType: "search_result",
        isOfficial: true,
        retrievedAt: "2026-08-27T00:00:00.000Z",
        metadata: { rank: 1 },
        extractedText: null,
        fetchStatus: "pending",
        fetchError: null,
      },
    ];

    const markdown = renderResearchMarkdown(draft, sources);

    expect(markdown).toContain("## 资料索引");
    expect(markdown).toContain("[S1] Cursor pricing");
    expect(markdown).toContain("https://cursor.com/pricing");
    expect(markdown).toContain("Cursor");
  });

  it("appends numbered evidence excerpts when evidence is provided", () => {
    const sources: ResearchSource[] = [
      {
        id: "src-1",
        taskId: "task-1",
        runId: "run-1",
        product: "Cursor",
        title: "Cursor pricing",
        url: "https://cursor.com/pricing",
        canonicalUrl: "https://cursor.com/pricing",
        snippet: "Plans for individuals and teams.",
        sourceType: "search_result",
        isOfficial: true,
        retrievedAt: "2026-08-27T00:00:00.000Z",
        metadata: { rank: 1 },
        extractedText: "Hobby is $20 per month.",
        fetchStatus: "ok",
        fetchError: null,
      },
    ];
    const evidence: ResearchEvidence[] = [
      {
        id: "ev-1",
        taskId: "task-1",
        sourceId: "src-1",
        product: "Cursor",
        dimension: "价格",
        value: "$20",
        evidenceText: "Hobby is $20 per month.",
        confidence: 0.8,
        createdAt: "2026-08-27T00:00:00.000Z",
      },
    ];

    const markdown = renderResearchMarkdown(draft, sources, evidence);
    expect(markdown).toContain("## 证据摘录");
    expect(markdown).toContain("[E1] Cursor / 价格");
    expect(markdown).toContain("Hobby is $20 per month");
  });
});
