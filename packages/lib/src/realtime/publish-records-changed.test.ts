// packages/lib/src/realtime/publish-records-changed.test.ts
//
// Tier-2 publisher tests (plan events/03 §7b): `publishRecordsChanged` chunking
// + in-publisher def canonicalization, and `publishRunCompleted` on the org
// channel. The publishers lazily import `../cache` (barrel-cycle avoidance), so
// the cache module is mocked here — vitest intercepts dynamic imports too.

import { describe, expect, it, vi } from 'vitest'
import type { RecordChangedEntry } from './events'
import { publishRecordsChanged, publishRunCompleted } from './publish-helpers'
import type { RealtimeService } from './realtime-service'
import { rooms } from './rooms'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const DEF_CUID = 'xrbtfl7syi3sm4mqf5wiayuz'
const PART_DEF_CUID = 'elppl4chr8dhnjfibwryu5to'

// The #1784 keyspace: producers can hold the bare entityType slug where the
// room key needs the org's EntityDefinition CUID.
vi.mock('../cache', () => ({
  canonicalizeEntityDefinitionId: vi.fn(async (_orgId: string, value: string) =>
    value === 'part' ? PART_DEF_CUID : value
  ),
}))

interface Frame {
  roomKey: string
  event: string
  data: Record<string, unknown> & {
    entityDefinitionId?: string
    entries?: RecordChangedEntry[]
    chunk?: { index: number; total: number }
    defCounts?: Record<string, number>
  }
}

function fakeService(): { service: RealtimeService; frames: Frame[] } {
  const frames: Frame[] = []
  const publish = vi.fn(async (roomKey: string, event: string, data: unknown) => {
    frames.push({ roomKey, event, data: data as Frame['data'] })
    return true
  })
  return { service: { publish } as unknown as RealtimeService, frames }
}

describe('publishRecordsChanged — tier-2 delta frames', () => {
  it('publishes one un-chunked frame on the def record channel when under the cap', async () => {
    const { service, frames } = fakeService()
    const entries: RecordChangedEntry[] = [
      { recordId: 'inst-1' },
      { recordId: 'inst-2', fieldIds: ['contact:email'] },
    ]
    await publishRecordsChanged(service, ORG, { entityDefinitionId: DEF_CUID, entries })

    expect(frames).toHaveLength(1)
    expect(frames[0]?.roomKey).toBe(rooms.orgRecords(ORG, DEF_CUID))
    expect(frames[0]?.event).toBe('records:changed')
    expect(frames[0]?.data.entityDefinitionId).toBe(DEF_CUID)
    expect(frames[0]?.data.entries).toEqual(entries)
    expect(frames[0]?.data.chunk).toBeUndefined()
  })

  it('chunks at 100 entries per frame with chunk metadata', async () => {
    const { service, frames } = fakeService()
    const entries = Array.from({ length: 101 }, (_, i) => ({ recordId: `inst-${i}` }))
    await publishRecordsChanged(service, ORG, { entityDefinitionId: DEF_CUID, entries })

    expect(frames).toHaveLength(2)
    expect(frames[0]?.data.chunk).toEqual({ index: 0, total: 2 })
    expect(frames[1]?.data.chunk).toEqual({ index: 1, total: 2 })
    expect(frames[0]?.data.entries).toHaveLength(100)
    expect(frames[1]?.data.entries).toHaveLength(1)
    // Every chunk still rides the SAME def channel and carries the def id.
    for (const frame of frames) {
      expect(frame.roomKey).toBe(rooms.orgRecords(ORG, DEF_CUID))
      expect(frame.data.entityDefinitionId).toBe(DEF_CUID)
    }
  })

  it('canonicalizes a slug-keyed def id inside the publisher (room key AND payload)', async () => {
    const { service, frames } = fakeService()
    await publishRecordsChanged(service, ORG, {
      entityDefinitionId: 'part',
      entries: [{ recordId: 'inst-1' }],
    })

    // Without in-publisher canonicalization this frame would address
    // `…-records-part` while every browser sits on `…-records-<cuid>` —
    // delivered to nobody (the #1784 bug class).
    expect(frames).toHaveLength(1)
    expect(frames[0]?.roomKey).toBe(rooms.orgRecords(ORG, PART_DEF_CUID))
    expect(frames[0]?.data.entityDefinitionId).toBe(PART_DEF_CUID)
  })

  it('publishes nothing for an empty entry list', async () => {
    const { service, frames } = fakeService()
    await publishRecordsChanged(service, ORG, { entityDefinitionId: DEF_CUID, entries: [] })
    expect(frames).toHaveLength(0)
  })

  it('never publishes on the org presence channel', async () => {
    const { service, frames } = fakeService()
    await publishRecordsChanged(service, ORG, {
      entityDefinitionId: DEF_CUID,
      entries: [{ recordId: 'inst-1' }],
    })
    expect(frames.map((f) => f.roomKey)).not.toContain(rooms.orgPresence(ORG))
  })
})

describe('publishRunCompleted — run-completion edge', () => {
  it('publishes on the org presence channel with the run ref and source', async () => {
    const { service, frames } = fakeService()
    await publishRunCompleted(service, ORG, {
      source: 'import',
      ref: 'job-1',
      defCounts: { [DEF_CUID]: 42 },
    })

    expect(frames).toHaveLength(1)
    expect(frames[0]?.roomKey).toBe(rooms.orgPresence(ORG))
    expect(frames[0]?.event).toBe('run:completed')
    expect(frames[0]?.data).toEqual({
      source: 'import',
      ref: 'job-1',
      defCounts: { [DEF_CUID]: 42 },
    })
  })

  it('canonicalizes defCounts keys and merges counts that collapse onto one id', async () => {
    const { service, frames } = fakeService()
    // The importer's own def can be slug-keyed while a relation auto-create
    // target reports the CUID for the SAME def — the publisher must sum them.
    await publishRunCompleted(service, ORG, {
      source: 'import',
      ref: 'job-1',
      defCounts: { part: 10, [PART_DEF_CUID]: 5, [DEF_CUID]: 3 },
    })

    expect(frames).toHaveLength(1)
    expect(frames[0]?.data.defCounts).toEqual({ [PART_DEF_CUID]: 15, [DEF_CUID]: 3 })
  })
})
