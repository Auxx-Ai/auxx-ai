// packages/lib/src/data-connectors/__tests__/sink-writer-parity.test.ts
// L1 parity (plans/entity/domain-tables/02-sink-writer.md §4): one sync story run against a
// `FieldValue` definition and the writer-backed `__sink_fixture`, over in-memory models of
// both storages, asserting the same outcome; plus the writer-only arms and the no-writer path.

import type { ResourceFieldId } from '@auxx/types/field'
import { getInstanceId, toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../__test-helpers'
import type { ChildSet } from '../map-record'
import type { DecodedMapping, PendingRelation } from '../service'
import type { ProjectedRecord, SyncCtx } from '../sinks/types'
import {
  FIXTURE_KEYS,
  FIXTURE_TYPE,
  registerSinkFixture,
  type SinkFixture,
  unregisterSinkFixture,
} from './support/sink-fixture-writer'

type Item = Record<string, unknown> & {
  id: string
  mappingId: string
  externalId: string
  entityDefinitionId: string
  entityInstanceId: string | null
  managedFields: string[]
  pendingRelations: PendingRelation[] | null
  linkedRelations: string[] | null
}
interface Cell {
  value: unknown
  marker: string | null
  related?: string
}

const w = vi.hoisted(() => ({
  items: new Map<string, Record<string, unknown>>(),
  itemSeq: 0,
  cells: new Map<
    string,
    Map<string, { value: unknown; marker: string | null; related?: string }>
  >(),
  keep: [] as string[][],
  entityDefLookups: 0,
}))
const clone = <T>(v: T): T => (v == null ? v : structuredClone(v))
const itemList = () => [...w.items.values()] as Item[]

vi.mock('../service', async (orig) => ({
  ...(await orig<typeof import('../service')>()),
  findItem: async (_db: unknown, _c: string, mappingId: string, externalId: string) =>
    clone(w.items.get(`${mappingId}::${externalId}`)) ?? null,
  findItemByDef: async (_db: unknown, _c: string, defId: string, externalId: string) =>
    clone(itemList().find((i) => i.entityDefinitionId === defId && i.externalId === externalId)) ??
    null,
  touchItem: async (_db: unknown, id: string, runId: string) => {
    const item = itemList().find((i) => i.id === id)
    if (item) item.lastSeenRunId = runId
  },
  upsertItem: async (_db: unknown, input: Record<string, unknown>) => {
    const key = `${input.mappingId}::${input.externalId}`
    const prev = w.items.get(key)
    w.items.set(key, {
      id: `item-${++w.itemSeq}`,
      archivedAt: null,
      pinnedFields: [],
      linkedRelations: null,
      ...prev,
      ...input,
      mintedInstance: (prev?.mintedInstance as boolean) || (input.mintedInstance as boolean),
    })
  },
  setItemPendingRelations: async (_db: unknown, id: string, rels: PendingRelation[]) => {
    const item = itemList().find((i) => i.id === id)
    if (item) item.pendingRelations = rels
  },
  listItemsForMapping: async (_db: unknown, _c: string, mappingId: string) =>
    clone(itemList().filter((i) => i.mappingId === mappingId)),
  listItemsWithPendingRelations: async () =>
    clone(itemList().filter((i) => (i.pendingRelations ?? []).length > 0)),
  setItemRelationState: async (
    _db: unknown,
    id: string,
    s: { pendingRelations: PendingRelation[]; linkedRelations: string[] }
  ) => {
    const item = itemList().find((i) => i.id === id)!
    item.pendingRelations = s.pendingRelations
    item.linkedRelations = s.linkedRelations
  },
  readRelationshipTargets: async (
    _db: unknown,
    _org: string,
    pairs: Array<{ entityInstanceId: string; fieldId: string }>
  ) => {
    const out = new Map<string, string>()
    for (const p of pairs) {
      const related = w.cells.get(p.entityInstanceId)?.get(p.fieldId)?.related
      if (related) out.set(`${p.entityInstanceId}::${p.fieldId}`, related)
    }
    return out
  },
  markItemArchived: async (_db: unknown, id: string) => {
    const item = itemList().find((i) => i.id === id)
    if (item) item.archivedAt = new Date(0)
  },
}))

// The FieldValue marker clear's keep-set, read the way reconcile-managed-markers.test.ts does.
vi.mock('drizzle-orm', async (orig) => {
  const actual = await orig<typeof import('drizzle-orm')>()
  return {
    ...actual,
    notInArray: (col: unknown, ids: string[]) => {
      w.keep.push(ids)
      return actual.notInArray(col as never, ids)
    },
  }
})

const FIELD_IDS = ['f-alpha', 'f-beta', 'f-note', 'f-parent']
vi.mock('../../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: async (ref: string) => ref,
}))
vi.mock('../field-id-resolver', () => ({
  buildWriteKeyToFieldId: async () => new Map(FIELD_IDS.map((id) => [id, id])),
}))
vi.mock('../../cache', () => ({
  getCachedFieldMap: async () =>
    new Map(FIELD_IDS.map((id) => [id, { id, type: 'TEXT', systemAttribute: null, options: {} }])),
  getCachedResource: async () => null,
  getCachedCustomFields: async () => [],
  getCachedResourceFields: async () => [],
  getCachedEntityDefId: async (_org: string, type: string) => {
    w.entityDefLookups += 1
    return { __sink_fixture: 'def_fx', __sink_fixture_parent: 'def_parent' }[type]
  },
}))
vi.mock('../../identity', () => ({
  upsertRecordIdentity: vi.fn(),
  findRecordByIdentity: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../accounting/work-items/wake', () => ({ wakeRecords: async () => {} }))

import { replaceChildSets } from '../child-sets'
import { finalizeConnectorTeardown } from '../mutations'
import { reconcileManagedMarkers } from '../reconciliation'
import { resolveRelationships } from '../relationship-pass'
import { entitySink } from '../sinks/entity-sink'
import { writerKeyOf } from '../sinks/writers'

interface Arm {
  name: 'FieldValue' | 'writer'
  def: string
  ref: (field: 'alpha' | 'beta' | 'note') => string
  parentKey: string
}
const FV: Arm = {
  name: 'FieldValue',
  def: 'def_fv',
  ref: (f) => `def_fv:f-${f}`,
  parentKey: 'f-parent',
}
const FX: Arm = {
  name: 'writer',
  def: 'def_fx',
  ref: (f) => (f === 'note' ? 'def_fx:f-note' : `def_fx:${f}`),
  parentKey: FIXTURE_KEYS.parent,
}

/** `alpha` from `def_fv:f-alpha`, `def_fx:alpha` or `__sink_fixture:alpha`. */
const logical = (ref: string) => ref.slice(ref.lastIndexOf(':') + 1).replace(/^f-/, '')

interface World {
  arm: Arm
  fixture: SinkFixture | null
  db: SyncCtx['db']
  crud: {
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    archive: ReturnType<typeof vi.fn>
    getFieldValues: ReturnType<typeof vi.fn>
  }
  log: unknown[]
  deleted: boolean
  selectRows: unknown[]
}

let world: World

function newWorld(arm: Arm, withWriter = true): World {
  w.items.clear()
  w.cells.clear()
  w.keep.length = 0
  w.itemSeq = 0
  w.entityDefLookups = 0
  unregisterSinkFixture()
  const fixture = withWriter ? registerSinkFixture() : null
  let lastWrite: { id: string; keys: string[] } | null = null
  let seq = 0
  const log: unknown[] = []

  const writeCells = (id: string, ws: Record<string, unknown>) => {
    lastWrite = { id, keys: Object.keys(ws) }
    const row = w.cells.get(id) ?? new Map<string, Cell>()
    w.cells.set(id, row)
    for (const [key, value] of Object.entries(ws)) {
      if (value === null || value === undefined || value === '') row.delete(key)
      else
        row.set(key, {
          value,
          marker: null,
          related: key === 'f-parent' ? getInstanceId(value as never) : undefined,
        })
    }
  }
  const crud = {
    create: vi.fn(async (defId: string, ws: Record<string, unknown>) => {
      log.push(['create', defId, ws])
      const id = `fv-${++seq}`
      writeCells(id, ws)
      return { instance: { id } }
    }),
    update: vi.fn(async (recordId: string, ws: Record<string, unknown>) => {
      log.push(['update', recordId, ws])
      writeCells(getInstanceId(recordId as never), ws)
      return {}
    }),
    archive: vi.fn(async (recordId: string) => {
      log.push(['archive', recordId])
    }),
    getFieldValues: vi.fn(async (recordId: string) => {
      const row = w.cells.get(getInstanceId(recordId as never)) ?? new Map<string, Cell>()
      return new Map([...row].map(([k, c]) => [k, { type: 'text', value: c.value }]))
    }),
  }

  const current: World = {
    arm,
    fixture,
    crud,
    log,
    deleted: false,
    selectRows: [],
    db: undefined as unknown as SyncCtx['db'],
  }
  current.db = {
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          log.push(['db.update', vals])
          if (vals.managedByConnectorId === 'dc1' && lastWrite) {
            for (const key of lastWrite.keys) {
              const cell = w.cells.get(lastWrite.id)?.get(key)
              if (cell) cell.marker = 'dc1'
            }
          }
          if ('managedByConnectorId' in vals && vals.managedByConnectorId === null) {
            const keep = w.keep.at(-1) ?? []
            for (const row of w.cells.values()) {
              for (const [key, cell] of row) {
                if (cell.marker === 'dc1' && !keep.includes(key)) cell.marker = null
              }
            }
          }
        },
      }),
    }),
    // The FieldValue drift query, evaluated over the model for the uuid-keyed (cell) refs.
    execute: async () => {
      const rows: Array<{ entityId: string }> = []
      for (const item of itemList()) {
        if (!item.entityInstanceId || item.archivedAt) continue
        const refs = [arm.ref('alpha'), arm.ref('beta'), arm.ref('note')].filter((r) =>
          r.includes(':f-')
        )
        const drifted = refs.some((ref) => {
          const cell = w.cells.get(item.entityInstanceId!)?.get(ref.slice(ref.indexOf(':') + 1))
          if (((item.pinnedFields as string[]) ?? []).includes(ref.slice(ref.indexOf(':') + 1)))
            return false
          return cell ? cell.marker !== 'dc1' : item.managedFields.includes(ref)
        })
        if (drifted) rows.push({ entityId: item.entityInstanceId })
      }
      return { rows }
    },
    select: () => ({ from: () => ({ where: async () => current.selectRows }) }),
    selectDistinct: () => ({
      from: () => ({
        where: async () =>
          itemList()
            .filter((i) => i.entityInstanceId)
            .map((i) => ({ id: i.entityInstanceId })),
      }),
    }),
    delete: () => ({
      where: async () => {
        current.deleted = true
      },
    }),
    query: {
      DataConnectorItem: { findFirst: async () => null },
      EntityInstance: { findFirst: async () => ({ archivedAt: null }) },
      AppInstallation: { findFirst: async () => null },
    },
  } as unknown as SyncCtx['db']
  world = current
  return current
}

function ctxFor(): SyncCtx {
  return makeSyncCtx({
    db: world.db,
    crud: world.crud as never,
    ownedCrud: world.crud as never,
  })
}

function mapping(
  arm: Arm,
  over: Partial<DecodedMapping> = {},
  fields: Array<'alpha' | 'beta' | 'note'> = ['alpha', 'beta', 'note']
): DecodedMapping {
  return {
    row: { id: 'm1' },
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'contributing',
    entityDefinitionId: arm.def,
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    fieldMappings: fields.map((f) => ({
      id: `fm-${f}`,
      targetFieldRef: arm.ref(f),
      expression: `{${f}}`,
      sourceFields: {},
    })),
    ...over,
  } as unknown as DecodedMapping
}

function record(
  arm: Arm,
  externalId: string,
  values: Partial<Record<'alpha' | 'beta' | 'note', unknown>>,
  pendingRelations: PendingRelation[] = []
): ProjectedRecord {
  return {
    externalId,
    displayName: externalId,
    fields: Object.fromEntries(Object.entries(values).map(([f, v]) => [arm.ref(f as 'alpha'), v])),
    identityCandidates: [],
    pendingRelations,
  }
}

async function sync(arm: Arm, records: ProjectedRecord[], m = mapping(arm)): Promise<SyncCtx> {
  const ctx = ctxFor()
  for (const r of records) await entitySink.upsertRecord(ctx, m, r)
  return ctx
}

const instanceOf = (externalId: string, mappingId = 'm1') =>
  (w.items.get(`${mappingId}::${externalId}`) as Item | undefined)?.entityInstanceId ?? null

/** The instance's values and the logical keys dc1 holds a mark on, whichever storage holds them. */
function view(arm: Arm, instanceId: string | null) {
  if (!instanceId) return null
  const cells = w.cells.get(instanceId) ?? new Map<string, Cell>()
  const marked = [...cells].filter(([, c]) => c.marker === 'dc1').map(([k]) => logical(k))
  const out: Record<string, unknown> = { note: cells.get('f-note')?.value ?? null }
  if (arm.name === 'FieldValue') {
    out.alpha = cells.get('f-alpha')?.value ?? null
    out.beta = cells.get('f-beta')?.value ?? null
    out.parent = cells.get('f-parent')?.related ?? null
  } else {
    const row = world.fixture!.rows.get(instanceId)!
    out.alpha = row.alpha
    out.beta = row.beta
    out.parent = row.parent
    for (const [key, owner] of Object.entries(row.connectorMarks)) {
      if (owner === 'dc1') marked.push(logical(key))
    }
  }
  return { ...out, marked: marked.sort() }
}

function itemView(externalId: string, mappingId = 'm1') {
  const item = w.items.get(`${mappingId}::${externalId}`) as Item | undefined
  if (!item) return null
  return {
    bound: item.entityInstanceId != null,
    minted: item.mintedInstance,
    managed: [...item.managedFields].map(logical).sort(),
    linked: (item.linkedRelations ?? []).map(logical).sort(),
  }
}

const counts = (ctx: SyncCtx) => {
  const { created, updated, skipped, failed, archived, relationshipWarnings } = ctx.counters
  return { created, updated, skipped, failed, archived, relationshipWarnings }
}

/** Run one story per arm on a fresh world and return both snapshots. */
async function both<T>(story: (arm: Arm) => Promise<T>): Promise<[T, T]> {
  newWorld(FV)
  const fv = await story(FV)
  newWorld(FX)
  const fx = await story(FX)
  return [fv, fx]
}

const A1 = { alpha: 'a1', beta: 'b1', note: 'n1' }

beforeEach(() => {
  newWorld(FV)
})

describe('sink writer parity: FieldValue definition vs __sink_fixture', () => {
  it('first sync mints and binds', async () => {
    const [fv, fx] = await both(async (arm) => {
      const ctx = await sync(arm, [record(arm, 'r1', A1)])
      return { counts: counts(ctx), item: itemView('r1'), state: view(arm, instanceOf('r1')) }
    })
    expect(fx).toEqual(fv)
    expect(fx.counts.created).toBe(1)
    expect(fx.item).toEqual({
      bound: true,
      minted: true,
      managed: ['alpha', 'beta', 'note'],
      linked: [],
    })
    expect(fx.state).toEqual({
      alpha: 'a1',
      beta: 'b1',
      note: 'n1',
      parent: null,
      marked: ['alpha', 'beta', 'note'],
    })
  })

  it('the writer takes its keys, the ordinary write takes the rest on the minted instance', async () => {
    newWorld(FX)
    const apply = vi.spyOn(world.fixture!.writer, 'apply')
    await sync(FX, [record(FX, 'r1', A1)])

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0]?.[2]).toEqual({
      instanceId: null,
      connectorId: 'dc1',
      values: { [FIXTURE_KEYS.alpha]: 'a1', [FIXTURE_KEYS.beta]: 'b1' },
      parents: {},
    })
    expect(world.crud.create).not.toHaveBeenCalled()
    expect(world.crud.update).toHaveBeenCalledWith('def_fx:fx-1', { 'f-note': 'n1' })
  })

  it('second sync hash-skips', async () => {
    const [fv, fx] = await both(async (arm) => {
      await sync(arm, [record(arm, 'r1', A1)])
      const apply = world.fixture ? vi.spyOn(world.fixture.writer, 'apply') : null
      const writesBefore = world.crud.create.mock.calls.length + world.crud.update.mock.calls.length
      const ctx = await sync(arm, [record(arm, 'r1', A1)])
      const writes =
        world.crud.create.mock.calls.length +
        world.crud.update.mock.calls.length -
        writesBefore +
        (arm.name === 'writer' ? apply!.mock.calls.length : 0)
      return { counts: counts(ctx), writes }
    })
    expect(fx).toEqual(fv)
    expect(fx).toEqual({
      counts: {
        created: 0,
        updated: 0,
        skipped: 1,
        failed: 0,
        archived: 0,
        relationshipWarnings: 0,
      },
      writes: 0,
    })
  })

  it('a hand edit drifts one key and the re-sync heals only that record', async () => {
    const [fv, fx] = await both(async (arm) => {
      await sync(arm, [record(arm, 'r1', A1), record(arm, 'r2', { ...A1, alpha: 'a2' })])
      const edited = instanceOf('r1')!
      if (arm.name === 'writer') world.fixture!.handEdit(edited, FIXTURE_KEYS.alpha, 'hand')
      else w.cells.get(edited)!.set('f-alpha', { value: 'hand', marker: null })
      const drifted = view(arm, edited)
      const ctx = await sync(arm, [
        record(arm, 'r1', A1),
        record(arm, 'r2', { ...A1, alpha: 'a2' }),
      ])
      return { drifted, counts: counts(ctx), healed: view(arm, edited) }
    })
    expect(fx).toEqual(fv)
    expect(fx.drifted).toMatchObject({ alpha: 'hand', marked: ['beta', 'note'] })
    expect(fx.counts).toMatchObject({ updated: 1, skipped: 1 })
    expect(fx.healed).toMatchObject({ alpha: 'a1', marked: ['alpha', 'beta', 'note'] })
  })

  it('a relationship write leaves marks alone, and an edge already in place is not rewritten', async () => {
    const [fv, fx] = await both(async (arm) => {
      const edge = { fieldKey: arm.parentKey, targetDef: 'def_parent', targetExternalId: 'P1' }
      w.items.set('m-parent::P1', {
        id: 'item-parent',
        mappingId: 'm-parent',
        externalId: 'P1',
        entityDefinitionId: 'def_parent',
        entityInstanceId: 'p-1',
        managedFields: [],
      })
      await sync(arm, [record(arm, 'r1', A1, [edge])])
      const before = view(arm, instanceOf('r1'))
      const first = await resolveRelationships(ctxFor())
      const after = view(arm, instanceOf('r1'))

      const item = [...w.items.values()].find((i) => i.externalId === 'r1') as Item
      item.pendingRelations = [edge]
      const apply = world.fixture ? vi.spyOn(world.fixture.writer, 'apply') : null
      const updatesBefore = world.crud.update.mock.calls.length
      const second = await resolveRelationships(ctxFor())
      const rewrites =
        world.crud.update.mock.calls.length - updatesBefore + (apply?.mock.calls.length ?? 0)
      return { before, first, after, second, rewrites, item: itemView('r1') }
    })
    expect(fx).toEqual(fv)
    expect(fx.after).toEqual({ ...fx.before, parent: 'p-1' })
    expect(fx.first).toEqual({ resolved: 1, stillPending: 0 })
    expect(fx.second).toEqual({ resolved: 1, stillPending: 0 })
    expect(fx.rewrites).toBe(0)
    expect(fx.item?.linked).toEqual(['parent'])
  })

  it('an unmapped key is cleared', async () => {
    const [fv, fx] = await both(async (arm) => {
      await sync(arm, [record(arm, 'r1', A1)])
      const ctx = ctxFor()
      await reconcileManagedMarkers(ctx, [
        { syncMode: 'snapshot', mappings: [mapping(arm, {}, ['alpha', 'note'])] },
      ])
      return view(arm, instanceOf('r1'))
    })
    expect(fx).toEqual(fv)
    expect(fx).toMatchObject({ beta: 'b1', marked: ['alpha', 'note'] })
  })

  it('orphan archive finds children', async () => {
    const [fv, fx] = await both(async (arm) => {
      const child = mapping(arm, {
        row: { id: 'm1' } as DecodedMapping['row'],
        parentMappingId: 'm-parent',
        rootPath: 'lines[]',
        orphanBehavior: 'archive',
      })
      const ctx = await sync(arm, [record(arm, 'C1', A1), record(arm, 'C2', A1)], child)
      const gone = w.items.get('m1::C2') as Item
      world.selectRows = [
        {
          id: gone.id,
          entityInstanceId: gone.entityInstanceId,
          entityDefinitionId: gone.entityDefinitionId,
          mintedInstance: true,
          removedUpstreamAt: null,
        },
      ]
      const set: ChildSet = {
        mapping: child,
        parentExternalId: 'P1',
        externalIds: ['C1'],
        root: { mappingId: 'm-parent', externalId: 'P1', upstreamUpdatedAt: null },
      }
      await replaceChildSets(ctx, [set])
      const archived = world.log
        .filter((e) => (e as unknown[])[0] === 'archive')
        .map((e) => (e as string[])[1] === toRecordId(arm.def, instanceOf('C2')!))
      return { archived, count: ctx.counters.archived }
    })
    expect(fx).toEqual(fv)
    expect(fx).toEqual({ archived: [true], count: 1 })
  })
})

describe('sink writer arms with no FieldValue analogue', () => {
  it('connector delete sweeps only its own marks', async () => {
    newWorld(FX)
    await sync(FX, [record(FX, 'r1', A1)])
    const row = world.fixture!.rows.get(instanceOf('r1')!)!
    row.connectorMarks[FIXTURE_KEYS.beta] = 'dc2'
    world.selectRows = [{ appInstallationId: null }]

    await finalizeConnectorTeardown(world.db, 'org1', 'user1', 'dc1', 'keep')

    expect(row.connectorMarks).toEqual({ [FIXTURE_KEYS.beta]: 'dc2' })
    expect(world.deleted).toBe(true)
  })

  it('a failed apply fails the record and binds nothing', async () => {
    newWorld(FX)
    world.fixture!.failNext('row write refused')
    const ctx = await sync(FX, [record(FX, 'r1', A1)])

    expect(counts(ctx)).toMatchObject({ failed: 1, created: 0 })
    expect(ctx.counters.errorSample[0]).toMatchObject({ error: 'row write refused' })
    expect(w.items.size).toBe(0)
    expect(world.crud.update).not.toHaveBeenCalled()
  })

  it('a failed ordinary write after a mint still binds the instance, unhashed', async () => {
    newWorld(FX)
    world.crud.update.mockRejectedValueOnce(new Error('note refused'))
    const ctx = await sync(FX, [record(FX, 'r1', A1)])

    expect(counts(ctx)).toMatchObject({ created: 1, failed: 1 })
    const item = w.items.get('m1::r1') as Item
    expect(item).toMatchObject({ entityInstanceId: 'fx-1', contentHash: '', mintedInstance: true })

    const retry = await sync(FX, [record(FX, 'r1', A1)])
    expect(counts(retry)).toMatchObject({ updated: 1, skipped: 0 })
    expect(view(FX, 'fx-1')).toMatchObject({ note: 'n1', marked: ['alpha', 'beta', 'note'] })
  })

  it('an ignored binding is not handed to the writer and is not managed', async () => {
    newWorld(FX)
    const apply = vi.spyOn(world.fixture!.writer, 'apply')
    const m = mapping(FX)
    m.fieldMappings[1]!.mergeStrategy = 'ignore'
    await sync(FX, [record(FX, 'r1', A1)], m)

    expect(apply.mock.calls[0]?.[2].values).toEqual({ [FIXTURE_KEYS.alpha]: 'a1' })
    expect(itemView('r1')?.managed).toEqual(['alpha', 'note'])
  })

  it('a relationship clear on a writer parent key nulls the column', async () => {
    newWorld(FX)
    await sync(FX, [record(FX, 'r1', A1)])
    const row = world.fixture!.rows.get(instanceOf('r1')!)!
    row.parent = 'p-1'
    const item = w.items.get('m1::r1') as Item
    item.linkedRelations = [FIXTURE_KEYS.parent]
    item.pendingRelations = [
      { fieldKey: FIXTURE_KEYS.parent, targetDef: null, targetExternalId: null },
    ]

    await resolveRelationships(ctxFor())

    expect(row.parent).toBeNull()
    expect(item.linkedRelations).toEqual([])
    expect(item.pendingRelations).toEqual([])
  })
})

describe('the no-writer path', () => {
  async function story(withWriter: boolean) {
    newWorld(FV, withWriter)
    const edge = { fieldKey: FV.parentKey, targetDef: 'def_parent', targetExternalId: 'P1' }
    w.items.set('m-parent::P1', {
      id: 'item-parent',
      mappingId: 'm-parent',
      externalId: 'P1',
      entityDefinitionId: 'def_parent',
      entityInstanceId: 'p-1',
      managedFields: [],
    })
    await sync(FV, [record(FV, 'r1', A1, [edge])])
    await sync(FV, [record(FV, 'r1', A1)])
    await resolveRelationships(ctxFor())
    await reconcileManagedMarkers(ctxFor(), [
      { syncMode: 'snapshot', mappings: [mapping(FV, {}, ['alpha'])] },
    ])
    return { log: world.log, items: clone([...w.items.values()]), cells: clone([...w.cells]) }
  }

  it('makes the same calls with a writer registered for another definition as with none', async () => {
    const none = await story(false)
    expect(w.entityDefLookups).toBe(0)
    const registered = await story(true)
    expect(registered).toEqual(none)
  })

  it('resolves no key of a definition to a writer it does not own', () => {
    newWorld(FV)
    expect(writerKeyOf(world.fixture!.writer, FV.ref('alpha'))).toBeUndefined()
    expect(writerKeyOf(world.fixture!.writer, `${FIXTURE_TYPE}:alpha`)).toBe(FIXTURE_KEYS.alpha)
  })
})

describe('sink writer parity: merge strategies and pins on writer keys', () => {
  function withAlpha(arm: Arm, strategy?: 'fill_blank' | 'connector_owned_only') {
    const m = mapping(arm)
    if (strategy) m.fieldMappings[0]!.mergeStrategy = strategy
    return m
  }

  /** A hand write of alpha: the value lands, the connector's mark goes. */
  function handAlpha(arm: Arm, instanceId: string, value: unknown) {
    if (arm.name === 'writer') return world.fixture!.handEdit(instanceId, FIXTURE_KEYS.alpha, value)
    if (value === null) w.cells.get(instanceId)!.delete('f-alpha')
    else w.cells.get(instanceId)!.set('f-alpha', { value, marker: null })
  }

  const snap = (arm: Arm, externalId: string) => ({
    state: view(arm, instanceOf(externalId)),
    item: itemView(externalId),
  })

  it('fill_blank writes over a blank and never over a value', async () => {
    const [fv, fx] = await both(async (arm) => {
      const m = withAlpha(arm, 'fill_blank')
      await sync(arm, [record(arm, 'r1', A1)], m)
      const first = snap(arm, 'r1')
      handAlpha(arm, instanceOf('r1')!, 'hand')
      await sync(arm, [record(arm, 'r1', { ...A1, alpha: 'a2' })], m)
      const kept = snap(arm, 'r1')
      handAlpha(arm, instanceOf('r1')!, null)
      await sync(arm, [record(arm, 'r1', { ...A1, alpha: 'a3' })], m)
      return { first, kept, refilled: snap(arm, 'r1') }
    })
    expect(fx).toEqual(fv)
    expect(fx.first.state).toMatchObject({ alpha: 'a1', marked: ['alpha', 'beta', 'note'] })
    expect(fx.kept.state).toMatchObject({ alpha: 'hand', marked: ['beta', 'note'] })
    expect(fx.refilled.state).toMatchObject({ alpha: 'a3', marked: ['alpha', 'beta', 'note'] })
  })

  it('connector_owned_only overwrites what the item manages, else only fills a blank', async () => {
    const [fv, fx] = await both(async (arm) => {
      const m = withAlpha(arm, 'connector_owned_only')
      await sync(arm, [record(arm, 'u1', { ...A1, alpha: null }), record(arm, 'm1', A1)], m)
      handAlpha(arm, instanceOf('u1')!, 'hand')
      handAlpha(arm, instanceOf('m1')!, 'hand')
      const ctx = await sync(
        arm,
        [record(arm, 'u1', { ...A1, alpha: 'a2' }), record(arm, 'm1', { ...A1, alpha: 'a2' })],
        m
      )
      return { counts: counts(ctx), unmanaged: snap(arm, 'u1'), managed: snap(arm, 'm1') }
    })
    expect(fx).toEqual(fv)
    expect(fx.unmanaged.state).toMatchObject({ alpha: 'hand' })
    expect(fx.unmanaged.item?.managed).toEqual(['beta', 'note'])
    expect(fx.managed.state).toMatchObject({ alpha: 'a2', marked: ['alpha', 'beta', 'note'] })
  })

  it('a pinned key is neither written nor drifted, and stays managed', async () => {
    const [fv, fx] = await both(async (arm) => {
      await sync(arm, [record(arm, 'r1', A1)])
      const item = w.items.get('m1::r1') as Item
      item.pinnedFields = [arm.name === 'writer' ? FIXTURE_KEYS.alpha : 'f-alpha']
      await sync(arm, [record(arm, 'r1', { ...A1, alpha: 'a2' })])
      const pinned = snap(arm, 'r1')
      handAlpha(arm, instanceOf('r1')!, 'hand')
      const ctx = await sync(arm, [record(arm, 'r1', { ...A1, alpha: 'a2' })])
      return { pinned, counts: counts(ctx), after: snap(arm, 'r1') }
    })
    expect(fx).toEqual(fv)
    expect(fx.pinned.state).toMatchObject({ alpha: 'a1' })
    expect(fx.pinned.item?.managed).toEqual(['alpha', 'beta', 'note'])
    expect(fx.counts).toMatchObject({ skipped: 1, updated: 0 })
    expect(fx.after.state).toMatchObject({ alpha: 'hand' })
  })
})

describe('fan-out onto a writer parent key once the parent has_many is gone', () => {
  it('the child gets its parent through apply({ parents })', async () => {
    newWorld(FX)
    const { sinkSourceRecord } = await import('../sink-source-record')
    const order = mapping(FX, {
      row: { id: 'm-order' } as DecodedMapping['row'],
      entityDefinitionId: 'def_parent',
      fieldMappings: [],
    })
    const lines = mapping(FX, {
      rootPath: 'lines[]',
      parentMappingId: 'm-order',
      relationshipFieldKey: 'def_parent:gone_line_items',
      fieldMappings: [
        {
          id: 'fm-alpha',
          targetFieldRef: 'def_fx:alpha' as ResourceFieldId,
          expression: '{a}',
          sourceFields: { a: 'a' },
        },
      ] as DecodedMapping['fieldMappings'],
    })
    const ctx = ctxFor()
    await sinkSourceRecord(ctx, [order, lines], {
      streamKey: 'orders',
      externalId: 'o1',
      fields: { id: 'o1', lines: [{ a: 'x' }] },
    })
    const line = itemList().find((i) => i.mappingId === 'm1')!
    expect(line.pendingRelations).toEqual([
      { fieldKey: FIXTURE_KEYS.parent, targetDef: 'def_parent', targetExternalId: 'o1' },
    ])

    const apply = vi.spyOn(world.fixture!.writer, 'apply')
    await resolveRelationships(ctxFor())
    const orderInstance = itemList().find((i) => i.mappingId === 'm-order')!.entityInstanceId
    expect(apply).toHaveBeenCalledWith(world.db, 'org1', {
      instanceId: line.entityInstanceId,
      connectorId: 'dc1',
      values: {},
      parents: { [FIXTURE_KEYS.parent]: orderInstance },
    })
    expect(world.fixture!.rows.get(line.entityInstanceId!)?.parent).toBe(orderInstance)
  })
})

describe('scale', () => {
  it('clears unmapped marks in chunks of 1000 instances', async () => {
    newWorld(FX)
    for (let i = 0; i < 2500; i++) {
      w.items.set(`m1::x${i}`, {
        id: `i${i}`,
        mappingId: 'm1',
        externalId: `x${i}`,
        entityInstanceId: `fx-${i}`,
        managedFields: [],
      })
    }
    const clear = vi.spyOn(world.fixture!.writer, 'clearMarks')
    await reconcileManagedMarkers(ctxFor(), [
      { syncMode: 'snapshot', mappings: [mapping(FX, {}, ['alpha', 'note'])] },
    ])
    expect(clear.mock.calls.map((c) => c[2].length)).toEqual([1000, 1000, 500])
  })

  it('writer drift reads the marks of the record in hand, not the whole mapping', async () => {
    newWorld(FX)
    await sync(FX, [record(FX, 'r1', A1), record(FX, 'r2', A1), record(FX, 'r3', A1)])
    const read = vi.spyOn(world.fixture!.writer, 'readMarks')
    await sync(FX, [record(FX, 'r2', A1)])
    expect(read.mock.calls.map((c) => c[2])).toEqual([[instanceOf('r2')]])
  })
})
