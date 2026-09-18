// packages/lib/src/postings/__tests__/unsync-eligibility.test.ts
//
// R1-R4 of plans/accounting/tasks/60-un-syncing-from-the-provider.md §3.
//
// What is under test is the REFUSAL TABLE, not the delivery machinery: each of
// these is a per-row outcome the sync queue renders verbatim, and the sentence
// is the whole product. A refusal that names the wrong thing sends somebody to
// debug a mechanism their row was never in.
//
// 🔌 No provider is named anywhere - `providerLabel` throughout, per D14a.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../accounting-commit-lock', () => ({ withAccountingCommitLock: vi.fn() }))
vi.mock('../../money/quickbooks/invoke-quickbooks-tool', () => ({
  resolveQuickbooksContext: vi.fn(),
}))

import type { Database } from '@auxx/database'
import { readUnsyncTarget } from '../unsync/reads'

const ORG = 'org_1'
const LABEL = 'Ledgerly'

/**
 * A stub `Database` answering `readUnsyncTarget`'s four selects in order:
 * posting, delivery, external object, reversal.
 */
function stubDb(...results: unknown[][]) {
  const queue = [...results]
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit'])
    chain[method] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(queue.shift() ?? []).then(resolve, reject)

  const tx = { select: () => chain }
  return { transaction: (fn: (tx: unknown) => unknown) => Promise.resolve(fn(tx)) } as Database
}

const posting = (overrides: Record<string, unknown> = {}) => ({
  id: 'gl_a',
  docNumber: 'GL-2026-09-001',
  status: 'posted',
  exportStatus: 'exported',
  deliveryIntent: 'automatic',
  ...overrides,
})
const delivery = { id: 'del_1', bookId: 'book_1', attemptEpoch: 0 }
const object = { id: 'obj_1', externalId: '184', remoteVersion: '3' }

const read = (db: Database) =>
  readUnsyncTarget(db, { organizationId: ORG, glPostingId: 'gl_a', providerLabel: LABEL })

beforeEach(() => vi.clearAllMocks())

describe('readUnsyncTarget', () => {
  it('accepts a delivered entry and hands back the handle the withdrawal needs', async () => {
    const result = await read(stubDb([posting()], [delivery], [object], []))

    expect(result).toMatchObject({
      eligible: true,
      docNumber: 'GL-2026-09-001',
      target: { externalId: '184', remoteVersion: '3', attemptEpoch: 0, objectId: 'obj_1' },
    })
  })

  it('R1: refuses an entry that was never sent', async () => {
    // A `failed` row uses Retry; a held row is already un-synced.
    const result = await read(stubDb([posting({ exportStatus: 'failed' })]))

    expect(result).toMatchObject({ eligible: false })
    expect(result.eligible === false && result.reason).toContain('was never sent')
  })

  it('R2 is retired: a legacy row with no deliveryIntent now falls through to R3', async () => {
    // `GlPosting.deliveryIntent` is gone (§0b, TARGET §1) - the column that
    // used to mark "predates the delivery pipeline" cannot be read any more,
    // so a row with no delivery lands on R3's ordinary refusal instead of a
    // dedicated R2 sentence.
    const result = await read(stubDb([posting({ deliveryIntent: null })], [], [], []))

    expect(result.eligible === false && result.reason).toContain('no record of what was created')
  })

  it('R3: refuses when nothing records what was created there, and names the provider', async () => {
    const result = await read(stubDb([posting()], [delivery], [], []))

    expect(result.eligible === false && result.reason).toBe(
      `We have no record of what was created in ${LABEL}, so nothing can be removed safely.`
    )
  })

  it('R3: a delivery that was never planned is the same refusal, not a crash', async () => {
    const result = await read(stubDb([posting()], [], [], []))

    expect(result.eligible === false && result.reason).toContain('no record of what was created')
  })

  it('R4: refuses a reversed entry and names its reversal', async () => {
    // Removing one half leaves the provider holding an unbalanced correction.
    const result = await read(
      stubDb(
        [posting({ status: 'reversed' })],
        [delivery],
        [object],
        [{ docNumber: 'GL-2026-09-001-R1' }]
      )
    )

    const reason = result.eligible === false ? result.reason : ''
    expect(reason).toContain('has been reversed by GL-2026-09-001-R1')
    expect(reason).toContain(`leaves ${LABEL} holding an unbalanced correction`)
  })

  it('R4: fires on a posting still marked posted whose reversal already exists', async () => {
    // The pair is created before the original flips, so the reversal row is the
    // fact that matters - checking `status` alone would miss the window.
    const result = await read(
      stubDb([posting()], [delivery], [object], [{ docNumber: 'GL-2026-09-001-R1' }])
    )

    expect(result.eligible).toBe(false)
  })

  it('reports an id that is not this organization’s rather than throwing', async () => {
    const result = await read(stubDb([]))

    expect(result).toEqual({ eligible: false, docNumber: null, reason: 'Not found.' })
  })
})
