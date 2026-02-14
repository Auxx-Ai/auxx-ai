// packages/services/src/apps/update-app-publication-status.ts

import { App, AppVersion, database } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { AppError } from './errors'

/**
 * Update app publication status
 * This submits ALL production versions for review together
 *
 * Actions:
 * - 'review': Submit app (and all prod versions) for review
 * - 'withdraw': Withdraw app from review
 *
 * Note: Admin actions (approve, reject, publish) are handled separately
 *
 * @param params - Object containing appId, userId, and targetStatus
 * @returns Result with updated app or error
 */
export async function updateAppPublicationStatus(params: {
  appId: string
  userId: string
  targetStatus: 'review' | 'withdraw' | 'unpublish'
}) {
  const { appId, userId, targetStatus } = params

  // Step 1: Get app and verify it exists
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.id, appId),
    }),
    'get-app'
  )

  if (appResult.isErr()) {
    return appResult
  }

  const app = appResult.value

  if (!app) {
    return err({
      code: 'APP_NOT_FOUND',
      message: 'App not found',
      appSlug: appId,
    })
  }

  // Step 2: Verify user is a member of the developer account
  const memberResult = await fromDatabase(
    database.query.DeveloperAccountMember.findFirst({
      where: (members, { and, eq }) =>
        and(eq(members.developerAccountId, app.developerAccountId), eq(members.userId, userId)),
    }),
    'check-member-access'
  )

  if (memberResult.isErr()) {
    return memberResult
  }

  const member = memberResult.value

  if (!member) {
    return err({
      code: 'DEVELOPER_ACCESS_DENIED',
      message: 'You do not have permission to update this app',
      userId,
      appId,
    })
  }

  // Step 3: Handle action
  switch (targetStatus) {
    case 'review': {
      return await handleSubmitForReview(appId, app)
    }

    case 'withdraw': {
      return await handleWithdrawFromReview(appId, app)
    }

    case 'unpublish': {
      return await handleUnpublish(appId, app)
    }

    default: {
      return err({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Invalid target status: ${targetStatus}`,
        appId,
      })
    }
  }
}

/**
 * Handle submitting app for review
 * Sets app and all prod versions to pending-review
 */
async function handleSubmitForReview(appId: string, app: typeof App.$inferSelect) {
  // Validate app eligibility
  const eligibilityResult = await validateAppEligibility(appId, app)
  if (eligibilityResult.isErr()) {
    return eligibilityResult
  }

  // Validate current state - can only submit if not already in review or approved
  if (app.reviewStatus === 'pending-review' || app.reviewStatus === 'in-review') {
    return err({
      code: 'APP_ALREADY_IN_REVIEW',
      message: 'App is already in review',
      appId,
      currentReviewStatus: app.reviewStatus,
    })
  }

  // Update app to pending-review
  const updateResult = await fromDatabase(
    database
      .update(App)
      .set({
        reviewStatus: 'pending-review',
        updatedAt: new Date(),
      })
      .where(eq(App.id, appId))
      .returning(),
    'update-app-status'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  const [updatedApp] = updateResult.value

  if (!updatedApp) {
    return err({
      code: 'APP_UPDATE_FAILED',
      message: 'Failed to update app status',
      appId,
    })
  }

  // Update all prod versions to 'pending-review'
  await fromDatabase(
    database
      .update(AppVersion)
      .set({
        reviewStatus: 'pending-review',
        updatedAt: new Date(),
      })
      .where(and(eq(AppVersion.appId, appId), eq(AppVersion.versionType, 'prod'))),
    'update-versions-to-pending-review'
  )

  return ok({ app: updatedApp })
}

/**
 * Handle withdrawing from review
 * Sets app and all prod versions reviewStatus to withdrawn
 */
async function handleWithdrawFromReview(appId: string, app: typeof App.$inferSelect) {
  // Validate current state
  if (app.reviewStatus !== 'pending-review' && app.reviewStatus !== 'in-review') {
    return err({
      code: 'APP_NOT_IN_REVIEW',
      message: 'App is not in review',
      appId,
      currentReviewStatus: app.reviewStatus,
    })
  }

  // Update app to withdrawn
  const updateResult = await fromDatabase(
    database
      .update(App)
      .set({
        reviewStatus: 'withdrawn',
        updatedAt: new Date(),
      })
      .where(eq(App.id, appId))
      .returning(),
    'update-app-status'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  const [updatedApp] = updateResult.value

  if (!updatedApp) {
    return err({
      code: 'APP_UPDATE_FAILED',
      message: 'Failed to update app status',
      appId,
    })
  }

  // Update all prod versions in review to 'withdrawn'
  await fromDatabase(
    database
      .update(AppVersion)
      .set({
        reviewStatus: 'withdrawn',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(AppVersion.appId, appId),
          eq(AppVersion.versionType, 'prod'),
          // Only withdraw versions that are in review
          eq(AppVersion.reviewStatus, 'pending-review')
        )
      ),
    'withdraw-versions-from-review'
  )

  return ok({ app: updatedApp })
}

/**
 * Handle unpublishing app
 * Unpublishes all published versions
 */
async function handleUnpublish(appId: string, app: typeof App.$inferSelect) {
  // Check if app is published
  if (app.publicationStatus !== 'published') {
    return err({
      code: 'APP_NOT_PUBLISHED',
      message: 'App is not published',
      appId,
    })
  }

  // Check for active installations
  const installationsResult = await fromDatabase(
    database.query.AppInstallation.findMany({
      where: (installations, { eq, and, isNull }) =>
        and(eq(installations.appId, appId), isNull(installations.uninstalledAt)),
    }),
    'check-installations'
  )

  if (installationsResult.isErr()) {
    return installationsResult
  }

  const activeInstallations = installationsResult.value

  if (activeInstallations.length > 0) {
    return err({
      code: 'APP_HAS_ACTIVE_INSTALLATIONS',
      message: `Cannot unpublish app with ${activeInstallations.length} active installation(s)`,
      appId,
      installationCount: activeInstallations.length,
    })
  }

  // Update all published versions to unpublished
  await fromDatabase(
    database
      .update(AppVersion)
      .set({
        publicationStatus: 'unpublished',
        updatedAt: new Date(),
        // NOTE: reviewStatus stays 'approved'
      })
      .where(
        and(
          eq(AppVersion.appId, appId),
          eq(AppVersion.versionType, 'prod'),
          eq(AppVersion.publicationStatus, 'published')
        )
      ),
    'unpublish-versions'
  )

  // Update app to unpublished
  const updateResult = await fromDatabase(
    database
      .update(App)
      .set({
        publicationStatus: 'unpublished',
        updatedAt: new Date(),
      })
      .where(eq(App.id, appId))
      .returning(),
    'update-app-status'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  const [updatedApp] = updateResult.value

  if (!updatedApp) {
    return err({
      code: 'APP_UPDATE_FAILED',
      message: 'Failed to update app status',
      appId,
    })
  }

  return ok({ app: updatedApp })
}

/**
 * Validate app eligibility for review submission
 * Checks listing completeness, production version or OAuth config
 */
async function validateAppEligibility(appId: string, app: typeof App.$inferSelect) {
  // Check 1: App listing must be complete
  const listingFields = {
    category: app.category,
    description: app.description,
    avatarUrl: app.avatarUrl,
    websiteUrl: app.websiteUrl,
    documentationUrl: app.documentationUrl,
    contactUrl: app.contactUrl,
    termsOfServiceUrl: app.termsOfServiceUrl,
    contentOverview: app.contentOverview,
    contentHowItWorks: app.contentHowItWorks,
    contentConfigure: app.contentConfigure,
  }

  const MINIMUM_CONTENT_LENGTH = 100
  const missingFields: string[] = []

  // Validate basic fields
  if (!listingFields.category?.trim()) missingFields.push('category')
  if (!listingFields.description?.trim()) missingFields.push('description')
  // if (!listingFields.avatarUrl?.trim()) missingFields.push('avatarUrl')
  if (!listingFields.websiteUrl?.trim()) missingFields.push('websiteUrl')
  if (!listingFields.documentationUrl?.trim()) missingFields.push('documentationUrl')
  if (!listingFields.contactUrl?.trim()) missingFields.push('contactUrl')
  if (!listingFields.termsOfServiceUrl?.trim()) missingFields.push('termsOfServiceUrl')

  // Validate content fields (minimum length)
  if (
    !listingFields.contentOverview ||
    listingFields.contentOverview.trim().length < MINIMUM_CONTENT_LENGTH
  ) {
    missingFields.push('contentOverview')
  }
  if (
    !listingFields.contentHowItWorks ||
    listingFields.contentHowItWorks.trim().length < MINIMUM_CONTENT_LENGTH
  ) {
    missingFields.push('contentHowItWorks')
  }
  if (
    !listingFields.contentConfigure ||
    listingFields.contentConfigure.trim().length < MINIMUM_CONTENT_LENGTH
  ) {
    missingFields.push('contentConfigure')
  }

  if (missingFields.length > 0) {
    return err({
      code: 'APP_LISTING_INCOMPLETE',
      message: 'App listing is incomplete',
      appId,
      missingFields,
    })
  }

  // Check 2: Must have production version OR OAuth configured
  const versionsResult = await fromDatabase(
    database.query.AppVersion.findFirst({
      where: (versions, { and, eq }) =>
        and(eq(versions.appId, appId), eq(versions.versionType, 'prod')),
    }),
    'check-prod-versions'
  )

  const hasProdVersion = versionsResult.isOk() && !!versionsResult.value
  const hasOAuth = app.hasOauth

  if (!hasProdVersion && !hasOAuth) {
    return err({
      code: 'APP_NO_PROD_VERSION',
      message: 'App must have at least one production version or OAuth enabled',
      appId,
    })
  }

  // Check 3: If OAuth is enabled, config must be complete
  if (hasOAuth) {
    const oauthMissingFields: string[] = []

    if (!app.oauthExternalEntrypointUrl?.trim()) {
      oauthMissingFields.push('oauthExternalEntrypointUrl')
    }

    if (!app.scopes || app.scopes.length === 0) {
      oauthMissingFields.push('scopes')
    }

    if (oauthMissingFields.length > 0) {
      return err({
        code: 'APP_OAUTH_CONFIG_INCOMPLETE',
        message: 'OAuth configuration is incomplete',
        appId,
        missingFields: oauthMissingFields,
      })
    }
  }

  return ok(undefined)
}
