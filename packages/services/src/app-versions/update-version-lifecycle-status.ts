// packages/services/src/app-versions/update-version-lifecycle-status.ts

import { AppVersion, database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { AppVersionError } from './errors'

/**
 * Valid lifecycle transitions for app versions
 */
const VALID_LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  draft: ['active'],
  active: ['deprecated'],
  deprecated: ['active'], // Can reactivate deprecated versions
}

/**
 * Update version lifecycle status
 * Handles: draft → active, active → deprecated, deprecated → active
 *
 * @param params - Object containing versionId, userId, and status
 * @returns Result with updated version or error
 */
export async function updateVersionLifecycleStatus(params: {
  versionId: string
  userId: string
  status: 'draft' | 'active' | 'deprecated'
}) {
  const { versionId, userId, status } = params

  // Step 1: Get version and verify it exists
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
      code: 'VERSION_ACCESS_DENIED',
      message: 'You do not have permission to update this version',
      versionId,
      organizationId: app.developerAccountId,
    })
  }

  // Step 3: Validate lifecycle transition
  const currentStatus = version.status ?? 'draft'
  const validNextStates = VALID_LIFECYCLE_TRANSITIONS[currentStatus]

  if (!validNextStates?.includes(status)) {
    return err({
      code: 'INVALID_LIFECYCLE_TRANSITION',
      message: `Cannot transition from ${currentStatus} to ${status}`,
      versionId,
      currentStatus,
      targetStatus: status,
    })
  }

  // Step 4: Update version lifecycle status
  const updateResult = await fromDatabase(
    database
      .update(AppVersion)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(AppVersion.id, versionId))
      .returning(),
    'update-version-lifecycle'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  const [updatedVersion] = updateResult.value

  if (!updatedVersion) {
    return err({
      code: 'VERSION_CREATE_FAILED',
      message: 'Failed to update version lifecycle status',
      appId: version.appId,
      reason: 'No version returned from update',
    })
  }

  return ok({ version: updatedVersion })
}
