import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReportDocument } from "../../src/components/report-view";
import type {
  ResearchDraft,
  ResearchEvidence,
  ResearchReport,
  ResearchSource,
} from "../../src/lib/domain/research";

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
  limitations: ["V2 仅使用搜索摘要。"],
};

const report: ResearchReport = {
  id: "report-1",
  taskId: "task-1",
  runId: "run-1",
  title: draft.title,
  content: "# report",
  structuredContent: draft,
  reviewStatus: "not_reviewed",
  revision: 1,
  createdAt: "2026-08-27T00:00:00.000Z",
};

function evidence(overrides: Partial<ResearchEvidence> = {}): ResearchEvidence {
  return {
    id: "ev-1",
    taskId: "task-1",
    sourceId: "src-1",
    product: "Cursor",
    dimension: "价格",
    value: "$20",
    evidenceText: "Hobby is $20 per month.",
    confidence: 0.8,
    createdAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function source(overrides: Partial<ResearchSource>): ResearchSource {
  return {
    id: "src-1",
    taskId: "task-1",
    runId: "run-1",
    product: "Cursor",
    title: "Cursor pricing",
    url: "https://www.cursor.com/pricing",
    canonicalUrl: "https://cursor.com/pricing",
    snippet: "Plans for individuals and teams.",
    sourceType: "search_result",
    isOfficial: true,
    retrievedAt: "2026-08-27T00:00:00.000Z",
    metadata: { rank: 1 },
    extractedText: null,
    fetchStatus: "pending" as const,
    fetchError: null,
    ...overrides,
  };
}

describe("ReportDocument", () => {
  it("shows a completed report with a clear note when review requests revisions", () => {
    const html = renderToStaticMarkup(
      <ReportDocument
        report={{ ...report, reviewStatus: "revision_requested" }}
        sources={[]}
        reviewNotes={["确认价格是否仍然有效", "补充企业版限制"]}
        taskId="task-1"
      />,
    );

    expect(html).toContain("已完成 · 仍有审核建议");
    expect(html).toContain("报告已生成，Reviewer 仍建议人工复核。");
    expect(html).toContain("建议人工确认");
    expect(html).toContain("确认价格是否仍然有效");
    expect(html).toContain("补充企业版限制");
    expect(html).not.toContain("revision_requested");
    expect(html.indexOf("<h2>最终结论</h2>")).toBeLessThan(html.indexOf("<h2>建议人工确认</h2>"));
    expect(html.indexOf("<h2>建议人工确认</h2>")).toBeLessThan(html.indexOf("<h2>资料索引</h2>"));
    expect(html).toContain('aria-label="回到顶部"');
    expect(html).toContain('data-visible="false"');
  });

  it("renders a numbered source catalog with a safe external link", () => {
    const html = renderToStaticMarkup(
      <ReportDocument report={report} sources={[source({})]} taskId="task-1" />,
    );

    expect(html).toContain("资料索引");
    expect(html).toContain("[S1]");
    expect(html).toContain("Cursor pricing");
    expect(html).toContain("cursor.com");
    expect(html).toContain('href="https://www.cursor.com/pricing"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("证据状态 / 仅使用搜索摘要");
  });

  it("does not turn javascript URLs into links and shows the empty catalog copy", () => {
    const unsafe = renderToStaticMarkup(
      <ReportDocument
        report={report}
        sources={[source({ id: "src-bad", url: "javascript:alert(1)", canonicalUrl: "javascript:alert(1)" })]}
        taskId="task-1"
      />,
    );
    expect(unsafe).not.toContain('href="javascript:');
    expect(unsafe).toContain("javascript:alert(1)");

    const empty = renderToStaticMarkup(
      <ReportDocument report={report} sources={[]} taskId="task-1" />,
    );
    expect(empty).toContain("本次任务没有保存公开搜索来源");
    expect(empty).toContain("证据状态 / 未启用联网搜索");
  });

  it("renders numbered evidence excerpts with a safe source link", () => {
    const html = renderToStaticMarkup(
      <ReportDocument
        report={report}
        sources={[source({})]}
        evidence={[evidence({})]}
        taskId="task-1"
      />,
    );
    expect(html).toContain("证据摘录");
    expect(html).toContain("[E1]");
    expect(html).toContain("价格");
    expect(html).toContain("Hobby is $20 per month.");
    expect(html).toContain("证据状态 / 已读取页面正文");
    expect(html).toContain('href="https://www.cursor.com/pricing"');
  });

  it("does not link javascript URLs from evidence sources", () => {
    const html = renderToStaticMarkup(
      <ReportDocument
        report={report}
        sources={[source({ url: "javascript:alert(1)", canonicalUrl: "javascript:alert(1)" })]}
        evidence={[evidence({})]}
        taskId="task-1"
      />,
    );
    expect(html).toContain("证据摘录");
    expect(html).not.toContain('href="javascript:');
  });

  it("shows only the first three sources and evidence excerpts by default", () => {
    const manySources = Array.from({ length: 5 }, (_, index) => source({
      id: `src-${index + 1}`,
      title: `Source ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      canonicalUrl: `https://example.com/${index + 1}`,
    }));
    const manyEvidence = Array.from({ length: 5 }, (_, index) => evidence({
      id: `ev-${index + 1}`,
      sourceId: `src-${index + 1}`,
      evidenceText: `Evidence ${index + 1}`,
    }));
    const html = renderToStaticMarkup(
      <ReportDocument report={report} sources={manySources} evidence={manyEvidence} taskId="task-1" />,
    );

    expect(html).toContain("Source 3");
    expect(html).not.toContain("Source 4");
    expect(html).toContain("Evidence 3");
    expect(html).not.toContain("Evidence 4");
    expect(html).toContain("展开其余 2 条");
    expect(html).toContain('aria-expanded="false"');
  });

  it("renders a report table of contents with section and product anchors", () => {
    const html = renderToStaticMarkup(
      <ReportDocument report={report} sources={[source({})]} taskId="task-1" />,
    );

    expect(html).toContain('aria-label="报告目录"');
    expect(html).toContain('href="#report-overview"');
    expect(html).toContain('href="#report-sources"');
    expect(html).toContain('href="#report-evidence"');
    expect(html).toContain('href="#report-product-1"');
    expect(html).toContain('id="report-overview"');
    expect(html).toContain('id="report-product-1"');
  });
});
