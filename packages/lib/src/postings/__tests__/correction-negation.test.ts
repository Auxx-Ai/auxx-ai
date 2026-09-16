// packages/lib/src/postings/__tests__/correction-negation.test.ts

/**
 * The invariant the ledger was missing: a correction must EXACTLY reverse the
 * effect it corrects (task 54). Corrections were structurally supported from
 * the beginning and never once accepted — 9,102 `AccountingWork` rows, all
 * `operation: 'original'` — so nothing ever constrained what one may contain.
 */

import { describe, expect, it } from 'vitest'

type Line = { glAccountId: string; direction: 'debit' | 'credit'; amountMinor: string }

/** `account → signed minor`, debit positive. Mirrors `accept-entry.ts`. */
function netByAccount(contribution: readonly Line[]): Map<string, bigint> {
  const net = new Map<string, bigint>()
  for (const line of contribution) {
    const signed = (line.direction === 'debit' ? 1n : -1n) * BigInt(line.amountMinor)
    net.set(line.glAccountId, (net.get(line.glAccountId) ?? 0n) + signed)
  }
  return net
}

function negates(original: readonly Line[], correction: readonly Line[]): boolean {
  const was = netByAccount(original)
  const now = netByAccount(correction)
  for (const account of new Set([...was.keys(), ...now.keys()]))
    if ((now.get(account) ?? 0n) !== -(was.get(account) ?? 0n)) return false
  return true
}

/** A $120 invoice receipt: Dr bank, Cr A/R. */
const receipt: Line[] = [
  { glAccountId: 'gl-bank', direction: 'debit', amountMinor: '120' },
  { glAccountId: 'gl-ar', direction: 'credit', amountMinor: '120' },
]

describe('a correction must reverse the effect it corrects', () => {
  it('accepts the exact reversal', () => {
    const reversal: Line[] = [
      { glAccountId: 'gl-ar', direction: 'debit', amountMinor: '120' },
      { glAccountId: 'gl-bank', direction: 'credit', amountMinor: '120' },
    ]
    expect(negates(receipt, reversal)).toBe(true)
  })

  it('refuses a reversal of the wrong amount', () => {
    const short: Line[] = [
      { glAccountId: 'gl-ar', direction: 'debit', amountMinor: '100' },
      { glAccountId: 'gl-bank', direction: 'credit', amountMinor: '100' },
    ]
    expect(negates(receipt, short)).toBe(false)
  })

  it('refuses a balanced journal that touches different accounts', () => {
    // This is the hole the check closes: balanced, plausible, and not a
    // reversal of anything.
    const impostor: Line[] = [
      { glAccountId: 'gl-suspense', direction: 'debit', amountMinor: '120' },
      { glAccountId: 'gl-bank', direction: 'credit', amountMinor: '120' },
    ]
    expect(negates(receipt, impostor)).toBe(false)
  })

  it('refuses a re-post of the original rather than its reversal', () => {
    expect(negates(receipt, receipt)).toBe(false)
  })

  it('accepts a reversal that regroups lines, as long as accounts net out', () => {
    // A tax split posted as three lines may come back as one per account.
    const split: Line[] = [
      { glAccountId: 'gl-bank', direction: 'debit', amountMinor: '120' },
      { glAccountId: 'gl-ar', direction: 'credit', amountMinor: '100' },
      { glAccountId: 'gl-ar', direction: 'credit', amountMinor: '20' },
    ]
    const merged: Line[] = [
      { glAccountId: 'gl-ar', direction: 'debit', amountMinor: '120' },
      { glAccountId: 'gl-bank', direction: 'credit', amountMinor: '120' },
    ]
    expect(negates(split, merged)).toBe(true)
  })

  it('refuses a correction that leaves an account of the original untouched', () => {
    const partial: Line[] = [
      { glAccountId: 'gl-ar', direction: 'debit', amountMinor: '120' },
      { glAccountId: 'gl-suspense', direction: 'credit', amountMinor: '120' },
    ]
    expect(negates(receipt, partial)).toBe(false)
  })
})
