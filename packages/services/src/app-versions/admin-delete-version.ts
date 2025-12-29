// packages/services/src/app-versions/admin-delete-version.ts

import { database, AppVersion } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Admin-only: Delete version
 *
 * @param params - Version ID and admin user ID
 * @returns Result with success or error
 */
export async function adminDeleteVersion(params: { versionId: string; adminUserId: string }) {
  const { versionId, adminUserId } = params

  // Verify version exists
  const versionResult = await fromDatabase(
    database.query.AppVersion.findFirst({
      where: (versions, { eq }) => eq(versions.id, versionId),
    }),
    'get-version'
  )

  if (versionResult.isErr()) {
    return versionResult
  }

  if (!versionResult.value) {
    return err({
      code: 'VERSION_NOT_FOUND',
      message: 'Version not found',
      versionId,
    })
  }

  // Delete version
  const deleteResult = await fromDatabase(
    database.delete(AppVersion).where(eq(AppVersion.id, versionId)),
    'delete-version'
  )

  if (deleteResult.isErr()) {
    return deleteResult
  }

  // TODO: Log admin action

  return ok({ success: true })
}
