// packages/lib/src/data-connectors/__tests__/sink-writer-catalog.test.ts
// The writer seam outside the sink (plans/entity/domain-tables/02-sink-writer.md §2-3): key
// resolution, the catalog resolving a target to a writer key before a field, and the child
// fan-out flipping an inverse onto a writer parent key.

import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceField } from '../../resources'
import type { ContributingTargetField } from '../app-catalog'
import type { ConnectorRecord } from '../connectors/types'
import type { DecodedMapping } from '../service'
import type { ProjectedRecord, SyncCtx } from '../sinks/types'
import {
  FIXTURE_KEYS,
  FIXTURE_PARENT_TYPE,
  FIXTURE_TYPE,
  registerSinkFixture,
  unregisterSinkFixture,
} from './support/sink-fixture-writer'

const h = vi.hoisted(() => ({
  upsertRecord: vi.fn<(ctx: unknown, m: unknown, r: ProjectedRecord) => Promise<void>>(),
  fieldsByDef: {} as Record<string, unknown[]>,
  defLookups: 0,
}))
vi.mock('../sinks/entity-sink', () => ({ entitySink: { upsertRecord: h.upsertRecord } }))
vi.mock('../reconciliation', () => ({ archiveExternalId: vi.fn() }))
vi.mock('../../cache', () => ({
  getCachedResourceFields: async (_org: string, defId: string) => h.fieldsByDef[defId] ?? [],
  getCachedEntityDefId: async (_org: string, type: string) => {
    h.defLookups += 1
    return type === '__sink_fixture' ? 'def_fx' : undefined
  },
}))

import { buildContributingFieldBindings } from '../app-catalog'
import { newRecordFailureTally } from '../record-failure-tally'
import { newRunCounters } from '../service'
import { sinkSourceRecord } from '../sink-source-record'
import {
  sinkWriterFor,
  sinkWriterForDef,
  writerKeyField,
  writerKeyForTarget,
  writerKeyOf,
} from '../sinks/writers'

beforeEach(() => {
  unregisterSinkFixture()
  h.defLookups = 0
  h.upsertRecord.mockReset().mockResolvedValue(undefined)
  for (const k of Object.keys(h.fieldsByDef)) delete h.fieldsByDef[k]
})

describe('writer key resolution', () => {
  it('reads nothing from the cache while no writer is registered', async () => {
    expect(await sinkWriterForDef('org1', 'def_fx')).toBeUndefined()
    expect(h.defLookups).toBe(0)
  })

  it('finds the writer behind a definition id', async () => {
    const { writer } = registerSinkFixture()
    expect(sinkWriterFor(FIXTURE_TYPE)).toBe(writer)
    expect(await sinkWriterForDef('org1', 'def_fx')).toBe(writer)
    expect(await sinkWriterForDef('org1', 'def_other')).toBeUndefined()
  })

  it('maps a def-qualified ref, a bare field and a key onto the key', () => {
    const { writer } = registerSinkFixture()
    expect(writerKeyOf(writer, 'def_fx:alpha')).toBe(FIXTURE_KEYS.alpha)
    expect(writerKeyOf(writer, 'alpha')).toBe(FIXTURE_KEYS.alpha)
    expect(writerKeyOf(writer, FIXTURE_KEYS.parent)).toBe(FIXTURE_KEYS.parent)
    expect(writerKeyOf(writer, 'def_fx:f-note')).toBeUndefined()
    expect(writerKeyOf(writer, 'def_fx:@app:shopify:alpha')).toBeUndefined()
    expect(writerKeyField(FIXTURE_KEYS.beta)).toBe('beta')
  })

  it('resolves a catalog target by the systemAttribute convention', () => {
    const { writer } = registerSinkFixture()
    expect(writerKeyForTarget(writer, '__sink_fixture_beta')).toBe(FIXTURE_KEYS.beta)
    expect(writerKeyForTarget(writer, 'beta')).toBe(FIXTURE_KEYS.beta)
    expect(writerKeyForTarget(writer, 'gamma')).toBeUndefined()
  })
})

describe('catalog: a target resolves to a writer key before a registry field', () => {
  // A registry field named like a writer key, read-only, as the lines' totals are today.
  const defFields: ContributingTargetField[] = [
    {
      id: 'cf_alpha',
      name: 'Alpha',
      systemAttribute: '__sink_fixture_alpha',
      type: 'TEXT',
      isCreatable: false,
      isUpdatable: false,
    },
    { id: 'cf_note', name: 'Note', systemAttribute: 'note', type: 'TEXT' },
  ]
  const fields = [
    { sourcePath: 'a', target: '__sink_fixture_alpha' },
    { sourcePath: 'n', target: 'note' },
    { constant: 'fixed', target: 'beta' },
  ]

  it('binds writer keys as `<defId>:<field>` and the rest to their fields', () => {
    const { writer } = registerSinkFixture()
    const bindings = buildContributingFieldBindings('def_fx', 'app', fields, defFields, writer)
    expect(bindings.map((b) => b.targetFieldRef)).toEqual([
      'def_fx:alpha',
      'def_fx:cf_note',
      'def_fx:beta',
    ])
    expect(bindings[2]?.expression).toBe('"fixed"')
  })

  it('without a writer the same catalog binds registry fields, refusing the read-only one', () => {
    expect(() => buildContributingFieldBindings('def_fx', 'app', fields, defFields)).toThrow(
      /read-only or computed/
    )
    const bindings = buildContributingFieldBindings('def_fx', 'app', fields.slice(1, 2), defFields)
    expect(bindings.map((b) => b.targetFieldRef)).toEqual(['def_fx:cf_note'])
  })
})

describe('child fan-out: the flipped inverse lands on a writer parent key', () => {
  const ctx = {
    orgId: 'org1',
    connector: { id: 'dc1' },
    counters: newRunCounters(),
    failureTally: newRecordFailureTally(),
  } as unknown as SyncCtx

  const mapping = (over: Partial<DecodedMapping>): DecodedMapping =>
    ({
      rootPath: '',
      linkMode: 'upsert',
      targetMode: 'owned',
      parentMappingId: null,
      relationshipFieldKey: null,
      orphanBehavior: 'ignore',
      fieldMappings: [],
      ...over,
    }) as DecodedMapping

  async function childEdges(inverse: string) {
    h.fieldsByDef.orderDef = [
      {
        id: toFieldId('cf_lines'),
        key: 'lines',
        label: 'Lines',
        type: 'object',
        fieldType: 'RELATIONSHIP',
        capabilities: {},
        resourceFieldId: toResourceFieldId('orderDef', 'cf_lines'),
        relationship: { relationshipType: 'has_many', inverseResourceFieldId: inverse },
      } as unknown as ResourceField,
    ]
    const order = mapping({ row: { id: 'om' } as never, entityDefinitionId: 'orderDef' })
    const lines = mapping({
      row: { id: 'lm' } as never,
      rootPath: 'lines[]',
      entityDefinitionId: 'def_fx',
      parentMappingId: 'om',
      relationshipFieldKey: 'orderDef:cf_lines',
    })
    const source: ConnectorRecord = {
      streamKey: 'order',
      externalId: 'o1',
      fields: { id: 'o1', lines: [{ x: 1 }] },
    }
    await sinkSourceRecord(ctx, [order, lines], source)
    const child = h.upsertRecord.mock.calls.map(([, , r]) => r).find((r) => r.externalId !== 'o1')
    return child?.pendingRelations
  }

  it('takes the writer key when the child def has a writer that owns the inverse', async () => {
    registerSinkFixture()
    expect(await childEdges(FIXTURE_KEYS.parent)).toEqual([
      { fieldKey: FIXTURE_KEYS.parent, targetDef: 'orderDef', targetExternalId: 'o1' },
    ])
  })

  it('keeps the field id for an inverse the writer does not own', async () => {
    registerSinkFixture()
    expect(await childEdges('def_fx:cf_order')).toEqual([
      { fieldKey: 'cf_order', targetDef: 'orderDef', targetExternalId: 'o1' },
    ])
  })
})

describe('catalog: a system relationship key whose field is gone', () => {
  it('keeps the edge when the child writer holds a parent key for the parent', async () => {
    const { resolveRelationshipFieldKeyFromFields } = await import('../catalog-shape')
    const { writer } = registerSinkFixture()
    const key = 'system:gone_line_items'
    expect(
      resolveRelationshipFieldKeyFromFields(key, 'app', FIXTURE_PARENT_TYPE, 'def_p', [], writer)
    ).toBe('def_p:gone_line_items')
    expect(
      resolveRelationshipFieldKeyFromFields(key, 'app', 'other', 'def_p', [], writer)
    ).toBeNull()
    expect(
      resolveRelationshipFieldKeyFromFields(key, 'app', FIXTURE_PARENT_TYPE, 'def_p', [])
    ).toBeNull()
  })
})
