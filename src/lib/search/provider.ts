export interface SearchQuery {
  query: string;
  count?: number;
}

export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  rank: number;
}

export interface SearchResult extends RawSearchResult {
  canonicalUrl: string;
}

export interface SearchProvider {
  readonly name: string;
  search(input: SearchQuery): Promise<SearchResult[]>;
}

export class DisabledSearchProvider implements SearchProvider {
  readonly name = "disabled";

  async search(): Promise<SearchResult[]> {
    return [];
  }
}

