// apps/web/src/components/pickers/record-picker/use-prune-deleted-selections.test.ts

import type { RecordId, RecordPickerItem } from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import { selectNotFoundCandidates } from './use-prune-deleted-selections'

/**
 * The three-state hydration contract, pinned.
 *
 * `resources/store/relationship-store.ts` documents it: an item (found), `null`
 * (the batch answered and this id was not in it), `undefined` (not loaded yet).
 * The picker's `hydratedMap` collapses all three by admitting only truthy items,
 * which is why a dangling id goes invisible and gets re-saved.
 *
 * 🛑 The fix must NOT collapse them the other way. `selectNotFoundCandidates`
 * keys on `=== null`; a naive `!item` would nominate every relation on the first
 * paint — before any hydration has returned — and the caller would then commit
 * that empty list. The `naive` implementation below is the negative control:
 * every test that distinguishes the two is asserted against BOTH, and the naive
 * one is asserted to fail exactly where it would destroy data.
 */
function naiveFalsinessCandidates(
  recordIds: RecordId[],
  hydratedItems: (RecordPickerItem | null | undefined)[]
): RecordId[] {
  const candidates: RecordId[] = []
  for (let index = 0; index < recordIds.length; index++) {
    if (!hydratedItems[index]) {
      const recordId = recordIds[index]
      if (recordId) candidates.push(recordId)
    }
  }
  return candidates
}

const A = 'work_order:aaaaaaaaaaaaaaaaaaaaaaaa' as RecordId
const B = 'work_order:bbbbbbbbbbbbbbbbbbbbbbbb' as RecordId
const C = 'thread:cccccccccccccccccccccccc' as RecordId

function item(recordId: RecordId): RecordPickerItem {
  return {
    id: recordId.split(':')[1] as string,
    recordId,
    displayName: 'Something',
  } as RecordPickerItem
}

describe('selectNotFoundCandidates', () => {
  it('nominates nothing while hydration is still in flight', () => {
    // First paint: the store has no slot for any id yet, so every read is
    // `undefined`. This is the single most dangerous frame in the change.
    const loading = [undefined, undefined, undefined]

    expect(selectNotFoundCandidates([A, B, C], loading)).toEqual([])

    // Negative control: the naive falsiness test nominates ALL THREE here, and
    // the caller would save the relation field as empty.
    expect(naiveFalsinessCandidates([A, B, C], loading)).toEqual([A, B, C])
  })

  it('nominates nothing on a partially hydrated frame', () => {
    // The batcher resolves in chunks, so a mixed frame is normal, not an error.
    const partial = [item(A), undefined, undefined]

    expect(selectNotFoundCandidates([A, B, C], partial)).toEqual([])
    expect(naiveFalsinessCandidates([A, B, C], partial)).toEqual([B, C])
  })

  it('nominates only the ids the batch explicitly answered as not found', () => {
    const settled = [item(A), null, undefined]

    expect(selectNotFoundCandidates([A, B, C], settled)).toEqual([B])
    // The naive form additionally nominates C, which has not loaded at all.
    expect(naiveFalsinessCandidates([A, B, C], settled)).toEqual([B, C])
  })

  it('nominates nothing when every id hydrated', () => {
    const items = [item(A), item(B), item(C)]
    expect(selectNotFoundCandidates([A, B, C], items)).toEqual([])
    expect(naiveFalsinessCandidates([A, B, C], items)).toEqual([])
  })

  it('tolerates a shorter items array than the id list', () => {
    // A positional misalignment must read as "not loaded", never "not found".
    expect(selectNotFoundCandidates([A, B, C], [item(A)])).toEqual([])
  })

  it('nominating is not deleting — a nominated id is only a question', () => {
    // `null` covers "this viewer cannot see it" as well as "deleted": every
    // `thread:` id resolves to nothing through `record.getByIds` for EVERY
    // viewer (mail-lens tables are dropped from the batch), alive or not. So a
    // nomination must go to `record.checkMissingTargets` for a verdict — which
    // refuses to judge any def it cannot resolve to `EntityInstance`.
    expect(selectNotFoundCandidates([C], [null])).toEqual([C])
  })
})
