import { DeepSeekEvidenceExtractor } from "@/lib/ai/deepseek-extractor";
import { DeepSeekResearchGenerator } from "@/lib/ai/deepseek-generator";
import { DeepSeekResearchInvestigator } from "@/lib/ai/deepseek-investigator";
import { DemoEvidenceExtractor } from "@/lib/ai/demo-extractor";
import { DemoResearchGenerator } from "@/lib/ai/demo-generator";
import type { EvidenceExtractor } from "@/lib/ai/extractor";
import type { ResearchGenerator } from "@/lib/ai/generator";
import { DisabledResearchInvestigator, type ResearchInvestigator } from "@/lib/ai/investigator";
import { DeepSeekResearchReviewer } from "@/lib/ai/deepseek-reviewer";
import { DeepSeekResearchPlanner } from "@/lib/ai/deepseek-planner";
import { DemoResearchPlanner } from "@/lib/ai/demo-planner";
import type { ResearchPlanner } from "@/lib/ai/planner";
import { DeepSeekResearchAnalyst } from "@/lib/ai/deepseek-analyst";
import { DemoResearchAnalyst } from "@/lib/ai/demo-analyst";
import type { ResearchAnalyst } from "@/lib/ai/analyst";
import { DisabledResearchReviewer, type ResearchReviewer } from "@/lib/ai/reviewer";
import { OpenAIEvidenceExtractor } from "@/lib/ai/openai-extractor";
import { OpenAIResearchGenerator } from "@/lib/ai/openai-generator";
import { ConfigurationError } from "@/lib/errors";
import { DeepSeekGapQueryPlanner } from "@/lib/ai/deepseek-gap-query-planner";
import { DemoGapQueryPlanner } from "@/lib/ai/demo-gap-query-planner";
import type { GapQueryPlanner } from "@/lib/ai/gap-investigator";
import { DeepSeekProductSelector } from "@/lib/ai/deepseek-product-selector";
import { DemoProductSelector } from "@/lib/ai/demo-product-selector";
import type { ProductSelector } from "@/lib/ai/product-discovery";

let cachedGenerator: ResearchGenerator | null = null;
let cachedExtractor: EvidenceExtractor | null = null;
let cachedInvestigator: ResearchInvestigator | null = null;
let cachedReviewer: ResearchReviewer | null = null;
let cachedPlanner: ResearchPlanner | null = null;
let cachedAnalyst: ResearchAnalyst | null = null;
let cachedGapQueryPlanner: GapQueryPlanner | null = null;
let cachedProductSelector: ProductSelector | null = null;

function researchProviderName(): string {
  return process.env.RESEARCH_PROVIDER?.trim().toLowerCase() || "demo";
}

export function getResearchGenerator(): ResearchGenerator {
  if (cachedGenerator) return cachedGenerator;

  const provider = researchProviderName();
  if (provider === "demo") cachedGenerator = new DemoResearchGenerator();
  else if (provider === "openai") cachedGenerator = new OpenAIResearchGenerator();
  else if (provider === "deepseek") cachedGenerator = new DeepSeekResearchGenerator();
  else throw new ConfigurationError(`不支持的 RESEARCH_PROVIDER：${provider}`);

  return cachedGenerator;
}

export function getEvidenceExtractor(): EvidenceExtractor {
  if (cachedExtractor) return cachedExtractor;

  const provider = researchProviderName();
  if (provider === "demo") cachedExtractor = new DemoEvidenceExtractor();
  else if (provider === "openai") cachedExtractor = new OpenAIEvidenceExtractor();
  else if (provider === "deepseek") cachedExtractor = new DeepSeekEvidenceExtractor();
  else throw new ConfigurationError(`不支持的 RESEARCH_PROVIDER：${provider}`);

  return cachedExtractor;
}

export function getResearchInvestigator(): ResearchInvestigator {
  if (cachedInvestigator) return cachedInvestigator;

  const provider = researchProviderName();
  if (provider === "deepseek") cachedInvestigator = new DeepSeekResearchInvestigator();
  else cachedInvestigator = new DisabledResearchInvestigator();

  return cachedInvestigator;
}

export function getResearchReviewer(): ResearchReviewer {
  if (cachedReviewer) return cachedReviewer;

  const provider = researchProviderName();
  if (provider === "deepseek") cachedReviewer = new DeepSeekResearchReviewer();
  else cachedReviewer = new DisabledResearchReviewer();

  return cachedReviewer;
}

export function getResearchPlanner(): ResearchPlanner {
  if (cachedPlanner) return cachedPlanner;

  const provider = researchProviderName();
  if (provider === "deepseek") cachedPlanner = new DeepSeekResearchPlanner();
  else if (provider === "demo" || provider === "openai") cachedPlanner = new DemoResearchPlanner();
  else throw new ConfigurationError(`不支持的 RESEARCH_PROVIDER：${provider}`);

  return cachedPlanner;
}

export function getResearchAnalyst(): ResearchAnalyst {
  if (cachedAnalyst) return cachedAnalyst;

  const provider = researchProviderName();
  if (provider === "deepseek") cachedAnalyst = new DeepSeekResearchAnalyst();
  else if (provider === "demo" || provider === "openai") cachedAnalyst = new DemoResearchAnalyst();
  else throw new ConfigurationError(`不支持的 RESEARCH_PROVIDER：${provider}`);

  return cachedAnalyst;
}

export function getGapQueryPlanner(): GapQueryPlanner {
  if (cachedGapQueryPlanner) return cachedGapQueryPlanner;
  const provider = researchProviderName();
  if (provider === "deepseek") cachedGapQueryPlanner = new DeepSeekGapQueryPlanner();
  else if (provider === "demo" || provider === "openai") cachedGapQueryPlanner = new DemoGapQueryPlanner();
  else throw new ConfigurationError(`不支持的 RESEARCH_PROVIDER：${provider}`);
  return cachedGapQueryPlanner;
}

export function getProductSelector(): ProductSelector {
  if (cachedProductSelector) return cachedProductSelector;
  const provider = researchProviderName();
  if (provider === "deepseek") cachedProductSelector = new DeepSeekProductSelector();
  else if (provider === "demo" || provider === "openai") cachedProductSelector = new DemoProductSelector();
  else throw new ConfigurationError(`不支持的 RESEARCH_PROVIDER：${provider}`);
  return cachedProductSelector;
}
