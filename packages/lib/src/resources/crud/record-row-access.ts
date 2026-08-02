// packages/lib/src/resources/crud/record-row-access.ts

import type { Database } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import { ForbiddenError } from '../../errors'
import type { CapabilityView } from '../../permissions/capabilities/capability-view'
// Value import, but from the PURE `entity-access` module (enums + registry +
// seat-policy constants only), not the permissions barrel — the barrel is
// vitest-hostile and this file is deliberately importable for its pure halves.
import { ALWAYS_PER_ROW_DEF_SLUGS } from '../../permissions/capabilities/entity-access'
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
 *    `canEditEntity` reachable. Rows it allows are never read — **except for the
 *    defs in `ALWAYS_PER_ROW_DEF_SLUGS`; see the exception below.**
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
 *
 * ## 🔴 The exception to rule 1, and why it is not an accident
 *
 * Rule 1 is sound only while the def gate is an upper bound on row authority:
 * *"the def says yes"* must imply *"every row of it says yes"*. That holds for
 * every def whose authority is LOCAL — the Records area, plus whatever rows were
 * shared with this member.
 *
 * It does not hold for `article`, whose authority is **non-local**: it lives one
 * hop away, on the article's knowledge base. No def-level key can answer a
 * per-KB question, so the def gate is wrong in *both* directions for it (plan
 * v3/06 §7.2) — and short-circuiting on it lets a `records: Edit` member write
 * every article in the organization, KBs they cannot open included, because
 * `canEditEntity('article')` resolves to `PermissionKey.recordsEdit`.
 *
 * So {@link ALWAYS_PER_ROW_DEF_SLUGS} forces those ids into the stamped set
 * whatever the def gate answered. Everything else is unchanged: the stamp is
 * still the judge, the batch still fails whole, and a missing stamp still
 * denies. Only the fast path is forfeited, and only for that one def. The set's
 * declaration site carries the full argument — including why moving `article`
 * onto `ENTITY_WRITE_KEYS` or `ENTITY_BASE_AREAS` instead merely swaps which
 * member is wronged.
 *
 * **Cost:** the forced ids join the SAME single `stampRows` call as the
 * def-denied ones, so a hundred-article batch pays one extra `getByIds` round
 * trip, not a hundred. That is exactly why the set must stay tiny.
 */

/** A row shape carrying the `_access` stamp — `getByIds`' items, structurally. */
export interface StampedRow {
  _access?: Rung
}

/**
 * The subset of `recordIds` that must be read back and judged per row — the ids
 * the DEF-level edit gate refuses, **plus** every id belonging to a def in
 * {@link ALWAYS_PER_ROW_DEF_SLUGS} whatever that gate said.
 *
 * Pure, in-memory, and memoized per definition so a 100-row single-def batch
 * asks `canEditEntity` at most once.
 *
 * Returns `[]` when `capabilities` is absent: that means an internal caller
 * (worker, seeder, record-rule) and is today's unrestricted semantics. The
 * carve-out does NOT override that — an unenforced caller has no member to be
 * relative to, so there is nothing a stamp could be judged against.
 */
export function defDeniedRecordIds(
  capabilities: CapabilityView | undefined,
  recordIds: readonly RecordId[],
  /**
   * Def key → entity slug, because {@link ALWAYS_PER_ROW_DEF_SLUGS} is
   * slug-keyed while a RecordId's def part may be the slug OR the definition
   * CUID (`article:<id>` from the records table, `<cuid>:<id>` from a
   * relationship value — **both occur in production**).
   *
   * 🔴 **REQUIRED, with no default, and that is the point.** An optional
   * resolver made the carve-out's coverage depend on which id form the caller
   * happened to mint — true-today facts like "`ArticlesView` sends the slug
   * form" are exactly the kind that quietly stop being true. A missing resolver
   * is now a compile error rather than a silently weakened gate. Callers build
   * it with `buildDefIdToSlug(await getCachedResources(orgId))`, off the org
   * cache every request has already warmed.
   */
  defIdToSlug: (entityDefId: string) => string
): RecordId[] {
  if (!capabilities) return []
  const verdict = new Map<string, boolean>()
  const denied: RecordId[] = []
  for (const recordId of recordIds) {
    const { entityDefinitionId } = parseRecordId(recordId)
    let allowed = verdict.get(entityDefinitionId)
    if (allowed === undefined) {
      // Checked against the raw key AND the resolved slug. The resolver is
      // required, so the raw arm is belt-and-braces rather than the safety net
      // it used to be: `buildDefIdToSlug` falls back to identity for a key it
      // cannot resolve (an org whose `resources` cache is cold or incomplete),
      // and the raw arm keeps slug-form ids covered through that window.
      const alwaysPerRow =
        ALWAYS_PER_ROW_DEF_SLUGS.has(entityDefinitionId) ||
        ALWAYS_PER_ROW_DEF_SLUGS.has(defIdToSlug(entityDefinitionId))
      allowed = !alwaysPerRow && capabilities.canEditEntity(entityDefinitionId)
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
  stampRows: (ids: RecordId[]) => Promise<Record<string, StampedRow | undefined>>,
  /** See {@link defDeniedRecordIds}. Required — a missing resolver must not compile. */
  defIdToSlug: (entityDefId: string) => string
): Promise<void> {
  if (!capabilities) return
  const denied = defDeniedRecordIds(capabilities, recordIds, defIdToSlug)
  if (denied.length === 0) return
  // ONE stamped read for the whole set — the def-denied ids and the
  // always-per-row ids share it, so the carve-out costs one round trip per
  // batch, never one per row.
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
 *
 * 🔴 **`defIdToSlug` is REQUIRED and is deliberately not resolved here.**
 * Building one needs the org `resources` cache, and both of this function's
 * callers have already read it on the way in — `assertFieldValueHostsWritable`
 * literally holds the resolver it needs three lines above the call. Resolving it
 * internally would be a second read of the same blob per write, and would drag
 * the cache graph into a module that is imported for its pure halves.
 *
 * Required rather than optional because {@link ALWAYS_PER_ROW_DEF_SLUGS} is
 * slug-keyed and a RecordId's def part may be either form: with an optional
 * parameter the gate's coverage would depend on which form the caller happened
 * to mint, and a new caller could opt out of a security control by omission.
 */
export async function assertRecordRowsEditableWithDb(params: {
  db: Database
  organizationId: string
  userId: string
  capabilities: CapabilityView | undefined
  recordIds: readonly RecordId[]
  /** See {@link defDeniedRecordIds}. Required — omission must not compile. */
  defIdToSlug: (entityDefId: string) => string
}): Promise<void> {
  const { db, organizationId, userId, capabilities, recordIds } = params
  return assertRecordRowsEditable(
    capabilities,
    recordIds,
    async (ids) => {
      const { RecordPickerService } = await import('../picker/record-picker-service')
      const service = new RecordPickerService(organizationId, userId, db, capabilities)
      return service.getResourcesByIds(ids)
    },
    params.defIdToSlug
  )
}
