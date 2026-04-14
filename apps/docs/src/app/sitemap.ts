// apps/docs/src/app/sitemap.ts
import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'

const BASE_URL = 'https://docs.auxx.ai'

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages()

  return pages.map((page) => ({
    url: `${BASE_URL}${page.url}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: page.url === '/' ? 1.0 : 0.7,
  }))
}
