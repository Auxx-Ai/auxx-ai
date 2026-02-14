// packages/services/src/apps/register-oauth-app.ts

import { App, database, oauthApplication } from '@auxx/database'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Generate a secure OAuth client secret
 */
export function generateClientSecret(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Generate a unique client ID for an app
 */
export function generateClientId(appSlug: string): string {
  // Format: app-{slug}-{random}
  const random = randomBytes(8).toString('hex')
  return `app-${appSlug}-${random}`
}

/**
 * Register an app as an OAuth application in Better Auth
 */
export async function registerAppAsOAuthClient(input: {
  appId: string
  appSlug: string
  appTitle: string
  redirectUris: string[]
  scopes: string[]
}) {
  const { appId, appSlug, appTitle, redirectUris, scopes } = input

  // Check if app already has an OAuth application
  const existingAppResult = await fromDatabase(
    database.query.App.findFirst({
      where: eq(App.id, appId),
      with: {
        oauthApplication: true,
      },
    }),
    'check-existing-app'
  )

  if (existingAppResult.isErr()) {
    return existingAppResult
  }

  const existingApp = existingAppResult.value

  if (!existingApp) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: 'App not found',
      appId,
    })
  }

  if (existingApp.oauthApplicationId) {
    return err({
      code: 'OAUTH_ALREADY_ENABLED' as const,
      message: 'App already has an OAuth application registered',
      appId,
    })
  }

  // Create OAuth application
  const clientId = generateClientId(appSlug)
  const clientSecret = generateClientSecret()

  const createOAuthResult = await fromDatabase(
    database
      .insert(oauthApplication)
      .values({
        clientId,
        clientSecret,
        name: appTitle,
        redirectURLs: redirectUris.join(','), // Better Auth expects comma-separated string
        type: 'confidential', // Apps are confidential clients (have client_secret)
        disabled: false,
        metadata: JSON.stringify({
          appId,
          appSlug,
          scopes,
          thirdPartyApp: true,
        }),
      })
      .returning(),
    'create-oauth-application'
  )

  if (createOAuthResult.isErr()) {
    return createOAuthResult
  }

  const [oauthApp] = createOAuthResult.value

  if (!oauthApp) {
    return err({
      code: 'OAUTH_CREATE_FAILED' as const,
      message: 'Failed to create OAuth application',
    })
  }

  // Link app to OAuth application
  const updateAppResult = await fromDatabase(
    database
      .update(App)
      .set({
        oauthApplicationId: oauthApp.id,
        updatedAt: new Date(),
      })
      .where(eq(App.id, appId))
      .returning(),
    'link-oauth-to-app'
  )

  if (updateAppResult.isErr()) {
    // Rollback: delete the oauth application we just created
    await database.delete(oauthApplication).where(eq(oauthApplication.id, oauthApp.id))
    return updateAppResult
  }

  return ok({
    oauthApplicationId: oauthApp.id,
    clientId: oauthApp.clientId,
    clientSecret: oauthApp.clientSecret,
  })
}

/**
 * Unregister an OAuth application for an app
 */
export async function unregisterAppOAuthClient(appId: string) {
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: eq(App.id, appId),
    }),
    'find-app'
  )

  if (appResult.isErr()) {
    return appResult
  }

  const app = appResult.value

  if (!app) {
    return err({
      code: 'APP_NOT_FOUND' as const,
      message: 'App not found',
      appId,
    })
  }

  if (!app.oauthApplicationId) {
    return err({
      code: 'OAUTH_NOT_ENABLED' as const,
      message: 'App does not have an OAuth application',
      appId,
    })
  }

  // Delete OAuth application (cascade will handle tokens/consents)
  const deleteResult = await fromDatabase(
    database.delete(oauthApplication).where(eq(oauthApplication.id, app.oauthApplicationId)),
    'delete-oauth-application'
  )

  if (deleteResult.isErr()) {
    return deleteResult
  }

  // Unlink from app
  const updateResult = await fromDatabase(
    database
      .update(App)
      .set({
        oauthApplicationId: null,
        updatedAt: new Date(),
      })
      .where(eq(App.id, appId))
      .returning(),
    'unlink-oauth-from-app'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  return ok({ success: true })
}

/**
 * Update OAuth application redirect URIs
 */
export async function updateOAuthRedirectUris(oauthApplicationId: string, redirectUris: string[]) {
  const updateResult = await fromDatabase(
    database
      .update(oauthApplication)
      .set({
        redirectURLs: redirectUris.join(','),
        updatedAt: new Date(),
      })
      .where(eq(oauthApplication.id, oauthApplicationId))
      .returning(),
    'update-redirect-uris'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  return ok({ success: true })
}
