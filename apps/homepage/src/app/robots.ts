// apps/homepage/src/app/robots.ts
import { getHomepageUrl } from '@auxx/config/client'
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getHomepageUrl()

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/health'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
