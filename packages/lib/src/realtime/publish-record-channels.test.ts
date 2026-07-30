// packages/lib/src/realtime/publish-record-channels.test.ts

import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'
import { describe, expect, it, vi } from 'vitest'
import type { FieldValueUpdateEntry } from './events'
import { publishFieldValueUpdates, publishRecordsInvalidated } from './publish-helpers'
import type { RealtimeService } from './realtime-service'
import { rooms } from './rooms'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const DEF_A = 'xrbtfl7syi3sm4mqf5wiayuz'
const DEF_B = 'elppl4chr8dhnjfibwryu5to'

const ROOM_A = rooms.orgRecords(ORG, DEF_A)
const ROOM_B = rooms.orgRecords(ORG, DEF_B)

interface Frame {
  roomKey: string
  event: string
  data: { entries?: FieldValueUpdateEntry[]; chunk?: { index: number; total: number } } & Record<
    string,
    unknown
  >
}

function fakeService(): { service: RealtimeService; frames: Frame[] } {
  const frames: Frame[] = []
  const publish = vi.fn(async (roomKey: string, event: string, data: unknown) => {
    frames.push({ roomKey, event, data: data as Frame['data'] })
    return true
  })
  return { service: { publish } as unknown as RealtimeService, frames }
}

function entry(defId: string, instance: string, field: string): FieldValueUpdateEntry {
  return {
    key: buildFieldValueKey(toRecordId(defId, instance), field as FieldId),
    value: { id: `v-${field}`, type: 'text', value: `secret-${defId}` },
  }
}

describe('publishFieldValueUpdates — per-def fanout', () => {
  it('publishes one frame per def and never mixes defs on one channel', async () => {
    const { service, frames } = fakeService()
    const a1 = entry(DEF_A, 'inst-a1', 'field-a1')
    const a2 = entry(DEF_A, 'inst-a2', 'field-a2')
    const b1 = entry(DEF_B, 'inst-b1', 'field-b1')
    const aEntries = [a1, a2]
    const bEntries = [b1]

    // Interleaved on purpose — bucketing must not depend on input order.
    await publishFieldValueUpdates(service, ORG, [a1, b1, a2])

    expect(frames).toHaveLength(2)
    const frameA = frames.find((f) => f.roomKey === ROOM_A)
    const frameB = frames.find((f) => f.roomKey === ROOM_B)
    expect(frameA?.event).toBe('fieldValues:updated')
    expect(frameB?.event).toBe('fieldValues:updated')
    expect(frameA?.data.entries).toEqual(aEntries)
    expect(frameB?.data.entries).toEqual(bEntries)

    // The leak this closes: def A's raw stored values must not appear on def B's
    // channel (and vice versa).
    for (const e of frameB?.data.entries ?? []) {
      expect(e.key.startsWith(`${DEF_A}:`)).toBe(false)
    }
    for (const e of frameA?.data.entries ?? []) {
      expect(e.key.startsWith(`${DEF_B}:`)).toBe(false)
    }
  })

  it('never publishes on the org presence channel', async () => {
    const { service, frames } = fakeService()
    await publishFieldValueUpdates(service, ORG, [entry(DEF_A, 'inst-a1', 'field-a1')])
    expect(frames.map((f) => f.roomKey)).not.toContain(rooms.orgPresence(ORG))
  })

  it('chunks per def bucket, not across the whole call', async () => {
    const { service, frames } = fakeService()
    // 51 entries on def A (one over CHUNK_SIZE) + 1 on def B.
    const aEntries = Array.from({ length: 51 }, (_, i) => entry(DEF_A, `inst-a${i}`, `field-a${i}`))
    await publishFieldValueUpdates(service, ORG, [...aEntries, entry(DEF_B, 'inst-b1', 'field-b1')])

    const aFrames = frames.filter((f) => f.roomKey === ROOM_A)
    const bFrames = frames.filter((f) => f.roomKey === ROOM_B)

    expect(aFrames).toHaveLength(2)
    expect(aFrames[0]?.data.chunk).toEqual({ index: 0, total: 2 })
    expect(aFrames[1]?.data.chunk).toEqual({ index: 1, total: 2 })
    expect(aFrames[0]?.data.entries).toHaveLength(50)
    expect(aFrames[1]?.data.entries).toHaveLength(1)

    // Def B stays a single un-chunked frame — its bucket is under the limit even
    // though the call as a whole is over it.
    expect(bFrames).toHaveLength(1)
    expect(bFrames[0]?.data.chunk).toBeUndefined()
    expect(bFrames[0]?.data.entries).toHaveLength(1)
  })

  it('publishes nothing for an empty entry list', async () => {
    const { service, frames } = fakeService()
    await publishFieldValueUpdates(service, ORG, [])
    expect(frames).toHaveLength(0)
  })

  it('drops entries whose def cannot be derived rather than broadcasting them', async () => {
    const { service, frames } = fakeService()
    await publishFieldValueUpdates(service, ORG, [
      { key: ':orphan-field' as FieldValueUpdateEntry['key'], value: 'x' },
      entry(DEF_A, 'inst-a1', 'field-a1'),
    ])
    expect(frames).toHaveLength(1)
    expect(frames[0]?.roomKey).toBe(ROOM_A)
    expect(frames[0]?.data.entries).toHaveLength(1)
  })
})

describe('publishRecordsInvalidated — per-def fanout', () => {
  it('addresses each def frame to that def’s own channel', async () => {
    const { service, frames } = fakeService()
    await publishRecordsInvalidated(service, ORG, { entityDefinitionIds: [DEF_A, DEF_B] })

    expect(frames).toHaveLength(2)
    expect(frames).toEqual(
      expect.arrayContaining([
        { roomKey: ROOM_A, event: 'records:invalidated', data: { entityDefinitionId: DEF_A } },
        { roomKey: ROOM_B, event: 'records:invalidated', data: { entityDefinitionId: DEF_B } },
      ])
    )
  })

  it('publishes nothing for an empty def list', async () => {
    const { service, frames } = fakeService()
    await publishRecordsInvalidated(service, ORG, { entityDefinitionIds: [] })
    expect(frames).toHaveLength(0)
  })
})
