// packages/lib/src/providers/imap/__tests__/imap-backfill-cutoff.test.ts
//
// The fail-closed backfill-window resolver for IMAP channels (skip-events
// history §11 G1 / the #1721 rule). The dangerous reading is the old
// `backfillCutoffAt && !initialBackfillCompletedAt`, which hands a channel
// with NEITHER stamp no suppression at all — so a first folder walk would
// publish `message:received` (workflows, billed classification, filters,
// signals) for every historical message. The resolver must suppress from
// "now" instead, and flag that the computed cutoff needs a durable stamp so
// the completion stamp can ever close the window (#1587).

import { describe, expect, it } from 'vitest'
import { resolveImapBackfillCutoff } from '../imap-backfill-cutoff'

describe('resolveImapBackfillCutoff', () => {
  it('arms the stored cutoff while the backfill is incomplete', () => {
    const stamped = '2026-08-20T10:00:00.000Z'
    const window = resolveImapBackfillCutoff({ backfillCutoffAt: stamped })

    expect(window.cutoff).toEqual(new Date(stamped))
    // Already durable — initialize must not rewrite it (insert-only stamp).
    expect(window.needsDurableStamp).toBe(false)
  })

  it('opens the gate only on an explicit completion stamp', () => {
    const window = resolveImapBackfillCutoff({
      backfillCutoffAt: '2026-08-20T10:00:00.000Z',
      initialBackfillCompletedAt: '2026-08-20T11:00:00.000Z',
    })

    expect(window.cutoff).toBeNull()
    expect(window.needsDurableStamp).toBe(false)
  })

  it('fails CLOSED for a channel with neither stamp — cutoff "now", to be stamped durably', () => {
    const before = Date.now()
    const window = resolveImapBackfillCutoff({ email: 'ops@example.com' })
    const after = Date.now()

    expect(window.cutoff).not.toBeNull()
    expect(window.cutoff!.getTime()).toBeGreaterThanOrEqual(before)
    expect(window.cutoff!.getTime()).toBeLessThanOrEqual(after)
    // Without the durable write-back the completion stamp (guarded on
    // `backfillCutoffAt` existing) could never land, and the window would
    // drift forward forever — the #1587 incident class.
    expect(window.needsDurableStamp).toBe(true)
  })

  it('treats completed-without-cutoff as a closed window', () => {
    // Migration 099 stamps both, but insert-only history means a row could in
    // principle carry only the completion stamp — completion always wins.
    const window = resolveImapBackfillCutoff({
      initialBackfillCompletedAt: '2026-08-20T11:00:00.000Z',
    })

    expect(window.cutoff).toBeNull()
    expect(window.needsDurableStamp).toBe(false)
  })

  it('fails closed on missing or malformed metadata', () => {
    for (const metadata of [null, undefined, 'garbage', 42, ['not', 'an', 'object'], {}]) {
      const window = resolveImapBackfillCutoff(metadata)
      expect(window.cutoff).toBeInstanceOf(Date)
      expect(window.needsDurableStamp).toBe(true)
    }
  })

  it('ignores a non-string cutoff value rather than arming an Invalid Date', () => {
    const window = resolveImapBackfillCutoff({ backfillCutoffAt: { nested: true } })
    expect(window.cutoff).toBeInstanceOf(Date)
    expect(Number.isNaN(window.cutoff!.getTime())).toBe(false)
    expect(window.needsDurableStamp).toBe(true)
  })
})
