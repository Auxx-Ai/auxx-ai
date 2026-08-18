// packages/lib/src/thread-events/__tests__/thread-events.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../errors'
import { recordThreadEvent } from '../thread-event-mutations'
import {
  decodeThreadEventCursor,
  encodeThreadEventCursor,
  listThreadEvents,
} from '../thread-event-queries'
import type { ThreadEventRow } from '../types'

function makeRow(overrides: Partial<ThreadEventRow> = {}): ThreadEventRow {
  return {
    id: 'te1',
    organizationId: 'org1',
    threadId: 'thr1',
    type: 'thread:archived',
    actorId: null,
    data: {},
    createdAt: new Date('2026-08-17T10:00:00.000Z'),
    ...overrides,
  }
}

/** Build a `db` stub for the select chain, capturing the limit passed to it. */
function makeSelectDb(rows: ThreadEventRow[], captured: { limit?: number }): Database {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async (n: number) => {
              captured.limit = n
              return rows.slice(0, n)
            },
          }),
        }),
      }),
    }),
  }
  return db as unknown as Database
}

/** Build a `db` stub for the insert chain, capturing the values passed to it. */
function makeInsertDb(captured: { values?: Record<string, unknown> }): Database {
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          captured.values = v
          return [{ id: 'te_minted', createdAt: new Date('2026-08-17T12:00:00.000Z'), ...v }]
        },
      }),
    }),
  }
  return db as unknown as Database
}

describe('thread event cursor', () => {
  it('round-trips (createdAt, id) through the opaque string', () => {
    const cursor = { createdAt: new Date('2026-08-17T10:15:30.123Z'), id: 'te_abc' }
    const encoded = encodeThreadEventCursor(cursor)
    const decoded = decodeThreadEventCursor(encoded)
    expect(decoded.createdAt.getTime()).toBe(cursor.createdAt.getTime())
    expect(decoded.id).toBe(cursor.id)
  })

  it('rejects garbage input with BadRequestError', () => {
    expect(() => decodeThreadEventCursor('not-a-cursor')).toThrow(BadRequestError)
    expect(() => decodeThreadEventCursor('')).toThrow(BadRequestError)
    // Valid base64url but no separator / bad date inside.
    expect(() => decodeThreadEventCursor(Buffer.from('nodate').toString('base64url'))).toThrow(
      BadRequestError
    )
    expect(() => decodeThreadEventCursor(Buffer.from('garbage|id').toString('base64url'))).toThrow(
      BadRequestError
    )
  })
})

describe('listThreadEvents', () => {
  it('returns all rows and a null cursor when the page is not full', async () => {
    const rows = [makeRow({ id: 'te2' }), makeRow({ id: 'te1' })]
    const captured: { limit?: number } = {}
    const result = await listThreadEvents(makeSelectDb(rows, captured), {
      organizationId: 'org1',
      threadId: 'thr1',
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.events).toHaveLength(2)
    expect(result.value.nextCursor).toBeNull()
    // Default page size 50, +1 sentinel row to detect an older page.
    expect(captured.limit).toBe(51)
  })

  it('slices to the limit and returns a cursor for the last kept row', async () => {
    const rows = [
      makeRow({ id: 'te3', createdAt: new Date('2026-08-17T10:03:00.000Z') }),
      makeRow({ id: 'te2', createdAt: new Date('2026-08-17T10:02:00.000Z') }),
      makeRow({ id: 'te1', createdAt: new Date('2026-08-17T10:01:00.000Z') }),
    ]
    const captured: { limit?: number } = {}
    const result = await listThreadEvents(makeSelectDb(rows, captured), {
      organizationId: 'org1',
      threadId: 'thr1',
      limit: 2,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(captured.limit).toBe(3)
    expect(result.value.events.map((e) => e.id)).toEqual(['te3', 'te2'])
    expect(result.value.nextCursor).not.toBeNull()
    const decoded = decodeThreadEventCursor(result.value.nextCursor as string)
    expect(decoded.id).toBe('te2')
    expect(decoded.createdAt.toISOString()).toBe('2026-08-17T10:02:00.000Z')
  })

  it('accepts a cursor from the previous page', async () => {
    const rows = [makeRow({ id: 'te1', createdAt: new Date('2026-08-17T10:01:00.000Z') })]
    const captured: { limit?: number } = {}
    const cursor = encodeThreadEventCursor({
      createdAt: new Date('2026-08-17T10:02:00.000Z'),
      id: 'te2',
    })
    const result = await listThreadEvents(makeSelectDb(rows, captured), {
      organizationId: 'org1',
      threadId: 'thr1',
      cursor,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.events.map((e) => e.id)).toEqual(['te1'])
    expect(result.value.nextCursor).toBeNull()
  })

  it('surfaces a tampered cursor as err(BadRequestError)', async () => {
    const result = await listThreadEvents(makeSelectDb([], {}), {
      organizationId: 'org1',
      threadId: 'thr1',
      cursor: 'definitely-not-a-cursor',
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error).toBeInstanceOf(BadRequestError)
  })
})

describe('recordThreadEvent', () => {
  it('inserts with defaults and returns the row', async () => {
    const captured: { values?: Record<string, unknown> } = {}
    const result = await recordThreadEvent(makeInsertDb(captured), {
      organizationId: 'org1',
      threadId: 'thr1',
      type: 'thread:archived',
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(captured.values).toMatchObject({
      organizationId: 'org1',
      threadId: 'thr1',
      type: 'thread:archived',
      actorId: null,
      data: {},
    })
    // id/createdAt omitted so the schema defaults mint them.
    expect(captured.values).not.toHaveProperty('id')
    expect(captured.values).not.toHaveProperty('createdAt')
    expect(result.value.id).toBe('te_minted')
  })

  it('passes through explicit id, createdAt, actorId and typed data', async () => {
    const captured: { values?: Record<string, unknown> } = {}
    const createdAt = new Date('2026-08-01T00:00:00.000Z')
    const result = await recordThreadEvent(makeInsertDb(captured), {
      organizationId: 'org1',
      threadId: 'thr1',
      type: 'thread:tagged',
      actorId: 'agent:agt1',
      data: { tagIds: ['t1'], tagNames: ['VIP'], source: { kind: 'workflow', id: 'wf1' } },
      id: 'legacy_evt_id',
      createdAt,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(captured.values).toMatchObject({
      id: 'legacy_evt_id',
      createdAt,
      actorId: 'agent:agt1',
      type: 'thread:tagged',
      data: { tagIds: ['t1'], tagNames: ['VIP'], source: { kind: 'workflow', id: 'wf1' } },
    })
    expect(result.value.id).toBe('legacy_evt_id')
  })
})
