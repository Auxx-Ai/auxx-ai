// packages/lib/src/realtime/__tests__/publish-lines-updated.test.ts
//
// `lines:updated` rides the parent def's record room, chunked like
// `fieldValues:updated`, with `deleted` on the first frame only.

import { describe, expect, it, vi } from 'vitest'
import type { Line } from '../../accounting/documents/lines/client'
import { publishLinesUpdatedEvent } from '../publish-helpers'
import type { RealtimeService } from '../realtime-service'
import { rooms } from '../rooms'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const QUOTE_DEF = 'xrbtfl7syi3sm4mqf5wiayuz'

function fakeService() {
  const frames: Array<{ roomKey: string; event: string; data: any; options: unknown }> = []
  const publish = vi.fn(async (roomKey: string, event: string, data: unknown, options: unknown) => {
    frames.push({ roomKey, event, data, options })
    return true
  })
  return { service: { publish } as unknown as RealtimeService, frames }
}

const line = (id: string) => ({ id, documentType: 'quote', documentId: 'q_1' }) as Line

describe('publishLinesUpdatedEvent', () => {
  it('publishes one frame on the parent def room, excluding the acting socket', async () => {
    const { service, frames } = fakeService()
    await publishLinesUpdatedEvent(
      service,
      ORG,
      QUOTE_DEF,
      { documentType: 'quote', documentId: 'q_1', upserted: [line('a')], deleted: ['b'] },
      { excludeSocketId: 'sock_1' }
    )
    expect(frames).toEqual([
      {
        roomKey: rooms.orgRecords(ORG, QUOTE_DEF),
        event: 'lines:updated',
        data: { documentType: 'quote', documentId: 'q_1', upserted: [line('a')], deleted: ['b'] },
        options: { excludeSocketId: 'sock_1' },
      },
    ])
  })

  it('chunks at 50 rows and sends the deletions once', async () => {
    const { service, frames } = fakeService()
    const upserted = Array.from({ length: 120 }, (_, i) => line(`l${i}`))
    await publishLinesUpdatedEvent(service, ORG, QUOTE_DEF, {
      documentType: 'quote',
      documentId: 'q_1',
      upserted,
      deleted: ['gone'],
    })
    expect(frames.map((f) => f.data.upserted.length)).toEqual([50, 50, 20])
    expect(frames.map((f) => f.data.deleted)).toEqual([['gone'], [], []])
    expect(frames.map((f) => f.data.chunk)).toEqual([
      { index: 0, total: 3 },
      { index: 1, total: 3 },
      { index: 2, total: 3 },
    ])
  })

  it('publishes a delete-only frame, and nothing for an empty change', async () => {
    const { service, frames } = fakeService()
    const base = { documentType: 'quote' as const, documentId: 'q_1' }
    await publishLinesUpdatedEvent(service, ORG, QUOTE_DEF, {
      ...base,
      upserted: [],
      deleted: ['x'],
    })
    await publishLinesUpdatedEvent(service, ORG, QUOTE_DEF, { ...base, upserted: [], deleted: [] })
    expect(frames).toHaveLength(1)
    expect(frames[0]?.data).toEqual({ ...base, upserted: [], deleted: ['x'] })
  })
})
