// packages/lib/src/field-hooks/__tests__/dispatch.test.ts
//
// plans/events/10 §4.2: what each KIND may do on each lane, and that one bad handler
// cannot starve the rest. Boundaries (org cache, the bus event, the hook bootstrap) are
// mocked with hoisted factories — same convention as finalize-integrity-passes.test.ts.

import { FieldType } from '@auxx/database/enums'
import type { CustomFieldEntity } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchCore, EntityFieldChangeEvent, FieldChangeRef, MarkHandler } from '../types'

const h = vi.hoisted(() => ({
  findCachedResource: vi.fn(),
  getCachedCustomFields: vi.fn(),
  emitFieldChange: vi.fn(),
}))

// The registry self-inits by calling `registerAllHooks()`, which pulls the whole hook
// graph; these tests register their own fakes instead.
vi.mock('../register-hooks', () => ({ registerAllHooks: () => {} }))

vi.mock('../../cache', () => ({
  findCachedResource: h.findCachedResource,
  getCachedCustomFields: h.getCachedCustomFields,
}))

vi.mock('../../field-values/field-change-events', () => ({
  emitFieldChange: h.emitFieldChange,
}))

import { dispatchFieldChanges } from '../dispatch'
import {
  __resetFieldChangeHooksForTest,
  registerDeriveHooks,
  registerMarkHooks,
  registerReactHooks,
} from '../registry'

const ORG = 'org_1'
const USER = 'usr_1'
const DEF = 'def_invoices'
const SLUG = 'invoices'
const RECORD = `${DEF}:inv_1` as RecordId

const FIELDS = [
  {
    id: 'fld_status',
    systemAttribute: 'invoice_status',
    name: 'Status',
    type: FieldType.SINGLE_SELECT,
  },
  {
    id: 'fld_addr',
    systemAttribute: 'billing_address',
    name: 'Address',
    type: FieldType.ADDRESS_STRUCT,
  },
  // No systemAttribute — cannot be a degraded trigger key.
  { id: 'fld_note', systemAttribute: null, name: 'Note', type: FieldType.TEXT },
] as unknown as CustomFieldEntity[]

function statusChange(extra: Record<string, unknown> = {}) {
  return { recordId: RECORD, outputKey: 'invoice_status', o: 'draft', n: 'sent', ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetFieldChangeHooksForTest()
  h.findCachedResource.mockResolvedValue({
    entityDefinitionId: DEF,
    entityType: 'invoice',
    apiSlug: SLUG,
  })
  h.getCachedCustomFields.mockResolvedValue(FIELDS)
})

describe('dispatchFieldChanges — marks', () => {
  it('fires on both lanes, with values buffered and without on sync', async () => {
    const seen: FieldChangeRef[] = []
    const markIt: MarkHandler = async (event) => {
      seen.push(event)
    }
    registerMarkHooks(SLUG, [markIt])

    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [statusChange()],
    })
    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'sync',
      changes: [{ recordId: RECORD, outputKey: 'invoice_status' }],
      db: {} as never,
    })

    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({
      recordId: RECORD,
      entitySlug: SLUG,
      entityType: 'invoice',
      oldValue: 'draft',
      newValue: 'sent',
    })
    expect(seen[1]?.oldValue).toBeUndefined()
    expect(seen[1]?.newValue).toBeUndefined()
  })

  it('canonicalises the recordId to the def CUID keyspace', async () => {
    const seen: FieldChangeRef[] = []
    registerMarkHooks(SLUG, [
      async (event) => {
        seen.push(event)
      },
    ])

    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [{ ...statusChange(), recordId: 'invoice:inv_1' as RecordId }],
    })

    expect(seen[0]?.recordId).toBe(RECORD)
  })
})

describe('dispatchFieldChanges — derives', () => {
  it('fires on the buffered lane with a full event', async () => {
    const seen: EntityFieldChangeEvent[] = []
    registerDeriveHooks(SLUG, [
      async (event) => {
        seen.push(event)
      },
    ])

    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [statusChange()],
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      oldValue: 'draft',
      newValue: 'sent',
      oldDisplay: null,
      newDisplay: null,
    })
  })

  it('is skipped on the sync lane without a batch core', async () => {
    const derive = vi.fn(async () => {})
    registerDeriveHooks(SLUG, [derive])

    const report = await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'sync',
      changes: [{ recordId: RECORD, outputKey: 'invoice_status' }],
      db: {} as never,
    })

    expect(derive).not.toHaveBeenCalled()
    expect(Object.values(report.handlers)[0]).toEqual({ fired: 0, skipped: 1, failed: 0 })
  })

  it('hands every sync target to the batch core in ONE grouped call', async () => {
    const core = vi.fn<BatchCore>(async () => {})
    registerDeriveHooks(FieldType.ADDRESS_STRUCT, [async () => {}], { batch: core })

    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'sync',
      changes: [
        { recordId: RECORD, outputKey: 'billing_address' },
        { recordId: `${DEF}:inv_2` as RecordId, outputKey: 'billing_address' },
      ],
      db: {} as never,
    })

    expect(core).toHaveBeenCalledTimes(1)
    expect(core.mock.calls[0]?.[0].targets).toHaveLength(2)
  })

  it('counts a batch core with no db as failed rather than dropping it silently', async () => {
    const core = vi.fn<BatchCore>(async () => {})
    registerDeriveHooks(FieldType.ADDRESS_STRUCT, [async () => {}], { batch: core })

    const report = await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'sync',
      changes: [{ recordId: RECORD, outputKey: 'billing_address' }],
    })

    expect(core).not.toHaveBeenCalled()
    expect(Object.values(report.handlers)[0]).toEqual({ fired: 0, skipped: 0, failed: 1 })
  })

  it('skipOnCreate drops a create change on both the inline and the batch path', async () => {
    const derive = vi.fn(async () => {})
    const core = vi.fn<BatchCore>(async () => {})
    registerDeriveHooks(SLUG, [derive], { skipOnCreate: true, batch: core })

    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [statusChange({ isCreate: true })],
    })
    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'sync',
      changes: [{ recordId: RECORD, outputKey: 'invoice_status', isCreate: true }],
      db: {} as never,
    })

    expect(derive).not.toHaveBeenCalled()
    expect(core).not.toHaveBeenCalled()
  })
})

describe('dispatchFieldChanges — reacts', () => {
  it('fires on the buffered lane only', async () => {
    const react = vi.fn(async () => {})
    registerReactHooks('*', [react])

    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [statusChange()],
    })
    expect(react).toHaveBeenCalledTimes(1)

    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'sync',
      changes: [{ recordId: RECORD, outputKey: 'invoice_status' }],
      db: {} as never,
    })
    expect(react).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchFieldChanges — degraded records', () => {
  it('dispatches every systemAttribute field to marks, and no derive', async () => {
    const marked: string[] = []
    const derive = vi.fn(async () => {})
    registerMarkHooks(SLUG, [
      async (event) => {
        marked.push(event.field.id)
      },
    ])
    registerDeriveHooks(SLUG, [derive])

    const report = await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [],
      degraded: [RECORD],
    })

    expect(marked).toEqual(['fld_status', 'fld_addr'])
    expect(derive).not.toHaveBeenCalled()
    expect(report.degraded).toBe(2)
    expect(report.changes).toBe(0)
  })

  it('skips a def cheaply when nothing applicable is registered', async () => {
    registerDeriveHooks(SLUG, [async () => {}])

    const report = await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [],
      degraded: [RECORD],
    })

    expect(report.degraded).toBe(0)
  })
})

describe('dispatchFieldChanges — isolation, the bus event and the report', () => {
  it('counts a throwing handler as failed and still runs the rest', async () => {
    const boom: MarkHandler = async () => {
      throw new Error('nope')
    }
    const after = vi.fn(async () => {})
    registerMarkHooks(SLUG, [boom])
    registerMarkHooks(SLUG, [after])

    const report = await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [statusChange()],
    })

    expect(after).toHaveBeenCalledTimes(1)
    expect(report.handlers.boom).toEqual({ fired: 0, skipped: 0, failed: 1 })
  })

  it('emits field:updated for non-create buffered changes only', async () => {
    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [statusChange(), statusChange({ isCreate: true })],
    })
    expect(h.emitFieldChange).toHaveBeenCalledTimes(1)
    expect(h.emitFieldChange.mock.calls[0]?.[0]).toMatchObject({
      recordId: RECORD,
      entitySlug: SLUG,
      change: {
        fieldId: 'fld_status',
        fieldName: 'Status',
        fieldType: FieldType.SINGLE_SELECT,
        oldValue: 'draft',
        newValue: 'sent',
        oldDisplay: null,
        newDisplay: null,
      },
    })
    expect(h.emitFieldChange.mock.calls[0]?.[1]).toBeUndefined()

    h.emitFieldChange.mockClear()
    await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'sync',
      changes: [{ recordId: RECORD, outputKey: 'invoice_status' }],
      db: {} as never,
    })
    expect(h.emitFieldChange).not.toHaveBeenCalled()
  })

  it('reports the lane and the counts, and skips changes whose field is unknown', async () => {
    registerMarkHooks(SLUG, [async () => {}])

    const report = await dispatchFieldChanges({
      organizationId: ORG,
      userId: USER,
      lane: 'buffered',
      changes: [statusChange(), { recordId: RECORD, outputKey: 'not_a_field', o: 1, n: 2 }],
    })

    expect(report.lane).toBe('buffered')
    expect(report.changes).toBe(1)
    expect(report.degraded).toBe(0)
  })
})
