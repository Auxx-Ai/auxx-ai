// packages/lib/src/admin/export-apps.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('admin-export')

/**
 * Export all apps for a developer account as a portable JSON structure.
 * Excludes secrets, S3 assets, and internal IDs.
 */
export async function exportByDeveloperAccount(db: Database, developerAccountId: string) {
  logger.info(`Exporting apps for developer account ${developerAccountId}`)

  const devAccount = await db.query.DeveloperAccount.findFirst({
    where: (da, { eq }) => eq(da.id, developerAccountId),
  })

  if (!devAccount) {
    throw new Error('Developer account not found')
  }

  const apps = await db.query.App.findMany({
    where: (a, { eq }) => eq(a.developerAccountId, developerAccountId),
    with: {
      oauthApplication: true,
      connectionDefinitions: true,
      deployments: {
        orderBy: (d, { desc }) => [desc(d.createdAt)],
      },
    },
  })

  return {
    exportVersion: '1.0',
    exportedAt: new Date().toISOString(),
    developerAccount: {
      slug: devAccount.slug,
      title: devAccount.title,
      featureFlags: devAccount.featureFlags,
    },
    apps: apps.map((app) => {
      // Find latest production deployment
      const latestProdDeployment = app.deployments.find((d) => d.deploymentType === 'production')

      return {
        slug: app.slug,
        title: app.title,
        description: app.description,
        category: app.category,
        scopes: app.scopes,
        hasOauth: app.hasOauth,
        hasBundle: app.hasBundle,
        publicationStatus: app.publicationStatus,
        reviewStatus: app.reviewStatus,
        autoApprove: app.autoApprove,
        overview: app.overview,
        contentOverview: app.contentOverview,
        contentHowItWorks: app.contentHowItWorks,
        contentConfigure: app.contentConfigure,
        websiteUrl: app.websiteUrl,
        documentationUrl: app.documentationUrl,
        contactUrl: app.contactUrl,
        supportSiteUrl: app.supportSiteUrl,
        termsOfServiceUrl: app.termsOfServiceUrl,
        oauthExternalEntrypointUrl: app.oauthExternalEntrypointUrl,
        oauthApplication: app.oauthApplication
          ? {
              clientId: app.oauthApplication.clientId,
              name: app.oauthApplication.name,
              redirectURLs: app.oauthApplication.redirectURLs,
              type: app.oauthApplication.type,
            }
          : null,
        connectionDefinitions: app.connectionDefinitions.map((cd) => ({
          connectionType: cd.connectionType,
          label: cd.label,
          description: cd.description,
          global: cd.global,
          major: cd.major,
          oauth2AuthorizeUrl: cd.oauth2AuthorizeUrl,
          oauth2AccessTokenUrl: cd.oauth2AccessTokenUrl,
          oauth2ClientId: cd.oauth2ClientId,
          // oauth2ClientSecret intentionally excluded
          oauth2Scopes: cd.oauth2Scopes,
          oauth2TokenRequestAuthMethod: cd.oauth2TokenRequestAuthMethod,
          oauth2RefreshTokenIntervalSeconds: cd.oauth2RefreshTokenIntervalSeconds,
          oauth2Features: cd.oauth2Features,
        })),
        latestDeployment: latestProdDeployment
          ? {
              version: latestProdDeployment.version,
              settingsSchema: latestProdDeployment.settingsSchema,
              status: latestProdDeployment.status,
              releaseNotes: latestProdDeployment.releaseNotes,
              metadata: latestProdDeployment.metadata,
            }
          : null,
      }
    }),
  }
}
