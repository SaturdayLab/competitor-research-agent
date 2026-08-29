import type { ResearchSource, ResearchTask } from "@/lib/domain/research";
import type { PageReader } from "@/lib/read/page-reader";
import type { ResearchRepository } from "@/lib/research/repository";
import type { SearchProvider } from "@/lib/search/provider";

export type InvestigateInput = {
  task: ResearchTask;
  sources: ResearchSource[];
  searchProvider: SearchProvider;
  pageReader: PageReader;
  repository: ResearchRepository;
  runId: string;
};

export type ToolCallLog = {
  name: string;
  ok: boolean;
  detail: string;
};

export type InvestigateResult = {
  sources: ResearchSource[];
  toolCalls: ToolCallLog[];
};

export interface ResearchInvestigator {
  readonly name: string;
  investigate(input: InvestigateInput): Promise<InvestigateResult>;
}

export function getAgentMaxSteps(environment: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(environment.AGENT_MAX_STEPS ?? 6);
  if (!Number.isFinite(parsed)) return 6;
  return Math.min(Math.max(Math.trunc(parsed), 1), 12);
}

export class DisabledResearchInvestigator implements ResearchInvestigator {
  readonly name = "disabled";

  async investigate(input: InvestigateInput): Promise<InvestigateResult> {
    return { sources: input.sources, toolCalls: [] };
  }
}
