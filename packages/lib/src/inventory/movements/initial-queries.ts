// packages/lib/src/inventory/movements/initial-queries.ts

import type { Database, Transaction } from '@auxx/database'
import { StockMovementType } from '../../resources/registry/enum-values'
import {
  findSystemRecordIdsByValue,
  readSystemRecords,
  systemFields,
} from '../../resources/system-records'

/** A part's `initial` row as the anchor rules read it (111 Q26). */
export interface PartInitial {
  movementId: string
  partInstanceId: string
  quantity: number
  /** `stock_movement_occurred_at`, or `createdAt` for a row written without one. */
  occurredAt: Date
  /** The count fact, absent on a row nothing has stamped yet. */
  countQuantity: number | null
  /** `YYYY-MM-DD`. */
  countDate: string | null
}

const INITIAL_ATTRIBUTES = [
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_occurred_at',
  'stock_movement_count_quantity',
  'stock_movement_count_date',
] as const

/**
 * Each part's `initial` movement, archived rows included: an archived anchor is still the
 * anchor. A part with none is absent; a part with several (a raced double open) keeps its first.
 */
export async function readPartInitials(
  db: Database | Transaction,
  organizationId: string,
  partIds: readonly string[]
): Promise<Map<string, PartInitial>> {
  const initials = new Map<string, PartInitial>()
  const unique = [...new Set(partIds.filter(Boolean))]
  if (unique.length === 0) return initials

  const ctx = await systemFields(db, organizationId, 'stock_movement', INITIAL_ATTRIBUTES, {
    required: ['stock_movement_part', 'stock_movement_type', 'stock_movement_quantity'],
  })
  if (!ctx) return initials

  const found = await findSystemRecordIdsByValue(
    db,
    organizationId,
    ctx,
    [
      { attribute: 'stock_movement_type', option: [StockMovementType.INITIAL] },
      { attribute: 'stock_movement_part', related: unique },
    ],
    { includeArchived: true }
  )
  const ids = [...new Set([...found.values()].flat())]
  if (ids.length === 0) return initials

  const records = await readSystemRecords(db, organizationId, ctx, { ids, includeArchived: true })
  for (const record of records) {
    const partInstanceId = record.related('stock_movement_part')
    if (!partInstanceId || initials.has(partInstanceId)) continue
    const occurredAt = record.date('stock_movement_occurred_at')
    const countDate = record.date('stock_movement_count_date')
    initials.set(partInstanceId, {
      movementId: record.id,
      partInstanceId,
      quantity: record.number('stock_movement_quantity') ?? 0,
      occurredAt: occurredAt ? new Date(occurredAt) : record.createdAt,
      countQuantity: record.number('stock_movement_count_quantity'),
      countDate: countDate ? countDate.slice(0, 10) : null,
    })
  }
  return initials
}
