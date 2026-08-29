import type { ResearchRepository } from "@/lib/research/repository";
import { SupabaseResearchRepository } from "@/lib/supabase/research-repository";

let cachedRepository: ResearchRepository | null = null;

export function getResearchRepository(): ResearchRepository {
  cachedRepository ??= new SupabaseResearchRepository();
  return cachedRepository;
}
