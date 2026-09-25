// packages/lib/src/events/handlers/__tests__/finalize-integrity-repoint.test.ts
// A sync-session re-point is captured with its old parent and reaches the finalize marks.

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedField } from '../../../field-values/types'

const h = vi.hoisted(() => ({
  findCachedResource: vi.fn(),
  getCachedCustomFields: vi.fn(),
  markOrStampOrder: vi.fn(async (_org: string, _orderId: string) => {}),
  markOrStampOrderLine: vi.fn(async (_org: string, _lineId: string) => {}),
}))

vi.mock('../../../field-hooks/register-hooks', () => ({ registerAllHooks: () => {} }))
vi.mock('../../../cache', () => ({
  findCachedResource: h.findCachedResource,
  getCachedCustomFields: h.getCachedCustomFields,
}))
vi.mock('../../../field-values/field-change-events', () => ({ emitFieldChange: vi.fn() }))
vi.mock('../../../inventory/builds/drift-reconciler', () => ({
  markOrStampOrder: h.markOrStampOrder,
  markOrStampOrderLine: h.markOrStampOrderLine,
}))
vi.mock('../passes/fulfillment-log-pass', () => ({
  fulfillmentPostingTriggerPass: vi.fn(async () => {}),
}))

import { __resetFieldChangeHooksForTest, registerMarkHooks } from '../../../field-hooks/registry'
import {
  captureSyncFieldWrite,
  isDeltaSubscribed,
} from '../../../field-values/field-value-mutations'
import { stampOrderOnLineChange } from '../../../inventory/builds/drift-hooks'
import { createManifestCollector } from '../../../record-rules/sync-manifest-collector'
import { runIntegrityPasses } from '../finalize-integrity-passes'

const ORG = 'org_1'
const LINE = 'def_li:li1' as RecordId
const ORDER_FIELD = {
  id: 'fld_order',
  systemAttribute: 'line_item_order',
  entityDefinitionId: 'def_li',
  name: 'Order',
  type: FieldType.RELATIONSHIP,
  options: {},
} as unknown as CachedField

const rel = (recordId: string) => [{ type: 'relationship', recordId }] as never

/** One sync-session write of the line's order edge, captured the way the set seam does. */
function capture(
  collector: ReturnType<typeof createManifestCollector>,
  oldValues: unknown[] | null,
  newValues: unknown[] | null
) {
  captureSyncFieldWrite({
    collector,
    subscribed: isDeltaSubscribed(collector, ORDER_FIELD, 'fld_order', 'def_li'),
    recordId: LINE,
    field: ORDER_FIELD,
    fieldId: 'fld_order',
    oldValues: oldValues as never,
    newValues: newValues as never,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetFieldChangeHooksForTest()
  registerMarkHooks('line_item', [stampOrderOnLineChange])
  h.findCachedResource.mockResolvedValue({
    entityDefinitionId: 'def_li',
    entityType: 'line_item',
    apiSlug: 'line_item',
  })
  h.getCachedCustomFields.mockResolvedValue([ORDER_FIELD])
})

describe('re-pointed edges through finalize', () => {
  it('captures {o, n} without a rule subscription', () => {
    const collector = createManifestCollector({})
    expect(isDeltaSubscribed(collector, ORDER_FIELD, 'fld_order', 'def_li')).toBe('repoint')
    capture(collector, rel('def_order:orderA'), rel('def_order:orderB'))
    expect(collector.toJson()?.deltas[LINE]).toEqual({
      line_item_order: { o: ['def_order:orderA'], n: ['def_order:orderB'] },
    })
  })

  it('records no delta for a first attach or a created line', () => {
    const attach = createManifestCollector({})
    capture(attach, [], rel('def_order:orderB'))
    expect(attach.toJson()?.deltas).toEqual({})
    expect(attach.toJson()?.touched[LINE]).toEqual(['line_item_order'])

    const created = createManifestCollector({})
    created.recordCreated(LINE)
    capture(created, [], rel('def_order:orderB'))
    expect(created.toJson()?.deltas).toEqual({})
  })

  it('a re-point from order A to B marks both orders', async () => {
    const collector = createManifestCollector({})
    capture(collector, rel('def_order:orderA'), rel('def_order:orderB'))

    await runIntegrityPasses({} as never, { organizationId: ORG, manifest: collector.toJson()! })

    expect(h.markOrStampOrderLine).toHaveBeenCalledWith(ORG, 'li1')
    expect(h.markOrStampOrder).toHaveBeenCalledWith(ORG, 'orderA')
  })

  it('a cleared edge marks the order the line left', async () => {
    const collector = createManifestCollector({})
    capture(collector, rel('def_order:orderA'), null)

    await runIntegrityPasses({} as never, { organizationId: ORG, manifest: collector.toJson()! })

    expect(h.markOrStampOrder).toHaveBeenCalledWith(ORG, 'orderA')
  })
})
