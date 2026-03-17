// packages/lib/src/cache/providers/app-slug-map-provider.ts

import type { CachedApp } from '../app-cache-keys'
import type { AppCacheProvider } from '../app-cache-provider'

/** Computes a slug → app map for all apps */
export const appSlugMapProvider: AppCacheProvider<Record<string, CachedApp>> = {
  async compute(db) {
    const apps = await db.query.App.findMany()

    const map: Record<string, CachedApp> = {}
    for (const app of apps) {
      map[app.slug] = {
        id: app.id,
        slug: app.slug,
        title: app.title,
        description: app.description,
        avatarId: app.avatarId,
        avatarUrl: app.avatarUrl,
        screenshots: (app.screenshots as string[]) ?? [],
        category: app.category,
        websiteUrl: app.websiteUrl,
        documentationUrl: app.documentationUrl,
        contactUrl: app.contactUrl,
        supportSiteUrl: app.supportSiteUrl,
        termsOfServiceUrl: app.termsOfServiceUrl,
        overview: app.overview,
        contentOverview: app.contentOverview,
        contentHowItWorks: app.contentHowItWorks,
        contentConfigure: app.contentConfigure,
        scopes: (app.scopes as string[]) ?? [],
        hasOauth: app.hasOauth ?? false,
        hasBundle: app.hasBundle ?? false,
        oauthExternalEntrypointUrl: app.oauthExternalEntrypointUrl,
        publicationStatus: app.publicationStatus,
        reviewStatus: app.reviewStatus,
        verified: app.verified ?? false,
        autoApprove: app.autoApprove ?? false,
        developerAccountId: app.developerAccountId,
        createdAt: app.createdAt.toISOString(),
        updatedAt: app.updatedAt.toISOString(),
      }
    }
    return map
  },
}
