// packages/lib/src/mail-unsubscribe/execute-unsubscribe.test.ts
// End-to-end tier routing for the executor, plus the two rules a regression
// here would break silently:
//
//   • INVARIANT 2 — our outbound unsubscribe is NEVER recorded as
//     `contact:unsubscribed`, which upserts an org-wide suppression row and
//     would silence our own mail to that address.
//   • The `http` tier POSTs NOTHING — the URL comes back for the client.
//
// Only this module's own collaborators are mocked. The shared `@auxx/database`
// / `@auxx/logger` / `drizzle-orm` mocks from `src/test/setup.ts` stay in place
// — fully replacing one kills the file at COLLECTION as the graph grows.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./unsubscribe-queries', () => ({
  getMailUnsubscribe: vi.fn(),
  resolveUnsubscribeTarget: vi.fn(),
}))
vi.mock('./unsubscribe-mutations', () => ({
  upsertMailUnsubscribe: vi.fn(),
  setMailUnsubscribeStatus: vi.fn(),
}))
vi.mock('./one-click-post', () => ({ postOneClickUnsubscribe: vi.fn() }))
vi.mock('./mailto-send', () => ({ sendMailtoUnsubscribe: vi.fn() }))
vi.mock('../signals/record-signal', () => ({ recordSignal: vi.fn() }))
vi.mock('../audit-log/record-audit', () => ({ recordAudit: vi.fn() }))

import { ok } from 'neverthrow'
import { recordAudit } from '../audit-log/record-audit'
import { recordSignal } from '../signals/record-signal'
import { executeUnsubscribe } from './execute-unsubscribe'
import { sendMailtoUnsubscribe } from './mailto-send'
import { postOneClickUnsubscribe } from './one-click-post'
import type { UnsubscribeTarget } from './types'
import { setMailUnsubscribeStatus, upsertMailUnsubscribe } from './unsubscribe-mutations'
import { getMailUnsubscribe, resolveUnsubscribeTarget } from './unsubscribe-queries'

const db = {} as never

const INPUT = {
  organizationId: 'org_1',
  inboxId: 'ibx_1',
  subjectKey: 'list:stripe.updates.example.com',
  userId: 'usr_1',
  isSharedInbox: false,
}

const RECORD = {
  id: 'unsub_1',
  organizationId: 'org_1',
  inboxId: 'ibx_1',
  subjectKey: 'list:stripe.updates.example.com',
  method: 'one-click' as const,
  requestedByUserId: 'usr_1',
  requestedAt: new Date('2026-08-01T00:00:00.000Z'),
  status: 'requested' as const,
  lastSeenAfterAt: null,
  messagesSeenAfter: 0,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}

function target(overrides: Partial<UnsubscribeTarget> = {}): UnsubscribeTarget {
  return {
    messageId: 'msg_1',
    threadId: 'thr_1',
    integrationId: 'int_1',
    subject: 'Stripe updates',
    senderIdentifier: 'news@stripe.example.com',
    contactEntityInstanceId: 'ent_1',
    offer: { offered: true, method: 'one-click', httpUrl: 'https://list.example.com/u/abc' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMailUnsubscribe).mockResolvedValue(ok(null))
  vi.mocked(upsertMailUnsubscribe).mockResolvedValue(ok(RECORD))
  vi.mocked(setMailUnsubscribeStatus).mockImplementation(async (_db, _orgId, id, status) =>
    ok({ ...RECORD, id, status })
  )
  vi.mocked(postOneClickUnsubscribe).mockResolvedValue({
    accepted: true,
    status: 200,
    finalUrl: 'https://list.example.com/u/abc',
  })
  vi.mocked(sendMailtoUnsubscribe).mockResolvedValue({
    messageId: 'msg_out',
    to: 'unsub@list.example.com',
    integrationId: 'int_1',
  })
  vi.mocked(recordSignal).mockResolvedValue({ ok: true, value: { id: 'sig_1' } } as never)
  vi.mocked(recordAudit).mockReturnValue(ok(undefined) as never)
})

describe('executeUnsubscribe — tiers', () => {
  it('one-click POSTs server-side and records the request', async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(ok(target()))

    const result = await executeUnsubscribe(db, INPUT)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ status: 'confirmed', method: 'one-click' })
    expect(postOneClickUnsubscribe).toHaveBeenCalledWith('https://list.example.com/u/abc')
    expect(sendMailtoUnsubscribe).not.toHaveBeenCalled()
  })

  it('the http tier POSTs NOTHING and hands the url back for the client to open', async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(
      ok(target({ offer: { offered: true, method: 'http', httpUrl: 'https://x.example.com/u' } }))
    )

    const result = await executeUnsubscribe(db, INPUT)

    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'requested',
      method: 'http',
      openUrl: 'https://x.example.com/u',
    })
    expect(postOneClickUnsubscribe).not.toHaveBeenCalled()
  })

  it('the mailto tier sends from the channel the mail arrived on', async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(
      ok(target({ offer: { offered: true, method: 'mailto', mailto: 'unsub@list.example.com' } }))
    )

    await executeUnsubscribe(db, INPUT)

    expect(sendMailtoUnsubscribe).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        mailto: 'unsub@list.example.com',
        preferredIntegrationId: 'int_1',
      })
    )
    expect(postOneClickUnsubscribe).not.toHaveBeenCalled()
  })
})

describe('executeUnsubscribe — the safety gate is an OUTCOME, not an error', () => {
  it('returns the typed refusal and touches nothing', async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(
      ok(
        target({
          offer: {
            offered: false,
            reason: 'unverified-sender',
            alternative: 'block-sender',
            message: 'nope',
          },
        })
      )
    )

    const result = await executeUnsubscribe(db, INPUT)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'refused',
      refusal: { reason: 'unverified-sender', alternative: 'block-sender' },
    })
    expect(postOneClickUnsubscribe).not.toHaveBeenCalled()
    expect(sendMailtoUnsubscribe).not.toHaveBeenCalled()
    expect(upsertMailUnsubscribe).not.toHaveBeenCalled()
    expect(recordSignal).not.toHaveBeenCalled()
  })
})

describe('executeUnsubscribe — never twice from the same list (§6.4)', () => {
  it('short-circuits on an existing record without touching the third party', async () => {
    vi.mocked(getMailUnsubscribe).mockResolvedValue(ok(RECORD))

    const result = await executeUnsubscribe(db, INPUT)

    expect(result._unsafeUnwrap()).toEqual({ status: 'already-requested', record: RECORD })
    expect(resolveUnsubscribeTarget).not.toHaveBeenCalled()
    expect(postOneClickUnsubscribe).not.toHaveBeenCalled()
    expect(upsertMailUnsubscribe).not.toHaveBeenCalled()
  })

  it('upserts on (organizationId, inboxId, subjectKey) — the race-safe floor', async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(ok(target()))

    await executeUnsubscribe(db, INPUT)

    expect(upsertMailUnsubscribe).toHaveBeenCalledWith(db, {
      organizationId: 'org_1',
      inboxId: 'ibx_1',
      subjectKey: 'list:stripe.updates.example.com',
      method: 'one-click',
      requestedByUserId: 'usr_1',
    })
  })
})

describe('executeUnsubscribe — the signal (§3, INVARIANT 2)', () => {
  it("records 'mail:unsubscribed_from' and NEVER 'contact:unsubscribed'", async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(ok(target()))

    await executeUnsubscribe(db, INPUT)

    expect(recordSignal).toHaveBeenCalledTimes(1)
    const signal = vi.mocked(recordSignal).mock.calls[0]![0]
    expect(signal.kind).toBe('mail:unsubscribed_from')
    expect(signal.kind).not.toBe('contact:unsubscribed')
    expect(signal.contactEntityInstanceId).toBe('ent_1')
  })

  it('never emits contact:unsubscribed on ANY tier', async () => {
    const offers = [
      { offered: true as const, method: 'one-click' as const, httpUrl: 'https://x.example.com/u' },
      { offered: true as const, method: 'http' as const, httpUrl: 'https://x.example.com/u' },
      { offered: true as const, method: 'mailto' as const, mailto: 'u@x.example.com' },
    ]

    for (const offer of offers) {
      vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(ok(target({ offer })))
      await executeUnsubscribe(db, INPUT)
    }

    const kinds = vi.mocked(recordSignal).mock.calls.map(([signal]) => signal.kind)
    expect(kinds).toEqual([
      'mail:unsubscribed_from',
      'mail:unsubscribed_from',
      'mail:unsubscribed_from',
    ])
    expect(kinds).not.toContain('contact:unsubscribed')
  })

  it('skips the signal when the sender maps to no contact', async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(
      ok(target({ contactEntityInstanceId: null }))
    )

    await executeUnsubscribe(db, INPUT)

    expect(recordSignal).not.toHaveBeenCalled()
  })

  it('a failed signal write never fails the unsubscribe — the POST already went out', async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(ok(target()))
    vi.mocked(recordSignal).mockRejectedValue(new Error('bus down'))

    const result = await executeUnsubscribe(db, INPUT)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ status: 'confirmed' })
  })
})

/**
 * V1 — a rejected unsubscribe used to be recorded as a successful one.
 *
 * The endpoint's answer was logged at `warn` and thrown away: the row said
 * `requested`, the card said done, and a sender answering 410 was
 * indistinguishable from one that honored us. `setMailUnsubscribeStatus` existed
 * for exactly this and had zero callers, so `confirmed` and `failed` were
 * unreachable states.
 */
describe('executeUnsubscribe — the tier-1 verdict is recorded (V1)', () => {
  beforeEach(() => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(ok(target()))
  })

  it('records confirmed when the endpoint accepts', async () => {
    const result = await executeUnsubscribe(db, INPUT)

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'confirmed', method: 'one-click' })
    expect(setMailUnsubscribeStatus).toHaveBeenCalledWith(db, 'org_1', 'unsub_1', 'confirmed')
    expect(result._unsafeUnwrap()).toMatchObject({ record: { status: 'confirmed' } })
  })

  it.each([500, 403, 410])('records failed — NOT requested — on a %i', async (status) => {
    vi.mocked(postOneClickUnsubscribe).mockResolvedValue({
      accepted: false,
      status,
      finalUrl: 'https://list.example.com/u/abc',
    })

    const result = await executeUnsubscribe(db, INPUT)

    const outcome = result._unsafeUnwrap()
    expect(outcome).toMatchObject({ status: 'failed', method: 'one-click' })
    expect(outcome.status).not.toBe('requested')
    expect(setMailUnsubscribeStatus).toHaveBeenCalledWith(db, 'org_1', 'unsub_1', 'failed')
  })

  it('never falls back to opening the URL when the POST is rejected', async () => {
    // A one-click POST endpoint is not necessarily a browsable confirmation
    // page — that is exactly why tier 2 exists as a separate tier. Surface the
    // failure; the fallback is a product question, not a silent retry.
    vi.mocked(postOneClickUnsubscribe).mockResolvedValue({
      accepted: false,
      status: 500,
      finalUrl: 'https://list.example.com/u/abc',
    })

    const result = await executeUnsubscribe(db, INPUT)

    expect(result._unsafeUnwrap()).not.toHaveProperty('openUrl')
  })

  it.each([
    ['http', { offered: true as const, method: 'http' as const, httpUrl: 'https://x.test/u' }],
    ['mailto', { offered: true as const, method: 'mailto' as const, mailto: 'u@x.test' }],
  ])('leaves the %s tier at requested — nothing acknowledges it', async (_name, offer) => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(ok(target({ offer })))

    const result = await executeUnsubscribe(db, INPUT)

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'requested' })
    // No acknowledgement exists, so there is no terminal state to write.
    expect(setMailUnsubscribeStatus).not.toHaveBeenCalled()
  })

  it('a failed status write never fails the unsubscribe — the POST already went out', async () => {
    // Same posture as the audit write: bookkeeping must not turn a completed
    // operation into an error the user retries. The endpoint's answer is still
    // the truth about the attempt, so the reported status does not degrade.
    vi.mocked(setMailUnsubscribeStatus).mockRejectedValue(new Error('db down'))

    const result = await executeUnsubscribe(db, INPUT)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ status: 'confirmed', record: RECORD })
  })

  it('re-offers a previously FAILED row instead of short-circuiting it', async () => {
    // Without this, recording `failed` would be worse than the bug it fixes: the
    // short-circuit would dead-end the card on `already-requested` forever.
    vi.mocked(getMailUnsubscribe).mockResolvedValue(ok({ ...RECORD, status: 'failed' }))

    const result = await executeUnsubscribe(db, INPUT)

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'confirmed' })
    expect(postOneClickUnsubscribe).toHaveBeenCalled()
  })

  it.each([
    'requested',
    'confirmed',
    'ignored',
  ] as const)('still short-circuits a %s row — we never ask a third party twice', async (status) => {
    vi.mocked(getMailUnsubscribe).mockResolvedValue(ok({ ...RECORD, status }))

    const result = await executeUnsubscribe(db, INPUT)

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'already-requested' })
    expect(postOneClickUnsubscribe).not.toHaveBeenCalled()
  })
})

describe('executeUnsubscribe — the audit row (§6.4, invariant 11)', () => {
  it('audits a SHARED inbox, where the action affects colleagues', async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(ok(target()))

    await executeUnsubscribe(db, { ...INPUT, isSharedInbox: true })

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        action: 'inbox.unsubscribed_from_list',
        actorId: 'usr_1',
        targetType: 'inbox',
        targetId: 'ibx_1',
      })
    )
  })

  it('does not audit a personal inbox — it affects exactly the person who clicked', async () => {
    vi.mocked(resolveUnsubscribeTarget).mockResolvedValue(ok(target()))

    await executeUnsubscribe(db, { ...INPUT, isSharedInbox: false })

    expect(recordAudit).not.toHaveBeenCalled()
  })
})
