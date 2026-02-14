// packages/services/src/workflow-share/get-or-create-end-user.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { WorkflowShareError } from './errors'
import type { EndUserIdentification } from './types'

/**
 * End user record
 */
export interface EndUser {
  id: string
  workflowAppId: string
  sessionId: string
  userId: string | null
  externalId: string | null
  context: Record<string, unknown> | null
  metadata: Record<string, unknown>
  totalRuns: number
  lastRunAt: Date | null
  createdAt: Date
}

/**
 * Options for getting or creating end user
 */
export interface GetOrCreateEndUserOptions {
  workflowAppId: string
  identification: EndUserIdentification
}

/**
 * Get or create end user for workflow access
 *
 * Handles three scenarios:
 * 1. Anonymous visitor (sessionId only)
 * 2. Logged-in Auxx user (userId + sessionId)
 * 3. Embedded scenario (externalId + sessionId)
 *
 * When a logged-in user is found by sessionId but doesn't have userId linked,
 * we link them (session continuity when anonymous user logs in).
 *
 * @param options - Identification options
 * @returns Result with end user or error
 */
export async function getOrCreateEndUser(
  options: GetOrCreateEndUserOptions
): Promise<Result<EndUser, WorkflowShareError>> {
  const { workflowAppId, identification } = options
  const { sessionId, userId, externalId, metadata } = identification

  // Priority 1: Find by userId if logged in
  if (userId) {
    const byUserResult = await fromDatabase(
      database.query.EndUser.findFirst({
        where: and(
          eq(schema.EndUser.workflowAppId, workflowAppId),
          eq(schema.EndUser.userId, userId)
        ),
      }),
      'get-end-user-by-user-id'
    )

    if (byUserResult.isErr()) {
      return err(byUserResult.error)
    }

    if (byUserResult.value) {
      return ok(byUserResult.value as EndUser)
    }
  }

  // Priority 2: Find by sessionId
  const bySessionResult = await fromDatabase(
    database.query.EndUser.findFirst({
      where: and(
        eq(schema.EndUser.workflowAppId, workflowAppId),
        eq(schema.EndUser.sessionId, sessionId)
      ),
    }),
    'get-end-user-by-session-id'
  )

  if (bySessionResult.isErr()) {
    return err(bySessionResult.error)
  }

  let endUser = bySessionResult.value as EndUser | undefined

  // Link userId if user is now logged in (session continuity)
  if (endUser && userId && !endUser.userId) {
    const updateResult = await fromDatabase(
      database
        .update(schema.EndUser)
        .set({ userId })
        .where(eq(schema.EndUser.id, endUser.id))
        .returning(),
      'link-user-to-end-user'
    )

    if (updateResult.isOk() && updateResult.value[0]) {
      endUser = updateResult.value[0] as EndUser
    }
  }

  if (endUser) {
    return ok(endUser)
  }

  // Priority 3: Find by externalId (for embedded)
  if (externalId) {
    const byExternalResult = await fromDatabase(
      database.query.EndUser.findFirst({
        where: and(
          eq(schema.EndUser.workflowAppId, workflowAppId),
          eq(schema.EndUser.externalId, externalId)
        ),
      }),
      'get-end-user-by-external-id'
    )

    if (byExternalResult.isErr()) {
      return err(byExternalResult.error)
    }

    if (byExternalResult.value) {
      return ok(byExternalResult.value as EndUser)
    }
  }

  // Create new end user
  const createResult = await fromDatabase(
    database
      .insert(schema.EndUser)
      .values({
        workflowAppId,
        sessionId,
        userId: userId || null,
        externalId: externalId || null,
        metadata: metadata || {},
      })
      .returning(),
    'create-end-user'
  )

  if (createResult.isErr()) {
    return err(createResult.error)
  }

  const newUser = createResult.value[0]

  if (!newUser) {
    return err({
      code: 'END_USER_CREATION_FAILED' as const,
      message: 'Failed to create end user',
    })
  }

  return ok(newUser as EndUser)
}
