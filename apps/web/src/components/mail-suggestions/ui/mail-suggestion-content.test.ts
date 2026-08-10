// apps/web/src/components/mail-suggestions/ui/mail-suggestion-content.test.ts
// The card's refusal explanation is the SERVER's refusal, not a paraphrase of it
// (v2 plan §4.1 / V13).
//
// `unsubscribeRefusalReason` is an adapter from the denormalized `evidence` row
// onto `unsubscribeRefusal` — the same predicate `selectUnsubscribeMethod` runs
// before it touches a stranger's endpoint. These tests exist to make the two
// impossible to drift: every case is asserted against the gate's own answer for
// the equivalent `Message`, never against a hard-coded string.

import type {
  MailSuggestionEvidence,
  MailUnsubscribeMethod,
} from '@auxx/lib/mail-suggestions/client'
import type { UnsubscribeCandidate } from '@auxx/lib/mail-unsubscribe/client'
import { selectUnsubscribeMethod } from '@auxx/lib/mail-unsubscribe/client'
import { describe, expect, it } from 'vitest'
import { unsubscribeRefusalReason } from './mail-suggestion-content'

const HTTP_URL = 'https://list.example.com/u/abc'
const MAILTO = 'unsub-abc@list.example.com'

function evidence(overrides: Partial<MailSuggestionEvidence> = {}): MailSuggestionEvidence {
  return {
    windowDays: 90,
    messageCount: 34,
    threadCount: 30,
    unreadRate: 1,
    manualArchiveRate: 0,
    everReplied: false,
    sampleThreadIds: [],
    unsubscribeMethod: 'one-click',
    listId: 'stripe.updates.example.com',
    senderDomain: 'example.com',
    senderAuthenticated: true,
    historyDays: 60,
    filteredThreadCount: 0,
    ...overrides,
  }
}

/**
 * The `Message` the gate would read for the same group. The miner denormalizes
 * the resolved tier onto `evidence.unsubscribeMethod`, so this rebuilds the
 * header shape that tier came from.
 */
function candidateFor(row: MailSuggestionEvidence): UnsubscribeCandidate {
  const meta: Record<MailUnsubscribeMethod, UnsubscribeCandidate['unsubscribeMeta']> = {
    'one-click': { httpUrl: HTTP_URL, oneClick: true },
    http: { httpUrl: HTTP_URL, oneClick: false },
    mailto: { mailto: MAILTO, oneClick: false },
  }
  return {
    listId: row.listId,
    senderAuthenticated: row.senderAuthenticated,
    unsubscribeMeta: row.unsubscribeMethod ? meta[row.unsubscribeMethod] : null,
  }
}

/** The gate's answer for the same inputs, in the card's `string | null` shape. */
function gateReason(row: MailSuggestionEvidence): string | null {
  const offer = selectUnsubscribeMethod(candidateFor(row))
  return offer.offered ? null : offer.message
}

describe('unsubscribeRefusalReason — one predicate, two callers (§4.1 / V13)', () => {
  const cases: [name: string, row: MailSuggestionEvidence][] = [
    ['authenticated sender with a list-id and one-click', evidence()],
    [
      'a real list-id is identity enough on an unauthenticated sender',
      evidence({
        senderAuthenticated: false,
      }),
    ],
    ['domain group, authenticated', evidence({ listId: null, senderAuthenticated: true })],
    ['domain group, NOT authenticated', evidence({ listId: null, senderAuthenticated: false })],
    ['no published unsubscribe address', evidence({ unsubscribeMethod: null })],
    [
      'unverified AND no address — the unverified branch wins',
      evidence({
        listId: null,
        senderAuthenticated: false,
        unsubscribeMethod: null,
      }),
    ],
    ['http tier', evidence({ unsubscribeMethod: 'http' })],
    ['mailto tier', evidence({ unsubscribeMethod: 'mailto' })],
  ]

  for (const [name, row] of cases) {
    it(`agrees with the server gate: ${name}`, () => {
      expect(unsubscribeRefusalReason(row)).toBe(gateReason(row))
    })
  }

  it('refuses a domain group whose senderAuthenticated is NULL (invariant 3)', () => {
    // The column is nullable and the evidence type collapses NULL to `false` at
    // mining time — but a row written before that collapse, or a jsonb blob from
    // any other producer, can still carry NULL. NULL IS NOT A PASS, and the card
    // must not reach a different verdict than the executor by leaning on
    // truthiness.
    const row = evidence({
      listId: null,
      senderAuthenticated: null as unknown as boolean,
    })

    expect(unsubscribeRefusalReason(row)).toBe(gateReason(row))
    expect(unsubscribeRefusalReason(row)).toMatch(/not authenticated/)
  })

  it('offers on a list-id whose senderAuthenticated is NULL — the list IS the identity', () => {
    const row = evidence({ senderAuthenticated: null as unknown as boolean })

    expect(unsubscribeRefusalReason(row)).toBeNull()
    expect(gateReason(row)).toBeNull()
  })

  it('never invents copy the gate does not publish', () => {
    for (const [, row] of cases) {
      const reason = unsubscribeRefusalReason(row)
      if (reason !== null) expect(reason).toBe(gateReason(row))
    }
  })
})
