import type { ResearchEvidence, ResearchSource, ResearchTask } from "@/lib/domain/research";
import type { ResearchAnalysis } from "@/lib/ai/analyst";

export type ResearchGenerationInput = Pick<ResearchTask, "topic" | "competitors"> & {
  focus?: string | null;
  sources?: ResearchSource[];
  evidence?: ResearchEvidence[];
  dimensions?: string[];
  analysis?: ResearchAnalysis;
  revisionNotes?: string[];
};

export interface NumberedResearchSource {
  id: `S${number}`;
  product: string;
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchGenerator {
  readonly name: string;
  generate(input: ResearchGenerationInput): Promise<unknown>;
}

export function numberedResearchSources(sources: ResearchSource[] = []): NumberedResearchSource[] {
  return sources.map((source, index) => ({
    id: `S${index + 1}` as NumberedResearchSource["id"],
    product: source.product,
    title: source.title,
    url: source.url,
    snippet: source.snippet,
  }));
}
