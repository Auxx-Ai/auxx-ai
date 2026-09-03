// packages/lib/src/resources/crud/__tests__/sync-supplied-record-number.test.ts
//
// "Theirs if they bring one, otherwise ours" (plans/money/tasks/39 section 6.5),
// proven through `createEntity` rather than the hook alone: a sync-origin create
// that carries `order_number` reaches the numbering hook with the value intact
// (the write guard, `applyDefaults` and the required-field check all leave it
// alone), the hook keeps it, and the write lands with no RecordSequence
// allocation. The same create with no number still allocates.
//
// Mutation-seam mocks mirror field-write-guard.test.ts.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  publish: vi.fn(async () => {}),
  publishLater: vi.fn(() => {}),
  findCachedResource: vi.fn(),
  allocate: vi.fn(),
}))

vi.mock('../../../dedup/pairs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteOpenPairsForRecord: vi.fn(async () => ok(0)),
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
}))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: vi.fn(async () => ok({ id: 'inst_1', archivedAt: null })),
  getEntityInstanceRow: vi.fn(async () => ({ id: 'inst_1', archivedAt: null })),
  updateEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  createEntityInstance: h.createEntityInstance,
  deleteEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
}))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  publishRecordsChanged: vi.fn(async () => {}),
  rooms: { orgRecords: () => 'room' },
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCachedResource: h.findCachedResource,
}))
vi.mock('../../../comments', () => ({
  CommentService: class {
    deleteCommentsByRecordId = vi.fn(async () => {})
  },
}))
vi.mock('../../../records/record-numbering', () => ({
  recordNumbering: { create: h.allocate },
}))

import { createManifestCollector } from '../../../record-rules/sync-manifest-collector'
import { ORDER_HOOKS } from '../../hooks/order-hooks'
import type { SystemHookContext } from '../../hooks/types'
import type { ResourceField } from '../../registry/field-types'
import { createEntity, type MutationContext } from '../unified-handler-mutations'
import type { WriteSession } from '../write-origin'

const ORDER_NUMBER_FIELD_ID = 'f_order_number'

function syncSession(): WriteSession {
  return {
    origin: {
      kind: 'sync',
      source: 'connector',
      ref: 'run_1',
      collector: createManifestCollector({}),
    },
    depth: 0,
  }
}

/** The platform's own `order_number`: hook-owned, so neither creatable nor updatable. */
function orderNumberField(): ResourceField {
  return {
    id: ORDER_NUMBER_FIELD_ID,
    label: 'Order Number',
    key: 'order_number',
    systemAttribute: 'order_number',
    type: 'string',
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  } as ResourceField
}

/** A typed `setFieldValues` stand-in that records the values map of every write. */
function setFieldValuesSpy() {
  const writes: Record<string, unknown>[] = []
  const fn: MutationContext['setFieldValues'] = async (_recordId, values) => {
    writes.push(values)
    return { failures: [], changed: true, changes: [], instance: null }
  }
  return { fn, writes }
}

function ctx(setFieldValues: MutationContext['setFieldValues']): MutationContext {
  return {
    db: {} as never,
    organizationId: 'org_1',
    userId: 'user_1',
    session: syncSession(),
    fieldValueService: {} as never,
    resolveEntityDefinition: async () => ({ id: 'def_1', entityType: 'order', apiSlug: 'orders' }),
    getFields: async () => [],
    // The real order hook, fed the way `UnifiedCrudHandler.runPreHooks` feeds it.
    runPreHooks: async (operation, entityDef, values) =>
      ORDER_HOOKS.order_number![0]!({
        operation,
        entityDef,
        field: {
          id: ORDER_NUMBER_FIELD_ID,
          type: 'TEXT',
          systemAttribute: 'order_number',
        } as unknown as SystemHookContext['field'],
        values,
        organizationId: 'org_1',
        userId: 'user_1',
        allFields: [],
      }),
    validateUniqueFields: async () => {},
    setFieldValues,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.allocate.mockResolvedValue({ recordNumber: 'ORD-0535', sequenceNumber: 535 })
  h.findCachedResource.mockResolvedValue({ fields: [orderNumberField()] })
})

describe('createEntity with a connector-supplied order_number', () => {
  it('keeps the supplied number end to end and allocates nothing', async () => {
    const spy = setFieldValuesSpy()

    const result = await createEntity(ctx(spy.fn), 'def_1', {
      [ORDER_NUMBER_FIELD_ID]: '#1001',
      order_currency: 'USD',
    })

    expect(result.instance.id).toBe('inst_1')
    expect(h.allocate).not.toHaveBeenCalled()
    expect(spy.writes).toHaveLength(1)
    expect(spy.writes[0]).toMatchObject({ [ORDER_NUMBER_FIELD_ID]: '#1001', order_currency: 'USD' })
  })

  it('still allocates when the create carries no number', async () => {
    const spy = setFieldValuesSpy()

    await createEntity(ctx(spy.fn), 'def_1', { order_currency: 'USD' })

    expect(h.allocate).toHaveBeenCalledWith('org_1', 'order')
    expect(spy.writes[0]).toMatchObject({ [ORDER_NUMBER_FIELD_ID]: 'ORD-0535' })
  })
})
