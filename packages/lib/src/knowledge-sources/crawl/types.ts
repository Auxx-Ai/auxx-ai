// packages/lib/src/knowledge-sources/crawl/types.ts
// The CrawlProvider seam: discovery (map a site into a section tree) + crawl (stream
// clean markdown per page). Provider-swappable (Firecrawl first, native later) — the
// tree shape and CrawlPage are ours, identical across providers. See
// plans/kb/sources/phase-2-website-crawler.md.

/** A node in the discovered sitemap tree — a section (branch) or a page (leaf). */
export interface SitemapNode {
  /** Pathname prefix, e.g. '/products'. The root is '/'. */
  path: string
  /** A representative URL for this node (the page URL for leaves). */
  url: string
  title?: string
  /** false = section/branch, true = leaf doc. A node can be both a page and a branch. */
  isPage: boolean
  children: SitemapNode[]
}

/** One crawled page, normalized to clean markdown. */
export interface CrawlPage {
  url: string
  title?: string
  markdown: string
}

export interface CrawlOpts {
  /** Section path prefixes the user checked (e.g. ['/docs', '/products']). */
  selectedPaths: string[]
  /** Extra single URLs to include beyond the selected sections. */
  includeUrls?: string[]
  /** URLs/paths to never ingest. */
  excludeUrls?: string[]
  /** Strip nav/footer boilerplate (default true). */
  mainContentOnly?: boolean
  /** Credit guardrail — cap pages per crawl; the provider truncates + the caller logs. */
  maxPages?: number
}

export interface CrawlProvider {
  /** Stable id, e.g. 'firecrawl' | 'native'. */
  readonly id: string

  /** Reachability + title for the Connect step (auto-fills the source name). */
  checkUrl(url: string): Promise<{ accessible: boolean; statusCode: number; title?: string }>

  /** Optional sibling subdomains to offer in the wizard. */
  findSubdomains?(url: string): Promise<string[]>

  /** Map a site into the section tree backing the Pages checkbox step. */
  getSitemapTree(url: string, opts?: { includeSubdomains?: boolean }): Promise<SitemapNode>

  /**
   * Drive a crawl; invoke `onPage` for each result as it lands; resolve when complete.
   * The returned `urls` is the full list the orchestrator diffs for orphan reconciliation.
   */
  crawl(
    url: string,
    opts: CrawlOpts,
    onPage: (page: CrawlPage) => Promise<void>
  ): Promise<{ urls: string[] }>
}
