// packages/lib/src/admin/import-apps.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('admin-import')

/**
 * Shape of the export JSON file used for import
 */
export interface ExportData {
  exportVersion: string
  exportedAt: string
  developerAccount: {
    slug: string
    title: string
    featureFlags: Record<string, unknown> | null
  }
  apps: Array<{
    slug: string
    title: string
    description: string | null
    category: string | null
    scopes: string[] | null
    hasOauth: boolean | null
    hasBundle: boolean | null
    publicationStatus: string
    reviewStatus: string | null
    autoApprove: boolean
    overview: string | null
    contentOverview: string | null
    contentHowItWorks: string | null
    contentConfigure: string | null
    websiteUrl: string | null
    documentationUrl: string | null
    contactUrl: string | null
    supportSiteUrl: string | null
    termsOfServiceUrl: string | null
    oauthExternalEntrypointUrl: string | null
    oauthApplication: {
      clientId: string
      name: string
      redirectURLs: string
      type: string
    } | null
    connectionDefinitions: Array<{
      connectionType: string
      label: string
      description: string | null
      global: boolean | null
      major: number
      oauth2AuthorizeUrl: string | null
      oauth2AccessTokenUrl: string | null
      oauth2ClientId: string | null
      oauth2Scopes: string[] | null
      oauth2TokenRequestAuthMethod: string | null
      oauth2RefreshTokenIntervalSeconds: number | null
      oauth2Features: Record<string, unknown> | null
    }>
    latestDeployment: unknown | null
  }>
}

/**
 * Validation result for import preview
 */
export interface ImportValidation {
  developerAccount: {
    slug: string
    exists: boolean
  }
  apps: Array<{
    slug: string
    title: string
    status: 'new' | 'update' | 'conflict'
    connectionCount: number
    hasOauth: boolean
  }>
}

/**
 * Result of a completed import
 */
export interface ImportResult {
  developerAccount: { slug: string; action: 'created' | 'updated' }
  apps: Array<{
    slug: string
    originalSlug: string | null
    action: 'created' | 'updated'
    oauthApplication: { clientId: string; action: 'created' | 'updated' } | null
    connectionDefinitions: Array<{
      label: string
      major: number
      action: 'created' | 'updated'
    }>
  }>
  postImportChecklist: string[]
}

/**
 * Validate an export JSON for import, checking slug availability and conflicts.
 */
export async function validateImport(
  db: Database,
  exportData: ExportData,
  targetDeveloperAccountId: string
): Promise<ImportValidation> {
  logger.info(`Validating import for target developer account: ${targetDeveloperAccountId}`)

  // Check each app slug against the target developer account
  const apps = await Promise.all(
    exportData.apps.map(async (app) => {
      const existingApp = await db.query.App.findFirst({
        where: (a, { eq }) => eq(a.slug, app.slug),
      })

      let status: 'new' | 'update' | 'conflict'
      if (!existingApp) {
        status = 'new'
      } else if (existingApp.developerAccountId === targetDeveloperAccountId) {
        status = 'update'
      } else {
        status = 'conflict'
      }

      return {
        slug: app.slug,
        title: app.title,
        status,
        connectionCount: app.connectionDefinitions.length,
        hasOauth: app.connectionDefinitions.some((cd) => cd.connectionType === 'oauth2-code'),
      }
    })
  )

  return {
    developerAccount: {
      slug: exportData.developerAccount.slug,
      exists: true, // target account always exists since it's selected from the UI
    },
    apps,
  }
}

/**
 * Import apps from an export JSON, using upserts matched by natural keys.
 * Runs in a single transaction for atomicity.
 */
export async function importApps(
  db: Database,
  exportData: ExportData,
  adminUserId: string,
  options: {
    targetDeveloperAccountId: string
    selectedSlugs: string[]
    slugOverrides: Record<string, string>
  }
): Promise<ImportResult> {
  const developerAccountId = options.targetDeveloperAccountId

  logger.info(
    `Importing ${options.selectedSlugs.length} apps into developer account: ${developerAccountId}`
  )

  return await db.transaction(async (tx) => {
    // 1. Verify target developer account exists
    const targetDevAccount = await tx.query.DeveloperAccount.findFirst({
      where: (da, { eq }) => eq(da.id, developerAccountId),
    })

    if (!targetDevAccount) {
      throw new Error('Target developer account not found')
    }

    // 2. Filter to selected apps
    const selectedApps = exportData.apps.filter((app) => options.selectedSlugs.includes(app.slug))

    // 3. Upsert each app
    const appResults: ImportResult['apps'] = []
    const postImportChecklist: string[] = []

    for (const appData of selectedApps) {
      const resolvedSlug = options.slugOverrides[appData.slug] ?? appData.slug
      const originalSlug = resolvedSlug !== appData.slug ? appData.slug : null

      // 3b. Upsert OAuthApplication
      let oauthResult: ImportResult['apps'][number]['oauthApplication'] = null
      let oauthApplicationId: string | null = null

      if (appData.oauthApplication) {
        const existingOauth = await tx.query.oauthApplication.findFirst({
          where: (oa, { eq }) => eq(oa.clientId, appData.oauthApplication!.clientId),
        })

        if (existingOauth) {
          await tx
            .update(schema.oauthApplication)
            .set({
              name: appData.oauthApplication.name,
              redirectURLs: appData.oauthApplication.redirectURLs,
              type: appData.oauthApplication.type,
              updatedAt: new Date(),
            })
            .where(eq(schema.oauthApplication.id, existingOauth.id))
          oauthApplicationId = existingOauth.id
          oauthResult = { clientId: appData.oauthApplication.clientId, action: 'updated' }
        } else {
          const [insertedOauth] = await tx
            .insert(schema.oauthApplication)
            .values({
              clientId: appData.oauthApplication.clientId,
              clientSecret: null,
              name: appData.oauthApplication.name,
              redirectURLs: appData.oauthApplication.redirectURLs,
              type: appData.oauthApplication.type,
              disabled: false,
              userId: adminUserId,
            })
            .returning({ id: schema.oauthApplication.id })
          oauthApplicationId = insertedOauth.id
          oauthResult = { clientId: appData.oauthApplication.clientId, action: 'created' }
        }

        postImportChecklist.push(
          `Set clientSecret on OAuth app '${appData.oauthApplication.clientId}'`
        )
      }

      // 3c. Upsert App
      const existingApp = await tx.query.App.findFirst({
        where: (a, { eq }) => eq(a.slug, resolvedSlug),
      })

      let appAction: 'created' | 'updated'
      let appId: string

      const appFields = {
        title: appData.title,
        description: appData.description,
        category: appData.category,
        scopes: appData.scopes,
        hasOauth: appData.hasOauth,
        hasBundle: appData.hasBundle,
        autoApprove: appData.autoApprove,
        overview: appData.overview,
        contentOverview: appData.contentOverview,
        contentHowItWorks: appData.contentHowItWorks,
        contentConfigure: appData.contentConfigure,
        websiteUrl: appData.websiteUrl,
        documentationUrl: appData.documentationUrl,
        contactUrl: appData.contactUrl,
        supportSiteUrl: appData.supportSiteUrl,
        termsOfServiceUrl: appData.termsOfServiceUrl,
        oauthExternalEntrypointUrl: appData.oauthExternalEntrypointUrl,
        oauthApplicationId,
        publicationStatus: appData.publicationStatus as 'unpublished' | 'published',
        reviewStatus: appData.reviewStatus as
          | 'pending-review'
          | 'in-review'
          | 'approved'
          | 'rejected'
          | 'withdrawn'
          | null,
        updatedAt: new Date(),
      }

      if (existingApp) {
        await tx.update(schema.App).set(appFields).where(eq(schema.App.id, existingApp.id))
        appId = existingApp.id
        appAction = 'updated'
      } else {
        const [insertedApp] = await tx
          .insert(schema.App)
          .values({
            slug: resolvedSlug,
            developerAccountId,
            ...appFields,
          })
          .returning({ id: schema.App.id })
        appId = insertedApp.id
        appAction = 'created'
      }

      // 3d. Upsert ConnectionDefinitions
      const connResults: ImportResult['apps'][number]['connectionDefinitions'] = []

      for (const cd of appData.connectionDefinitions) {
        const existingConn = await tx.query.ConnectionDefinition.findFirst({
          where: (c, { eq, and }) => and(eq(c.appId, appId), eq(c.major, cd.major)),
        })

        const connFields = {
          connectionType: cd.connectionType,
          label: cd.label,
          description: cd.description,
          global: cd.global,
          oauth2AuthorizeUrl: cd.oauth2AuthorizeUrl,
          oauth2AccessTokenUrl: cd.oauth2AccessTokenUrl,
          oauth2ClientId: cd.oauth2ClientId,
          oauth2Scopes: cd.oauth2Scopes,
          oauth2TokenRequestAuthMethod: cd.oauth2TokenRequestAuthMethod,
          oauth2RefreshTokenIntervalSeconds: cd.oauth2RefreshTokenIntervalSeconds,
          oauth2Features: cd.oauth2Features,
          updatedAt: new Date(),
        }

        let connAction: 'created' | 'updated'
        if (existingConn) {
          await tx
            .update(schema.ConnectionDefinition)
            .set(connFields)
            .where(eq(schema.ConnectionDefinition.id, existingConn.id))
          connAction = 'updated'
        } else {
          await tx.insert(schema.ConnectionDefinition).values({
            appId,
            developerAccountId,
            major: cd.major,
            createdById: adminUserId,
            oauth2ClientSecret: null,
            ...connFields,
          })
          connAction = 'created'
        }

        connResults.push({ label: cd.label, major: cd.major, action: connAction })

        if (cd.connectionType === 'oauth2-code') {
          postImportChecklist.push(
            `Set oauth2ClientSecret for ${resolvedSlug} connection '${cd.label}'`
          )
        }
      }

      postImportChecklist.push(`Upload logo/avatar for ${resolvedSlug}`)
      if (appData.hasBundle) {
        postImportChecklist.push(`Deploy bundle for ${resolvedSlug} via SDK CLI`)
      }
      postImportChecklist.push(`Publish ${resolvedSlug} when ready`)

      appResults.push({
        slug: resolvedSlug,
        originalSlug,
        action: appAction,
        oauthApplication: oauthResult,
        connectionDefinitions: connResults,
      })
    }

    logger.info(`Import complete: ${appResults.length} apps processed`)

    return {
      developerAccount: { slug: targetDevAccount.slug, action: 'updated' },
      apps: appResults,
      postImportChecklist,
    }
  })
}
