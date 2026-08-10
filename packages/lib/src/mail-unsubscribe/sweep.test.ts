// packages/lib/src/mail-unsubscribe/sweep.test.ts
// The ignored-unsubscribe decision (§6.4): counting what arrived since, and the
// 14-day flip that lets the UI say "Stripe ignored your unsubscribe".
//
// `resolveSweepUpdate` takes `now` as a parameter and `sweepMailUnsubscribes`
// takes `db` as its first, precisely so this needs no fake timers, no BullMQ
// and no `@auxx/database` replacement — the shared `src/test/setup.ts` proxy
// stays in place (never fully replace a shared `vi.mock` in a lib test).

import { describe, expect, it } from 'vitest'
import { UNSUBSCRIBE_IGNORED_AFTER_DAYS } from './client'
import {
  resolveSweepUpdate,
  type SweepableUnsubscribe,
  type SweepObservation,
  sweepMailUnsubscribes,
} from './sweep'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-08-01T05:40:00.000Z')

function row(overrides: Partial<SweepableUnsubscribe> = {}): SweepableUnsubscribe {
  return {
    id: 'unsub_1',
    organizationId: 'org_1',
    inboxId: 'ibx_1',
    subjectKey: 'list:stripe.updates.example.com',
    requestedAt: new Date(NOW.getTime() - 3 * DAY_MS),
    status: 'requested',
    messagesSeenAfter: 0,
    lastSeenAfterAt: null,
    ...overrides,
  }
}

describe('resolveSweepUpdate — counting', () => {
  it('writes nothing when nothing moved', () => {
    expect(
      resolveSweepUpdate(row(), { messagesSeenAfter: 0, lastSeenAfterAt: null }, NOW)
    ).toBeNull()
  })

  it('records new arrivals and when the newest landed', () => {
    const seenAt = new Date(NOW.getTime() - DAY_MS)
    expect(
      resolveSweepUpdate(row(), { messagesSeenAfter: 6, lastSeenAfterAt: seenAt }, NOW)
    ).toEqual({ messagesSeenAfter: 6, lastSeenAfterAt: seenAt })
  })

  it('is absolute, not incremental — a recount that matches the row writes nothing', () => {
    const seenAt = new Date(NOW.getTime() - DAY_MS)
    const existing = row({ messagesSeenAfter: 6, lastSeenAfterAt: seenAt })
    expect(
      resolveSweepUpdate(existing, { messagesSeenAfter: 6, lastSeenAfterAt: seenAt }, NOW)
    ).toBeNull()
  })
})

describe(`resolveSweepUpdate — the ${UNSUBSCRIBE_IGNORED_AFTER_DAYS}-day 'ignored' flip`, () => {
  const stale = row({
    requestedAt: new Date(NOW.getTime() - (UNSUBSCRIBE_IGNORED_AFTER_DAYS + 1) * DAY_MS),
  })

  it('flips to ignored past the deadline when mail kept arriving', () => {
    const update = resolveSweepUpdate(
      stale,
      { messagesSeenAfter: 6, lastSeenAfterAt: new Date(NOW.getTime() - DAY_MS) },
      NOW
    )
    expect(update?.status).toBe('ignored')
    expect(update?.messagesSeenAfter).toBe(6)
  })

  it('does NOT flip when the sender went quiet — silence is them honoring it', () => {
    expect(
      resolveSweepUpdate(stale, { messagesSeenAfter: 0, lastSeenAfterAt: null }, NOW)
    ).toBeNull()
  })

  it('does NOT flip before the deadline, however much mail arrived', () => {
    const update = resolveSweepUpdate(
      row({ requestedAt: new Date(NOW.getTime() - (UNSUBSCRIBE_IGNORED_AFTER_DAYS - 1) * DAY_MS) }),
      { messagesSeenAfter: 40, lastSeenAfterAt: NOW },
      NOW
    )
    expect(update).not.toBeNull()
    expect(update?.status).toBeUndefined()
  })

  it('flips exactly ON the deadline boundary', () => {
    const update = resolveSweepUpdate(
      row({ requestedAt: new Date(NOW.getTime() - UNSUBSCRIBE_IGNORED_AFTER_DAYS * DAY_MS) }),
      { messagesSeenAfter: 1, lastSeenAfterAt: NOW },
      NOW
    )
    expect(update?.status).toBe('ignored')
  })

  it.each(['failed', 'ignored'] as const)("never flips a '%s' row", (status) => {
    // `failed` means we never got through, so counting the sender's mail against
    // our own failure is the wrong attribution; `ignored` is already terminal.
    const update = resolveSweepUpdate(
      row({
        status,
        requestedAt: new Date(NOW.getTime() - 90 * DAY_MS),
      }),
      { messagesSeenAfter: 9, lastSeenAfterAt: NOW },
      NOW
    )
    expect(update?.status).toBeUndefined()
    expect(update?.messagesSeenAfter).toBe(9)
  })

  it("DOES flip a 'confirmed' row — a 2xx is a promise, not the mail stopping", () => {
    // V1's companion rule. The one-click endpoint answering 200 is the only
    // acknowledgement any tier gets, and RFC 8058 says nothing about when (or
    // whether) the list actually drops the address. Letting `confirmed`
    // short-circuit the flip would make the one tier that tells us anything the
    // only tier we never audit.
    const update = resolveSweepUpdate(
      row({ status: 'confirmed', requestedAt: new Date(NOW.getTime() - 90 * DAY_MS) }),
      { messagesSeenAfter: 9, lastSeenAfterAt: NOW },
      NOW
    )
    expect(update?.status).toBe('ignored')
    expect(update?.messagesSeenAfter).toBe(9)
  })

  it("a quiet 'confirmed' sender is never called ignored", () => {
    // Silence past the deadline is the sender HONORING us — the flip needs BOTH
    // the deadline and mail that actually kept arriving.
    expect(
      resolveSweepUpdate(
        row({ status: 'confirmed', requestedAt: new Date(NOW.getTime() - 90 * DAY_MS) }),
        { messagesSeenAfter: 0, lastSeenAfterAt: null },
        NOW
      )
    ).toBeNull()
  })
})

/**
 * A hand-rolled `db`: one page of rows for the scan, and a FIFO of count
 * observations consumed in the order the sweep issues them.
 *
 * The two queries are told apart by their projection — the count query is the
 * only one that selects `messages`.
 */
function fakeDb(rows: SweepableUnsubscribe[], observations: SweepObservation[]) {
  const updates: Array<Record<string, unknown>> = []
  const queue = [...observations]
  let scanned = false

  const db = {
    select: (projection: Record<string, unknown>) => {
      if ('messages' in projection) {
        const chain = {
          from: () => chain,
          innerJoin: () => chain,
          where: async () => {
            const next = queue.shift() ?? { messagesSeenAfter: 0, lastSeenAfterAt: null }
            return [{ messages: next.messagesSeenAfter, lastSeenAfterAt: next.lastSeenAfterAt }]
          },
        }
        return chain
      }
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => {
          if (scanned) return []
          scanned = true
          return rows
        },
      }
      return chain
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values)
        },
      }),
    }),
  } as never

  return { db, updates }
}

describe('sweepMailUnsubscribes', () => {
  it('writes only the rows whose numbers moved', async () => {
    const seenAt = new Date(NOW.getTime() - DAY_MS)
    const { db, updates } = fakeDb(
      [row({ id: 'unsub_quiet' }), row({ id: 'unsub_noisy' })],
      [
        { messagesSeenAfter: 0, lastSeenAfterAt: null },
        { messagesSeenAfter: 6, lastSeenAfterAt: seenAt },
      ]
    )

    const stats = await sweepMailUnsubscribes(db, { now: NOW })

    expect(stats).toEqual({ scanned: 2, updated: 1, markedIgnored: 0 })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ messagesSeenAfter: 6, lastSeenAfterAt: seenAt })
    expect(updates[0]).not.toHaveProperty('status')
  })

  it('flips a stale, still-mailing sender to ignored', async () => {
    const { db, updates } = fakeDb(
      [row({ id: 'unsub_stale', requestedAt: new Date(NOW.getTime() - 20 * DAY_MS) })],
      [{ messagesSeenAfter: 6, lastSeenAfterAt: NOW }]
    )

    const stats = await sweepMailUnsubscribes(db, { now: NOW })

    expect(stats).toEqual({ scanned: 1, updated: 1, markedIgnored: 1 })
    expect(updates[0]).toMatchObject({ status: 'ignored', messagesSeenAfter: 6 })
  })

  it('flips a CONFIRMED sender that kept mailing — a 200 buys no exemption', async () => {
    const { db, updates } = fakeDb(
      [
        row({
          id: 'unsub_confirmed',
          status: 'confirmed',
          requestedAt: new Date(NOW.getTime() - 20 * DAY_MS),
        }),
      ],
      [{ messagesSeenAfter: 4, lastSeenAfterAt: NOW }]
    )

    const stats = await sweepMailUnsubscribes(db, { now: NOW })

    expect(stats).toEqual({ scanned: 1, updated: 1, markedIgnored: 1 })
    expect(updates[0]).toMatchObject({ status: 'ignored', messagesSeenAfter: 4 })
  })

  it('skips an unparseable subject key instead of aborting the whole sweep', async () => {
    const { db, updates } = fakeDb(
      [row({ id: 'unsub_bad', subjectKey: 'sender:example.com' }), row({ id: 'unsub_good' })],
      [{ messagesSeenAfter: 3, lastSeenAfterAt: NOW }]
    )

    const stats = await sweepMailUnsubscribes(db, { now: NOW })

    expect(stats).toEqual({ scanned: 2, updated: 1, markedIgnored: 0 })
    expect(updates[0]).toMatchObject({ messagesSeenAfter: 3 })
  })

  it('stops on cancellation without writing', async () => {
    const { db, updates } = fakeDb(
      [row({ id: 'a' }), row({ id: 'b' })],
      [{ messagesSeenAfter: 1, lastSeenAfterAt: NOW }]
    )

    const stats = await sweepMailUnsubscribes(db, { now: NOW, isCancelled: () => true })

    expect(stats.scanned).toBe(0)
    expect(updates).toHaveLength(0)
  })
})
