// packages/lib/src/field-hooks/pre/__tests__/accounting-work-item-delete.test.ts
//
// 91 §8.9: a deleted record sweeps its parked accounting work, keyed by its entity
// type, and never refuses the delete.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ swept: vi.fn() }))
vi.mock('../../../accounting/work-items/write', () => ({ deleteWorkItemsForSources: h.swept }))

import type { RecordId } from '@auxx/types/resource'
import type { EntityPreDeleteEvent } from '../../types'
import { sweepAccountingWorkItemsOnDelete } from '../accounting-work-item-delete'

const event = (entityType: string | null): EntityPreDeleteEvent => ({
  recordId: 'def_fulfillment:ful_1' as RecordId,
  entityDefinitionId: 'def_fulfillment',
  entityType,
  entitySlug: 'fulfillments',
  values: {},
  organizationId: 'org_1',
  userId: 'user_1',
  bypass: new Set(),
})

beforeEach(() => {
  h.swept.mockReset()
})

describe('sweepAccountingWorkItemsOnDelete', () => {
  it("deletes every stage's rows for the record, keyed by its entity type", async () => {
    h.swept.mockResolvedValue({ isErr: () => false })
    await sweepAccountingWorkItemsOnDelete(event('fulfillment'))
    expect(h.swept).toHaveBeenCalledWith(expect.anything(), 'org_1', {
      sourceKind: 'fulfillment',
      sourceIds: ['ful_1'],
    })
  })

  it('does nothing for a record with no entity type', async () => {
    await sweepAccountingWorkItemsOnDelete(event(null))
    expect(h.swept).not.toHaveBeenCalled()
  })

  it('never refuses the delete when the sweep fails', async () => {
    h.swept.mockResolvedValue({ isErr: () => true, error: new Error('db down') })
    await expect(sweepAccountingWorkItemsOnDelete(event('payout'))).resolves.toBeUndefined()
  })
})
