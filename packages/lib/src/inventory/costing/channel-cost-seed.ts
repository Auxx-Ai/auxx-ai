// packages/lib/src/inventory/costing/channel-cost-seed.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'
import { requestAccountingRecovery } from '../../accounting/work-items/recovery'
import { getOrgCache } from '../../cache'
import { isServicePartKind } from './client'
import { type EnsureStandardCostResult, ensureStandardCost } from './ensure-standard-cost'
import { pricePendingMovementsQuietly } from './price-pending-movements'

const SEED_ATTRIBUTES = ['part_channel_cost', 'part_standard_cost', 'part_kind'] as const

/**
 * Seed a provisional `channel` standard from `part_channel_cost` on the named parts that have
 * none (106 D5). Filters before `ensureStandardCost`, which reads the whole org, so a sync of
 * parts that are already priced costs one query.
 */
export async function seedStandardFromChannelCost(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Result<EnsureStandardCostResult, Error>> {
  const unique = [...new Set(partIds.filter(Boolean))]
  if (unique.length === 0) return ok({ writtenPartIds: [] })

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...SEED_ATTRIBUTES])
  const channelField = fields.part_channel_cost
  const standardField = fields.part_standard_cost
  if (!channelField || !standardField) return ok({ writtenPartIds: [] })

  const fieldIds = [channelField.id, standardField.id, fields.part_kind?.id].filter(
    (id): id is string => Boolean(id)
  )
  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueNumber: schema.FieldValue.valueNumber,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, fieldIds),
        inArray(schema.FieldValue.entityId, unique)
      )
    )

  const channelCosts = new Map<string, number>()
  const priced = new Set<string>()
  const services = new Set<string>()
  for (const row of rows) {
    if (row.fieldId === channelField.id) {
      if (row.valueNumber != null && row.valueNumber >= 0) {
        channelCosts.set(row.entityId, row.valueNumber)
      }
    } else if (row.fieldId === standardField.id) {
      if (row.valueNumber != null) priced.add(row.entityId)
    } else if (isServicePartKind(row.optionId)) {
      services.add(row.entityId)
    }
  }

  const seeds = new Map<string, number>()
  for (const [partId, cost] of channelCosts) {
    if (!priced.has(partId) && !services.has(partId)) seeds.set(partId, cost)
  }
  if (seeds.size === 0) return ok({ writtenPartIds: [] })

  const result = await ensureStandardCost(db, organizationId, [...seeds.keys()], {
    kind: 'channel',
    unitCosts: seeds,
  })
  if (result.isOk() && result.value.writtenPartIds.length > 0) {
    await pricePendingMovementsQuietly(db, organizationId, result.value.writtenPartIds)
    await requestAccountingRecovery(organizationId)
  }
  return result
}
