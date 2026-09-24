// packages/lib/src/field-hooks/post/channel-cost-seed.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import { seedStandardFromChannelCost } from '../../inventory/costing/channel-cost-seed'
import type { BatchCore, DeriveHandler } from '../types'

const logger = createScopedLogger('field-hooks:channel-cost-seed')

const ATTRIBUTE = 'part_channel_cost'

/** A written `part_channel_cost` seeds a first standard (106 D5). Never throws: a sync must not fail on it. */
export const seedStandardOnChannelCost: DeriveHandler = async (event) => {
  if (event.field.systemAttribute !== ATTRIBUTE || event.newValue == null) return
  const { entityInstanceId } = parseRecordId(event.recordId)
  await seed(database, event.organizationId, [entityInstanceId])
}

/** The sync lane: one read for every part the run touched, whatever the values were. */
export const seedStandardOnChannelCostBatch: BatchCore = async ({
  organizationId,
  db,
  targets,
}) => {
  const partIds = targets
    .filter((target) => target.field.systemAttribute === ATTRIBUTE)
    .map((target) => parseRecordId(target.recordId).entityInstanceId)
  await seed(db, organizationId, partIds)
}

async function seed(
  db: Parameters<typeof seedStandardFromChannelCost>[0],
  organizationId: string,
  partIds: string[]
): Promise<void> {
  if (partIds.length === 0) return
  try {
    const result = await seedStandardFromChannelCost(db, organizationId, partIds)
    if (result.isErr()) {
      logger.warn('Could not seed a standard from a channel cost', {
        organizationId,
        parts: partIds.length,
        error: result.error.message,
      })
    }
  } catch (error) {
    logger.warn('Could not seed a standard from a channel cost', {
      organizationId,
      parts: partIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
