// packages/lib/src/data-connectors/connectors/__tests__/app-connector-state.test.ts
// Pure-unit coverage of the app-connector cursor translation helpers — the round
// trip between the engine's opaque token `SyncCursor` and the flat app cursor.

import { describe, expect, it } from 'vitest'
import { decodeCursor, decodeSince, encodeCursor, encodeSince } from '../app-connector-state'

describe('encodeSince / decodeSince', () => {
  it('round-trips an opaque since of any JSON shape', () => {
    for (const since of ['2026-09-01T00:00:00Z', { historyId: '84422' }, 1_700_000_000, null]) {
      expect(decodeSince(encodeSince(since))).toEqual(since)
    }
  })

  it('keeps an absent since absent', () => {
    expect(encodeSince(undefined)).toBeUndefined()
    expect(decodeSince(undefined)).toBeUndefined()
  })

  it('drops a watermark that is not JSON (a pre-v14 ISO watermark) instead of failing', () => {
    expect(decodeSince('2026-09-01T00:00:00Z')).toBeUndefined()
  })
})

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a plain string cursor', () => {
    const encoded = encodeCursor('c2')
    expect(encoded).toEqual({ kind: 'token', value: '"c2"' })
    expect(decodeCursor(encoded)).toBe('c2')
  })

  it('round-trips a structured cursor', () => {
    const encoded = encodeCursor({ after: 'x', page: 3 })
    expect(encoded.kind).toBe('token')
    expect(decodeCursor(encoded)).toEqual({ after: 'x', page: 3 })
  })

  it('decodes undefined for no cursor', () => {
    expect(decodeCursor(undefined)).toBeUndefined()
  })

  it('tolerates a malformed value → undefined (never throws mid-sync)', () => {
    expect(decodeCursor({ kind: 'token', value: 'not json {' })).toBeUndefined()
    // A non-string value (legacy/garbage) is also tolerated.
    expect(decodeCursor({ kind: 'token', value: undefined as unknown as string })).toBeUndefined()
  })
})
