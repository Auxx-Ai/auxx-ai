// packages/lib/src/field-hooks/pre/return-status-guard.ts

import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import { unwrapStatusValue } from '../../resources/hooks/lifecycle-status-guard'
import {
  RETURN_ENTRY_STATUSES,
  RETURN_STATUS_TRANSITIONS,
} from '../../resources/hooks/return-hooks'
import type { FieldPreHookHandler } from '../types'

const logger = createScopedLogger('field-hooks:return-status-guard')

/**
 * The PHYSICAL lifecycle wall for `return_status` on the chain that actually runs for
 * interactive writes (plans/money/tasks/54-returns.md section 3.3, which asks for exactly
 * this: *"Use `lifecycle-status-guard.ts` (`field-hooks/pre/`) for the transition rules, the
 * same way `build` and `purchase_order` do."*).
 *
 * 🛑 **The system-hook twin in `resources/hooks/return-hooks.ts` is coverage; this is the
 * enforcement point, and for `return` that gap is the primary door.** `runPreHooks` fires only
 * for writes through `UnifiedCrudHandler` - `record.create` / `record.update`, the bulk record
 * writes, the CSV importer and the SDK. `return` is a VISIBLE entity with a list page and a
 * drawer, and warehouse staff drive this field by hand from that drawer: every one of those
 * edits goes `useSaveFieldValue -> api.fieldValue.set -> FieldValueService ->
 * fireFieldPreHooks` and reaches the system registry never
 * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md section 1). Both are kept -
 * removing either narrows coverage - and both read ONE graph, the constants imported above.
 *
 * ⚠️ **The value here is already coerced, and that is the trap that makes this class of guard
 * ship inert.** By the time `fireFieldPreHooks` runs, `validateAndConvertValue` has turned a
 * SINGLE_SELECT write into `{ type: 'option', optionId: 'received' }` - it is **never** a bare
 * string on this chain. A guard comparing `event.newValue` to `'received'` passes everything,
 * reads correctly in review, and passes any unit test that feeds it a bare string (section 2).
 * `unwrapStatusValue` is shared with the system side for exactly that reason.
 *
 * 🔑 **Unlike `build_status` this is a TRANSITION wall, not a value wall, and it can be one
 * only because it reads the stored value itself.** `event.existingValue` is `undefined` on the
 * single-field path, so a guard reading it would be inert in precisely the way section 2
 * describes - `build-status-guard.ts` records that as the reason it settled for a value wall.
 * The read here goes through `FieldValueService`, which resolves the AMBIENT WRITE DB, so
 * inside a transaction it sees the row the write in flight has not committed yet rather than
 * a stale value on a second connection.
 *
 * ✅ **Nothing is bypassed today, and that is a finding rather than an omission.**
 * `fireFieldPreHooks` short-circuits on `ctx.bypassFieldGuards.has(systemAttribute)` before any
 * handler runs, and a guard that starts working without its sanctioned writers exempted breaks
 * them (section 4: "half of this fix is worse than none"). An audit of every writer of
 * `return_status` found exactly one - `buildReturnValues` in `returns/writes.ts`, reached by
 * `createReturn` and `updateReturn` - and it is a GENERIC editor, not an action: it writes
 * whatever status the caller asked for, which is the write this graph exists to police. There
 * is no `receiveReturn` / `inspectReturn` / `closeReturn` with side effects of its own to
 * protect. 🛑 The day one is written it needs `bypassFieldGuards: ['return_status']`, or it
 * will be refused by the wall built to protect it.
 *
 * ⚠️ **Fails OPEN in three places, matching the system twin.** An unreadable stored status, a
 * stored value the graph does not know, and a write of the value the record already holds all
 * pass. A transition guard that bricks every edit because a read failed is worse than one that
 * misses an edge, and an unrecognised current value is the enum validator's problem.
 */
export const guardReturnLifecycleTransition: FieldPreHookHandler = async (event) => {
  const next = unwrapStatusValue(event.newValue)
  if (typeof next !== 'string' || next === '') return event.newValue

  const current = await readStoredReturnStatus(event.organizationId, event.userId, {
    recordId: event.recordId,
    fieldId: event.fieldId,
  })

  // Unreadable: fail open rather than brick the field.
  if (current === undefined) return event.newValue

  // 🔑 Nothing stored means this write is the record's FIRST status, which is an entry
  // point and not a transition - the field chain sees only a write and never an
  // `operation`, so "is this a create" is answered by the absence of a stored value.
  // Both entry points matter: an emailed return enters at `requested`, and the ~15% of
  // Auxx-Lift's returns that are a pallet on the dock enter at `received`.
  if (current === null) {
    if (!(RETURN_ENTRY_STATUSES as readonly string[]).includes(next)) {
      throw new BadRequestError(
        `A return starts at ${RETURN_ENTRY_STATUSES.join(' or ')}, not at ${next}.`
      )
    }
    return event.newValue
  }

  // An idempotent re-save of the value already held is always allowed.
  if (current === next) return event.newValue

  const allowed = RETURN_STATUS_TRANSITIONS[current]
  if (!allowed) return event.newValue

  if (!allowed.includes(next)) {
    throw new BadRequestError(
      `A return cannot move from ${current} to ${next}. From ${current} it can go to ` +
        `${describeAllowed(allowed)}.`
    )
  }

  return event.newValue
}

/**
 * The states a record may move to next, in words.
 *
 * ⚠️ Duplicated from the system twin so the two doors refuse in the same sentence. It is three
 * lines and the twin does not export it; hoisting both message builders beside the graph
 * constants is the tidier end state and needs an edit to `return-hooks.ts`.
 */
function describeAllowed(allowed: readonly string[]): string {
  if (allowed.length === 0) return 'nothing - it is a final state'
  return allowed.join(', ')
}

/**
 * The return's stored `return_status`.
 *
 * @returns the current value, `null` when the record has none yet, or `undefined` when the
 *   read failed and the guard should stand aside.
 */
async function readStoredReturnStatus(
  organizationId: string,
  userId: string | undefined,
  target: { recordId: RecordId; fieldId: string }
): Promise<string | null | undefined> {
  try {
    const stored = await new FieldValueService(organizationId, userId).getValues({
      recordId: target.recordId,
      fieldIds: [target.fieldId],
    })
    const typed = firstValue(stored.get(target.fieldId))
    return typed?.type === 'option' ? typed.optionId : null
  } catch (error) {
    logger.warn('could not read return_status - allowing the transition', {
      organizationId,
      recordId: target.recordId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/** `getValues` hands back a scalar or an array depending on the field. */
function firstValue(entry: TypedFieldValue | TypedFieldValue[] | undefined) {
  return Array.isArray(entry) ? entry[0] : entry
}
