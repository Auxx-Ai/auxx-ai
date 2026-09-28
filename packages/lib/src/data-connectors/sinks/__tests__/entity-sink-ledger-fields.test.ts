// packages/lib/src/data-connectors/sinks/__tests__/entity-sink-ledger-fields.test.ts
// Brief 114 P1: once the payout sync adopts a connector's payout record and writes its ledger
// fields (`payout_gateway_id`, `payout_status`, ...), the connector's re-sync must leave them
// alone. The sink writes only the refs the mapping projected. Mock recipe from entity-sink-pin.

import { toResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../../__test-helpers'
import type { DecodedMapping } from '../../service'
import type { ProjectedRecord, SyncCtx } from '../types'

const findItem = vi.fn()
const findItemByDef = vi.fn()
const touchItem = vi.fn()
const upsertItem = vi.fn()
vi.mock('../../service', () => ({
  findItem: (...a: unknown[]) => findItem(...a),
  findItemByDef: (...a: unknown[]) => findItemByDef(...a),
  touchItem: (...a: unknown[]) => touchItem(...a),
  upsertItem: (...a: unknown[]) => upsertItem(...a),
  listItemsForMapping: vi.fn(),
  markItemArchived: vi.fn(),
  setItemPendingRelations: vi.fn(),
}))

const resolveConnectorFieldRef = vi.fn()
vi.mock('../../../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: (...a: unknown[]) => resolveConnectorFieldRef(...a),
}))
const buildWriteKeyToFieldId = vi.fn()
vi.mock('../../field-id-resolver', () => ({
  buildWriteKeyToFieldId: (...a: unknown[]) => buildWriteKeyToFieldId(...a),
}))

const getCachedFieldMap = vi.fn()
const getCachedResource = vi.fn()
vi.mock('../../../cache', () => ({
  getCachedFieldMap: (...a: unknown[]) => getCachedFieldMap(...a),
  getCachedResource: (...a: unknown[]) => getCachedResource(...a),
}))

vi.mock('../../../identity', () => ({
  upsertRecordIdentity: vi.fn(),
  findRecordByIdentity: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../../field-values/field-value-helpers', () => ({
  createFieldValueContext: vi.fn(() => ({})),
  validateAndConvertValue: vi.fn(async (_ctx: unknown, value: unknown) => ({
    type: 'text',
    value: String(value).trim().toLowerCase(),
  })),
  maybeUpdateDisplayValue: vi.fn(),
}))
vi.mock('../../../field-values/field-value-mutations', () => ({
  // The planner reads the value column off the built row to compare and to write.
  buildFieldValueRow: (params: { value: { value: string } } & Record<string, unknown>) => ({
    ...params,
    valueText: params.value.value,
  }),
}))
vi.mock('../../../field-values/search-text', () => ({ updateSearchText: vi.fn() }))
vi.mock('../../../custom-fields/check-unique-value-typed', () => ({
  checkUniqueValueTyped: vi.fn(async () => true),
}))

import { entitySink } from '../entity-sink'

const DEF_ID = 'def_payout'
const EVIDENCE = ['payout_source_external_id', 'payout_source_status', 'payout_source_amount']
const LEDGER = ['payout_gateway_id', 'payout_status', 'payout_paid_at', 'payout_payment_gateway']

function mapping(targetMode: 'owned' | 'contributing'): DecodedMapping {
  return {
    row: { id: 'm_payout' },
    rootPath: '',
    linkMode: 'upsert',
    targetMode,
    entityDefinitionId: DEF_ID,
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    fieldMappings: EVIDENCE.map((attribute, i) => ({
      id: `fm${i}`,
      targetFieldRef: toResourceFieldId(DEF_ID, attribute),
      expression: `{${attribute}}`,
      sourceFields: {},
    })),
  } as unknown as DecodedMapping
}

const RECORD: ProjectedRecord = {
  externalId: 'po_9',
  displayName: 'po_9',
  fields: {
    [toResourceFieldId(DEF_ID, 'payout_source_external_id')]: 'po_9',
    [toResourceFieldId(DEF_ID, 'payout_source_status')]: 'paid',
    [toResourceFieldId(DEF_ID, 'payout_source_amount')]: '97.00',
  },
  identityCandidates: [],
  pendingRelations: [],
}

const create = vi.fn()
const update = vi.fn()
const getFieldValues = vi.fn()

function makeCtx(db: unknown): SyncCtx {
  return makeSyncCtx({
    db: db as never,
    crud: { update, create, getFieldValues } as never,
    ownedCrud: { update, create, getFieldValues } as never,
  })
}

const db = {
  query: { DataConnectorItem: { findFirst: vi.fn(async () => null) } },
  select: vi.fn(),
  selectDistinct: vi.fn(),
  update: vi.fn(() => ({ set: () => ({ where: async () => {} }) })),
  execute: vi.fn(async () => ({ rows: [] })),
}

beforeEach(() => {
  vi.clearAllMocks()
  // Bound to the adopted record; the ledger fields on it were written by the payout sync.
  findItem.mockResolvedValue({
    id: 'item1',
    entityInstanceId: 'inst_conn',
    contentHash: 'stale',
    pendingRelations: [],
    managedFields: Object.keys(RECORD.fields),
    pinnedFields: [],
  })
  findItemByDef.mockResolvedValue(null)
  update.mockResolvedValue(undefined)
  getFieldValues.mockResolvedValue(new Map())
  resolveConnectorFieldRef.mockImplementation(async (ref: string) => ref)
  const every = [...EVIDENCE, ...LEDGER]
  buildWriteKeyToFieldId.mockResolvedValue(new Map(every.map((a) => [a, `uuid_${a}`])))
  getCachedFieldMap.mockResolvedValue(
    new Map(
      every.map((a) => [
        `uuid_${a}`,
        { id: `uuid_${a}`, type: 'TEXT', systemAttribute: a, options: {}, isUnique: false },
      ])
    )
  )
  getCachedResource.mockResolvedValue(null)
})

describe('a connector re-sync of an adopted payout record', () => {
  it.each([
    'owned',
    'contributing',
  ] as const)('(%s) writes only its mapped evidence fields, never the ledger fields', async (targetMode) => {
    await entitySink.upsertRecord(makeCtx(db), mapping(targetMode), RECORD)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[0]).toBe(`${DEF_ID}:inst_conn`)
    const written = update.mock.calls[0]?.[1] as Record<string, unknown>
    expect(written).toEqual({
      payout_source_external_id: 'po_9',
      payout_source_status: 'paid',
      payout_source_amount: '97.00',
    })
    for (const attribute of LEDGER) expect(written).not.toHaveProperty(attribute)
  })
})
