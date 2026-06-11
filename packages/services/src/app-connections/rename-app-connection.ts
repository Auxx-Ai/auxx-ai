// packages/services/src/app-connections/rename-app-connection.ts

import { updateCredential } from '@auxx/credentials/store'
import { err, ok } from 'neverthrow'
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

  const result = await updateCredential(connectionId, organizationId, { label: trimmed })

  if (result.isErr()) {
    return err(result.error)
  }

  logger.info('Renamed connection', { connectionId, label: trimmed })
  return ok(undefined)
}
