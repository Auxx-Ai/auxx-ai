// packages/lib/src/data-migrations/migrations/060-personal-inbox-move.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getOrgCache, onCacheEvent } from '../../cache'
import {
  buildDefFieldIdMap,
  type FieldValuePlan,
  type MovingFieldValue,
  moveInboxInstance,
  planFieldValueMoves as planFieldValueMovesForTarget,
  rekeyInboxGrants,
} from '../../inboxes/inbox-def-move'
import { type Lens, normalizeLens } from '../../permissions/visibility/lens'
import { MAIL_SHARING_DEFS } from '../../resource-access/mail-sharing-defs'
import { loadExistingState } from '../../seed/entity-migrations/helpers'
import type { DataMigrationDef } from '../types'

export type { FieldValuePlan, MovingFieldValue }
export {
  type GrantRekeyPlan,
  type GrantRow,
  planGrantRekey,
} from '../../inboxes/inbox-def-move'

const logger = createScopedLogger('migration-060')

/** `ResourceAccess.entityDefinitionId` slugs — the mail keyspace, not CUIDs. */
const INBOX_KEY = 'inbox'
const PERSONAL_INBOX_KEY = 'personal_inbox'

/** `granteeType: 'role'` id for "everyone in the workspace" (the v2 floor row). */
const WORKSPACE_BASELINE_GRANTEE = 'org_member'

/**
 * The two `inbox_*` attributes `personal_inbox` deliberately does NOT carry
 * (40a §1.2): a personal mailbox has no org-wide visibility floor, and the def
 * IS the personal marker. Their FieldValue rows are deleted on the moved
 * instance. The FIELDS survive on the `inbox` def until phase 4, so this is
 * reversible.
 */
export const DROPPED_PERSONAL_ATTRS = ['inbox_default_lens', 'inbox_is_personal'] as const

/** `inbox_owner_user_id` — the attribute that names the mailbox owner. */
const OWNER_ATTR = 'inbox_owner_user_id'

/** `inbox_is_personal` — the legacy forgeable marker this migration retires. */
const PERSONAL_ATTR = 'inbox_is_personal'

/** `inbox_default_lens` — the shared-inbox visibility floor, source of the §4.1 rows. */
const LENS_ATTR = 'inbox_default_lens'

const CHUNK = 500

// ═══════════════════════════════════════════════════════════════════════════
// PURE CORE — the decisions, separated from the IO that feeds them
// ═══════════════════════════════════════════════════════════════════════════

/** One `ResourceAccess` row as the pre-flight sees it. */
export interface KeyspaceProbeRow {
  id: string
  organizationId: string
  entityDefinitionId: string
  entityInstanceId: string | null
}

/**
 * The pre-flight (plan 40 §4.1), corrected.
 *
 * The plan words this as "per org, zero mail-def `ResourceAccess` rows keyed by
 * def CUID". As written it can NEVER pass: a CUID-keyed row with
 * `entityInstanceId IS NULL` is a **def-level RECORD restriction marker** — the
 * legitimate second meaning of this dual keyspace
 * (`restricted-entity-def-ids-provider.ts`), and dev's DemoOrg1 holds three of
 * them on `contact`. Only INSTANCE-level CUID rows are the fail-open case the
 * pre-flight exists for: they are invisible to the slug-keyed re-key below AND
 * to the §4.1 count check, so the migration must refuse rather than silently
 * strand a live grant in an unread keyspace.
 *
 * Phase 0b's `canonicalMailRecordId` + `repair-mail-grant-keyspace` clear these
 * at the boundary and in the data; this is the guard that makes the re-key safe
 * if either regressed.
 */
export function findStrayInstanceGrants(rows: readonly KeyspaceProbeRow[]): KeyspaceProbeRow[] {
  return rows.filter((row) => row.entityInstanceId !== null)
}

/**
 * {@link planFieldValueMovesForTarget} bound to THIS migration's direction.
 *
 * The planner itself lives in `inboxes/inbox-def-move.ts` and is shared with
 * `claimPersonalInbox`, which runs the same move in reverse (40a §3 — "share
 * the mechanism rather than writing a second one that can drift"). The only
 * thing that differs between the two directions is which attributes have no
 * counterpart, so that is the only thing bound here: `inbox` →
 * `personal_inbox` drops {@link DROPPED_PERSONAL_ATTRS}; the reverse drops
 * nothing, because the shared def's attribute set is a superset.
 */
export function planFieldValueMoves(input: {
  values: readonly MovingFieldValue[]
  /** `systemAttribute` → the NEW def's `CustomField.id`. */
  newFieldIdByAttr: ReadonlyMap<string, string>
}): FieldValuePlan {
  return planFieldValueMovesForTarget({ ...input, droppedAttrs: DROPPED_PERSONAL_ATTRS })
}

/** A shared inbox and the floor its `inbox_default_lens` encodes. */
export interface FloorSeed {
  organizationId: string
  instanceId: string
  lens: Lens
}

/**
 * The §4.1 floor row for ONE shared inbox, or `null` when the inbox needs none.
 *
 * | `default_lens`        | row                                              |
 * |-----------------------|--------------------------------------------------|
 * | `full`                | none — `baselineAtCreate: false` + no row ⇒ the   |
 * |                       | member's `Area.inboxes` level, the org-shared     |
 * |                       | default                                          |
 * | `metadata` / `subject`| `role:org_member @ view`, **lens preserved**      |
 * | `none`                | `role:org_member @ none`, the v2 restriction      |
 * |                       | marker                                           |
 *
 * `grantedById` is deliberately null: the column is a real FK to `User` and a
 * migration has no user actor, so inventing one would be both a lie and an
 * abort risk. Nothing reads it for authorization.
 *
 * Personal inboxes never reach here — they get NO baseline row, which is the
 * whole point of `baselineAtCreate: true` (no row ⇒ no access).
 */
export function buildFloorRow(seed: FloorSeed): typeof schema.ResourceAccess.$inferInsert | null {
  if (seed.lens === 'full') return null
  return {
    organizationId: seed.organizationId,
    entityDefinitionId: INBOX_KEY,
    entityInstanceId: seed.instanceId,
    granteeType: ResourceGranteeType.role,
    granteeId: WORKSPACE_BASELINE_GRANTEE,
    permission: seed.lens === 'none' ? ResourcePermission.none : ResourcePermission.view,
    lens: seed.lens === 'none' ? null : seed.lens,
    grantedById: null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IO
// ═══════════════════════════════════════════════════════════════════════════

interface InboxDefPair {
  organizationId: string
  inboxDefId: string
  personalDefId: string
}

/** The `inbox` + `personal_inbox` def ids per org, and the 059 prerequisite check. */
async function loadInboxDefPairs(db: Database): Promise<InboxDefPair[]> {
  const defs = await db
    .select({
      id: schema.EntityDefinition.id,
      organizationId: schema.EntityDefinition.organizationId,
      entityType: schema.EntityDefinition.entityType,
    })
    .from(schema.EntityDefinition)
    .where(inArray(schema.EntityDefinition.entityType, [INBOX_KEY, PERSONAL_INBOX_KEY]))

  const byOrg = new Map<string, { inbox?: string; personal?: string }>()
  for (const def of defs) {
    const entry = byOrg.get(def.organizationId) ?? {}
    if (def.entityType === INBOX_KEY) entry.inbox = def.id
    else entry.personal = def.id
    byOrg.set(def.organizationId, entry)
  }

  const missingPersonal: string[] = []
  const pairs: InboxDefPair[] = []
  for (const [organizationId, entry] of byOrg) {
    if (!entry.inbox) continue
    if (!entry.personal) {
      missingPersonal.push(organizationId)
      continue
    }
    pairs.push({ organizationId, inboxDefId: entry.inbox, personalDefId: entry.personal })
  }

  if (missingPersonal.length > 0) {
    // 059 sorts before this id and the runner is fail-stop, so a gap here means
    // a partially-failed 059 run. Halting is the only safe response: without the
    // new def's CustomField rows there is nothing to remap FieldValues ONTO, and
    // `FieldValue.fieldId` is a real FK (`project_registry_fields_need_materialization`).
    throw new Error(
      `personal_inbox EntityDefinition missing for ${missingPersonal.length} org(s) ` +
        `(${missingPersonal.slice(0, 5).join(', ')}); run entity migration 059 first`
    )
  }

  return pairs
}

/**
 * Refuse to run while any INSTANCE-level mail grant is keyed by a def CUID
 * (plan 40 §4.1, scoped per the correction on {@link findStrayInstanceGrants}).
 */
async function assertCleanMailKeyspace(db: Database): Promise<void> {
  const rows = await db
    .select({
      id: schema.ResourceAccess.id,
      organizationId: schema.ResourceAccess.organizationId,
      entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
      entityInstanceId: schema.ResourceAccess.entityInstanceId,
    })
    .from(schema.ResourceAccess)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.ResourceAccess.entityDefinitionId)
    )
    .where(inArray(schema.EntityDefinition.entityType, [...MAIL_SHARING_DEFS]))

  const strays = findStrayInstanceGrants(rows)
  if (strays.length > 0) {
    throw new Error(
      `${strays.length} instance-level mail ResourceAccess row(s) are still keyed by an ` +
        `EntityDefinition CUID (orgs: ${[...new Set(strays.map((s) => s.organizationId))].join(', ')}). ` +
        `Run packages/lib/scripts/repair-mail-grant-keyspace.ts (plan 40 phase 0b) before this migration.`
    )
  }
}

interface InboxCensusRow {
  instanceId: string
  organizationId: string
  entityDefinitionId: string
  isPersonal: boolean
  lens: Lens
  ownerUserId: string | null
}

/**
 * Every inbox instance across both defs, with the three facts the migration
 * branches on. `isPersonal` is TRUE for anything already on the new def — that
 * is what makes a re-run self-repairing rather than merely inert.
 */
async function loadInboxCensus(db: Database, pairs: InboxDefPair[]): Promise<InboxCensusRow[]> {
  const defIds = pairs.flatMap((p) => [p.inboxDefId, p.personalDefId])
  if (defIds.length === 0) return []

  const orgByDefId = new Map<string, string>()
  const personalDefIds = new Set<string>()
  for (const pair of pairs) {
    orgByDefId.set(pair.inboxDefId, pair.organizationId)
    orgByDefId.set(pair.personalDefId, pair.organizationId)
    personalDefIds.add(pair.personalDefId)
  }

  const instances = await db
    .select({
      id: schema.EntityInstance.id,
      entityDefinitionId: schema.EntityInstance.entityDefinitionId,
    })
    .from(schema.EntityInstance)
    .where(inArray(schema.EntityInstance.entityDefinitionId, defIds))

  if (instances.length === 0) return []

  const markers = await db
    .select({
      entityId: schema.FieldValue.entityId,
      systemAttribute: schema.CustomField.systemAttribute,
      optionId: schema.FieldValue.optionId,
      valueText: schema.FieldValue.valueText,
      valueJson: schema.FieldValue.valueJson,
      valueBoolean: schema.FieldValue.valueBoolean,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        inArray(
          schema.FieldValue.entityId,
          instances.map((i) => i.id)
        ),
        inArray(schema.CustomField.systemAttribute, [PERSONAL_ATTR, LENS_ATTR, OWNER_ATTR])
      )
    )

  const personalMarker = new Set<string>()
  const lensByInstance = new Map<string, Lens>()
  const ownerByInstance = new Map<string, string>()
  for (const row of markers) {
    if (row.systemAttribute === PERSONAL_ATTR) {
      if (row.valueBoolean === true) personalMarker.add(row.entityId)
    } else if (row.systemAttribute === LENS_ATTR) {
      // SINGLE_SELECT reads back as an array on some paths — never compare raw
      // (`project_use_system_values_single_select_arrays`).
      lensByInstance.set(
        row.entityId,
        normalizeLens(row.optionId ?? row.valueText ?? row.valueJson, 'full')
      )
    } else if (row.systemAttribute === OWNER_ATTR) {
      if (row.valueText) ownerByInstance.set(row.entityId, row.valueText)
    }
  }

  return instances.map((instance) => ({
    instanceId: instance.id,
    organizationId: orgByDefId.get(instance.entityDefinitionId) as string,
    entityDefinitionId: instance.entityDefinitionId,
    // Def membership FIRST: once moved, the marker value is gone and the def is
    // the only truth (RECON §11.2 — never derive the def from the marker).
    isPersonal: personalDefIds.has(instance.entityDefinitionId) || personalMarker.has(instance.id),
    // An inbox with no stored floor predates 033's backfill; `full` is what that
    // migration defaulted an unset visibility to.
    lens: lensByInstance.get(instance.id) ?? 'full',
    ownerUserId: ownerByInstance.get(instance.id) ?? null,
  }))
}

/**
 * Move one instance onto the `personal_inbox` def and remap its FieldValues.
 *
 * The mechanism lives in `inboxes/inbox-def-move.ts` and is shared with
 * `claimPersonalInbox`'s reverse move (40a §3); this wrapper supplies the
 * direction and turns the planner's `unmapped` report into this migration's
 * warn-and-continue posture.
 */
async function moveInstance(
  db: Database,
  pair: InboxDefPair,
  row: InboxCensusRow,
  newFieldIdByAttr: ReadonlyMap<string, string>
): Promise<{ instanceMoved: boolean; valuesRemapped: number; valuesDeleted: number }> {
  const moved = await moveInboxInstance(db, {
    instanceId: row.instanceId,
    fromDefId: pair.inboxDefId,
    toDefId: pair.personalDefId,
    newFieldIdByAttr,
    droppedAttrs: DROPPED_PERSONAL_ATTRS,
  })

  for (const value of moved.unmapped) {
    logger.warn('FieldValue has no personal_inbox counterpart — left on the shared def', {
      organizationId: row.organizationId,
      instanceId: row.instanceId,
      fieldValueId: value.id,
      systemAttribute: value.systemAttribute,
    })
  }

  return {
    instanceMoved: moved.instanceMoved,
    valuesRemapped: moved.valuesRemapped,
    valuesDeleted: moved.valuesDeleted,
  }
}

/** Re-key one moved instance's grant rows into the `personal_inbox` keyspace. */
async function rekeyGrants(
  db: Database,
  row: InboxCensusRow
): Promise<{ recoded: number; raised: number; dropped: number }> {
  return rekeyInboxGrants(db, {
    organizationId: row.organizationId,
    instanceId: row.instanceId,
    fromKey: INBOX_KEY,
    toKey: PERSONAL_INBOX_KEY,
  })
}

/**
 * Guarantee the mailbox owner keeps an `admin` row after the re-key.
 *
 * `baselineAtCreate: true` means an absent row is NO access, so this is the row
 * that stops a personal mailbox becoming unreachable by its own owner. Written
 * only when `inbox_owner_user_id` resolves to a real `User` — `grantedById` is a
 * live FK and an unverified id aborts the insert (056's lesson).
 */
async function ensureOwnerAdminRow(db: Database, row: InboxCensusRow): Promise<boolean> {
  if (!row.ownerUserId) {
    logger.warn('Personal inbox has no owner — no admin ResourceAccess row written', {
      organizationId: row.organizationId,
      instanceId: row.instanceId,
    })
    return false
  }

  const [user] = await db
    .select({ id: schema.User.id })
    .from(schema.User)
    .where(eq(schema.User.id, row.ownerUserId))
    .limit(1)

  if (!user) {
    logger.warn('Personal inbox owner is not a real User — no admin row written', {
      organizationId: row.organizationId,
      instanceId: row.instanceId,
      ownerUserId: row.ownerUserId,
    })
    return false
  }

  const [existing] = await db
    .select({ id: schema.ResourceAccess.id, permission: schema.ResourceAccess.permission })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, row.organizationId),
        eq(schema.ResourceAccess.entityDefinitionId, PERSONAL_INBOX_KEY),
        eq(schema.ResourceAccess.entityInstanceId, row.instanceId),
        eq(schema.ResourceAccess.granteeType, ResourceGranteeType.user),
        eq(schema.ResourceAccess.granteeId, row.ownerUserId)
      )
    )
    .limit(1)

  if (existing) {
    if (existing.permission !== ResourcePermission.admin) {
      // Plan §4.1 says "write one if none exists", so this is left ALONE rather
      // than raised — but an owner who is not Manager of their own mailbox is
      // worth a line in the log, not a silent pass.
      logger.warn('Personal inbox owner holds a weaker-than-admin row — left as found', {
        organizationId: row.organizationId,
        instanceId: row.instanceId,
        ownerUserId: row.ownerUserId,
        permission: existing.permission,
      })
    }
    return false
  }

  await db
    .insert(schema.ResourceAccess)
    .values({
      organizationId: row.organizationId,
      entityDefinitionId: PERSONAL_INBOX_KEY,
      entityInstanceId: row.instanceId,
      granteeType: ResourceGranteeType.user,
      granteeId: row.ownerUserId,
      permission: ResourcePermission.admin,
      grantedById: row.ownerUserId,
    })
    .onConflictDoNothing()

  return true
}

/**
 * Count every persisted store 40a §5.2 lists as "count-then-decide" and log the
 * result.
 *
 * An exhaustive sweep of all 21 `*entityDefinitionId`-shaped columns found ZERO
 * inbox references outside `CustomField` / `FieldValue` / `ResourceAccess` /
 * `EntityInstance`, so no remap machinery is built for them. That verdict is
 * dev-shaped, which is exactly why it is re-counted at run time instead of
 * assumed: prod differs in scale, and a non-zero count here is the difference
 * between "nothing to do" and "a stale RecordId nobody will notice".
 *
 * Warn, never throw. A `RecordRule` on the inbox def is not corruption — it
 * simply stops covering personal mailboxes — and aborting a half-applied move
 * over it would be strictly worse than reporting it.
 */
async function auditUnmappedReferences(
  db: Database,
  inboxDefIds: string[],
  movedInstanceIds: string[],
  organizationIds: string[]
): Promise<Record<string, number>> {
  if (inboxDefIds.length === 0) return {}

  const list = (values: string[]) =>
    sql.join(
      values.map((value) => sql`${value}`),
      sql`, `
    )
  const defList = list(inboxDefIds)
  const hasMoved = movedInstanceIds.length > 0 && organizationIds.length > 0

  /** Def-only stores: still valid for shared inboxes, they just stop covering personal ones. */
  const defOnly: [string, string][] = [
    ['Workflow', 'entityDefinitionId'],
    ['AgentTrigger', 'entityDefinitionId'],
    ['RecordRule', 'entityDefinitionId'],
    ['TableView', 'entityDefinitionId'],
    ['Dashboard', 'entityDefinitionId'],
    ['ExportJob', 'entityDefinitionId'],
    ['ImportMapping', 'entityDefinitionId'],
    ['DataConnectorMapping', 'entityDefinitionId'],
  ]

  /** Instance-bearing stores: hold a `(def, instance)` pair that goes STALE on a def move. */
  const instanceBearing: [string, string, string][] = [
    ['ThreadEntityLink', 'entityDefinitionId', 'entityInstanceId'],
    ['TaskReference', 'referencedEntityDefinitionId', 'referencedEntityInstanceId'],
    ['Comment', 'entityDefinitionId', 'entityId'],
    ['CommentReference', 'entityDefinitionId', 'entityInstanceId'],
    ['RecordIdentity', 'entityDefinitionId', 'entityInstanceId'],
    ['AiSuggestion', 'entityDefinitionId', 'entityInstanceId'],
    ['DataConnectorItem', 'entityDefinitionId', 'entityInstanceId'],
    ['Thread', 'primaryEntityDefinitionId', 'primaryEntityInstanceId'],
    ['FieldValue', 'relatedEntityDefinitionId', 'relatedEntityId'],
  ]

  /** RecordId-in-jsonb stores: `{entityDefinitionId,…}` payloads and `["inbox:<id>"]` values. */
  const jsonPayload: [string, string][] = [
    ['Notification', 'targetIds'],
    ['Favorite', 'targetIds'],
    ['MailView', 'filters'],
  ]

  const fragments = [
    ...defOnly.map(
      ([table, column]) =>
        sql`select ${`${table}.${column}`}::text as store, count(*)::int as count
            from ${sql.identifier(table)} where ${sql.identifier(column)} in (${defList})`
    ),
    ...instanceBearing.map(
      ([table, defColumn, instanceColumn]) =>
        sql`select ${`${table}.${instanceColumn}`}::text as store, count(*)::int as count
            from ${sql.identifier(table)}
            where ${sql.identifier(defColumn)} in (${defList})
              ${hasMoved ? sql`or ${sql.identifier(instanceColumn)} in (${list(movedInstanceIds)})` : sql``}`
    ),
    ...(hasMoved
      ? jsonPayload.map(
          ([table, column]) =>
            sql`select ${`${table}.${column}`}::text as store, count(*)::int as count
                from ${sql.identifier(table)}
                where "organizationId" in (${list(organizationIds)})
                  and ${sql.identifier(column)}::text ~ ${movedInstanceIds.join('|')}`
        )
      : []),
  ]

  const result = await db.execute<{ store: string; count: number }>(
    sql.join(fragments, sql` union all `)
  )
  return Object.fromEntries(result.rows.map((row) => [row.store, Number(row.count)]))
}

/**
 * Move every personal mailbox onto the `personal_inbox` definition and convert
 * the shared inboxes' `inbox_default_lens` floors into v2 `ResourceAccess`
 * baseline rows (plan 40 §4.1, 40a §4/§5.2/§5.3).
 *
 * Two jobs, one migration, because they read the SAME census (`is_personal` +
 * `default_lens` per inbox instance), share the same pre-flight, share the same
 * §4.1 count check, and must invalidate the same caches for the same orgs. The
 * `MEMBER_BASELINE_LEVELS` backfill is deliberately NOT here — it touches every
 * org's permission grants rather than mail data, and lives in 061 so an operator
 * can re-run either half alone.
 *
 * **Idempotent, and self-repairing.** The census treats "already on the
 * `personal_inbox` def" as personal, so a re-run re-enters every step for a
 * moved mailbox and finds each one already done: the instance update is skipped,
 * the FieldValue remap produces no updates (the values already point at new-def
 * fields), the drop set is empty, the grant re-key finds no legacy rows, and the
 * owner row already exists. A run that died halfway is repaired rather than
 * duplicated — which matters because the steps cannot share a transaction with
 * the cache invalidation that follows them.
 *
 * **Reversible:** `inbox_default_lens` and `inbox_is_personal` remain real
 * fields on the `inbox` def until phase 4; only the two FieldValue ROWS on moved
 * instances are deleted.
 */
export const migration060PersonalInboxMove: DataMigrationDef = {
  id: '060-personal-inbox-move',
  description:
    'Move personal mailboxes onto the personal_inbox def (values + grants) and write the shared-inbox floor rows',
  async run(db: Database): Promise<void> {
    await assertCleanMailKeyspace(db)

    const pairs = await loadInboxDefPairs(db)
    const pairByOrg = new Map(pairs.map((p) => [p.organizationId, p]))
    const census = await loadInboxCensus(db, pairs)

    const personal = census.filter((row) => row.isPersonal)
    const shared = census.filter((row) => !row.isPersonal)
    const affectedOrgs = new Set<string>()

    // ── 1. The def move ────────────────────────────────────────────────────
    let instancesMoved = 0
    let valuesRemapped = 0
    let valuesDeleted = 0
    let ownerRowsWritten = 0
    let grantsRecoded = 0
    let grantsRaised = 0
    let grantsDropped = 0

    const orgsWithPersonal = [...new Set(personal.map((row) => row.organizationId))]
    for (const organizationId of orgsWithPersonal) {
      const pair = pairByOrg.get(organizationId)
      if (!pair) continue

      // ONE query for BOTH defs' CustomField ids — `ExistingState.fields` is
      // keyed `${entityDefinitionId}:${systemAttribute}`, so the target def's
      // MATERIALIZED system fields fall straight out of it. Registry entries
      // that are never materialized (`id` / `created_at` are EntityInstance
      // COLUMNS) are absent by construction, which is exactly the set the
      // planner should treat as "no counterpart".
      const state = await loadExistingState(db, organizationId)
      const newFieldIdByAttr = buildDefFieldIdMap(state.fields, pair.personalDefId)

      for (const row of personal.filter((r) => r.organizationId === organizationId)) {
        const moved = await moveInstance(db, pair, row, newFieldIdByAttr)
        const grants = await rekeyGrants(db, row)
        const ownerWritten = await ensureOwnerAdminRow(db, row)

        if (moved.instanceMoved) instancesMoved += 1
        valuesRemapped += moved.valuesRemapped
        valuesDeleted += moved.valuesDeleted
        grantsRecoded += grants.recoded
        grantsRaised += grants.raised
        grantsDropped += grants.dropped
        if (ownerWritten) ownerRowsWritten += 1

        if (
          moved.instanceMoved ||
          moved.valuesRemapped > 0 ||
          moved.valuesDeleted > 0 ||
          grants.recoded > 0 ||
          grants.raised > 0 ||
          grants.dropped > 0 ||
          ownerWritten
        ) {
          affectedOrgs.add(organizationId)
        }
      }
    }

    // ── 2. The shared-inbox floor rows ─────────────────────────────────────
    const floorRows = shared
      .map((row) =>
        buildFloorRow({
          organizationId: row.organizationId,
          instanceId: row.instanceId,
          lens: row.lens,
        })
      )
      .filter((row): row is typeof schema.ResourceAccess.$inferInsert => row !== null)

    // `onConflictDoNothing`: anything already occupying the workspace-baseline
    // key was written deliberately, and overwriting it could only DOWNGRADE a
    // real grant. Re-running therefore adds nothing.
    for (let i = 0; i < floorRows.length; i += CHUNK) {
      await db
        .insert(schema.ResourceAccess)
        .values(floorRows.slice(i, i + CHUNK))
        .onConflictDoNothing()
    }
    for (const row of floorRows) affectedOrgs.add(row.organizationId)

    // ── 3. The §4.1 count check ────────────────────────────────────────────
    // Fail-open direction: `baselineAtCreate: false` means a restricted shared
    // inbox whose row was missed becomes org-visible. Per org, the number of
    // non-`full` shared inboxes must equal the number of `role:org_member` rows
    // that now exist on them.
    const expectedFloorByOrg = new Map<string, number>()
    for (const row of shared) {
      if (row.lens === 'full') continue
      expectedFloorByOrg.set(
        row.organizationId,
        (expectedFloorByOrg.get(row.organizationId) ?? 0) + 1
      )
    }

    const actualFloor = await db
      .select({
        organizationId: schema.ResourceAccess.organizationId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.entityDefinitionId, INBOX_KEY),
          eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
          eq(schema.ResourceAccess.granteeId, WORKSPACE_BASELINE_GRANTEE),
          isNotNull(schema.ResourceAccess.entityInstanceId)
        )
      )
      .groupBy(schema.ResourceAccess.organizationId)

    const actualFloorByOrg = new Map(actualFloor.map((r) => [r.organizationId, Number(r.count)]))
    for (const [organizationId, expected] of expectedFloorByOrg) {
      const actual = actualFloorByOrg.get(organizationId) ?? 0
      if (actual !== expected) {
        logger.error('Floor-row count mismatch — a restricted inbox may now be org-visible', {
          organizationId,
          expected,
          actual,
        })
      }
    }

    // ── 4. The zero-row audit ──────────────────────────────────────────────
    const references = await auditUnmappedReferences(
      db,
      pairs.map((p) => p.inboxDefId),
      personal.map((row) => row.instanceId),
      [...new Set(personal.map((row) => row.organizationId))]
    )
    const nonZero = Object.entries(references).filter(([, count]) => count > 0)
    if (nonZero.length > 0) {
      logger.warn('Persisted inbox references found — 40a §5.2 assumed zero; review these', {
        references: Object.fromEntries(nonZero),
      })
    }

    // ── 5. Cache invalidation (40a §5.3) ───────────────────────────────────
    // `mailGrantIndex` is LOAD-BEARING here. `org:mail-grant-index` was
    // deliberately not version-bumped — the blob shape is unchanged and, with
    // zero `personal_inbox` rows, the widened query is byte-identical. The
    // staleness window opens exactly at the re-key above, so dropping this key
    // would take personal-inbox audiences dark for the full ONE_DAY TTL.
    for (const organizationId of affectedOrgs) {
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
        'inboxes',
        'mailGrantIndex',
      ])
      // Member-broadcast semantics: `userMailVisibility` is per USER, so every
      // member has to recompute, not just the mailbox owner.
      await onCacheEvent('inbox.updated', { orgId: organizationId, broadcastUserKeys: true })
    }

    logger.info('Moved personal inboxes onto personal_inbox and wrote shared-inbox floors', {
      orgs: pairs.length,
      inboxes: census.length,
      personalInboxes: personal.length,
      instancesMoved,
      valuesRemapped,
      valuesDeleted,
      grantsRecoded,
      grantsRaised,
      grantsDropped,
      ownerRowsWritten,
      floorRowsPlanned: floorRows.length,
      orgsInvalidated: affectedOrgs.size,
      references,
    })
  },
}
