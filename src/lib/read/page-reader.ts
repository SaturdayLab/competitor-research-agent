export type PageReadSuccess = {
  ok: true;
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  contentType: string;
  status: number;
};

export type PageReadFailure = {
  ok: false;
  url: string;
  reason: string;
};

export type PageReadResult = PageReadSuccess | PageReadFailure;

export interface PageReader {
  readonly name: string;
  read(url: string): Promise<PageReadResult>;
}

export class DisabledPageReader implements PageReader {
  readonly name = "disabled";

  async read(url: string): Promise<PageReadResult> {
    return { ok: false, url, reason: "Page Reader 未启用" };
  }
}
