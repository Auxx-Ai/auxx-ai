// packages/services/src/app-versions/admin-unpublish-version.ts

import { AdminActionLog, AppVersion, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { recalculateAppStatus } from './recalculate-app-status'

/**
 * Admin-only: Unpublish version (published → unpublished)
 * Note: reviewStatus stays 'approved'
 *
 * @param params - Version ID and admin user ID
 * @returns Result with updated version or error
 */
export async function adminUnpublishVersion(params: { versionId: string; adminUserId: string }) {
  const { versionId, adminUserId } = params

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

  // Validate version is published
  if (version.publicationStatus !== 'published') {
    return err({
      code: 'VERSION_INVALID_STATUS',
      message: 'Can only unpublish published versions',
      versionId,
      currentStatus: version.publicationStatus || 'unknown',
    })
  }

  // Update version to unpublished (keeps approved status)
  const updateResult = await fromDatabase(
    database
      .update(AppVersion)
      .set({
        publicationStatus: 'unpublished',
        updatedAt: new Date(),
        // NOTE: reviewStatus stays 'approved'
      })
      .where(eq(AppVersion.id, versionId))
      .returning(),
    'unpublish-version'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  const [updatedVersion] = updateResult.value

  if (!updatedVersion) {
    return err({
      code: 'VERSION_UPDATE_FAILED',
      message: 'Failed to unpublish version',
      versionId,
    })
  }

  // Recalculate app status based on remaining versions
  await recalculateAppStatus(app.id)

  // Log admin action
  await fromDatabase(
    database.insert(AdminActionLog).values({
      adminUserId,
      actionType: 'UNPUBLISH_APP_VERSION',
      targetType: 'APP_VERSION',
      targetId: versionId,
      previousState: {
        publicationStatus: version.publicationStatus,
        reviewStatus: version.reviewStatus,
      },
      newState: {
        publicationStatus: 'unpublished',
        reviewStatus: version.reviewStatus, // Stays the same (approved)
      },
      details: {
        appId: app.id,
        appTitle: app.title,
        appSlug: app.slug,
        versionString: `${updatedVersion.major}.${updatedVersion.minor}.${updatedVersion.patch}`,
      },
    }),
    'log-admin-action'
  )

  return ok({ version: updatedVersion })
}
