// packages/services/src/apps/update-app-publication-status.ts

import { App, AppDeployment, database } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Update app publication status
 * This submits ALL production deployments for review together
 *
 * Actions:
 * - 'review': Submit app (and all prod deployments) for review
 * - 'withdraw': Withdraw app from review
 * - 'unpublish': Unpublish app
 *
 * Note: Admin actions (approve, reject, publish) are handled separately
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

  if (appResult.isErr()) return appResult

  const app = appResult.value

  if (!app) {
    return err({ code: 'APP_NOT_FOUND', message: 'App not found', appSlug: appId })
  }

  // Step 2: Verify user is a member of the developer account
  const memberResult = await fromDatabase(
    database.query.DeveloperAccountMember.findFirst({
      where: (members, { and, eq }) =>
        and(eq(members.developerAccountId, app.developerAccountId), eq(members.userId, userId)),
    }),
    'check-member-access'
  )

  if (memberResult.isErr()) return memberResult

  if (!memberResult.value) {
    return err({
      code: 'DEVELOPER_ACCESS_DENIED',
      message: 'You do not have permission to update this app',
      userId,
      appId,
    })
  }

  switch (targetStatus) {
    case 'review':
      return await handleSubmitForReview(appId, app)
    case 'withdraw':
      return await handleWithdrawFromReview(appId, app)
    case 'unpublish':
      return await handleUnpublish(appId, app)
    default:
      return err({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Invalid target status: ${targetStatus}`,
        appId,
      })
  }
}

/**
 * Handle submitting app for review
 * Sets app reviewStatus and transitions all active prod deployments to pending-review
 */
async function handleSubmitForReview(appId: string, app: typeof App.$inferSelect) {
  const eligibilityResult = await validateAppEligibility(appId, app)
  if (eligibilityResult.isErr()) return eligibilityResult

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
      .set({ reviewStatus: 'pending-review', updatedAt: new Date() })
      .where(eq(App.id, appId))
      .returning(),
    'update-app-status'
  )

  if (updateResult.isErr()) return updateResult

  const [updatedApp] = updateResult.value
  if (!updatedApp) {
    return err({ code: 'APP_UPDATE_FAILED', message: 'Failed to update app status', appId })
  }

  // Transition active production deployments to pending-review
  await fromDatabase(
    database
      .update(AppDeployment)
      .set({ status: 'pending-review' })
      .where(
        and(
          eq(AppDeployment.appId, appId),
          eq(AppDeployment.deploymentType, 'production'),
          eq(AppDeployment.status, 'active')
        )
      ),
    'update-deployments-to-pending-review'
  )

  return ok({ app: updatedApp })
}

/**
 * Handle withdrawing from review
 */
async function handleWithdrawFromReview(appId: string, app: typeof App.$inferSelect) {
  if (app.reviewStatus !== 'pending-review' && app.reviewStatus !== 'in-review') {
    return err({
      code: 'APP_NOT_IN_REVIEW',
      message: 'App is not in review',
      appId,
      currentReviewStatus: app.reviewStatus,
    })
  }

  const updateResult = await fromDatabase(
    database
      .update(App)
      .set({ reviewStatus: 'withdrawn', updatedAt: new Date() })
      .where(eq(App.id, appId))
      .returning(),
    'update-app-status'
  )

  if (updateResult.isErr()) return updateResult

  const [updatedApp] = updateResult.value
  if (!updatedApp) {
    return err({ code: 'APP_UPDATE_FAILED', message: 'Failed to update app status', appId })
  }

  // Withdraw deployments that are in review
  await fromDatabase(
    database
      .update(AppDeployment)
      .set({ status: 'withdrawn' })
      .where(
        and(
          eq(AppDeployment.appId, appId),
          eq(AppDeployment.deploymentType, 'production'),
          eq(AppDeployment.status, 'pending-review')
        )
      ),
    'withdraw-deployments-from-review'
  )

  return ok({ app: updatedApp })
}

/**
 * Handle unpublishing app
 */
async function handleUnpublish(appId: string, app: typeof App.$inferSelect) {
  if (app.publicationStatus !== 'published') {
    return err({ code: 'APP_NOT_PUBLISHED', message: 'App is not published', appId })
  }

  // Check for active installations
  const installationsResult = await fromDatabase(
    database.query.AppInstallation.findMany({
      where: (installations, { eq, and, isNull }) =>
        and(eq(installations.appId, appId), isNull(installations.uninstalledAt)),
    }),
    'check-installations'
  )

  if (installationsResult.isErr()) return installationsResult

  if (installationsResult.value.length > 0) {
    return err({
      code: 'APP_HAS_ACTIVE_INSTALLATIONS',
      message: `Cannot unpublish app with ${installationsResult.value.length} active installation(s)`,
      appId,
      installationCount: installationsResult.value.length,
    })
  }

  // Deprecate published deployments
  await fromDatabase(
    database
      .update(AppDeployment)
      .set({ status: 'deprecated' })
      .where(
        and(
          eq(AppDeployment.appId, appId),
          eq(AppDeployment.deploymentType, 'production'),
          eq(AppDeployment.status, 'published')
        )
      ),
    'deprecate-published-deployments'
  )

  // Update app to unpublished
  const updateResult = await fromDatabase(
    database
      .update(App)
      .set({ publicationStatus: 'unpublished', updatedAt: new Date() })
      .where(eq(App.id, appId))
      .returning(),
    'update-app-status'
  )

  if (updateResult.isErr()) return updateResult

  const [updatedApp] = updateResult.value
  if (!updatedApp) {
    return err({ code: 'APP_UPDATE_FAILED', message: 'Failed to update app status', appId })
  }

  return ok({ app: updatedApp })
}

/**
 * Validate app eligibility for review submission
 */
async function validateAppEligibility(appId: string, app: typeof App.$inferSelect) {
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

  if (!listingFields.category?.trim()) missingFields.push('category')
  if (!listingFields.description?.trim()) missingFields.push('description')
  if (!listingFields.websiteUrl?.trim()) missingFields.push('websiteUrl')
  if (!listingFields.documentationUrl?.trim()) missingFields.push('documentationUrl')
  if (!listingFields.contactUrl?.trim()) missingFields.push('contactUrl')
  if (!listingFields.termsOfServiceUrl?.trim()) missingFields.push('termsOfServiceUrl')

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

  // Must have production deployment OR OAuth configured
  const deploymentResult = await fromDatabase(
    database.query.AppDeployment.findFirst({
      where: (d, { and, eq }) => and(eq(d.appId, appId), eq(d.deploymentType, 'production')),
    }),
    'check-prod-deployments'
  )

  const hasProdDeployment = deploymentResult.isOk() && !!deploymentResult.value
  const hasOAuth = app.hasOauth

  if (!hasProdDeployment && !hasOAuth) {
    return err({
      code: 'APP_NO_PROD_VERSION',
      message: 'App must have at least one production deployment or OAuth enabled',
      appId,
    })
  }

  if (hasOAuth) {
    const oauthMissingFields: string[] = []
    if (!app.oauthExternalEntrypointUrl?.trim())
      oauthMissingFields.push('oauthExternalEntrypointUrl')
    if (!app.scopes || app.scopes.length === 0) oauthMissingFields.push('scopes')

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
