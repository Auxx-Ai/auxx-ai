// packages/lib/src/providers/imap/utils/__tests__/sync-cursor.test.ts

import { describe, expect, it } from 'vitest'
import { createSyncCursor } from '../create-sync-cursor'
import { parseSyncCursor } from '../parse-sync-cursor'

describe('sync cursor BigInt handling', () => {
  it('serializes and deserializes when uidValidity is BigInt at runtime', () => {
    // Simulate imapflow returning bigint for uidValidity (typed as number but bigint at runtime)
    const state = {
      uidValidity: BigInt(1) as unknown as number,
      highestUid: 42,
      modSeq: BigInt('99999999999'),
    }

    const cursor = createSyncCursor(state)
    const parsed = parseSyncCursor(cursor)

    expect(parsed).not.toBeNull()
    expect(parsed!.uidValidity).toBe(1)
    expect(parsed!.highestUid).toBe(42)
    expect(parsed!.modSeq).toBe(BigInt('99999999999'))
  })

  it('handles missing modSeq', () => {
    const state = { uidValidity: 1, highestUid: 0, modSeq: undefined }

    const cursor = createSyncCursor(state)
    const parsed = parseSyncCursor(cursor)

    expect(parsed).not.toBeNull()
    expect(parsed!.uidValidity).toBe(1)
    expect(parsed!.highestUid).toBe(0)
    expect(parsed!.modSeq).toBeUndefined()
  })

  it('handles modSeq of zero', () => {
    const state = {
      uidValidity: 5,
      highestUid: 100,
      modSeq: BigInt(0),
    }

    const cursor = createSyncCursor(state)
    const parsed = parseSyncCursor(cursor)

    expect(parsed).not.toBeNull()
    expect(parsed!.modSeq).toBe(BigInt(0))
  })
})
