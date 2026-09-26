// packages/lib/src/resources/crud/batch-create-audit.ts

import type { CustomFieldEntity } from '@auxx/database/types'
import { getEntityPreCreateHooks, hasFieldPreHooks } from '../../field-hooks/registry'
import type { SequenceScope } from '../../records/record-numbering'
import { getCommonHooks, getSystemHooks } from '../hooks/system-hooks'
import type { Resource } from '../registry/types'

/**
 * How `createEntitiesBatch` discharges every create hook a system definition carries
 * (plans/mrp/12-slice-batched-backflush.md §2). Hooks not listed make the def ineligible.
 */
export interface BatchCreateAudit {
  /** The def's own system hooks by attribute; `range` numbers are allocated once per batch. */
  systemHooks: Readonly<Record<string, { range: SequenceScope }>>
  /** Field pre-hooks, run per value exactly as the CRUD create runs them. */
  fieldPreHooks: readonly string[]
  /** Entity pre-create hooks, run per item; none are audited yet. */
  entityPreCreateHooks: 0
}

/**
 * The system definitions eligible for the batched create. `build_status`'s guard reads only the
 * new value and the caller's bypass, so it holds per value in a batch as per record.
 */
export const BATCH_CREATE_AUDITS: Readonly<Record<string, BatchCreateAudit>> = {
  stock_movement: { systemHooks: {}, fieldPreHooks: [], entityPreCreateHooks: 0 },
  build: {
    systemHooks: { build_number: { range: 'build' } },
    fieldPreHooks: ['build_status'],
    entityPreCreateHooks: 0,
  },
}

/** The common hooks every def runs; the batch runs them per item like the CRUD create. */
const AUDITED_COMMON_HOOKS = ['created_by_id']

/** Display field types the batch cannot compute: a composed name and a file avatar. */
const UNBATCHABLE_DISPLAY_TYPES = new Set(['NAME', 'FILE'])

export type BatchCreatePlan =
  | { ok: true; ranges: Array<{ systemAttribute: string; scope: SequenceScope }> }
  | { ok: false; reason: string }

/**
 * Whether a definition's creates can be batched, and the number ranges the batch allocates.
 * A system def needs an audit entry matching its registered hooks; a user-authored def (no
 * `entityType`) carries no code hooks and qualifies when none are registered against its slug.
 */
export function planBatchCreate(
  resource: Resource,
  fields: readonly CustomFieldEntity[]
): BatchCreatePlan {
  const entityType = resource.entityType ?? null
  const audit: BatchCreateAudit | undefined = entityType
    ? BATCH_CREATE_AUDITS[entityType]
    : { systemHooks: {}, fieldPreHooks: [], entityPreCreateHooks: 0 }
  if (!audit) return { ok: false, reason: `${entityType} creates are not audited for batching` }

  const common = Object.keys(getCommonHooks())
  if (common.some((attr) => !AUDITED_COMMON_HOOKS.includes(attr))) {
    return { ok: false, reason: 'An unaudited common hook is registered' }
  }
  const own = Object.keys(getSystemHooks(entityType))
  const unaudited = own.find((attr) => !(attr in audit.systemHooks))
  if (unaudited) return { ok: false, reason: `System hook ${unaudited} is not audited` }
  if (getEntityPreCreateHooks(resource.apiSlug).length !== audit.entityPreCreateHooks) {
    return { ok: false, reason: 'An entity pre-create hook is not audited' }
  }
  for (const field of fields) {
    const attr = field.systemAttribute
    if (
      attr &&
      !audit.fieldPreHooks.includes(attr) &&
      hasFieldPreHooks(resource.apiSlug, attr as never)
    ) {
      return { ok: false, reason: `Field pre-hook on ${attr} is not audited` }
    }
    if (field.isUnique)
      return { ok: false, reason: `Unique field ${field.id} needs a per-row check` }
  }
  const display = resource.display
  for (const shown of [display?.primaryDisplayField, display?.secondaryDisplayField]) {
    if (shown && UNBATCHABLE_DISPLAY_TYPES.has(shown.type)) {
      return { ok: false, reason: `Display field ${shown.id} is a ${shown.type}` }
    }
  }
  if (display?.avatarField) return { ok: false, reason: 'Avatar display columns are not batched' }

  const ranges = Object.entries(audit.systemHooks).map(([systemAttribute, { range }]) => ({
    systemAttribute,
    scope: range,
  }))
  return { ok: true, ranges }
}
