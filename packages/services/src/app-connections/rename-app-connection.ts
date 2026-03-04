// packages/services/src/app-connections/rename-app-connection.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { logger } from './utils'

/**
 * Rename an app connection's label.
 */
export async function renameAppConnection(
  connectionId: string,
  label: string,
  organizationId: string
) {
  const trimmed = label.trim()
  if (!trimmed) {
    return err({ code: 'INVALID_LABEL', message: 'Label must not be empty' })
  }

  const result = await fromDatabase(
    database
      .update(schema.WorkflowCredentials)
      .set({ label: trimmed, updatedAt: new Date() })
      .where(
        and(
          eq(schema.WorkflowCredentials.id, connectionId),
          eq(schema.WorkflowCredentials.organizationId, organizationId)
        )
      ),
    'rename-connection'
  )

  if (result.isErr()) {
    return result
  }

  logger.info('Renamed connection', { connectionId, label: trimmed })
  return ok(undefined)
}
