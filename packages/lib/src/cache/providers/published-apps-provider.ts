// packages/lib/src/cache/providers/published-apps-provider.ts

import type { CachedPublishedApp } from '../app-cache-keys'
import type { AppCacheProvider } from '../app-cache-provider'

/** Computes published apps with developer account and latest production deployment */
export const publishedAppsProvider: AppCacheProvider<CachedPublishedApp[]> = {
  async compute(db) {
    const apps = await db.query.App.findMany({
      where: (apps, { eq }) => eq(apps.publicationStatus, 'published'),
      with: {
        developerAccount: {
          columns: { title: true, logoUrl: true },
        },
        deployments: {
          where: (deployments, { eq, and }) =>
            and(eq(deployments.deploymentType, 'production'), eq(deployments.status, 'published')),
          orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
          limit: 1,
          columns: { id: true, version: true, status: true },
        },
      },
    })

    return apps.map((app) => ({
      id: app.id,
      slug: app.slug,
      title: app.title,
      description: app.description,
      avatarId: app.avatarId,
      avatarUrl: app.avatarUrl,
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
      oauthExternalEntrypointUrl: app.oauthExternalEntrypointUrl,
      verified: app.verified ?? false,
      developerAccount: {
        title: app.developerAccount.title,
        logoUrl: app.developerAccount.logoUrl,
      },
      latestDeployment: app.deployments[0]
        ? {
            id: app.deployments[0].id,
            version: app.deployments[0].version,
            status: app.deployments[0].status,
          }
        : null,
    }))
  },
}
