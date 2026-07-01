// packages/lib/src/resources/merge/merge-service-identity.test.ts
// Merge must re-point source RecordIdentity rows onto the target — archive is
// a soft delete so the FK cascade never fires, and app-less rows (chat
// visitorId) have no FieldValue to carry them across otherwise.
// plans/data-connectors/v7/option-3-multi-source-identity-store-plan.md Phase 2.

import { describe, expect, it, vi } from 'vitest'
import { EntityMergeService } from './merge-service'

const ORG_ID = 'org1'
const TARGET_ID = 'target1'
const SOURCE_A = 'sourceA'
const SOURCE_B = 'sourceB'

function makeService() {
  return new EntityMergeService({} as never, ORG_ID, 'user1')
}

/** Minimal chainable tx double: queues one result array per `.where()` call, in call order. */
function buildTx(results: unknown[][]) {
  let call = 0
  const where = vi.fn(() => Promise.resolve(results[call++] ?? []))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set }))
  const deleteWhere = vi.fn().mockResolvedValue(undefined)
  const del = vi.fn(() => ({ where: deleteWhere }))
  return { select, update, delete: del, set, updateWhere, deleteWhere }
}

describe('EntityMergeService.redirectRecordIdentities', () => {
  it('returns 0 and issues no writes when the source has no identity rows', async () => {
    const tx = buildTx([[]])
    const service = makeService()

    const count = await (service as any).redirectRecordIdentities(tx, [SOURCE_A], TARGET_ID)

    expect(count).toBe(0)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.delete).not.toHaveBeenCalled()
  })

  it('re-points a source identity the target does not already hold', async () => {
    const tx = buildTx([
      // source rows
      [{ id: 'ri1', source: 'shopify', connectionId: 'connUS', appFieldKey: 'customerId' }],
      // target rows (none of this kind)
      [],
    ])
    const service = makeService()

    const count = await (service as any).redirectRecordIdentities(tx, [SOURCE_A], TARGET_ID)

    expect(count).toBe(1)
    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(tx.set).toHaveBeenCalledWith({ entityInstanceId: TARGET_ID })
    expect(tx.updateWhere).toHaveBeenCalledTimes(1)
    expect(tx.delete).not.toHaveBeenCalled()
  })

  it('drops the source row when the target already holds that identity kind (no unique-key collision)', async () => {
    const tx = buildTx([
      [{ id: 'ri1', source: 'shopify', connectionId: 'connUS', appFieldKey: 'customerId' }],
      [{ source: 'shopify', connectionId: 'connUS', appFieldKey: 'customerId' }],
    ])
    const service = makeService()

    const count = await (service as any).redirectRecordIdentities(tx, [SOURCE_A], TARGET_ID)

    expect(count).toBe(0)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.delete).toHaveBeenCalledTimes(1)
    expect(tx.deleteWhere).toHaveBeenCalledTimes(1)
  })

  it('re-points the app-less chat visitorId link (connectionId/appFieldKey both null)', async () => {
    const tx = buildTx([
      [{ id: 'ri_chat', source: 'chat', connectionId: null, appFieldKey: null }],
      [],
    ])
    const service = makeService()

    const count = await (service as any).redirectRecordIdentities(tx, [SOURCE_A], TARGET_ID)

    expect(count).toBe(1)
    expect(tx.updateWhere).toHaveBeenCalledTimes(1)
  })

  it('merges the union across two sources — one re-pointed, one dropped as a duplicate kind', async () => {
    const tx = buildTx([
      [
        {
          id: 'ri_a_shopify',
          source: 'shopify',
          connectionId: 'connUS',
          appFieldKey: 'customerId',
        },
        { id: 'ri_a_chat', source: 'chat', connectionId: null, appFieldKey: null },
        {
          id: 'ri_b_shopify',
          source: 'shopify',
          connectionId: 'connUS',
          appFieldKey: 'customerId',
        },
      ],
      [], // target has neither kind yet
    ])
    const service = makeService()

    const count = await (service as any).redirectRecordIdentities(
      tx,
      [SOURCE_A, SOURCE_B],
      TARGET_ID
    )

    // One row per distinct kind is re-pointed (shopify:connUS:customerId, chat:'':'')
    expect(count).toBe(2)
    // The duplicate shopify row from source B is dropped, not re-pointed.
    expect(tx.delete).toHaveBeenCalledTimes(1)
  })
})
