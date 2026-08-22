// packages/lib/src/providers/imap/utils/__tests__/walk-complete.test.ts
//
// The walk-complete predicate gates BOTH the IDLE transition and the
// `initialBackfillCompletedAt` stamp. The stamp side is the one with teeth:
// an IMAP first walk carries its work in `imapImportBatchJob` payloads, not
// the Redis import cache, so the cache-drain path can go IDLE mid-walk — and
// stamping completion at that moment would reopen `message:received` for the
// rest of the historical import.

import { describe, expect, it } from 'vitest'
import { isImapWalkComplete } from '../walk-complete'

const checkpoint = (phase: 'listing' | 'importing' | 'done') =>
  JSON.stringify({ runId: 'run-1', phase })

describe('isImapWalkComplete', () => {
  it('is complete when no label carries a checkpoint', () => {
    expect(isImapWalkComplete([])).toBe(true)
    expect(isImapWalkComplete([{ syncCheckpoint: null }])).toBe(true)
  })

  it('is complete when every checkpoint is done', () => {
    expect(
      isImapWalkComplete([{ syncCheckpoint: checkpoint('done') }, { syncCheckpoint: null }])
    ).toBe(true)
  })

  it('is incomplete while any folder is still listing or importing', () => {
    expect(
      isImapWalkComplete([
        { syncCheckpoint: checkpoint('done') },
        { syncCheckpoint: checkpoint('listing') },
      ])
    ).toBe(false)
    expect(isImapWalkComplete([{ syncCheckpoint: checkpoint('importing') }])).toBe(false)
  })
})
