// packages/lib/src/record-layout/layout-store.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError } from '../errors'
import {
  type RecordLayoutDelta,
  type RecordLayoutSurface,
  recordLayoutDeltaSchema,
} from './layout-delta'

/**
 * Reads and writes for the two stored layers of the record layout system
 * (`plans/drawer/record-layout-system.md` §5).
 *
 * | Layer | Row | Key |
 * | --- | --- | --- |
 * | org | `TableView`, `isShared` + `isDefault` | `tableId = entityDefinitionId`, `contextType = surface` |
 * | user | `TableViewPreference` | `tableId = layout:<surface>:<defId>`, `tableViewId = null` |
 *
 * Both hold a **sparse delta**, never a layout. Nothing here ever writes a full
 * snapshot, and a delta that arrives malformed is rejected rather than stored.
 *
 * Access checks deliberately live in the router, not here: lib never gates. The
 * org write is def-admin (`assertStructuralAccess`); the personal write is open
 * to any member who can view the definition.
 */

/** Name given to the org layout row, mirroring `Default Panel View`. */
export function recordLayoutViewName(surface: RecordLayoutSurface): string {
  return surface === 'detail' ? 'Default Detail Layout' : 'Default Drawer Layout'
}

/**
 * `TableViewPreference.tableId` for a personal record layout.
 *
 * Namespaced rather than reusing the bare definition id, because the bare id and
 * `entity-<defId>` are already taken by the panel field config and the default
 * table's own per-user column state, and one preference row per key is all the
 * unique index allows.
 */
export function recordLayoutPreferenceTableId(
  entityDefinitionId: string,
  surface: RecordLayoutSurface
): string {
  return `layout:${surface}:${entityDefinitionId}`
}

/** Both stored layers for one definition on one surface. */
export interface RecordLayoutDeltas {
  /** The org override, or `null` when the org never customised this surface. */
  org: RecordLayoutDelta | null
  /** The viewer's personal override, or `null`. */
  user: RecordLayoutDelta | null
}

export interface RecordLayoutTarget {
  organizationId: string
  userId: string
  entityDefinitionId: string
  surface: RecordLayoutSurface
}

/**
 * Parse a stored `config` blob into a delta.
 *
 * Returns `null` rather than throwing for a blob that no longer validates: an
 * unreadable row must fall back to the registry default, not break the surface.
 * Zod strips unknown keys, which is also what keeps a hand-edited row from
 * smuggling capability into the layout.
 */
export function parseRecordLayoutDelta(config: unknown): RecordLayoutDelta | null {
  const parsed = recordLayoutDeltaSchema.safeParse(config)
  return parsed.success ? parsed.data : null
}

/** Read the org and personal deltas for one definition on one surface. */
export async function getRecordLayoutDeltas(
  db: Database,
  target: RecordLayoutTarget
): Promise<Result<RecordLayoutDeltas, Error>> {
  const { organizationId, userId, entityDefinitionId, surface } = target

  const [orgRows, userRows] = await Promise.all([
    db
      .select({ config: schema.TableView.config })
      .from(schema.TableView)
      .where(
        and(
          eq(schema.TableView.tableId, entityDefinitionId),
          eq(schema.TableView.organizationId, organizationId),
          eq(schema.TableView.contextType, surface),
          eq(schema.TableView.isDefault, true),
          eq(schema.TableView.isShared, true)
        )
      )
      .limit(1),
    db
      .select({ config: schema.TableViewPreference.config })
      .from(schema.TableViewPreference)
      .where(
        and(
          eq(schema.TableViewPreference.organizationId, organizationId),
          eq(schema.TableViewPreference.userId, userId),
          eq(
            schema.TableViewPreference.tableId,
            recordLayoutPreferenceTableId(entityDefinitionId, surface)
          ),
          isNull(schema.TableViewPreference.tableViewId)
        )
      )
      .limit(1),
  ])

  return ok({
    org: orgRows[0] ? parseRecordLayoutDelta(orgRows[0].config) : null,
    user: userRows[0] ? parseRecordLayoutDelta(userRows[0].config) : null,
  })
}

/**
 * Upsert the org layout delta.
 *
 * The partial unique index on `(tableId, organizationId, contextType) WHERE
 * isDefault` guarantees at most one such row, so this reads it and updates in
 * place rather than inserting a second.
 */
export async function saveOrgRecordLayout(
  db: Database,
  target: RecordLayoutTarget,
  delta: RecordLayoutDelta
): Promise<Result<RecordLayoutDelta, Error>> {
  const parsed = recordLayoutDeltaSchema.safeParse(delta)
  if (!parsed.success) return err(new BadRequestError('Invalid record layout.'))

  const { organizationId, userId, entityDefinitionId, surface } = target

  const existing = await db
    .select({ id: schema.TableView.id })
    .from(schema.TableView)
    .where(
      and(
        eq(schema.TableView.tableId, entityDefinitionId),
        eq(schema.TableView.organizationId, organizationId),
        eq(schema.TableView.contextType, surface),
        eq(schema.TableView.isDefault, true)
      )
    )
    .limit(1)

  if (existing[0]) {
    await db
      .update(schema.TableView)
      .set({ config: parsed.data, updatedAt: new Date() })
      .where(eq(schema.TableView.id, existing[0].id))
    return ok(parsed.data)
  }

  await db.insert(schema.TableView).values({
    tableId: entityDefinitionId,
    entityDefinitionId,
    name: recordLayoutViewName(surface),
    config: parsed.data,
    contextType: surface,
    isDefault: true,
    isShared: true,
    userId,
    organizationId,
    updatedAt: new Date(),
  })

  return ok(parsed.data)
}

/** Upsert the acting user's personal layout delta. */
export async function savePersonalRecordLayout(
  db: Database,
  target: RecordLayoutTarget,
  delta: RecordLayoutDelta
): Promise<Result<RecordLayoutDelta, Error>> {
  const parsed = recordLayoutDeltaSchema.safeParse(delta)
  if (!parsed.success) return err(new BadRequestError('Invalid record layout.'))

  const { organizationId, userId, entityDefinitionId, surface } = target

  await db
    .insert(schema.TableViewPreference)
    .values({
      tableId: recordLayoutPreferenceTableId(entityDefinitionId, surface),
      tableViewId: null,
      config: parsed.data,
      userId,
      organizationId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.TableViewPreference.organizationId,
        schema.TableViewPreference.userId,
        schema.TableViewPreference.tableId,
        schema.TableViewPreference.tableViewId,
      ],
      set: { config: parsed.data, updatedAt: new Date() },
    })

  return ok(parsed.data)
}

/** Delete the org layout delta, returning the surface to the registry default. */
export async function resetOrgRecordLayout(
  db: Database,
  target: RecordLayoutTarget
): Promise<Result<void, Error>> {
  await db
    .delete(schema.TableView)
    .where(
      and(
        eq(schema.TableView.tableId, target.entityDefinitionId),
        eq(schema.TableView.organizationId, target.organizationId),
        eq(schema.TableView.contextType, target.surface),
        eq(schema.TableView.isDefault, true)
      )
    )
  return ok(undefined)
}

/** Delete the acting user's personal layout delta. */
export async function resetPersonalRecordLayout(
  db: Database,
  target: RecordLayoutTarget
): Promise<Result<void, Error>> {
  await db
    .delete(schema.TableViewPreference)
    .where(
      and(
        eq(schema.TableViewPreference.organizationId, target.organizationId),
        eq(schema.TableViewPreference.userId, target.userId),
        eq(
          schema.TableViewPreference.tableId,
          recordLayoutPreferenceTableId(target.entityDefinitionId, target.surface)
        ),
        isNull(schema.TableViewPreference.tableViewId)
      )
    )
  return ok(undefined)
}
