// packages/lib/src/data-connectors/sinks/sink-page.ts
// Page-scoped binds for the entity sink: one read for the page's items and identities, and
// batched writes for what does not change a binding. See plans/mrp/14-batched-connector-sink.md §4.

import { schema } from '@auxx/database'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import {
  type enqueueRecordImageFetch,
  enqueueRecordImageFetches,
  type FetchRecordImageJobData,
} from '../../files/remote-image/enqueue'
import {
  type FindRecordByIdentityInput,
  findRecordByIdentity,
  findRecordsByIdentity,
  type RecordIdentityMatch,
} from '../../identity'
import {
  type DataConnectorItemRow,
  findItem,
  findItemByDef,
  insertItem,
  pickDefItem,
  setItemPendingRelations,
  touchItem,
  touchItemSet,
  type UpsertItemInput,
  updateItem,
  upsertItemSet,
} from '../service'
import type { SyncCtx } from './types'

type Row = DataConnectorItemRow

/**
 * The item and identity reads and writes the sink makes, with the service signatures. The
 * per-record lane uses the service functions; a page answers from memory.
 */
export interface ItemIo {
  findItem: typeof findItem
  findItemByDef: typeof findItemByDef
  touchItem: typeof touchItem
  setItemPendingRelations: typeof setItemPendingRelations
  upsertItem: (db: SyncCtx['db'], input: UpsertItemInput) => Promise<unknown>
  findRecordByIdentity: typeof findRecordByIdentity
  enqueueRecordImageFetch: typeof enqueueRecordImageFetch
}

/** An identity lookup scope: every `findRecordByIdentity` input but the external id. */
export type IdentityScope = Omit<FindRecordByIdentityInput, 'externalId' | 'organizationId'>

export interface SinkPage extends ItemIo {
  /** Load every item bound to these keys, by mapping and by def, in one query. */
  loadItems(keys: Array<{ mappingId: string; defId: string; externalId: string }>): Promise<void>
  /** Load the `RecordIdentity` matches of these external ids, one query per scope. */
  loadIdentities(scope: IdentityScope, externalIds: string[]): Promise<void>
  /** A mirror just wrote this identity: the next lookup of it reads the database. */
  noteIdentityWrite(scope: IdentityScope, externalId: string): void
  /** Defer a contributing provenance stamp; `fieldIds` are `CustomField` ids. */
  stamp(instanceId: string, fieldIds: string[]): void
  /** Write this instance's deferred stamps before anything reads or rewrites its cells. */
  flushStampsFor(instanceId: string): Promise<void>
  /** Write everything deferred. The page stays usable. */
  flush(): Promise<void>
  /**
   * `flush` only when a deferred item write changes what a direct item read sees (an archive
   * or removal cleared, a version stamp, `mintedInstance`); hashes and managed fields are not.
   */
  flushForItemReads(): Promise<void>
  /** Drop an item from memory after a path outside the page wrote it. */
  forget(itemId: string): void
  /** Copies of the page's in-memory items of one mapping. */
  itemsOf(mappingId: string): Row[]
}

/** What a deferred write must set on an item; a new binding or a rebind is written at once. */
interface Dirty {
  upsert: boolean
  touch: boolean
  pendingRelations: boolean
  upstreamUpdatedAt: boolean
  /** Changes a column `flushForItemReads` guards. */
  visible: boolean
}

const time = (d: Date | null | undefined) => d?.getTime() ?? null

const keyOf = (a: string, b: string) => `${a}\u0000${b}`
const scopeKey = (s: IdentityScope) =>
  JSON.stringify([s.entityDefinitionId, s.source, s.connectionId ?? null, s.appFieldKey ?? null])

/** An empty page for `ctx`'s connector; `loadItems` / `loadIdentities` fill it. */
export function createSinkPage(ctx: SyncCtx): SinkPage {
  const rows = new Map<string, Row>()
  // `mappingId, externalId` → item id, or null when known to have no item.
  const byKey = new Map<string, string | null>()
  // `defId, externalId` → item ids in read order.
  const byDef = new Map<string, string[]>()
  // scope → externalId → match, or null when known to have none.
  const identities = new Map<string, Map<string, RecordIdentityMatch | null>>()
  const dirty = new Map<string, Dirty>()
  const stamps = new Map<string, Set<string>>()
  let images: FetchRecordImageJobData[] = []

  const copy = (row: Row | undefined): Row | null => (row ? { ...row } : null)

  /** Adopt a row read or written outside memory; a row already in memory is newer. */
  const adopt = (row: Row): Row => {
    const known = rows.get(row.id)
    if (known) return known
    rows.set(row.id, row)
    byKey.set(keyOf(row.mappingId, row.externalId), row.id)
    const ids = byDef.get(keyOf(row.entityDefinitionId, row.externalId))
    if (ids && !ids.includes(row.id)) ids.push(row.id)
    return row
  }

  const markDirty = (id: string, patch: Partial<Dirty>) => {
    const d = dirty.get(id)
    dirty.set(id, {
      upsert: !!(d?.upsert || patch.upsert),
      touch: !!(d?.touch || patch.touch),
      pendingRelations: !!(d?.pendingRelations || patch.pendingRelations),
      upstreamUpdatedAt: !!(d?.upstreamUpdatedAt || patch.upstreamUpdatedAt),
      visible: !!(d?.visible || patch.visible),
    })
  }

  /** Whether writing `next` over `row` changes a column `flushForItemReads` guards. */
  const isVisible = (
    row: Row,
    next: { upstreamUpdatedAt?: Date | null; mintedInstance?: boolean }
  ): boolean =>
    row.archivedAt != null ||
    row.removedUpstreamAt != null ||
    (next.upstreamUpdatedAt !== undefined &&
      time(next.upstreamUpdatedAt) !== time(row.upstreamUpdatedAt)) ||
    (next.mintedInstance !== undefined && next.mintedInstance !== row.mintedInstance)

  const rowFor = async (mappingId: string, externalId: string): Promise<Row | null> => {
    const key = keyOf(mappingId, externalId)
    if (byKey.has(key)) {
      const id = byKey.get(key)
      return id ? (rows.get(id) ?? null) : null
    }
    const row = await findItem(ctx.db, ctx.connector.id, mappingId, externalId)
    if (!row) {
      byKey.set(key, null)
      return null
    }
    return adopt(row)
  }

  const flushStamps = async () => {
    if (stamps.size === 0) return
    const entityIds: string[] = []
    const fieldIds: string[] = []
    for (const [entityId, fields] of stamps) {
      for (const fieldId of fields) {
        entityIds.push(entityId)
        fieldIds.push(fieldId)
      }
    }
    const FV = schema.FieldValue
    await ctx.db
      .update(FV)
      .set({ managedByConnectorId: ctx.connector.id })
      .where(
        and(
          eq(FV.organizationId, ctx.orgId),
          sql`(${FV.entityId}, ${FV.fieldId}) in (select * from unnest(${sql.param(entityIds)}::text[], ${sql.param(fieldIds)}::text[]))`
        )
      )
    stamps.clear()
  }

  const flushItems = async () => {
    if (dirty.size === 0) return
    const upserts: Row[] = []
    const touches: Array<{ row: Row; d: Dirty }> = []
    for (const [id, d] of dirty) {
      const row = rows.get(id)
      if (!row) continue
      if (d.upsert) upserts.push(row)
      else touches.push({ row, d })
    }
    if (upserts.length > 0) await writeUpserts(ctx, upserts)
    if (touches.length > 0) await writeTouches(ctx, touches)
    dirty.clear()
  }

  const page: SinkPage = {
    async findItem(_db, _connectorId, mappingId, externalId) {
      return copy((await rowFor(mappingId, externalId)) ?? undefined)
    },

    async findItemByDef(_db, _connectorId, defId, externalId) {
      const ids = byDef.get(keyOf(defId, externalId))
      if (!ids) {
        const row = await findItemByDef(ctx.db, ctx.connector.id, defId, externalId)
        return copy(row ? adopt(row) : undefined)
      }
      return copy(pickDefItem(ids.map((id) => rows.get(id)!)) ?? undefined)
    },

    async touchItem(_db, itemId, lastSeenRunId, upstreamUpdatedAt) {
      const row = rows.get(itemId)
      if (!row) return touchItem(ctx.db, itemId, lastSeenRunId, upstreamUpdatedAt)
      const set = touchItemSet(lastSeenRunId, upstreamUpdatedAt, new Date())
      const visible = isVisible(row, set)
      Object.assign(row, set)
      markDirty(itemId, { touch: true, upstreamUpdatedAt: !!upstreamUpdatedAt, visible })
    },

    async setItemPendingRelations(_db, itemId, pendingRelations) {
      const row = rows.get(itemId)
      if (!row) return setItemPendingRelations(ctx.db, itemId, pendingRelations)
      row.pendingRelations = pendingRelations.length > 0 ? pendingRelations : null
      markDirty(itemId, { pendingRelations: true })
    },

    async upsertItem(_db, input) {
      const existing = await rowFor(input.mappingId, input.externalId)
      if (!existing) {
        const row = await insertItem(ctx.db, input)
        rows.delete(row.id)
        return { ...adopt(row) }
      }
      if (existing.entityInstanceId !== input.entityInstanceId) {
        // A rebind is written now: hooks and siblings read bindings, not hashes.
        const row = await updateItem(ctx.db, existing, input)
        const oldDef = byDef.get(keyOf(existing.entityDefinitionId, existing.externalId))
        if (oldDef?.includes(row.id) && existing.entityDefinitionId !== row.entityDefinitionId) {
          oldDef.splice(oldDef.indexOf(row.id), 1)
        }
        rows.delete(row.id)
        dirty.delete(row.id)
        return { ...adopt(row) }
      }
      const set = upsertItemSet(existing, input, new Date())
      const visible = isVisible(existing, set)
      Object.assign(existing, set)
      markDirty(existing.id, { upsert: true, visible })
      return { ...existing }
    },

    async findRecordByIdentity(input, db) {
      const known = identities.get(scopeKey(input))
      if (known?.has(input.externalId)) return known.get(input.externalId) ?? null
      return findRecordByIdentity(input, db)
    },

    async enqueueRecordImageFetch(data) {
      images.push(data)
      return true
    },

    async loadItems(keys) {
      if (keys.length === 0) return
      for (const k of keys) {
        if (!byKey.has(keyOf(k.mappingId, k.externalId))) {
          byKey.set(keyOf(k.mappingId, k.externalId), null)
        }
        if (!byDef.has(keyOf(k.defId, k.externalId))) byDef.set(keyOf(k.defId, k.externalId), [])
      }
      const I = schema.DataConnectorItem
      const found = await ctx.db
        .select()
        .from(I)
        .where(
          and(
            eq(I.dataConnectorId, ctx.connector.id),
            inArray(I.externalId, [...new Set(keys.map((k) => k.externalId))]),
            or(
              inArray(I.mappingId, [...new Set(keys.map((k) => k.mappingId))]),
              inArray(I.entityDefinitionId, [...new Set(keys.map((k) => k.defId))])
            )
          )
        )
      for (const row of found) {
        if (rows.has(row.id)) continue
        rows.set(row.id, row)
        const key = keyOf(row.mappingId, row.externalId)
        if (byKey.has(key)) byKey.set(key, row.id)
        byDef.get(keyOf(row.entityDefinitionId, row.externalId))?.push(row.id)
      }
    },

    async loadIdentities(scope, externalIds) {
      if (externalIds.length === 0) return
      const matches = await findRecordsByIdentity(
        { ...scope, organizationId: ctx.orgId, externalIds },
        ctx.db
      )
      const known = identities.get(scopeKey(scope)) ?? new Map()
      for (const id of externalIds) known.set(id, matches.get(id) ?? null)
      identities.set(scopeKey(scope), known)
    },

    noteIdentityWrite(scope, externalId) {
      identities.get(scopeKey(scope))?.delete(externalId)
    },

    stamp(instanceId, fieldIds) {
      const set = stamps.get(instanceId) ?? new Set<string>()
      for (const id of fieldIds) set.add(id)
      stamps.set(instanceId, set)
    },

    async flushStampsFor(instanceId) {
      if (stamps.has(instanceId)) await flushStamps()
    },

    async flush() {
      await flushStamps()
      await flushItems()
      if (images.length > 0) {
        const batch = images
        images = []
        await enqueueRecordImageFetches(batch)
      }
    },

    async flushForItemReads() {
      if ([...dirty.values()].some((d) => d.visible)) await page.flush()
    },

    itemsOf(mappingId) {
      return [...rows.values()].filter((r) => r.mappingId === mappingId).map((r) => ({ ...r }))
    },

    forget(itemId) {
      const row = rows.get(itemId)
      if (!row) return
      rows.delete(itemId)
      dirty.delete(itemId)
      byKey.delete(keyOf(row.mappingId, row.externalId))
      byDef.delete(keyOf(row.entityDefinitionId, row.externalId))
    },
  }
  return page
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/** One statement for every binding updated without a rebind; columns as `upsertItemSet`. */
async function writeUpserts(ctx: SyncCtx, upserts: Row[]): Promise<void> {
  const I = schema.DataConnectorItem
  const p = <T>(values: T[]) => sql.param(values)
  await ctx.db.execute(sql`
    update ${I} set
      "entityDefinitionId" = v.def,
      "contentHash" = v.hash,
      "managedFields" = v.managed::jsonb,
      "pendingRelations" = v.pending::jsonb,
      "upstreamUpdatedAt" = v.upstream::timestamp(3),
      "lastSeenRunId" = v.last_seen,
      "lastSyncedAt" = v.synced::timestamp(3),
      "mintedInstance" = v.minted,
      "archivedAt" = null,
      "removedUpstreamAt" = null,
      "error" = null
    from unnest(
      ${p(upserts.map((r) => r.id))}::text[],
      ${p(upserts.map((r) => r.entityDefinitionId))}::text[],
      ${p(upserts.map((r) => r.contentHash))}::text[],
      ${p(upserts.map((r) => JSON.stringify(r.managedFields)))}::text[],
      ${p(upserts.map((r) => (r.pendingRelations ? JSON.stringify(r.pendingRelations) : null)))}::text[],
      ${p(upserts.map((r) => iso(r.upstreamUpdatedAt)))}::text[],
      ${p(upserts.map((r) => r.lastSeenRunId))}::text[],
      ${p(upserts.map((r) => iso(r.lastSyncedAt)))}::text[],
      ${p(upserts.map((r) => r.mintedInstance))}::boolean[]
    ) as v(id, def, hash, managed, pending, upstream, last_seen, synced, minted)
    where ${I.id} = v.id
  `)
}

/** One statement for every touched binding; each column only where the page changed it. */
async function writeTouches(ctx: SyncCtx, touches: Array<{ row: Row; d: Dirty }>): Promise<void> {
  const I = schema.DataConnectorItem
  const p = <T>(values: T[]) => sql.param(values)
  const pick = <T>(f: (t: { row: Row; d: Dirty }) => T) => p(touches.map(f))
  await ctx.db.execute(sql`
    update ${I} set
      "lastSeenRunId" = case when v.touch then v.last_seen else ${I.lastSeenRunId} end,
      "lastSyncedAt" = case when v.touch then v.synced::timestamp(3) else ${I.lastSyncedAt} end,
      "removedUpstreamAt" = case when v.touch then null else ${I.removedUpstreamAt} end,
      "archivedAt" = case when v.touch then null else ${I.archivedAt} end,
      "upstreamUpdatedAt" = case when v.set_upstream then v.upstream::timestamp(3) else ${I.upstreamUpdatedAt} end,
      "pendingRelations" = case when v.set_pending then v.pending::jsonb else ${I.pendingRelations} end
    from unnest(
      ${pick((t) => t.row.id)}::text[],
      ${pick((t) => t.d.touch)}::boolean[],
      ${pick((t) => t.row.lastSeenRunId)}::text[],
      ${pick((t) => iso(t.row.lastSyncedAt))}::text[],
      ${pick((t) => t.d.upstreamUpdatedAt)}::boolean[],
      ${pick((t) => iso(t.row.upstreamUpdatedAt))}::text[],
      ${pick((t) => t.d.pendingRelations)}::boolean[],
      ${pick((t) => (t.row.pendingRelations ? JSON.stringify(t.row.pendingRelations) : null))}::text[]
    ) as v(id, touch, last_seen, synced, set_upstream, upstream, set_pending, pending)
    where ${I.id} = v.id
  `)
}

/** The scope `findInstanceByRecordIdentity` and the mirror use for an identity field. */
export function identityScope(
  entityDefinitionId: string,
  field: { appSlug: string; connectionId?: string | null; appFieldKey?: string | null }
): IdentityScope {
  return {
    entityDefinitionId,
    source: field.appSlug,
    connectionId: field.connectionId ?? null,
    appFieldKey: field.appFieldKey ?? null,
  }
}
