// packages/lib/src/postings/reports/pdf/__tests__/provider-sync-block.test.ts
//
// The "synced through" marker on the PRINTED statement - brief 20 §7.3.
//
// 🛑 **The property under test is that the PDF and the screen cannot disagree.**
// The firm posts December's depreciation in February, so auxx's December balance
// sheet is incomplete until the sync restates it. The screen at least has a
// person in front of it; the PDF is the copy that gets emailed to an accountant
// and then read months later. Two implementations of "is this statement
// complete" is exactly the bug the feature exists to prevent, so every assertion
// below is written against `describeProviderSyncCoverage`'s own answer rather
// than against a literal sentence copied out of the component.
//
// The parts are plain functions returning react-pdf elements, so they are called
// directly and their element tree walked. No renderer, no per-row work, and
// nothing here needs a database.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSyncMarker, ProviderSyncReading } from '../../../provider-sync/client'

type Client = typeof import('../../../provider-sync/client')

/**
 * The one function, wrapped in a spy. It delegates to the real implementation
 * for every test but one, which makes it answer something no statement could
 * produce to prove the page prints whatever it says.
 */
const describeCoverage = vi.hoisted(() => vi.fn())

vi.mock('../../../provider-sync/client', async (importOriginal) => {
  const actual = await importOriginal<Client>()
  return { ...actual, describeProviderSyncCoverage: describeCoverage }
})

const { describeProviderSyncCoverage } = await vi.importActual<Client>(
  '../../../provider-sync/client'
)
const { ProviderSyncBlock, providerSyncFooterNotice } = await import('../statement-parts')

/** Every string the element tree would print, flattened. */
function printedText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(printedText).join(' ')
  if (typeof node === 'object' && 'props' in node) {
    const { children } = (node as { props: { children?: unknown } }).props
    return printedText(children)
  }
  return ''
}

const CONNECTED: ProviderSyncMarker = {
  connected: true,
  providerId: 'quickbooks',
  syncedThrough: '2026-11-30',
}

beforeEach(() => {
  describeCoverage.mockReset()
  describeCoverage.mockImplementation(describeProviderSyncCoverage)
})

describe('the four states, on the printed page', () => {
  it('🛑 prints NOTHING at all for an org with no provider', () => {
    const marker: ProviderSyncMarker = {
      connected: false,
      providerId: 'none',
      syncedThrough: null,
    }

    // Not "synced through: never", not an empty strip, and no footer stamp
    // either: a marker on an unconnected org implies a connection exists.
    expect(ProviderSyncBlock({ marker, through: '2026-12-31' })).toBeNull()
    expect(providerSyncFooterNotice(marker, '2026-12-31')).toBeNull()
  })

  it('prints nothing when the marker could not be read at all', () => {
    // Same rule, different cause. A missing line is a much smaller problem than
    // a wrong one, which is `CompletenessBanner`'s rule and this follows it.
    expect(ProviderSyncBlock({ marker: null, through: '2026-12-31' })).toBeNull()
    expect(providerSyncFooterNotice(null, '2026-12-31')).toBeNull()
  })

  it('names the never-synced case, and stamps every page with it', () => {
    const marker: ProviderSyncMarker = {
      connected: true,
      providerId: 'quickbooks',
      syncedThrough: null,
    }
    const reading = describeProviderSyncCoverage(marker, '2026-12-31')
    expect(reading.coverage).toBe('never_synced')

    const printed = printedText(ProviderSyncBlock({ marker, through: '2026-12-31' }))

    expect(printed).toContain('STATEMENT INCOMPLETE')
    expect(printed).toContain(reading.headline ?? '')
    expect(printed).toContain(reading.detail ?? '')
    expect(providerSyncFooterNotice(marker, '2026-12-31')).toBe(reading.headline)
  })

  it('🛑 carries the incomplete reading when the range ends AFTER the marker', () => {
    // The case the feature exists for: a 31 December balance sheet on an org
    // read through 30 November is missing every entry the accountant authored in
    // between, and its figures will change when the sync catches up.
    const reading = describeProviderSyncCoverage(CONNECTED, '2026-12-31')
    expect(reading.coverage).toBe('behind')

    const printed = printedText(ProviderSyncBlock({ marker: CONNECTED, through: '2026-12-31' }))

    expect(printed).toContain(reading.headline ?? '')
    expect(printed).toContain(reading.detail ?? '')
    // The kicker is the PDF's own affordance, not a second reading: with no
    // colour to lean on, the box is inverted and captioned rather than tinted.
    expect(printed).toContain('STATEMENT INCOMPLETE')
    // And it repeats on every page, because a statement is flipped to the page
    // holding the number somebody cares about, not read from the top.
    expect(providerSyncFooterNotice(CONNECTED, '2026-12-31')).toBe(reading.headline)
  })

  it('confirms quietly when the marker reaches the end of the range', () => {
    const reading = describeProviderSyncCoverage(CONNECTED, '2026-11-30')
    expect(reading.coverage).toBe('current')

    const printed = printedText(ProviderSyncBlock({ marker: CONNECTED, through: '2026-11-30' }))

    expect(printed).toBe(reading.headline)
    // One quiet line, deliberately NOT the box: a complete statement should not
    // carry a warning telling it so, and it does not stamp every page either.
    expect(printed).not.toContain('STATEMENT INCOMPLETE')
    expect(providerSyncFooterNotice(CONNECTED, '2026-11-30')).toBeNull()
    // A statement ending BEFORE the marker is covered by the same reading.
    expect(printedText(ProviderSyncBlock({ marker: CONNECTED, through: '2026-06-30' }))).toBe(
      describeProviderSyncCoverage(CONNECTED, '2026-06-30').headline
    )
  })
})

describe('the PDF and the screen cannot disagree', () => {
  it('🛑 prints whatever describeProviderSyncCoverage says, and computes nothing itself', () => {
    // If the PDF ever grew its own thresholds or its own wording, this fails:
    // the one function is made to answer something no statement could produce,
    // and the page must still print exactly that.
    const sentinel: ProviderSyncReading = {
      coverage: 'behind',
      headline: 'HEADLINE-FROM-THE-ONE-FUNCTION',
      detail: 'DETAIL-FROM-THE-ONE-FUNCTION',
    }
    describeCoverage.mockReturnValue(sentinel)

    const printed = printedText(ProviderSyncBlock({ marker: CONNECTED, through: '2026-12-31' }))

    expect(printed).toContain(sentinel.headline ?? '')
    expect(printed).toContain(sentinel.detail ?? '')
    expect(providerSyncFooterNotice(CONNECTED, '2026-12-31')).toBe(sentinel.headline)
    // Judged against the statement's own through-date, not the run date and not
    // the range start.
    expect(describeCoverage).toHaveBeenCalledWith(CONNECTED, '2026-12-31')
  })

  it('renders nothing whenever the one function declines to, whatever the reason', () => {
    describeCoverage.mockReturnValue({
      coverage: 'not_connected',
      headline: null,
      detail: null,
    } satisfies ProviderSyncReading)

    expect(ProviderSyncBlock({ marker: CONNECTED, through: '2026-12-31' })).toBeNull()
    expect(providerSyncFooterNotice(CONNECTED, '2026-12-31')).toBeNull()
  })
})
