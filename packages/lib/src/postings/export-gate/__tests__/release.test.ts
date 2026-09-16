// packages/lib/src/postings/export-gate/__tests__/release.test.ts
//
// The gate standing in front of the sync queue's bulk action.
//
// Both collaborators are mocked: `evaluateExportGate` has its own suite next
// door, and `releaseExportsForSync` is the door this file is not allowed to
// change. What is under test is the composition - who gets through, what a
// refusal looks like on the row, and that a gate which cannot answer does not
// take the queue down with it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  evaluateExportGate: vi.fn(),
  releaseExportsForSync: vi.fn(),
}))

vi.mock('../reads', () => ({ evaluateExportGate: h.evaluateExportGate }))
vi.mock('../../retry-export', () => ({ releaseExportsForSync: h.releaseExportsForSync }))

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { AuxxError } from '../../../errors'
import type { SyncReleaseOutcome } from '../../retry-export'
import { releaseExportsThroughGate } from '../release'
import type { ExportGateStatus, ExportGateVerdict } from '../types'

const ORG = 'org_1'
const db = {} as Database

function verdict(
  glPostingId: string,
  status: ExportGateStatus,
  message: string | null = null
): ExportGateVerdict {
  return {
    glPostingId,
    docNumber: `DOC-${glPostingId}`,
    postingType: 'fulfillment',
    periodKey: '2026-08',
    status,
    findings: [],
    message,
  }
}

function report(verdicts: ExportGateVerdict[], unavailable: never[] = []) {
  return ok({
    checkedAt: '2026-09-15T00:00:00.000Z',
    postingsChecked: verdicts.length,
    blocked: verdicts.filter((v) => v.status === 'block').length,
    warned: verdicts.filter((v) => v.status === 'warn').length,
    verdicts,
    unavailable,
  })
}

function releasedOutcomes(ids: string[]): SyncReleaseOutcome[] {
  return ids.map((glPostingId) => ({
    glPostingId,
    docNumber: `DOC-${glPostingId}`,
    status: 'released',
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.evaluateExportGate.mockResolvedValue(report([]))
  h.releaseExportsForSync.mockImplementation(
    async (_db: unknown, input: { glPostingIds: string[] }) =>
      ok({
        released: input.glPostingIds.length,
        skipped: 0,
        failed: 0,
        outcomes: releasedOutcomes(input.glPostingIds),
      })
  )
})

describe('releaseExportsThroughGate', () => {
  it('refuses a blocked posting in the gate’s own words and never offers it to the release', async () => {
    h.evaluateExportGate.mockResolvedValue(
      report([verdict('p1', 'block', 'DOC-p1 was not sent: August 2026 still holds work.')])
    )

    const result = await releaseExportsThroughGate(db, {
      organizationId: ORG,
      glPostingIds: ['p1'],
    })

    // 🛑 Nothing was attempted, so nothing is called. A block is not a failure.
    expect(h.releaseExportsForSync).not.toHaveBeenCalled()
    expect(result._unsafeUnwrap()).toEqual({
      released: 0,
      skipped: 1,
      failed: 0,
      outcomes: [
        {
          glPostingId: 'p1',
          docNumber: 'DOC-p1',
          // `skipped`, not `error` - this is the status the queue panel renders
          // the message for without turning the row red.
          status: 'skipped',
          message: 'DOC-p1 was not sent: August 2026 still holds work.',
        },
      ],
    })
  })

  it('lets a warning through, because a warning is not a refusal', async () => {
    h.evaluateExportGate.mockResolvedValue(
      report([verdict('p1', 'warn', 'DOC-p1 can be sent, but the bank is behind.')])
    )

    const result = await releaseExportsThroughGate(db, {
      organizationId: ORG,
      glPostingIds: ['p1'],
    })

    expect(h.releaseExportsForSync).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      glPostingIds: ['p1'],
    })
    expect(result._unsafeUnwrap().released).toBe(1)
  })

  it('splits a mixed batch and re-tallies from the merged list, in the caller’s order', async () => {
    h.evaluateExportGate.mockResolvedValue(
      report([
        verdict('p1', 'clear'),
        verdict('p2', 'block', 'p2 is not ready.'),
        verdict('p3', 'warn'),
      ])
    )

    const result = await releaseExportsThroughGate(db, {
      organizationId: ORG,
      glPostingIds: ['p1', 'p2', 'p3'],
    })

    expect(h.releaseExportsForSync).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      glPostingIds: ['p1', 'p3'],
    })
    const value = result._unsafeUnwrap()
    expect(value.outcomes.map((outcome) => outcome.glPostingId)).toEqual(['p1', 'p2', 'p3'])
    expect(value).toMatchObject({ released: 2, skipped: 1, failed: 0 })
  })

  it('de-dupes the ids before either half sees them', async () => {
    await releaseExportsThroughGate(db, { organizationId: ORG, glPostingIds: ['p1', 'p1'] })

    expect(h.evaluateExportGate).toHaveBeenCalledWith(db, ORG, { glPostingIds: ['p1'] })
    expect(h.releaseExportsForSync).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      glPostingIds: ['p1'],
    })
  })

  it('fails OPEN: an unevaluable gate releases everything rather than grounding the queue', async () => {
    h.evaluateExportGate.mockResolvedValue(err(new AuxxError('Internal error')))

    const result = await releaseExportsThroughGate(db, {
      organizationId: ORG,
      glPostingIds: ['p1', 'p2'],
    })

    expect(h.releaseExportsForSync).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      glPostingIds: ['p1', 'p2'],
    })
    expect(result._unsafeUnwrap().released).toBe(2)
  })

  it('releases the postings a partial gate could still clear', async () => {
    h.evaluateExportGate.mockResolvedValue(
      report([verdict('p1', 'clear')], ['bank_reconciliation'] as never[])
    )

    const result = await releaseExportsThroughGate(db, {
      organizationId: ORG,
      glPostingIds: ['p1'],
    })
    expect(result._unsafeUnwrap().released).toBe(1)
  })

  it('gives a blocked posting words even if a future finding forgets to', async () => {
    h.evaluateExportGate.mockResolvedValue(report([verdict('p1', 'block', null)]))

    const result = await releaseExportsThroughGate(db, {
      organizationId: ORG,
      glPostingIds: ['p1'],
    })

    expect(result._unsafeUnwrap().outcomes[0]?.message).toBe(
      'The books are not ready to send this entry.'
    )
  })

  it('passes a refused release straight back', async () => {
    h.releaseExportsForSync.mockResolvedValue(err(new AuxxError('Internal error')))

    const result = await releaseExportsThroughGate(db, {
      organizationId: ORG,
      glPostingIds: ['p1'],
    })
    expect(result.isErr()).toBe(true)
  })
})
