// packages/services/src/app-versions/admin-reject-version.ts

import { AdminActionLog, AppVersion, database } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { recalculateAppStatus } from './recalculate-app-status'

/**
 * Admin-only: Reject version in review
 * Review Status: pending-review/in-review → rejected
 * Publication Status: stays unpublished
 *
 * @param params - Version ID, rejection reason, and admin user ID
 * @returns Result with updated version or error
 */
export async function adminRejectVersion(params: {
  versionId: string
  reason: string
  adminUserId: string
}) {
  const { versionId, reason, adminUserId } = params

  // Get version with app
  const versionResult = await fromDatabase(
    database.query.AppVersion.findFirst({
      where: (versions, { eq }) => eq(versions.id, versionId),
      with: {
        app: true,
      },
    }),
    'get-version'
  )

  if (versionResult.isErr()) {
    return versionResult
  }

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

  // Validate version is in reviewable state
  if (version.reviewStatus !== 'pending-review' && version.reviewStatus !== 'in-review') {
    return err({
      code: 'VERSION_NOT_IN_REVIEW',
      message: 'Version must be pending review or in review to reject',
      versionId,
      currentReviewStatus: version.reviewStatus,
    })
  }

  // Update version to rejected
  const updateResult = await fromDatabase(
    database
      .update(AppVersion)
      .set({
        reviewStatus: 'rejected',
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
        rejectionReason: reason,
        publicationStatus: 'unpublished',
        // isPublished: false,
        updatedAt: new Date(),
      })
      .where(eq(AppVersion.id, versionId))
      .returning(),
    'reject-version'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  const [updatedVersion] = updateResult.value

  if (!updatedVersion) {
    return err({
      code: 'VERSION_UPDATE_FAILED',
      message: 'Failed to reject version',
      versionId,
    })
  }

  // Reject ALL other versions that are in review for this app
  // This mirrors the behavior where submitting for review sets ALL versions to review
  await fromDatabase(
    database
      .update(AppVersion)
      .set({
        reviewStatus: 'rejected',
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
        rejectionReason: reason,
        publicationStatus: 'unpublished',
        // isPublished: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(AppVersion.appId, app.id),
          eq(AppVersion.versionType, 'prod'),
          eq(AppVersion.reviewStatus, 'pending-review')
        )
      ),
    'reject-all-review-versions'
  )

  // Recalculate app status based on remaining versions
  await recalculateAppStatus(app.id)

  // Log admin action with reason
  await fromDatabase(
    database.insert(AdminActionLog).values({
      adminUserId,
      actionType: 'REJECT_APP_VERSION',
      targetType: 'APP_VERSION',
      targetId: versionId,
      reason,
      previousState: {
        reviewStatus: version.reviewStatus,
        publicationStatus: version.publicationStatus,
        // isPublished: version.isPublished,
      },
      newState: {
        reviewStatus: 'rejected',
        publicationStatus: 'unpublished',
        // isPublished: false,
      },
      details: {
        appId: app.id,
        appTitle: app.title,
        appSlug: app.slug,
        versionString: `${version.major}.${version.minor}.${version.patch}`,
      },
    }),
    'log-admin-action'
  )

  // TODO: Send notification to developer with rejection reason

  return ok({ version: updatedVersion })
}
