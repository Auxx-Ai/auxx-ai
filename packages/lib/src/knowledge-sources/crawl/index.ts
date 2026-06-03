// packages/lib/src/knowledge-sources/crawl/index.ts
// The crawl-provider factory. Config-selected (CRAWL_PROVIDER, default 'firecrawl')
// like the Redis/email `*_PROVIDER` switch — swapping providers is a config flip, not
// a code edit. The native scraper provider is deferred (same contract).

import { configService } from '@auxx/credentials'
import { FirecrawlCrawlProvider } from './providers/firecrawl'
import type { CrawlProvider } from './types'

let cached: CrawlProvider | null = null

/** Get the configured CrawlProvider singleton. */
export function getCrawlProvider(): CrawlProvider {
  if (cached) return cached
  const id = configService.get<string>('CRAWL_PROVIDER') ?? 'firecrawl'
  switch (id) {
    case 'firecrawl':
      cached = new FirecrawlCrawlProvider()
      return cached
    case 'native':
      throw new Error('CRAWL_PROVIDER=native is not implemented yet (deferred — same contract)')
    default:
      throw new Error(`Unknown CRAWL_PROVIDER '${id}' (expected 'firecrawl' | 'native')`)
  }
}

/** Test seam — reset the cached provider (e.g. after flipping config). */
export function resetCrawlProvider(): void {
  cached = null
}

export type { MappedLink } from './sitemap-tree'
export { buildTreeFromPaths } from './sitemap-tree'
export type { CrawlOpts, CrawlPage, CrawlProvider, SitemapNode } from './types'
export { normalizeUrl, toPathRegex } from './url'
