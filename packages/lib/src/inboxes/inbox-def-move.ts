// packages/lib/src/inboxes/inbox-def-move.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { InboxDef } from '../resource-access/mail-sharing-defs'

/**
 * Moving ONE inbox instance between the two mailbox definitions — the shared
 * authority for data migration 060 (`inbox` → `personal_inbox`, in bulk) and
 * for `claimPersonalInbox` (`personal_inbox` → `inbox`, one instance, admin
 * triggered).
 *
 * The two directions are the same three operations — flip
 * `EntityInstance.entityDefinitionId`, remap the instance's `FieldValue` rows
 * onto the target def's `CustomField` ids by `systemAttribute`, re-key its
 * `ResourceAccess` rows — and 40a §3 asks for exactly one implementation of
 * them. A second copy would be free to drift on the parts that are easy to get
 * wrong and impossible to notice: the unique arbiter on `ResourceAccess` is
 * `(organizationId, entityDefinitionId, entityInstanceId, granteeType,
 * granteeId)` with `nullsNotDistinct`, so a naive `UPDATE … SET
 * entityDefinitionId` violates the index the moment both keyspaces hold a row
 * for the same grantee — and resolving that collision by letting the arbiter
 * pick is what downgraded a creator-Manager from `admin` to `view` earlier in
 * this effort. The precedent for consolidating rather than duplicating is
 * `workflow-run-stop-access.ts`.
 *
 * The module is a LEAF on purpose — `@auxx/database` + drizzle + the
 * dependency-free `mail-sharing-defs` and nothing else. Callers supply the
 * `systemAttribute → CustomField.id` map for the TARGET def; both build it from
 * ONE `loadExistingState(db, organizationId)` call, whose `fields` map is keyed
 * `${entityDefinitionId}:${systemAttribute}` and therefore already carries BOTH
 * defs' ids (see {@link buildDefFieldIdMap}).
 */

const CHUNK = 500

/** A `FieldValue` row of a moving instance, reduced to what the remap decides on. */
export interface MovingFieldValue {
  id: string
  fieldId: string
  /** `systemAttribute` of `fieldId`'s `CustomField`, or null for a custom field. */
  systemAttribute: string | null
}

export interface FieldValuePlan {
  /** `fieldId` + `entityDefinitionId` both move to the target def's counterpart. */
  updates: { id: string; fieldId: string }[]
  /** Attributes the target def deliberately does not carry. */
  deletes: string[]
  /** No counterpart on the target def and not deliberately dropped — left alone, logged. */
  unmapped: MovingFieldValue[]
}

/**
 * The `systemAttribute → CustomField.id` map for ONE definition, read out of
 * `loadExistingState(db, organizationId).fields`.
 *
 * That map is keyed `${entityDefinitionId}:${systemAttribute}` and holds every
 * MATERIALIZED system field in the org — both inbox defs included — so one call
 * serves both ends of a move and there is never a reason to hand-query
 * `CustomField` a second time. Registry entries that are never materialized
 * (`id` / `created_at` are `EntityInstance` COLUMNS) are absent by construction,
 * which is exactly the set {@link planFieldValueMoves} should treat as "no
 * counterpart".
 */
export function buildDefFieldIdMap(
  fields: ReadonlyMap<string, { id: string; systemAttribute: string; entityDefinitionId: string }>,
  entityDefinitionId: string
): Map<string, string> {
  const byAttr = new Map<string, string>()
  for (const field of fields.values()) {
    if (field.entityDefinitionId === entityDefinitionId) byAttr.set(field.systemAttribute, field.id)
  }
  return byAttr
}

/**
 * Plan one instance's FieldValue remap: source-def `CustomField` id → target-def
 * `CustomField` id, matched by `systemAttribute` (40a §6's "CLONE, not repoint"
 * decision — each def keeps its own field rows).
 *
 * Idempotent by construction: a value already pointing at a target-def field
 * produces no update (`target === value.fieldId`), while a dropped attribute is
 * deleted whichever def's field it still points at — so a re-run after a partial
 * failure repairs instead of duplicating.
 *
 * `droppedAttrs` is the direction's asymmetry, and it is a parameter rather than
 * a constant precisely because the two directions differ: `inbox` →
 * `personal_inbox` drops the two attributes the personal def has no field for,
 * while the reverse move drops nothing (the shared def's attribute set is a
 * superset).
 */
export function planFieldValueMoves(input: {
  values: readonly MovingFieldValue[]
  /** `systemAttribute` → the TARGET def's `CustomField.id`. */
  newFieldIdByAttr: ReadonlyMap<string, string>
  /** Attributes to delete rather than remap. Empty when the target is a superset. */
  droppedAttrs?: readonly string[]
}): FieldValuePlan {
  const { values, newFieldIdByAttr, droppedAttrs = [] } = input
  const dropped = new Set<string>(droppedAttrs)

  const updates: { id: string; fieldId: string }[] = []
  const deletes: string[] = []
  const unmapped: MovingFieldValue[] = []

  for (const value of values) {
    if (value.systemAttribute && dropped.has(value.systemAttribute)) {
      deletes.push(value.id)
      continue
    }
    const target = value.systemAttribute ? newFieldIdByAttr.get(value.systemAttribute) : undefined
    if (!target) {
      unmapped.push(value)
      continue
    }
    if (target === value.fieldId) continue
    updates.push({ id: value.id, fieldId: target })
  }

  return { updates, deletes, unmapped }
}

/** A grant row as the re-key sees it. */
export interface GrantRow {
  id: string
  granteeType: string
  granteeId: string
  permission: string
  lens: string | null
}

export interface GrantRekeyPlan {
  /** Source-keyspace rows with no counterpart — flipped in place, ids and `createdAt` preserved. */
  recode: string[]
  /** Existing target-keyspace rows the source row is STRONGER than — raised, then the source row goes. */
  raise: { id: string; permission: string; lens: string | null }[]
  /** Source-keyspace rows superseded by a target-keyspace row (never dropped before the raise). */
  drop: string[]
}

const PERMISSION_RANK: Record<string, number> = { none: 0, view: 1, edit: 2, admin: 3 }
const LENS_RANK: Record<string, number> = { none: 0, metadata: 1, subject: 2, full: 3 }

/** Rank a grant so a collision is resolved by strength, explicitly. */
function grantStrength(row: Pick<GrantRow, 'permission' | 'lens'>): number {
  const base = (PERMISSION_RANK[row.permission] ?? 0) * 10
  // `lens` only discriminates `view` rows; `edit`/`admin` imply full and carry null.
  return base + (row.permission === 'view' ? (LENS_RANK[row.lens ?? 'full'] ?? 3) : 3)
}

/**
 * Plan the re-key of one instance's grant rows from one inbox keyspace to the
 * other.
 *
 * The unique arbiter is `(organizationId, entityDefinitionId, entityInstanceId,
 * granteeType, granteeId)` with `nullsNotDistinct` (`schema/resource-access.ts`),
 * so both keyspaces' rows for the same grantee can coexist and a naive
 * `UPDATE … SET entityDefinitionId` violates the index the moment a partial
 * re-run left a counterpart behind.
 *
 * **The collision rule is explicit, never the arbiter's.** Phase 0b learned this
 * the hard way on the same table: letting `ON CONFLICT` pick the surviving row
 * downgraded a creator-Manager from `admin` to `view`. Here the STRONGER of the
 * two always wins, and the source row is only dropped after the surviving row
 * has been raised to match it — so no ordering of partial failures can lose a
 * permission.
 */
export function planGrantRekey(input: {
  legacy: readonly GrantRow[]
  existing: readonly GrantRow[]
}): GrantRekeyPlan {
  const granteeKey = (row: GrantRow) => `${row.granteeType}|${row.granteeId}`
  const existingByGrantee = new Map(input.existing.map((row) => [granteeKey(row), row]))

  const plan: GrantRekeyPlan = { recode: [], raise: [], drop: [] }

  for (const row of input.legacy) {
    const counterpart = existingByGrantee.get(granteeKey(row))
    if (!counterpart) {
      plan.recode.push(row.id)
      continue
    }
    if (grantStrength(row) > grantStrength(counterpart)) {
      plan.raise.push({ id: counterpart.id, permission: row.permission, lens: row.lens })
    }
    plan.drop.push(row.id)
  }

  return plan
}

export interface InboxInstanceMoveResult {
  instanceMoved: boolean
  valuesRemapped: number
  valuesDeleted: number
  unmapped: MovingFieldValue[]
}

/**
 * Move ONE inbox instance onto `toDefId` and remap its FieldValues.
 *
 * Reports `unmapped` rather than logging it, so the caller decides the severity:
 * a bulk migration warns and continues, a single interactive claim may want to
 * say so louder. Nothing is deleted that the caller did not name in
 * `droppedAttrs`.
 */
export async function moveInboxInstance(
  db: Database,
  input: {
    instanceId: string
    fromDefId: string
    toDefId: string
    /** `systemAttribute` → the TARGET def's `CustomField.id`. */
    newFieldIdByAttr: ReadonlyMap<string, string>
    droppedAttrs?: readonly string[]
  }
): Promise<InboxInstanceMoveResult> {
  const { instanceId, fromDefId, toDefId, newFieldIdByAttr, droppedAttrs } = input

  const [instance] = await db
    .select({ entityDefinitionId: schema.EntityInstance.entityDefinitionId })
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, instanceId))
    .limit(1)

  const needsMove = !!instance && instance.entityDefinitionId !== toDefId
  if (needsMove) {
    await db
      .update(schema.EntityInstance)
      .set({ entityDefinitionId: toDefId })
      .where(eq(schema.EntityInstance.id, instanceId))
  }

  const values = await db
    .select({
      id: schema.FieldValue.id,
      fieldId: schema.FieldValue.fieldId,
      systemAttribute: schema.CustomField.systemAttribute,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(eq(schema.FieldValue.entityId, instanceId))

  const plan = planFieldValueMoves({ values, newFieldIdByAttr, droppedAttrs })

  for (const update of plan.updates) {
    await db
      .update(schema.FieldValue)
      .set({ fieldId: update.fieldId, entityDefinitionId: toDefId })
      .where(eq(schema.FieldValue.id, update.id))
  }

  // Catch-all for a re-run that moved the instance but died before the values:
  // anything still pointing at the target def's OWN fields but carrying the
  // source def id gets its owner column corrected.
  if (plan.updates.length === 0 && plan.unmapped.length === 0) {
    await db
      .update(schema.FieldValue)
      .set({ entityDefinitionId: toDefId })
      .where(
        and(
          eq(schema.FieldValue.entityId, instanceId),
          eq(schema.FieldValue.entityDefinitionId, fromDefId)
        )
      )
  }

  for (let i = 0; i < plan.deletes.length; i += CHUNK) {
    await db
      .delete(schema.FieldValue)
      .where(inArray(schema.FieldValue.id, plan.deletes.slice(i, i + CHUNK)))
  }

  return {
    instanceMoved: needsMove,
    valuesRemapped: plan.updates.length,
    valuesDeleted: plan.deletes.length,
    unmapped: plan.unmapped,
  }
}

/**
 * Re-key one instance's `ResourceAccess` rows from `fromKey` to `toKey`.
 *
 * Mail grants live in the SLUG keyspace (`mail-sharing-defs.ts`), so the def
 * move is only half done until these rows follow: `composeUserMailVisibility`,
 * `mailGrantIndexProvider` and `hasPermission` all match
 * `ResourceAccess.entityDefinitionId` literally, and a row left behind is a
 * grant that silently stops being read.
 */
export async function rekeyInboxGrants(
  db: Database,
  input: { organizationId: string; instanceId: string; fromKey: InboxDef; toKey: InboxDef }
): Promise<{ recoded: number; raised: number; dropped: number }> {
  const { organizationId, instanceId, fromKey, toKey } = input

  const rows = await db
    .select({
      id: schema.ResourceAccess.id,
      entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
      granteeType: schema.ResourceAccess.granteeType,
      granteeId: schema.ResourceAccess.granteeId,
      permission: schema.ResourceAccess.permission,
      lens: schema.ResourceAccess.lens,
    })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        eq(schema.ResourceAccess.entityInstanceId, instanceId),
        inArray(schema.ResourceAccess.entityDefinitionId, [fromKey, toKey])
      )
    )

  const plan = planGrantRekey({
    legacy: rows.filter((r: { entityDefinitionId: string }) => r.entityDefinitionId === fromKey),
    existing: rows.filter((r: { entityDefinitionId: string }) => r.entityDefinitionId === toKey),
  })

  // RAISE BEFORE DROP — the surviving row must already carry the source row's
  // strength before the source row stops existing.
  for (const raise of plan.raise) {
    await db
      .update(schema.ResourceAccess)
      .set({ permission: raise.permission as never, lens: raise.lens as never })
      .where(eq(schema.ResourceAccess.id, raise.id))
  }

  for (let i = 0; i < plan.recode.length; i += CHUNK) {
    await db
      .update(schema.ResourceAccess)
      .set({ entityDefinitionId: toKey })
      .where(inArray(schema.ResourceAccess.id, plan.recode.slice(i, i + CHUNK)))
  }

  for (let i = 0; i < plan.drop.length; i += CHUNK) {
    await db
      .delete(schema.ResourceAccess)
      .where(inArray(schema.ResourceAccess.id, plan.drop.slice(i, i + CHUNK)))
  }

  return { recoded: plan.recode.length, raised: plan.raise.length, dropped: plan.drop.length }
}
