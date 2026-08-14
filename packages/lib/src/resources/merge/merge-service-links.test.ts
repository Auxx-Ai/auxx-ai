// packages/lib/src/resources/merge/merge-service-links.test.ts
// Merge must re-point mail participant links, thread primaries, and connector
// item bindings onto the target — archive is a soft delete, so without these
// blanket UPDATEs the archived source keeps all mail history (participant
// links only fill when NULL) and every later connector sync rebinds to it.
// plans/custom-field/multi/04-multi-email-implementation-plan.md D1 + D4.

import { schema } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../errors'
import { EntityMergeService } from './merge-service'

const ORG_ID = 'org1'
const TARGET_ID = 'target1'
const SOURCE_A = 'sourceA'
const SOURCE_B = 'sourceB'

function makeService() {
  return new EntityMergeService({} as never, ORG_ID, 'user1')
}

/** Minimal tx double covering only the update chain — the method issues no reads. */
function buildTx() {
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set }))
  return { update, set, updateWhere }
}

describe('EntityMergeService.redirectMailAndConnectorLinks', () => {
  it('re-points Participant, ThreadParticipant, Thread.primary and DataConnectorItem rows', async () => {
    const tx = buildTx()
    const service = makeService()

    await (service as any).redirectMailAndConnectorLinks(tx, [SOURCE_A, SOURCE_B], TARGET_ID)

    // One blanket UPDATE per table, identified by table reference (columns are
    // unassertable under the vitest schema mock — see src/test/setup.ts).
    expect(tx.update).toHaveBeenCalledTimes(4)
    expect(tx.update).toHaveBeenNthCalledWith(1, schema.Participant)
    expect(tx.update).toHaveBeenNthCalledWith(2, schema.ThreadParticipant)
    expect(tx.update).toHaveBeenNthCalledWith(3, schema.Thread)
    expect(tx.update).toHaveBeenNthCalledWith(4, schema.DataConnectorItem)

    // Participant / ThreadParticipant / DataConnectorItem re-point entityInstanceId;
    // Thread re-points its denormalized primary link.
    expect(tx.set).toHaveBeenNthCalledWith(1, { entityInstanceId: TARGET_ID })
    expect(tx.set).toHaveBeenNthCalledWith(2, { entityInstanceId: TARGET_ID })
    expect(tx.set).toHaveBeenNthCalledWith(3, { primaryEntityInstanceId: TARGET_ID })
    expect(tx.set).toHaveBeenNthCalledWith(4, { entityInstanceId: TARGET_ID })

    // Every update chain completes through `.where(...)`.
    expect(tx.updateWhere).toHaveBeenCalledTimes(4)
  })
})

describe('EntityMergeService.validateMergeInput', () => {
  it('throws AuxxError (not TRPCError) on invalid input', async () => {
    const service = makeService()

    await expect(
      service.merge({ targetRecordId: 'def1:target1', sourceRecordIds: [] } as never)
    ).rejects.toBeInstanceOf(BadRequestError)
  })
})
