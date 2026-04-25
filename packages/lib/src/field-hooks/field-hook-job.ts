// packages/lib/src/field-hooks/field-hook-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { FieldTriggerJobEvent } from '../events/types'
import { getFieldTriggers } from './registry'

const logger = createScopedLogger('field-hooks')

/**
 * BullMQ job handler for field:trigger events.
 * Looks up registered handlers for the systemAttribute and calls each one
 * with the full batch of recordIds for efficient processing.
 */
export async function handleFieldTriggerJob({
  data,
}: {
  data: FieldTriggerJobEvent
}): Promise<void> {
  const { systemAttribute, recordIds, organizationId, userId } = data.data

  const handlers = getFieldTriggers(systemAttribute as SystemAttribute)
  if (handlers.length === 0) {
    logger.debug(`No handlers for field trigger: ${systemAttribute}`)
    return
  }

  logger.info(`Processing field trigger: ${systemAttribute}`, {
    recordCount: recordIds.length,
    handlerCount: handlers.length,
  })

  for (const handler of handlers) {
    try {
      await handler({
        action: 'updated',
        systemAttribute: systemAttribute as SystemAttribute,
        recordIds: recordIds as RecordId[],
        organizationId,
        userId,
      })
    } catch (error) {
      logger.error(`Field trigger handler failed for ${systemAttribute}`, {
        recordIds,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
