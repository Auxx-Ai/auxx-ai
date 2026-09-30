// packages/lib/src/inventory/builds/__tests__/reverse-build-batch-run.test.ts
//
// A reversing build must NOT inherit the batch run (plans/money/tasks/45 §4.1): run N would
// contain its own undo, and a second `undoBatchRun(N)` would try to reverse the reversals. Nor the
// demand period: netting would read the reversal as coverage for the month it undoes. The source
// IS copied, which is what makes the omission deliberate.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewBuild } from '../build-writes'
import type { BuildRecord } from '../types'
import { buildRecord } from './support/build-record'

const ORG = 'org_1'
const USER = 'user_1'
const BUILD = 'bld_1'
const BATCH_RUN = 7

const h = vi.hoisted(() => ({
  original: null as unknown as BuildRecord,
  inserted: [] as NewBuild[],
}))

vi.mock('../build-queries', () => ({
  assertBuildStatus: (
    build: BuildRecord,
    allowed: (status: BuildRecord['status']) => boolean,
    message: string
  ) => {
    if (!allowed(build.status)) throw new Error(message)
  },
  lockBuild: vi.fn(async () => h.original),
  hasBuildReversal: vi.fn(async () => false),
  readBuildMovements: vi.fn(async () => [
    {
      movementId: 'mv_1',
      partId: 'part_asm',
      type: 'build_consume',
      quantity: -20,
      unitCost: 3661,
      extendedCost: -73220,
      glRole: null,
      qtyPerUnit: 2,
      costBasis: 'standard',
    },
    {
      movementId: 'mv_2',
      partId: 'part_lift',
      type: 'build_produce',
      quantity: 10,
      unitCost: 8022,
      extendedCost: 80220,
      glRole: null,
      qtyPerUnit: null,
      costBasis: 'standard',
    },
  ]),
}))

vi.mock('../build-writes', async () => {
  const { buildRecord } = await import('./support/build-record')
  return {
    insertBuild: vi.fn(async (_db: unknown, _org: string, _user: string, build: NewBuild) => {
      h.inserted.push(build)
      return buildRecord({ ...(build as Partial<BuildRecord>), buildId: 'bld_new_1' })
    }),
  }
})

vi.mock('../build-realtime', () => ({ publishBuildsChanged: vi.fn(async () => {}) }))

vi.mock('../../movements', () => ({
  writeStockMovements: vi.fn(async (_ctx: unknown, inputs: unknown[]) =>
    ok({
      records: inputs.map((_input, i) => ({ id: `mv_new_${i}` })),
      touched: { partIds: [], purchaseOrderLineIds: [], fulfillmentLineIds: [], buildIds: [] },
    })
  ),
  settleStockMovements: vi.fn(async () => {}),
}))

vi.mock('../../../accounting/ledger/post/post-inventory-movement', () => ({
  reverseInventoryMovementPosting: async () => null,
  linkMovementsToPosting: async () => undefined,
}))

import { reverseBuild } from '../reverse-build'

const db = { transaction: async (fn: (tx: unknown) => unknown) => fn('tx') } as never

beforeEach(() => {
  vi.clearAllMocks()
  h.original = buildRecord({
    buildId: BUILD,
    status: 'completed',
    source: 'batch',
    batchRun: BATCH_RUN,
    periodStart: new Date('2026-01-01T00:00:00.000Z'),
    periodEnd: new Date('2026-02-01T00:00:00.000Z'),
    quantityProduced: 10,
    materialCost: 87864,
    producedValue: 80220,
    completedAt: new Date('2026-01-31T23:59:59.999Z'),
  })
  h.inserted = []
})

async function reverseAndReadTheNewBuild(): Promise<NewBuild> {
  const result = await reverseBuild(db, ORG, USER, { buildId: BUILD })
  expect(result.isOk()).toBe(true)
  expect(h.inserted).toHaveLength(1)
  return h.inserted[0]!
}

describe('reverseBuild and the batch run', () => {
  it('does NOT copy the run number onto the reversal', async () => {
    const reversal = await reverseAndReadTheNewBuild()
    expect(reversal.batchRun ?? null).toBeNull()
  })

  it('DOES copy the source and names the original', async () => {
    const reversal = await reverseAndReadTheNewBuild()
    expect(reversal.source).toBe('batch')
    expect(reversal.reversalOfBuildId).toBe(BUILD)
    expect(reversal.status).toBe('completed')
  })

  it('does not copy the demand period either', async () => {
    const reversal = await reverseAndReadTheNewBuild()
    expect(reversal.periodStart ?? null).toBeNull()
    expect(reversal.periodEnd ?? null).toBeNull()
  })
})
