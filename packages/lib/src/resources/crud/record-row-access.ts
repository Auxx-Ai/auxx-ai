// packages/lib/src/resources/crud/record-row-access.ts

import type { Database } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import { ForbiddenError } from '../../errors'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
import { parseRecordId, type RecordId } from '../resource-id'

/**
 * **The PER-ROW write gate** (plan v3/03 §5.3) — the edit twin of
 * `record.ts`'s `assertCanDeleteRows`.
 *
 * ## Why the def gate alone is wrong
 *
 * `assertEditEntity(def)` asks one question per DEFINITION. Once a row of a def
 * is reachable by two different routes — *"mine because I may see the whole
 * def"* and *"mine because this row was shared with me"* — that question has no
 * right answer for a row: a member holding an `edit` grant on ONE row of a def
 * they otherwise cannot see is refused by the def gate, so the grant is readable
 * and **inert**. They open the record and cannot change it.
 *
 * ## The shape (identical to the delete gate, deliberately)
 *
 * 1. **The def gate runs first and short-circuits.** It is the cheap, in-memory
 *    answer for the overwhelmingly common all-def-editable batch, it costs no
 *    I/O, and it keeps the `NON_RECORD_DEF_SLUGS` / mail-infra branch of
 *    `canEditEntity` reachable. Rows it allows are never read.
 * 2. **Only def-DENIED ids are stamped**, through the same `_access` read path
 *    the client sees (`getByIds` → `recordAccessRankSql`), and re-judged per row
 *    against {@link CapabilityView.canEditRecordAt} — the `edit` floor on the
 *    row-effective rung. No new verb vocabulary.
 * 3. **A missing row, or a row with no stamp, DENIES.** `getByIds` drops
 *    unauthorized ids silently (the non-enumeration contract), so "absent" is
 *    the strongest denial signal there is; reading it as "no opinion" would let
 *    exactly the ids the read path hid through the write path. A row that comes
 *    back WITHOUT a stamp can only be an unenforced read, and "no stamp" must
 *    never read as "no objection".
 * 4. **The batch fails WHOLE**, like the def gate it replaces — a partial write
 *    whose failures are per-row strings is not something a user can reason about.
 */

/** A row shape carrying the `_access` stamp — `getByIds`' items, structurally. */
export interface StampedRow {
  _access?: Rung
}

/**
 * The subset of `recordIds` the DEF-level edit gate refuses — the only ids that
 * need a row read. Pure, in-memory, and memoized per definition so a 100-row
 * single-def batch asks `canEditEntity` exactly once.
 *
 * Returns `[]` when `capabilities` is absent: that means an internal caller
 * (worker, seeder, record-rule) and is today's unrestricted semantics.
 */
export function defDeniedRecordIds(
  capabilities: CapabilityView | undefined,
  recordIds: readonly RecordId[]
): RecordId[] {
  if (!capabilities) return []
  const verdict = new Map<string, boolean>()
  const denied: RecordId[] = []
  for (const recordId of recordIds) {
    const { entityDefinitionId } = parseRecordId(recordId)
    let allowed = verdict.get(entityDefinitionId)
    if (allowed === undefined) {
      allowed = capabilities.canEditEntity(entityDefinitionId)
      verdict.set(entityDefinitionId, allowed)
    }
    if (!allowed) denied.push(recordId)
  }
  return denied
}

/**
 * Judge already-stamped rows against the row-effective `edit` floor, throwing
 * 403 on the first refusal.
 *
 * Split from the fetch so the decision is assertable without Drizzle — under the
 * default Vitest config `@auxx/database`'s `schema` is a Proxy whose columns are
 * `undefined`, and a gate whose only test asserts a built predicate passes
 * vacuously.
 */
export function assertRowsEditableFromStamps(
  capabilities: CapabilityView,
  recordIds: readonly RecordId[],
  stamped: Record<string, StampedRow | undefined>
): void {
  for (const recordId of recordIds) {
    const access = stamped[recordId]?._access
    if (!access || !capabilities.canEditRecordAt(access)) {
      throw new ForbiddenError("You don't have permission to edit these records.")
    }
  }
}

/**
 * Assert every row in `recordIds` is writable by this member — the composed
 * gate: def short-circuit, then one stamped read of the def-denied remainder.
 *
 * `stampRows` is injected rather than imported so this module stays free of the
 * picker's import graph and so `UnifiedCrudHandler` can hand in its OWN
 * `getByIds` (already memoized scope + grantee union) instead of constructing a
 * second reader per call.
 */
export async function assertRecordRowsEditable(
  capabilities: CapabilityView | undefined,
  recordIds: readonly RecordId[],
  stampRows: (ids: RecordId[]) => Promise<Record<string, StampedRow | undefined>>
): Promise<void> {
  if (!capabilities) return
  const denied = defDeniedRecordIds(capabilities, recordIds)
  if (denied.length === 0) return
  assertRowsEditableFromStamps(capabilities, denied, await stampRows(denied))
}

/**
 * The standalone form for callers that hold a `db` but no `UnifiedCrudHandler`
 * — today `apps/web`'s `assertFieldValueHostsWritable`, which is the *primary*
 * record-edit surface (every field write from the drawer and the table grid) and
 * would otherwise keep the def gate while the CRUD lane moved past it.
 *
 * Lazy-imports the picker so importing this module for its pure halves does not
 * drag the picker's graph in (`project_realtime_barrel_import_cycle`'s lesson).
 */
export async function assertRecordRowsEditableWithDb(params: {
  db: Database
  organizationId: string
  userId: string
  capabilities: CapabilityView | undefined
  recordIds: readonly RecordId[]
}): Promise<void> {
  const { db, organizationId, userId, capabilities, recordIds } = params
  return assertRecordRowsEditable(capabilities, recordIds, async (ids) => {
    const { RecordPickerService } = await import('../picker/record-picker-service')
    const service = new RecordPickerService(organizationId, userId, db, capabilities)
    return service.getResourcesByIds(ids)
  })
}
