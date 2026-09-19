// packages/lib/src/entity-instances/edit-snapshot.ts
// The generic edit-in-place snapshot (74-D1, plan 74 §1.2): capture on Edit,
// restore on Cancel, drop on Save. Family-agnostic — a record id and the names
// of its content child relationships are the whole input.
//
// Not re-exported from `entity-instances/index.ts` on purpose: `resources/crud`
// imports that barrel, and this module reaches back into the crud handler.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { getInverseFieldId, getRelatedEntityDefinitionId } from '@auxx/types/custom-field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedCustomFields, getCachedResourceFields } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import { getRealtimeService, rooms } from '../realtime'
import type { RecordSnapshot } from '../record-rules/resolver'
import { fetchResourceSnapshots } from '../record-rules/snapshot-fetcher'
import type { EditStamp } from '../resources/picker/types'
import type { ResourceField } from '../resources/registry/field-types'

const logger = createScopedLogger('edit-snapshot')

export type { EditStamp }

/** What the `snapshot` column holds: the header, plus the content children per spec key. */
export interface EditSnapshotPayload {
  record: RecordSnapshot
  children: Record<string, RecordSnapshot[]>
}

/**
 * Projections whose registry entry does not (yet) declare `computed`, so the
 * capability rule below cannot see them. Restoring a stale copy would fight
 * their own writer — `vendor-payments/payment-state.ts` owns these three.
 */
const PROJECTED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'vendor_bill_amount_paid',
  'vendor_bill_paid_at',
  'vendor_bill_balance',
  // The memo's own settlement writer owns this one; it is `updatable` only so
  // the channel connector can transcribe it. Its siblings (`amount_applied`,
  // `balance`) and the totals the line hook recomputes (`subtotal`, `tax_total`,
  // `total`) are `updatable: false` and the rule above already skips them.
  'credit_memo_amount_refunded',
  // `settleCreditMemo` moves it (`issued` -> `settled`) and it carries a
  // lifecycle guard on both write chains, so restoring it would be refused
  // outright — Cancel on any issued memo would throw.
  'credit_memo_status',
  // `invoice-payments/payment-state.ts` is the only writer of these four, and an
  // invoice's is the one lifecycle field a projection moves (`sent` ->
  // `partially_paid` -> `paid`), so a payment landing mid-edit would be undone
  // by Cancel. `amount_paid`/`amount_credited`/`balance` are `updatable: false`
  // and the rule above already skips them; they are listed for the same reason
  // the bill's balance is — the set is what the projection owns.
  'invoice_status',
  'invoice_amount_paid',
  'invoice_amount_credited',
  'invoice_balance',
])

/** One named content relationship, resolved to the child side the rows are read through. */
interface ContentEdge {
  key: string
  childDefinitionId: string
  /** `CustomField.id` of the child's belongs_to field. */
  childFieldId: string
}

function relationshipOf(field: { options?: unknown }): RelationshipConfig | null {
  const options = field.options as { relationship?: RelationshipConfig } | null | undefined
  return options?.relationship ?? null
}

/**
 * Resolve each spec key to its child definition and the child's belongs_to
 * field. Read on the CHILD side for the reason `delete-closure.ts` gives: the
 * parent's mirror row is the one that historically dangled.
 */
async function resolveContentEdges(
  organizationId: string,
  headerDefinitionId: string,
  keys: readonly string[]
): Promise<ContentEdge[]> {
  if (keys.length === 0) return []
  const resourceFields = await getCachedResourceFields(organizationId, headerDefinitionId)
  const customFields = await getCachedCustomFields(organizationId, headerDefinitionId)

  const edges: ContentEdge[] = []
  for (const key of keys) {
    const registryField = resourceFields.find((f) => f.key === key)
    if (!registryField) {
      throw new BadRequestError(`No relationship "${key}" on this record`)
    }
    const stored = customFields.find((f) =>
      registryField.systemAttribute
        ? f.systemAttribute === registryField.systemAttribute
        : f.id === String(registryField.id)
    )
    const config = (stored ? relationshipOf(stored) : null) ?? registryField.relationship ?? null
    const childDefinitionId = config ? getRelatedEntityDefinitionId(config) : null
    const childFieldId = config ? getInverseFieldId(config) : null
    if (!config || !childDefinitionId || !childFieldId) {
      throw new BadRequestError(`Content relationship "${key}" has no resolvable inverse field`)
    }
    edges.push({ key, childDefinitionId, childFieldId })
  }
  return edges
}

/** The instance ids on the far side of one content edge, read from the child's own rows. */
async function readChildIds(
  db: Database,
  organizationId: string,
  headerInstanceId: string,
  edge: ContentEdge
): Promise<string[]> {
  const rows = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, edge.childFieldId),
        eq(schema.FieldValue.relatedEntityId, headerInstanceId)
      )
    )
  return [...new Set(rows.map((r) => r.entityId))]
}

async function snapshotRecords(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  instanceIds: readonly string[]
): Promise<RecordSnapshot[]> {
  if (instanceIds.length === 0) return []
  const snapshots = await fetchResourceSnapshots(
    db,
    organizationId,
    instanceIds.map((id) => toRecordId(entityDefinitionId, id))
  )
  return instanceIds
    .map((id) => snapshots.get(toRecordId(entityDefinitionId, id)))
    .filter((s): s is RecordSnapshot => Boolean(s))
}

function stampOf(row: { capturedAt: Date | string; byUserId: string }): EditStamp {
  return {
    openedAt: row.capturedAt instanceof Date ? row.capturedAt.toISOString() : row.capturedAt,
    byUserId: row.byUserId,
  }
}

export interface CaptureRecordSnapshotInput {
  organizationId: string
  entityInstanceId: string
  /**
   * The header definition's has_many content relationship KEYS as declared in
   * the registry — `['lines']` for `vendor_bill` / `credit_memo`,
   * `['lineItems']` for `invoice`. Named by the family spec, never walked from
   * `onDelete: 'cascade'` (66 D6).
   */
  children: readonly string[]
  byUserId: string
}

/**
 * Insert the pre-edit snapshot. If a row already exists its stamp comes back
 * untouched — the first Edit wins (66 D9).
 */
export async function captureRecordSnapshot(
  db: Database,
  input: CaptureRecordSnapshotInput
): Promise<EditStamp> {
  const { organizationId, entityInstanceId, byUserId } = input

  const existing = await readEditSnapshotRow(db, organizationId, entityInstanceId)
  if (existing) return stampOf(existing)

  const instance = await db.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.organizationId, organizationId),
      eq(schema.EntityInstance.id, entityInstanceId)
    ),
    columns: { id: true, entityDefinitionId: true },
  })
  if (!instance) throw new NotFoundError(`Record not found: ${entityInstanceId}`)

  const [record] = await snapshotRecords(db, organizationId, instance.entityDefinitionId, [
    entityInstanceId,
  ])
  if (!record) throw new NotFoundError(`Record not found: ${entityInstanceId}`)

  const edges = await resolveContentEdges(
    organizationId,
    instance.entityDefinitionId,
    input.children
  )
  const children: Record<string, RecordSnapshot[]> = {}
  for (const edge of edges) {
    const childIds = await readChildIds(db, organizationId, entityInstanceId, edge)
    children[edge.key] = await snapshotRecords(db, organizationId, edge.childDefinitionId, childIds)
  }

  const payload: EditSnapshotPayload = { record, children }
  await db
    .insert(schema.EntityInstanceEditSnapshot)
    .values({
      organizationId,
      entityInstanceId,
      entityDefinitionId: instance.entityDefinitionId,
      snapshot: payload,
      byUserId,
    })
    .onConflictDoNothing()

  // Re-read rather than trusting the insert: a concurrent Edit that won the
  // race owns the true pre-edit state, and its stamp is the one to hand back.
  const row = await readEditSnapshotRow(db, organizationId, entityInstanceId)
  if (!row) throw new NotFoundError(`Edit snapshot not found: ${entityInstanceId}`)
  return stampOf(row)
}

async function readEditSnapshotRow(
  db: Database,
  organizationId: string,
  entityInstanceId: string
): Promise<{ capturedAt: Date | string; byUserId: string } | null> {
  const rows = await db
    .select({
      capturedAt: schema.EntityInstanceEditSnapshot.capturedAt,
      byUserId: schema.EntityInstanceEditSnapshot.byUserId,
    })
    .from(schema.EntityInstanceEditSnapshot)
    .where(
      and(
        eq(schema.EntityInstanceEditSnapshot.organizationId, organizationId),
        eq(schema.EntityInstanceEditSnapshot.entityInstanceId, entityInstanceId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

/** The open edit on one record, or `null`. Never selects the `snapshot` column. */
export async function readEditStamp(
  db: Database,
  organizationId: string,
  entityInstanceId: string
): Promise<EditStamp | null> {
  const row = await readEditSnapshotRow(db, organizationId, entityInstanceId)
  return row ? stampOf(row) : null
}

/**
 * The open edits across a batch, in ONE `IN` query. Ids with no row are absent
 * from the map. Never selects the `snapshot` column — this is a read path.
 */
export async function readEditStamps(
  db: Database,
  organizationId: string,
  entityInstanceIds: readonly string[]
): Promise<Map<string, EditStamp>> {
  const out = new Map<string, EditStamp>()
  const ids = [...new Set(entityInstanceIds)]
  if (ids.length === 0) return out

  const rows = await db
    .select({
      entityInstanceId: schema.EntityInstanceEditSnapshot.entityInstanceId,
      capturedAt: schema.EntityInstanceEditSnapshot.capturedAt,
      byUserId: schema.EntityInstanceEditSnapshot.byUserId,
    })
    .from(schema.EntityInstanceEditSnapshot)
    .where(
      and(
        eq(schema.EntityInstanceEditSnapshot.organizationId, organizationId),
        inArray(schema.EntityInstanceEditSnapshot.entityInstanceId, ids)
      )
    )

  for (const row of rows) out.set(row.entityInstanceId, stampOf(row))
  return out
}

/** Save's clear. True when a row was deleted. */
export async function deleteEditSnapshot(
  db: Database,
  organizationId: string,
  entityInstanceId: string
): Promise<boolean> {
  const deleted = await db
    .delete(schema.EntityInstanceEditSnapshot)
    .where(
      and(
        eq(schema.EntityInstanceEditSnapshot.organizationId, organizationId),
        eq(schema.EntityInstanceEditSnapshot.entityInstanceId, entityInstanceId)
      )
    )
    .returning({ id: schema.EntityInstanceEditSnapshot.id })
  return deleted.length > 0
}

/**
 * The attributes of one snapshot that go back through the write path.
 *
 * **The rule, from the registry alone:** a field is restored when it is
 * writable (`updatable`, or `creatable` when recreating a removed line), is not
 * `computed`, and is not a has_many/has_one mirror — everything else is either
 * refused by the write path or is a projection with its own writer
 * ({@link PROJECTED_ATTRIBUTES} covers the three whose registry entry has not
 * caught up).
 */
function restorableValues(
  fields: ResourceField[],
  snapshot: RecordSnapshot,
  mode: 'update' | 'create'
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const fieldValues = snapshot.fieldValues ?? {}
  for (const field of fields) {
    const key = field.systemAttribute ?? String(field.id)
    if (!(key in fieldValues)) continue
    if (PROJECTED_ATTRIBUTES.has(key)) continue
    const capable = mode === 'create' ? field.capabilities.creatable : field.capabilities.updatable
    if (!capable || field.capabilities.computed) continue
    const relationship = field.relationship
    if (relationship && relationship.relationshipType !== 'belongs_to') continue
    values[key] = fieldValues[key]
  }
  return values
}

/** `belongs_to` values are bare instance ids in a snapshot; the write path takes RecordIds. */
async function encodeRelationshipValues(
  db: Database,
  organizationId: string,
  fields: ResourceField[],
  values: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const relationKeys = fields
    .filter((f) => f.relationship?.relationshipType === 'belongs_to')
    .map((f) => f.systemAttribute ?? String(f.id))
    .filter((k) => k in values)
  if (relationKeys.length === 0) return values

  const ids = relationKeys
    .map((k) => values[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  const byId = new Map<string, RecordId>()
  if (ids.length > 0) {
    const rows = await db
      .select({
        id: schema.EntityInstance.id,
        entityDefinitionId: schema.EntityInstance.entityDefinitionId,
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          inArray(schema.EntityInstance.id, [...new Set(ids)])
        )
      )
    for (const row of rows) byId.set(row.id, toRecordId(row.entityDefinitionId, row.id))
  }

  const out = { ...values }
  for (const key of relationKeys) {
    const raw = out[key]
    if (typeof raw !== 'string' || raw.length === 0) {
      out[key] = null
      continue
    }
    // 66 §2.5: a referenced record that no longer exists leaves the cell empty.
    out[key] = byId.get(raw) ?? null
  }
  return out
}

export interface RestoreRecordSnapshotInput {
  organizationId: string
  entityInstanceId: string
  actorUserId: string
}

/**
 * Cancel: put the record and its content children back as Edit found them, then
 * drop the row (66 D5/D8).
 *
 * 🛑 The snapshot row must still exist while the writes run — the family's lock
 * reads it for existence and would refuse them — so it is deleted LAST, inside
 * the same transaction.
 */
export async function restoreRecordSnapshot(
  db: Database,
  input: RestoreRecordSnapshotInput
): Promise<void> {
  const { organizationId, entityInstanceId, actorUserId } = input

  const rows = await db
    .select({
      entityDefinitionId: schema.EntityInstanceEditSnapshot.entityDefinitionId,
      snapshot: schema.EntityInstanceEditSnapshot.snapshot,
    })
    .from(schema.EntityInstanceEditSnapshot)
    .where(
      and(
        eq(schema.EntityInstanceEditSnapshot.organizationId, organizationId),
        eq(schema.EntityInstanceEditSnapshot.entityInstanceId, entityInstanceId)
      )
    )
    .limit(1)
  const row = rows[0]
  if (!row) throw new NotFoundError(`No open edit on record ${entityInstanceId}`)

  const payload = row.snapshot as EditSnapshotPayload
  const headerDefinitionId = row.entityDefinitionId
  const edges = await resolveContentEdges(
    organizationId,
    headerDefinitionId,
    Object.keys(payload.children ?? {})
  )

  // Leaf-path dynamic import: `resources/crud` imports `entity-instances`, so
  // reaching the handler statically would close that cycle.
  const { UnifiedCrudHandler } = await import('../resources/crud/unified-handler')

  await db.transaction(async (tx) => {
    const scoped = tx as unknown as Database
    const handler = new UnifiedCrudHandler(organizationId, actorUserId, scoped)

    const headerFields = await getCachedResourceFields(organizationId, headerDefinitionId)
    const headerValues = await encodeRelationshipValues(
      scoped,
      organizationId,
      headerFields,
      restorableValues(headerFields, payload.record, 'update')
    )
    if (Object.keys(headerValues).length > 0) {
      await handler.update(toRecordId(headerDefinitionId, entityInstanceId), headerValues)
    }

    for (const edge of edges) {
      const captured = payload.children[edge.key] ?? []
      const childFields = await getCachedResourceFields(organizationId, edge.childDefinitionId)
      const liveIds = new Set(await readChildIds(scoped, organizationId, entityInstanceId, edge))
      const capturedById = new Map(
        captured.filter((c) => c.id).map((c) => [String(c.id), c] as const)
      )

      // Survivors: back to their captured values.
      for (const [id, snapshot] of capturedById) {
        if (!liveIds.has(id)) continue
        const values = await encodeRelationshipValues(
          scoped,
          organizationId,
          childFields,
          restorableValues(childFields, snapshot, 'update')
        )
        if (Object.keys(values).length === 0) continue
        await handler.update(toRecordId(edge.childDefinitionId, id), values)
      }

      // Added since capture: gone, through the delete engine so the mirrors sweep.
      for (const id of liveIds) {
        if (capturedById.has(id)) continue
        await handler.delete(toRecordId(edge.childDefinitionId, id))
      }

      // Removed since capture: recreated under a fresh id (66 D8).
      for (const [id, snapshot] of capturedById) {
        if (liveIds.has(id)) continue
        const values = await encodeRelationshipValues(
          scoped,
          organizationId,
          childFields,
          restorableValues(childFields, snapshot, 'create')
        )
        await handler.create(edge.childDefinitionId, values)
      }
    }

    await tx
      .delete(schema.EntityInstanceEditSnapshot)
      .where(
        and(
          eq(schema.EntityInstanceEditSnapshot.organizationId, organizationId),
          eq(schema.EntityInstanceEditSnapshot.entityInstanceId, entityInstanceId)
        )
      )
  })

  logger.debug('Restored record from edit snapshot', { organizationId, entityInstanceId })
}

export interface PublishRecordEditStampInput {
  organizationId: string
  entityDefinitionId: string
  entityInstanceId: string
  edit: EditStamp | null
}

/**
 * Publish the edit stamp on the definition's records room so a second tab sees
 * the lock lift and re-engage without a refetch (§1.2.1 "Live").
 */
export async function publishRecordEditStamp(input: PublishRecordEditStampInput): Promise<void> {
  const { organizationId, entityDefinitionId, entityInstanceId, edit } = input
  const recordId = toRecordId(entityDefinitionId, entityInstanceId)
  await getRealtimeService()
    .publish(rooms.orgRecords(organizationId, entityDefinitionId), 'record:updated', {
      entityDefinitionId,
      record: { id: entityInstanceId, recordId, edit },
    })
    .catch(() => {})
}
