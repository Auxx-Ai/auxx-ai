// packages/lib/src/knowledge-sources/connectors/website.ts
// The website (crawl-mode) connector. Drives the configured CrawlProvider over the
// user's selected sections and emits one SourceItem per page — carrying `path` so the
// article sink files crawled pages into folder-by-path under the source root folder.
// The connector does no Article/Document work; the sink decides where each item lands.

import { getCrawlProvider } from '../crawl'
import { normalizeUrl } from '../crawl/url'
import type { SourceConnector } from './types'

/** Shape of a website source's `config` JSON. */
interface WebsiteConfig {
  url: string
  selectedPaths?: string[]
  includeUrls?: string[]
  excludeUrls?: string[]
  mainContentOnly?: boolean
  maxPages?: number
}

export const websiteConnector: SourceConnector = {
  mode: 'crawl',
  type: 'website',
  async crawl(source, onItem) {
    const config = source.config as WebsiteConfig
    if (!config?.url) throw new Error(`Website source ${source.id} is missing config.url`)

    const { urls } = await getCrawlProvider().crawl(
      config.url,
      {
        selectedPaths: config.selectedPaths ?? [],
        includeUrls: config.includeUrls,
        excludeUrls: config.excludeUrls,
        mainContentOnly: config.mainContentOnly ?? true,
        maxPages: config.maxPages,
      },
      async (page) => {
        let path: string | undefined
        try {
          path = new URL(page.url).pathname
        } catch {
          path = undefined
        }
        await onItem({
          externalId: normalizeUrl(page.url),
          title: page.title ?? page.url,
          markdown: page.markdown,
          path,
        })
      }
    )

    return { externalIds: urls.map(normalizeUrl) }
  },
}
