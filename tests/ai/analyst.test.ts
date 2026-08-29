import { describe, expect, it, vi } from "vitest";

import { validateResearchAnalysis, type ResearchAnalysisInput } from "@/lib/ai/analyst";
import { DeepSeekResearchAnalyst } from "@/lib/ai/deepseek-analyst";
import { DemoResearchAnalyst } from "@/lib/ai/demo-analyst";
import type { ResearchEvidence } from "@/lib/domain/research";

const competitors = ["飞书", "钉钉", "企业微信"];
const dimensions = ["产品定位", "定价", "集成生态"];

function evidence(overrides: Partial<ResearchEvidence> = {}): ResearchEvidence {
  return {
    id: "evidence-1",
    taskId: "task-1",
    sourceId: "source-1",
    product: "飞书",
    dimension: "产品定位",
    value: "一体化协作",
    evidenceText: "提供文档、会议与即时沟通能力。",
    confidence: 0.8,
    createdAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

const input: ResearchAnalysisInput = {
  topic: "协同办公",
  competitors,
  dimensions,
  sources: [],
  evidence: [
    evidence(),
    evidence({ id: "evidence-2", product: "钉钉", evidenceText: "提供组织协同能力。" }),
  ],
};

function validRaw() {
  return {
    dimensions: dimensions.map((dimension) => ({
      dimension,
      summary: `${dimension} 横向总结。`,
      productFindings: competitors.map((product) => {
        const ids = dimension === "产品定位" && product === "飞书"
          ? ["E1"]
          : dimension === "产品定位" && product === "钉钉"
            ? ["E2"]
            : [];
        return {
          product,
          finding: ids.length ? `${product} 有对应证据。` : `${product} 资料不足。`,
          evidenceIds: ids,
        };
      }),
      leaders: [],
      evidenceIds: dimension === "产品定位" ? ["E1", "E2"] : [],
      gaps: competitors
        .filter((product) => dimension !== "产品定位" || product === "企业微信")
        .map((product) => ({ product, reason: "资料不足。" })),
    })),
    overallSummary: "仅依据编号 Evidence 的横向分析。",
  };
}

describe("validateResearchAnalysis", () => {
  it("accepts a complete analysis and restores planner order and names", () => {
    const raw = validRaw();
    raw.dimensions.reverse();
    raw.dimensions[2]!.dimension = "产品定位";
    const result = validateResearchAnalysis(raw, input);
    expect(result.dimensions.map((item) => item.dimension)).toEqual(dimensions);
    expect(result.dimensions[0]?.productFindings.map((item) => item.product)).toEqual(competitors);
  });

  it.each([
    () => ({ ...validRaw(), dimensions: validRaw().dimensions.slice(0, 2) }),
    () => ({ ...validRaw(), dimensions: [...validRaw().dimensions, { ...validRaw().dimensions[0], dimension: "额外维度" }] }),
    () => {
      const raw = validRaw();
      raw.dimensions[0]!.summary = "";
      return raw;
    },
    () => {
      const raw = validRaw();
      raw.dimensions[0]!.productFindings = raw.dimensions[0]!.productFindings.slice(0, 2);
      return raw;
    },
    () => {
      const raw = validRaw();
      raw.dimensions[0]!.productFindings[0]!.evidenceIds = ["E99"];
      raw.dimensions[0]!.evidenceIds = ["E99", "E2"];
      return raw;
    },
    () => {
      const raw = validRaw();
      raw.dimensions[0]!.productFindings[2]!.evidenceIds = [];
      raw.dimensions[0]!.gaps = [];
      return raw;
    },
    () => {
      const raw = validRaw();
      raw.dimensions[0]!.evidenceIds = ["E1"];
      return raw;
    },
  ])("rejects invalid coverage or evidence references", (candidate) => {
    expect(() => validateResearchAnalysis(candidate(), input)).toThrow();
  });
});

describe("DemoResearchAnalyst", () => {
  it("is deterministic, covers every product, and marks evidence gaps", async () => {
    const analyst = new DemoResearchAnalyst();
    const first = await analyst.analyze(input);
    expect(await analyst.analyze(input)).toEqual(first);
    expect(first.dimensions.every((item) => item.productFindings.length === 3)).toBe(true);
    expect(first.dimensions[0]?.gaps.map((gap) => gap.product)).toEqual(["企业微信"]);
    expect(JSON.stringify(first)).not.toMatch(/Coding Agent|IDE|代码库理解/);
  });
});

describe("DeepSeekResearchAnalyst", () => {
  it("sends numbered evidence without source snippets and validates output", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validRaw()) } }],
    });
    const analyst = new DeepSeekResearchAnalyst({
      client: { chat: { completions: { create } } },
      model: "deepseek-chat",
    });
    await expect(analyst.analyze(input)).resolves.toMatchObject({ overallSummary: expect.any(String) });
    const request = create.mock.calls[0]?.[0] as { messages?: Array<{ content?: string }> };
    expect(request.messages?.[1]?.content).toContain('"id":"E1"');
    expect(request.messages?.[1]?.content).toContain("allowedEvidenceIds");
    expect(request.messages?.[1]?.content).not.toContain("snippet");
  });

  it("retries once with validation feedback and accepts the corrected analysis", async () => {
    const invalid = validRaw();
    invalid.dimensions[0]!.productFindings[0]!.evidenceIds = ["E99"];
    invalid.dimensions[0]!.evidenceIds = ["E99", "E2"];
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(invalid) } }] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validRaw()) } }] });
    const analyst = new DeepSeekResearchAnalyst({ client: { chat: { completions: { create } } } });
    await expect(analyst.analyze(input)).resolves.toMatchObject({ overallSummary: expect.any(String) });
    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1]?.[0] as { messages?: Array<{ content?: string }> };
    expect(retry.messages?.[1]?.content).toContain("validationError");
    expect(retry.messages?.[1]?.content).toContain("E99");
    expect(retry.messages?.[1]?.content).toContain("requiredCoverage");
    expect(retry.messages?.[1]?.content).toContain("requiredProducts");
  });

  it("does not add an analyst retry for request failures", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const analyst = new DeepSeekResearchAnalyst({ client: { chat: { completions: { create } } } });
    await expect(analyst.analyze(input)).rejects.toThrow("network unavailable");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("safely repairs a missing product after the correction retry", async () => {
    const invalid = validRaw();
    invalid.dimensions[0]!.productFindings[0]!.evidenceIds = ["E99"];
    invalid.dimensions[0]!.evidenceIds = ["E99", "E2"];
    const corrected = validRaw();
    corrected.dimensions[0]!.productFindings = corrected.dimensions[0]!.productFindings.slice(0, 2);
    corrected.dimensions[0]!.gaps = [];
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(invalid) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(corrected) } }] });
    const analyst = new DeepSeekResearchAnalyst({ client: { chat: { completions: { create } } } });
    const result = await analyst.analyze(input) as ReturnType<typeof validRaw>;
    expect(result.dimensions[0]?.productFindings).toContainEqual({ product: "企业微信", finding: "资料不足，未找到可引用的 Evidence。", evidenceIds: [] });
    expect(result.dimensions[0]?.gaps).toContainEqual({ product: "企业微信", reason: "资料不足，未找到可引用的 Evidence。" });
  });

  it("never repairs an invalid Evidence reference", async () => {
    const invalid = validRaw();
    invalid.dimensions[0]!.productFindings[0]!.evidenceIds = ["E99"];
    invalid.dimensions[0]!.evidenceIds = ["E99", "E2"];
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(invalid) } }] });
    const analyst = new DeepSeekResearchAnalyst({ client: { chat: { completions: { create } } } });
    await expect(analyst.analyze(input)).rejects.toThrow("不存在的 Evidence");
  });

  it("recomputes only the redundant dimension evidenceIds aggregate", async () => {
    const invalid = validRaw();
    invalid.dimensions[0]!.productFindings[0]!.evidenceIds = ["E99"];
    invalid.dimensions[0]!.evidenceIds = ["E99", "E2"];
    const corrected = validRaw();
    corrected.dimensions[0]!.evidenceIds = ["E1"];
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(invalid) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(corrected) } }] });
    const analyst = new DeepSeekResearchAnalyst({ client: { chat: { completions: { create } } } });
    const result = await analyst.analyze(input) as ReturnType<typeof validRaw>;
    expect(result.dimensions[0]?.evidenceIds).toEqual(["E1", "E2"]);
  });
});
