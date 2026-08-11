// packages/lib/src/mail-classification/client.test.ts
// `client.ts` is mostly constants and types. The one piece of logic in it is
// `isSameReclassifyScope`, and it is load-bearing: the sample's BullMQ jobId is
// keyed on (org, inbox) and carries no scope, so this comparison is the ONLY
// thing standing between "your run started" and a run at a completely different
// range quietly continuing instead.

import { describe, expect, it } from 'vitest'
import { isSameReclassifyScope, type MailReclassifyMode, type MailReclassifyRange } from './client'

const scope = (range: MailReclassifyRange, mode: MailReclassifyMode = 'fill-gaps') => ({
  range,
  mode,
})

describe('isSameReclassifyScope', () => {
  it('matches identical presets', () => {
    expect(
      isSameReclassifyScope(scope({ kind: 'days', days: 30 }), scope({ kind: 'days', days: 30 }))
    ).toBe(true)
    expect(isSameReclassifyScope(scope({ kind: 'all-time' }), scope({ kind: 'all-time' }))).toBe(
      true
    )
  })

  it('separates the two modes — this is the one that can double-bill (R4)', () => {
    expect(
      isSameReclassifyScope(
        scope({ kind: 'days', days: 30 }, 'fill-gaps'),
        scope({ kind: 'days', days: 30 }, 're-classify')
      )
    ).toBe(false)
  })

  it('separates two windows of the same kind', () => {
    expect(
      isSameReclassifyScope(scope({ kind: 'days', days: 30 }), scope({ kind: 'days', days: 90 }))
    ).toBe(false)
    expect(
      isSameReclassifyScope(
        scope({ kind: 'threads', threads: 100 }),
        scope({ kind: 'threads', threads: 1000 })
      )
    ).toBe(false)
  })

  // ⚠️ 30 days and 100 threads are both "a bit of recent mail" and neither is a
  // subset of the other — a kind change is a scope change.
  it('separates different kinds', () => {
    expect(
      isSameReclassifyScope(
        scope({ kind: 'days', days: 30 }),
        scope({ kind: 'threads', threads: 30 })
      )
    ).toBe(false)
  })

  it('compares both ends of a custom range, including an absent end', () => {
    const since = '2026-01-01T00:00:00.000Z'
    expect(
      isSameReclassifyScope(
        scope({ kind: 'custom', sinceIso: since }),
        scope({ kind: 'custom', sinceIso: since })
      )
    ).toBe(true)
    expect(
      isSameReclassifyScope(
        scope({ kind: 'custom', sinceIso: since }),
        scope({ kind: 'custom', sinceIso: since, untilIso: '2026-02-01T00:00:00.000Z' })
      )
    ).toBe(false)
  })

  // The two objects reach the comparison from different places — one from tRPC
  // input, one out of BullMQ job data — and neither JSON path promises key order,
  // which is why this is field-by-field rather than a stringify.
  it('does not depend on key order', () => {
    const a = { mode: 'fill-gaps' as const, range: { kind: 'custom', sinceIso: 'x' } as const }
    const b = { range: { sinceIso: 'x', kind: 'custom' } as const, mode: 'fill-gaps' as const }
    expect(isSameReclassifyScope(a, b)).toBe(true)
  })
})
