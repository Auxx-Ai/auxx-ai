// packages/lib/src/mail-unsubscribe/unsubscribe-queries.test.ts
// Regression cover for the header-vs-newest-message resolution in
// `resolveUnsubscribeTarget`.
//
// The bug this pins was found running the miner against the real dev database:
// `list:auxx-ai.auxx-ai.github.com` had 14 of 249 messages carrying
// `unsubscribeMeta`, and the newest was not one of them. The miner's grouped
// query takes the newest NON-NULL meta, so it wrote an `unsubscribe` card
// advertising `one-click`; this resolver read the newest message
// unconditionally and answered `refused: no-unsubscribe-method`. The card
// offered an unsubscribe the executor then refused.
//
// A hand-rolled `db` rather than a `vi.mock('@auxx/database', …)` replacement:
// fully replacing the shared proxy from `src/test/setup.ts` kills the file at
// COLLECTION the moment the import graph grows a table the mock did not list.

import { describe, expect, it } from 'vitest'
import { resolveUnsubscribeTarget } from './unsubscribe-queries'

interface TargetRow {
  messageId: string
  threadId: string
  integrationId: string
  subject: string | null
  listId: string | null
  senderAuthenticated: boolean | null
  unsubscribeMeta: unknown
  senderIdentifier: string | null
  contactEntityInstanceId: string | null
}

function row(overrides: Partial<TargetRow> = {}): TargetRow {
  return {
    messageId: 'msg_newest',
    threadId: 'thr_1',
    integrationId: 'int_1',
    subject: 'Re: [auxx-ai] something',
    listId: 'auxx-ai.auxx-ai.github.com',
    senderAuthenticated: true,
    unsubscribeMeta: null,
    senderIdentifier: 'notifications@github.com',
    contactEntityInstanceId: null,
    ...overrides,
  }
}

/**
 * Two selects, told apart by their projection: the target read is the only one
 * that asks for `messageId`; the header fallback asks for `unsubscribeMeta`
 * alone. `fallbackCalls` is how the "no second query when the newest message
 * already carries a header" case is asserted.
 */
function fakeDb(target: TargetRow | null, fallbackMeta: unknown) {
  const calls = { target: 0, fallback: 0 }

  const db = {
    select: (projection: Record<string, unknown>) => {
      const isTarget = 'messageId' in projection
      const chain: Record<string, unknown> = {}
      for (const key of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
        chain[key] = () => chain
      }
      chain.limit = async () => {
        if (isTarget) {
          calls.target++
          return target ? [target] : []
        }
        calls.fallback++
        return fallbackMeta === null ? [] : [{ unsubscribeMeta: fallbackMeta }]
      }
      return chain
    },
  } as never

  return { db, calls }
}

const ONE_CLICK = {
  httpUrl: 'https://github.com/notifications/unsubscribe/one-click/ABC',
  mailto: 'mailto:unsub+ABC@reply.github.com',
  oneClick: true,
}

describe('resolveUnsubscribeTarget — which message supplies the header', () => {
  it('falls back to the freshest message that HAS a List-Unsubscribe header', async () => {
    const { db, calls } = fakeDb(row({ unsubscribeMeta: null }), ONE_CLICK)

    const result = await resolveUnsubscribeTarget(db, 'org_1', 'ibx_1', 'list:l.example.com')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().offer).toEqual({
      offered: true,
      method: 'one-click',
      httpUrl: ONE_CLICK.httpUrl,
    })
    expect(calls.fallback).toBe(1)
  })

  it('does not run the fallback when the newest message already carries one', async () => {
    const { db, calls } = fakeDb(
      row({ unsubscribeMeta: { httpUrl: 'https://example.com/u', oneClick: false } }),
      ONE_CLICK
    )

    const result = await resolveUnsubscribeTarget(db, 'org_1', 'ibx_1', 'list:l.example.com')

    expect(result._unsafeUnwrap().offer).toEqual({
      offered: true,
      method: 'http',
      httpUrl: 'https://example.com/u',
    })
    expect(calls.fallback).toBe(0)
  })

  it('still refuses when NO message in the group publishes a header', async () => {
    const { db } = fakeDb(row({ unsubscribeMeta: null }), null)

    const result = await resolveUnsubscribeTarget(db, 'org_1', 'ibx_1', 'list:l.example.com')

    expect(result._unsafeUnwrap().offer).toMatchObject({
      offered: false,
      reason: 'no-unsubscribe-method',
      alternative: 'block-sender',
    })
  })

  it('keeps the GATE on the newest message — an older header never rescues an unverified sender', async () => {
    // invariant 3/4: no listId + `senderAuthenticated` NULL ⇒ refuse, whatever
    // headers older mail carried. Only the header travels from the fallback row.
    const { db, calls } = fakeDb(
      row({ listId: null, senderAuthenticated: null, unsubscribeMeta: null }),
      ONE_CLICK
    )

    const result = await resolveUnsubscribeTarget(db, 'org_1', 'ibx_1', 'domain:example.com')

    expect(result._unsafeUnwrap().offer).toMatchObject({
      offered: false,
      reason: 'unverified-sender',
      alternative: 'block-sender',
    })
    // The gate runs on the target row, so the fallback lookup is wasted work
    // rather than a correctness problem — but it must not change the verdict.
    expect(calls.fallback).toBeLessThanOrEqual(1)
  })

  it('returns NotFoundError when the inbox holds no mail from the group at all', async () => {
    const { db } = fakeDb(null, ONE_CLICK)

    const result = await resolveUnsubscribeTarget(db, 'org_1', 'ibx_1', 'list:l.example.com')

    expect(result.isErr()).toBe(true)
  })
})
