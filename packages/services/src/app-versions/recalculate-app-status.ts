// packages/services/src/app-versions/recalculate-app-status.ts

import { database, App } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { fromDatabase } from '../shared/utils'

/**
 * Recalculate and update app publication and review status based on its versions
 *
 * Publication Status Logic:
 * - Has any published version → App is published
 * - No published versions → App is unpublished
 *
 * Review Status Logic (Priority order):
 * - Has any in-review version → App is in-review
 * - Has any pending-review version → App is pending-review
 * - Has any approved version → App is approved
 * - Otherwise → App review status is null
 *
 * This ensures consistent status derivation across all operations.
 *
 * @param appId - The app to recalculate status for
 * @returns The new app statuses, or null if update failed
 */
export async function recalculateAppStatus(appId: string): Promise<{
  publicationStatus: 'unpublished' | 'published'
  reviewStatus: string | null
} | null> {
  // Get all prod versions for this app
  const allVersionsResult = await fromDatabase(
    database.query.AppVersion.findMany({
      where: (versions, { and, eq }) =>
        and(eq(versions.appId, appId), eq(versions.versionType, 'prod')),
    }),
    'get-all-versions'
  )

  if (allVersionsResult.isErr()) {
    return null
  }

  const allVersions = allVersionsResult.value

  // Determine publication status
  const hasPublishedVersion = allVersions.some(
    v => v.publicationStatus === 'published'
  )
  const newPublicationStatus = hasPublishedVersion ? 'published' : 'unpublished'

  // Determine review status priority:
  // 1. If any version is in-review → app is in-review
  // 2. If any version is pending-review → app is pending-review
  // 3. If any version is approved → app is approved
  // 4. Otherwise → null
  let newReviewStatus: string | null = null
  if (allVersions.some(v => v.reviewStatus === 'in-review')) {
    newReviewStatus = 'in-review'
  } else if (allVersions.some(v => v.reviewStatus === 'pending-review')) {
    newReviewStatus = 'pending-review'
  } else if (allVersions.some(v => v.reviewStatus === 'approved')) {
    newReviewStatus = 'approved'
  }

  // Get current app to check if update needed
  const appResult = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.id, appId),
    }),
    'get-app'
  )

  if (appResult.isErr() || !appResult.value) {
    return null
  }

  const app = appResult.value

  // Update app if either status changed
  if (
    app.publicationStatus !== newPublicationStatus ||
    app.reviewStatus !== newReviewStatus
  ) {
    await fromDatabase(
      database
        .update(App)
        .set({
          publicationStatus: newPublicationStatus,
          reviewStatus: newReviewStatus,
          updatedAt: new Date(),
        })
        .where(eq(App.id, appId)),
      'update-app-status'
    )
  }

  return {
    publicationStatus: newPublicationStatus,
    reviewStatus: newReviewStatus,
  }
}
