// packages/services/src/app-versions/update-version-publication-status.ts

import { database, AppVersion, App } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Update version publication status
 * Handles developer actions: submit, withdraw, publish, unpublish
 *
 * IMPORTANT: Admin actions (approve, reject) are in separate admin service
 *
 * @param params - Object containing versionId, userId, and action
 * @returns Result with updated version or error
 */
export async function updateVersionPublicationStatus(params: {
  versionId: string
  userId: string
  action: 'submit-for-review' | 'withdraw' | 'publish' | 'unpublish'
}) {
  const { versionId, userId, action } = params

  // Step 1: Get version with app
  const versionResult = await fromDatabase(
    database.query.AppVersion.findFirst({
      where: (versions, { eq }) => eq(versions.id, versionId),
      with: { app: true },
    }),
    'get-version'
  )

  if (versionResult.isErr()) return versionResult

  const versionWithApp = versionResult.value
  if (!versionWithApp) {
    return err({
      code: 'VERSION_NOT_FOUND',
      message: 'Version not found',
      versionId,
    })
  }

  const version = versionWithApp
  const app = versionWithApp.app

  // Step 2: Verify production version
  if (version.versionType !== 'prod') {
    return err({
      code: 'VERSION_NOT_PROD',
      message: 'Only production versions can have publication status updated',
      versionId,
      versionType: version.versionType,
    })
  }

  // Step 3: Verify user permissions
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
      code: 'VERSION_ACCESS_DENIED',
      message: 'You do not have permission to update this version',
      versionId,
      organizationId: app.developerAccountId,
    })
  }

  // Step 4: Execute action
  switch (action) {
    case 'submit-for-review': {
      return await handleSubmitForReview(versionId, version, app)
    }

    case 'withdraw': {
      return await handleWithdraw(versionId, version, app)
    }

    case 'publish': {
      return await handlePublish(versionId, version, app)
    }

    case 'unpublish': {
      return await handleUnpublish(versionId, version, app)
    }

    default: {
      return err({
        code: 'INVALID_ACTION',
        message: `Invalid action: ${action}`,
        versionId,
      })
    }
  }
}

/**
 * Handle submit for review
 *
 * If app.autoApprove is TRUE:
 *   - Review Status: null → approved
 *   - Publication Status: → published
 *   - Lifecycle Status: → active
 *   - Released At: set to now
 *
 * If app.autoApprove is FALSE (default):
 *   - Review Status: null → pending-review
 *   - Publication Status: stays unpublished
 */
async function handleSubmitForReview(versionId: string, version: any, app: any) {
  // Validate current state - can only submit if: new (null/undefined), withdrawn, or rejected
  if (
    version.reviewStatus &&
    version.reviewStatus !== 'withdrawn' &&
    version.reviewStatus !== 'rejected'
  ) {
    return err({
      code: 'VERSION_INVALID_STATE',
      message: 'Version must be new, withdrawn, or rejected to submit for review',
      versionId,
      currentReviewStatus: version.reviewStatus,
    })
  }

  if (version.publicationStatus === 'published') {
    return err({
      code: 'VERSION_ALREADY_PUBLISHED',
      message: 'Cannot submit published version for review. Unpublish first.',
      versionId,
    })
  }

  // Check if app has auto-approve enabled
  if (app.autoApprove) {
    // AUTO-APPROVE PATH: Automatically approve and publish
    const updateResult = await fromDatabase(
      database
        .update(AppVersion)
        .set({
          reviewStatus: 'approved',
          publicationStatus: 'published',
          status: 'active', // Make it installable
          reviewedAt: new Date(),
          reviewedBy: null, // System auto-approval, no admin user
          releasedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(AppVersion.id, versionId))
        .returning(),
      'auto-approve-and-publish-version'
    )

    if (updateResult.isErr()) return updateResult

    const [updatedVersion] = updateResult.value
    if (!updatedVersion) {
      return err({
        code: 'VERSION_UPDATE_FAILED',
        message: 'Failed to auto-approve version',
        versionId,
      })
    }

    // Update app status to approved and published
    await fromDatabase(
      database
        .update(App)
        .set({
          reviewStatus: 'approved',
          publicationStatus: 'published',
          updatedAt: new Date(),
        })
        .where(eq(App.id, version.appId)),
      'update-app-auto-approved'
    )

    return ok({
      version: updatedVersion,
      autoApproved: true,
    })
  }

  // MANUAL REVIEW PATH: Standard pending-review flow
  const updateResult = await fromDatabase(
    database
      .update(AppVersion)
      .set({
        reviewStatus: 'pending-review',
        publicationStatus: 'unpublished',
        updatedAt: new Date(),
      })
      .where(eq(AppVersion.id, versionId))
      .returning(),
    'update-version-review-status'
  )

  if (updateResult.isErr()) return updateResult

  const [updatedVersion] = updateResult.value
  if (!updatedVersion) {
    return err({
      code: 'VERSION_UPDATE_FAILED',
      message: 'Failed to update version',
      versionId,
    })
  }

  // Update app to pending-review (indicates new changes pending)
  await fromDatabase(
    database
      .update(App)
      .set({
        reviewStatus: 'pending-review',
        updatedAt: new Date(),
      })
      .where(eq(App.id, version.appId)),
    'update-app-review-status'
  )

  return ok({
    version: updatedVersion,
    autoApproved: false,
  })
}

/**
 * Handle withdraw from review
 * Review Status: pending-review/in-review → withdrawn
 * Publication Status: stays unpublished
 */
async function handleWithdraw(versionId: string, version: any, app: any) {
  // Validate current state
  if (version.reviewStatus !== 'pending-review' && version.reviewStatus !== 'in-review') {
    return err({
      code: 'VERSION_INVALID_STATE',
      message: 'Can only withdraw versions that are pending review or in review',
      versionId,
      currentReviewStatus: version.reviewStatus,
    })
  }

  // Update version to withdrawn
  const updateResult = await fromDatabase(
    database
      .update(AppVersion)
      .set({
        reviewStatus: 'withdrawn',
        updatedAt: new Date(),
      })
      .where(eq(AppVersion.id, versionId))
      .returning(),
    'update-version-withdrawn'
  )

  if (updateResult.isErr()) return updateResult

  const [updatedVersion] = updateResult.value
  if (!updatedVersion) {
    return err({
      code: 'VERSION_UPDATE_FAILED',
      message: 'Failed to update version',
      versionId,
    })
  }

  // Recalculate app review status
  await recalculateAppStatus(version.appId)

  return ok({ version: updatedVersion })
}

/**
 * Handle publish (developer publishes an approved version)
 * Review Status: must be 'approved'
 * Publication Status: unpublished → published
 * Lifecycle Status: → 'active' (makes version installable)
 */
async function handlePublish(versionId: string, version: any, app: any) {
  // Validate current state - must be approved
  if (version.reviewStatus !== 'approved') {
    return err({
      code: 'VERSION_NOT_APPROVED',
      message: 'Version must be approved by admin before publishing',
      versionId,
      currentReviewStatus: version.reviewStatus,
    })
  }

  // Validate not already published
  if (version.publicationStatus === 'published') {
    return err({
      code: 'VERSION_ALREADY_PUBLISHED',
      message: 'Version is already published',
      versionId,
    })
  }

  // Update version to published and active
  const updateResult = await fromDatabase(
    database
      .update(AppVersion)
      .set({
        publicationStatus: 'published',
        status: 'active', // Set to active when publishing so it's installable
        releasedAt: new Date(),
        updatedAt: new Date(),
        // NOTE: reviewStatus stays 'approved'
      })
      .where(eq(AppVersion.id, versionId))
      .returning(),
    'publish-version'
  )

  if (updateResult.isErr()) return updateResult

  const [updatedVersion] = updateResult.value
  if (!updatedVersion) {
    return err({
      code: 'VERSION_UPDATE_FAILED',
      message: 'Failed to publish version',
      versionId,
    })
  }

  // Recalculate app publication status
  await recalculateAppStatus(version.appId)

  return ok({ version: updatedVersion })
}

/**
 * Handle unpublish
 * Review Status: stays approved
 * Publication Status: published → unpublished
 * Lifecycle Status: stays as-is (typically 'active')
 * Note: To prevent new installations, use updateLifecycleStatus to set to 'deprecated'
 */
async function handleUnpublish(versionId: string, version: any, app: any) {
  // Validate current state
  if (version.publicationStatus !== 'published') {
    return err({
      code: 'VERSION_NOT_PUBLISHED',
      message: 'Version is not published',
      versionId,
      currentPublicationStatus: version.publicationStatus,
    })
  }

  // Check if this is the last published version
  const publishedVersionsResult = await fromDatabase(
    database.query.AppVersion.findMany({
      where: (versions, { and, eq }) =>
        and(
          eq(versions.appId, version.appId),
          eq(versions.versionType, 'prod'),
          eq(versions.publicationStatus, 'published')
        ),
    }),
    'check-published-versions'
  )

  if (publishedVersionsResult.isErr()) return publishedVersionsResult

  const publishedVersions = publishedVersionsResult.value

  if (publishedVersions.length === 1 && publishedVersions[0]?.id === versionId) {
    return err({
      code: 'VERSION_IS_LAST_PUBLISHED',
      message: 'Cannot unpublish the last published version',
      versionId,
    })
  }

  // Update version to unpublished (keeps approved status)
  const updateResult = await fromDatabase(
    database
      .update(AppVersion)
      .set({
        publicationStatus: 'unpublished',
        // isPublished: false,
        updatedAt: new Date(),
        // NOTE: reviewStatus stays 'approved'
      })
      .where(eq(AppVersion.id, versionId))
      .returning(),
    'unpublish-version'
  )

  if (updateResult.isErr()) return updateResult

  const [updatedVersion] = updateResult.value
  if (!updatedVersion) {
    return err({
      code: 'VERSION_UPDATE_FAILED',
      message: 'Failed to unpublish version',
      versionId,
    })
  }

  // Recalculate app publication status
  await recalculateAppStatus(version.appId)

  return ok({ version: updatedVersion })
}

/**
 * Recalculate app publication and review status based on versions
 */
async function recalculateAppStatus(appId: string) {
  const versionsResult = await fromDatabase(
    database.query.AppVersion.findMany({
      where: (versions, { and, eq }) =>
        and(eq(versions.appId, appId), eq(versions.versionType, 'prod')),
    }),
    'get-all-versions'
  )

  if (versionsResult.isErr()) return

  const versions = versionsResult.value

  // Determine publication status
  const hasPublishedVersion = versions.some((v) => v.publicationStatus === 'published')
  const newPublicationStatus = hasPublishedVersion ? 'published' : 'unpublished'

  // Determine review status priority:
  // 1. If any version is in-review → app is in-review
  // 2. If any version is pending-review → app is pending-review
  // 3. If any version is approved → app is approved
  // 4. Otherwise → null
  let newReviewStatus = null
  if (versions.some((v) => v.reviewStatus === 'in-review')) {
    newReviewStatus = 'in-review'
  } else if (versions.some((v) => v.reviewStatus === 'pending-review')) {
    newReviewStatus = 'pending-review'
  } else if (versions.some((v) => v.reviewStatus === 'approved')) {
    newReviewStatus = 'approved'
  }

  // Update app
  await fromDatabase(
    database
      .update(App)
      .set({
        publicationStatus: newPublicationStatus,
        reviewStatus: newReviewStatus,
        updatedAt: new Date(),
      })
      .where(eq(App.id, appId)),
    'recalculate-app-status'
  )
}
