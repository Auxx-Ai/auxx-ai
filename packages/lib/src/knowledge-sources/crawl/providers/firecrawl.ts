// packages/lib/src/knowledge-sources/crawl/providers/firecrawl.ts
// Firecrawl implementation of CrawlProvider. Reads its key lazily from configService
// (like PusherRealtimeProvider); talks the v2 REST API directly with fetch (no SDK
// dep). Crawls are async — we poll get_crawl_status inside the worker job (no public
// webhook route in Phase 2). See plans/kb/sources/phase-2-website-crawler.md §11.

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import { buildTreeFromPaths, type MappedLink } from '../sitemap-tree'
import type { CrawlOpts, CrawlPage, CrawlProvider, SitemapNode } from '../types'
import { toPathRegex } from '../url'

const logger = createScopedLogger('firecrawl-crawl-provider')

/** Poll cadence + ceiling for the in-worker crawl status loop. */
const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface FirecrawlPageData {
  markdown?: string
  metadata?: { title?: string; sourceURL?: string; url?: string; statusCode?: number }
}

export class FirecrawlCrawlProvider implements CrawlProvider {
  readonly id = 'firecrawl'

  private get apiKey(): string {
    const key = configService.get<string>('FIRECRAWL_API_KEY')
    if (!key) {
      throw new Error(
        'FIRECRAWL_API_KEY is not configured. Set it to enable website crawling (CRAWL_PROVIDER=firecrawl).'
      )
    }
    return key
  }

  private get baseUrl(): string {
    return configService.get<string>('FIRECRAWL_BASE_URL') ?? 'https://api.firecrawl.dev'
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Firecrawl ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`)
    }
    return (await res.json()) as T
  }

  async checkUrl(
    url: string
  ): Promise<{ accessible: boolean; statusCode: number; title?: string }> {
    try {
      const res = await this.request<{ data?: FirecrawlPageData }>('POST', '/v2/scrape', {
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      })
      const statusCode = res.data?.metadata?.statusCode ?? 200
      return {
        accessible: statusCode >= 200 && statusCode < 400,
        statusCode,
        title: res.data?.metadata?.title,
      }
    } catch (error) {
      logger.warn('checkUrl failed', { url, error: error instanceof Error ? error.message : error })
      return { accessible: false, statusCode: 0 }
    }
  }

  async getSitemapTree(url: string, opts?: { includeSubdomains?: boolean }): Promise<SitemapNode> {
    const res = await this.request<{ links?: Array<string | MappedLink> }>('POST', '/v2/map', {
      url,
      includeSubdomains: opts?.includeSubdomains ?? false,
    })
    const links: MappedLink[] = (res.links ?? []).map((link) =>
      typeof link === 'string' ? { url: link } : link
    )
    return buildTreeFromPaths(links)
  }

  async crawl(
    url: string,
    opts: CrawlOpts,
    onPage: (page: CrawlPage) => Promise<void>
  ): Promise<{ urls: string[] }> {
    const includePaths = opts.selectedPaths.map(toPathRegex)
    const { id } = await this.request<{ id: string }>('POST', '/v2/crawl', {
      url,
      limit: opts.maxPages,
      includePaths: includePaths.length > 0 ? includePaths : undefined,
      excludePaths: opts.excludeUrls?.map(toPathRegex),
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: opts.mainContentOnly ?? true,
      },
    })

    const urls: string[] = []
    for await (const page of this.pollCrawl(id)) {
      const pageUrl = page.metadata?.sourceURL ?? page.metadata?.url
      if (!pageUrl || !page.markdown) continue
      urls.push(pageUrl)
      await onPage({ url: pageUrl, title: page.metadata?.title, markdown: page.markdown })
    }
    return { urls }
  }

  /**
   * Poll GET /v2/crawl/{id} until status='completed', yielding each page as it lands.
   * Firecrawl paginates results via `next`; we drain new rows each tick by offset.
   */
  private async *pollCrawl(id: string): AsyncGenerator<FirecrawlPageData> {
    const started = Date.now()
    let yielded = 0
    while (true) {
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        throw new Error(`Firecrawl crawl ${id} timed out after ${POLL_TIMEOUT_MS}ms`)
      }
      const res = await this.request<{
        status: string
        data?: FirecrawlPageData[]
        error?: string
      }>('GET', `/v2/crawl/${id}`)

      const data = res.data ?? []
      for (; yielded < data.length; yielded++) {
        const page = data[yielded]
        if (page) yield page
      }

      if (res.status === 'completed') return
      if (res.status === 'failed' || res.status === 'cancelled') {
        throw new Error(`Firecrawl crawl ${id} ${res.status}: ${res.error ?? 'unknown error'}`)
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }
}
