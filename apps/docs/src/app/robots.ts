// apps/docs/src/app/robots.ts
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/health'],
      },
    ],
    sitemap: 'https://docs.auxx.ai/sitemap.xml',
  }
}
