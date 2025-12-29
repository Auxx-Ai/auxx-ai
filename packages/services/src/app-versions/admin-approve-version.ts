// packages/services/src/app-versions/admin-approve-version.ts

import { database, AppVersion, App, AdminActionLog } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Admin-only: Approve version in review
 * Review Status: pending-review/in-review → approved
 * Publication Status: stays unpublished (admin must publish separately)
 *
 * @param params - Version ID, admin user ID, and optional auto-publish flag
 * @returns Result with updated version or error
 */
export async function adminApproveVersion(params: {
  versionId: string
  adminUserId: string
  autoPublish?: boolean
}) {
  const { versionId, adminUserId, autoPublish = false } = params

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
      message: 'Version must be pending review or in review to approve',
      versionId,
      currentReviewStatus: version.reviewStatus,
    })
  }

  // Prepare update data
  const updateData: any = {
    reviewStatus: 'approved',
    reviewedAt: new Date(),
    reviewedBy: adminUserId,
    updatedAt: new Date(),
  }

  // If autoPublish, also set publication status
  if (autoPublish) {
    updateData.publicationStatus = 'published'
    // updateData.isPublished = true
    updateData.releasedAt = new Date()
  }

  // Update version
  const updateResult = await fromDatabase(
    database.update(AppVersion).set(updateData).where(eq(AppVersion.id, versionId)).returning(),
    'approve-version'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  const [updatedVersion] = updateResult.value

  if (!updatedVersion) {
    return err({
      code: 'VERSION_UPDATE_FAILED',
      message: 'Failed to approve version',
      versionId,
    })
  }

  // Update app status
  await fromDatabase(
    database
      .update(App)
      .set({
        reviewStatus: 'approved',
        publicationStatus: autoPublish ? 'published' : app.publicationStatus,
        updatedAt: new Date(),
      })
      .where(eq(App.id, app.id)),
    'update-app-status'
  )

  // Log admin action
  await fromDatabase(
    database.insert(AdminActionLog).values({
      adminUserId,
      actionType: 'APPROVE_APP_VERSION',
      targetType: 'APP_VERSION',
      targetId: versionId,
      previousState: {
        reviewStatus: version.reviewStatus,
        publicationStatus: version.publicationStatus,
        // isPublished: version.isPublished,
      },
      newState: {
        reviewStatus: 'approved',
        publicationStatus: autoPublish ? 'published' : version.publicationStatus,
        // isPublished: autoPublish ? true : version.isPublished,
      },
      details: {
        appId: app.id,
        appTitle: app.title,
        appSlug: app.slug,
        versionString: `${updatedVersion.major}.${updatedVersion.minor}.${updatedVersion.patch}`,
        autoPublish,
      },
    }),
    'log-admin-action'
  )

  // TODO: Send notification to developer

  return ok({ version: updatedVersion, published: autoPublish })
}
