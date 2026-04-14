// apps/web/src/app/robots.ts
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/workflows/'],
        disallow: '/',
      },
    ],
  }
}
