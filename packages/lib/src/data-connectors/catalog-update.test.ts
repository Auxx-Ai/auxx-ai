// packages/lib/src/data-connectors/catalog-update.test.ts
// The read + apply behind "Update available" (task 41 section 7) over a stubbed db and
// cache: `computeConnectorCatalogUpdate` derives both catalogs and diffs the persisted
// rows; `applyConnectorCatalogUpdate` walks the accepted entries through the injected
// writers (the real ones own the `resyncPending` stamping, covered by their own tests),
// writes the new hashes, moves `catalogDeploymentId`, and keep-mine leaves a conflicted
// binding untouched. A second read after apply reports `available: false`.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCachedCustomFields, getCachedEntityDefId, getOrgCache } from '../cache'
import {
  catalogFixtureV1,
  catalogFixtureV2,
  FIXTURE_DEF_FIELDS,
  FIXTURE_DEF_IDS,
  fixtureResolver,
  persistedRowsFromDerived,
} from './__test-helpers'
import { deriveConnectorShape } from './catalog-shape'
import { applyConnectorCatalogUpdate, type CatalogUpdateWriters } from './catalog-update'
import { computeConnectorCatalogUpdate, getConnectorCatalogUpdate } from './catalog-update-queries'
import type { DataConnectorRow, StreamWithRawMappings } from './service'

vi.mock('../cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cache')>()
  return {
    ...actual,
    getCachedEntityDefId: vi.fn(),
    getCachedCustomFields: vi.fn(),
    getOrgCache: vi.fn(),
  }
})

const ORG = 'org1'
const DC = 'dc1'
const OLD = 'dep_old'
const NEW = 'dep_new'

interface Recorded {
  table: unknown
  values: Record<string, unknown>
}

/**
 * Just enough drizzle for the read path (`db.query.*.findFirst/findMany`) plus a
 * recorder for `db.update(table).set(values).where()`. Rows are the fabricated
 * `listStreams` output split back into stream + mapping rows.
 */
function buildDb(state: { connector: DataConnectorRow; streams: StreamWithRawMappings[] }) {
  const updates: Recorded[] = []
  const db = {
    query: {
      DataConnector: { findFirst: vi.fn(async () => state.connector) },
      AppInstallation: {
        findFirst: vi.fn(async () => ({
          id: 'inst1',
          currentDeploymentId: NEW,
          uninstalledAt: null,
        })),
      },
      AppDeployment: {
        findMany: vi.fn(async () => [
          {
            id: OLD,
            version: '1.0.0',
            deploymentType: 'production',
            createdAt: new Date('2026-08-01'),
            catalog: { dataConnectors: [catalogFixtureV1()], entities: [] },
          },
          {
            id: NEW,
            version: '1.1.0',
            deploymentType: 'production',
            createdAt: new Date('2026-09-01'),
            catalog: { dataConnectors: [catalogFixtureV2()], entities: [] },
          },
        ]),
      },
      DataConnectorStream: {
        findMany: vi.fn(async () => state.streams.map(({ mappings: _m, ...s }) => s)),
      },
      DataConnectorMapping: {
        findMany: vi.fn(async () => state.streams.flatMap((s) => s.mappings)),
      },
      EntityDefinition: { findMany: vi.fn(async () => []) },
    },
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ table, values })
        },
      }),
    })),
  }
  return { db: db as unknown as Database, updates }
}

function connectorRow(over: Partial<DataConnectorRow> = {}): DataConnectorRow {
  return {
    id: DC,
    organizationId: ORG,
    type: 'app:shopify',
    definitionKind: 'app',
    appInstallationId: 'inst1',
    catalogDeploymentId: OLD,
    lastSyncedAt: new Date('2026-08-15'),
    resyncPending: null,
    ...over,
  } as DataConnectorRow
}

function writers(): CatalogUpdateWriters {
  return {
    addStream: vi.fn(async () => ({ id: 's_new' })) as unknown as CatalogUpdateWriters['addStream'],
    persistStreamShape: vi.fn(async () => new Map<string, string>()),
    setStreamRequestConfig: vi.fn(
      async () => ({})
    ) as unknown as CatalogUpdateWriters['setStreamRequestConfig'],
    setStreamSchema: vi.fn(async () => ({})) as unknown as CatalogUpdateWriters['setStreamSchema'],
    updateMapping: vi.fn(async () => ({})) as unknown as CatalogUpdateWriters['updateMapping'],
    removeMapping: vi.fn(async () => ({ success: true })),
    removeStream: vi.fn(async () => ({ success: true })),
    stampResyncPending: vi.fn(async () => undefined),
    countConnectorItems: vi.fn(async () => 0),
  }
}

beforeEach(() => {
  vi.mocked(getCachedEntityDefId).mockImplementation(async (_org, kind) => FIXTURE_DEF_IDS[kind])
  vi.mocked(getCachedCustomFields).mockImplementation(
    async (_org, defId) => (FIXTURE_DEF_FIELDS[defId] ?? []) as never
  )
  vi.mocked(getOrgCache).mockReturnValue({
    get: async (_org: string, key: string) => (key === 'entityDefs' ? FIXTURE_DEF_IDS : {}),
  } as never)
})

function seededState() {
  const derivedOld = deriveConnectorShape(catalogFixtureV1(), [], 'shopify', fixtureResolver())
  return { connector: connectorRow(), streams: persistedRowsFromDerived(derivedOld) }
}

describe('getConnectorCatalogUpdate', () => {
  it('reports the update with both versions and the diff entries', async () => {
    const { db } = buildDb(seededState())
    const result = await getConnectorCatalogUpdate(db, ORG, DC)
    expect(result.isOk()).toBe(true)
    const update = result._unsafeUnwrap()
    expect(update.available).toBe(true)
    expect(update.from?.version).toBe('1.0.0')
    expect(update.to?.version).toBe('1.1.0')
    expect(update.entries.some((e) => e.change.kind === 'stream' && e.change.op === 'add')).toBe(
      true
    )
    expect(
      update.entries.find((e) => e.change.kind === 'binding' && e.change.targetLabel === 'part_sku')
        ?.impact.level
    ).toBe('rebind')
  })

  it('is not available once the connector tracks the current deployment', async () => {
    const state = seededState()
    state.connector = connectorRow({ catalogDeploymentId: NEW })
    const { db } = buildDb(state)
    const update = (await getConnectorCatalogUpdate(db, ORG, DC))._unsafeUnwrap()
    expect(update.available).toBe(false)
    expect(update.entries).toEqual([])
  })

  it('is a NotFoundError for an unknown connector', async () => {
    const state = seededState()
    const { db } = buildDb(state)
    vi.mocked(db.query.DataConnector.findFirst).mockResolvedValueOnce(undefined as never)
    const result = await getConnectorCatalogUpdate(db, ORG, 'nope')
    expect(result.isErr()).toBe(true)
  })
})

describe('applyConnectorCatalogUpdate', () => {
  it('walks the accepted entries through the writers, stamps hashes and moves the pointer', async () => {
    const state = seededState()
    const { db, updates } = buildDb(state)
    const computed = (await computeConnectorCatalogUpdate(db, ORG, DC))._unsafeUnwrap()
    const w = writers()

    const result = await applyConnectorCatalogUpdate(
      db,
      ORG,
      DC,
      { entryIds: computed.entries.map((e) => e.id) },
      w
    )
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().catalogDeploymentId).toBe(NEW)

    // The new stream is created with its hash and its mappings persisted.
    expect(w.addStream).toHaveBeenCalledWith(
      db,
      ORG,
      DC,
      expect.objectContaining({ streamKey: 'fulfillment', catalogHash: expect.any(String) })
    )
    expect(w.persistStreamShape).toHaveBeenCalledWith(
      db,
      ORG,
      's_new',
      expect.objectContaining({ key: 'fulfillment' })
    )

    // The customer stream flips to incremental through the request-config mutation.
    expect(w.setStreamRequestConfig).toHaveBeenCalledWith(
      db,
      ORG,
      's_customer',
      expect.objectContaining({ syncMode: 'incremental' })
    )

    // One updateMapping per touched row, carrying the merged field mappings: the SKU
    // binding now an exclusive match (the real mutation classifies this as a rebind and
    // stamps resyncPending), the title fill_blank, and the contact gains notes / loses phone.
    const partRow = state.streams[0]!.mappings.find((m) => m.entityDefinitionId === 'def_part')!
    const partCall = vi
      .mocked(w.updateMapping)
      .mock.calls.find(([, , mappingId]) => mappingId === partRow.id)
    expect(partCall).toBeDefined()
    const partPatch = partCall![3]
    const sku = partPatch.fieldMappings?.find((fm) => fm.targetFieldRef?.endsWith('f_sku'))
    expect(sku?.identityRole).toEqual({ kind: 'match', normalize: 'none', exclusive: true })
    // The persisted entry id is kept on a changed binding.
    expect(sku?.id).toBe(
      partRow.fieldMappings.find((fm) => fm.targetFieldRef?.endsWith('f_sku'))!.id
    )
    expect(
      partPatch.fieldMappings?.find((fm) => fm.targetFieldRef?.endsWith('f_title'))?.mergeStrategy
    ).toBe('fill_blank')

    const contactRow = state.streams[1]!.mappings[0]!
    const contactPatch = vi
      .mocked(w.updateMapping)
      .mock.calls.find(([, , mappingId]) => mappingId === contactRow.id)![3]
    expect(contactPatch.fieldMappings?.some((fm) => fm.targetFieldRef?.endsWith('f_notes'))).toBe(
      true
    )
    expect(contactPatch.fieldMappings?.some((fm) => fm.targetFieldRef?.endsWith('f_phone'))).toBe(
      false
    )

    // Hashes stamped on every matched stream + mapping row (the new stream once more
    // after its creation), then the pointer moved.
    const streamStamps = updates.filter((u) => u.table === schema.DataConnectorStream)
    const mappingStamps = updates.filter((u) => u.table === schema.DataConnectorMapping)
    expect(streamStamps.length).toBe(3)
    expect(mappingStamps.length).toBe(4)
    expect(mappingStamps.every((u) => typeof u.values.catalogHash === 'string')).toBe(true)
    const pointer = updates.find((u) => u.table === schema.DataConnector)
    expect(pointer?.values.catalogDeploymentId).toBe(NEW)
  })

  it('keep-mine leaves the conflicted binding untouched', async () => {
    const state = seededState()
    const contactRow = state.streams[1]!.mappings[0]!
    const first = contactRow.fieldMappings.find((fm) => fm.targetFieldRef?.endsWith('f_first'))!
    first.mergeStrategy = 'overwrite' // hand edit; v2 wants connector_owned_only
    const { db } = buildDb(state)
    const computed = (await computeConnectorCatalogUpdate(db, ORG, DC))._unsafeUnwrap()
    const conflict = computed.entries.find(
      (e) => e.change.kind === 'binding' && e.change.targetLabel === 'first_name'
    )
    expect(conflict?.conflict).toBe(true)

    const w = writers()
    // The client omits a conflict the merchant keeps.
    const entryIds = computed.entries.filter((e) => !e.conflict).map((e) => e.id)
    await applyConnectorCatalogUpdate(db, ORG, DC, { entryIds }, w)
    const contactPatch = vi
      .mocked(w.updateMapping)
      .mock.calls.find(([, , mappingId]) => mappingId === contactRow.id)![3]
    expect(
      contactPatch.fieldMappings?.find((fm) => fm.targetFieldRef?.endsWith('f_first'))
        ?.mergeStrategy
    ).toBe('overwrite')
  })

  it('rejects an unknown entry id', async () => {
    const { db } = buildDb(seededState())
    const result = await applyConnectorCatalogUpdate(db, ORG, DC, { entryIds: ['nope'] }, writers())
    expect(result.isErr()).toBe(true)
  })

  it('a second read after apply reports no update', async () => {
    const state = seededState()
    const { db } = buildDb(state)
    const computed = (await computeConnectorCatalogUpdate(db, ORG, DC))._unsafeUnwrap()
    await applyConnectorCatalogUpdate(
      db,
      ORG,
      DC,
      { entryIds: computed.entries.map((e) => e.id) },
      writers()
    )
    // The stubbed db does not persist the pointer write; mirror it.
    state.connector = connectorRow({ catalogDeploymentId: NEW })
    const again = (await getConnectorCatalogUpdate(db, ORG, DC))._unsafeUnwrap()
    expect(again.available).toBe(false)
  })
})
