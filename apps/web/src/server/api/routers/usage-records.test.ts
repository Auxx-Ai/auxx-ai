// apps/web/src/server/api/routers/usage-records.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG_ID = 'org_cuid000000000000000000000'

const { readRecordsUsage } = vi.hoisted(() => ({ readRecordsUsage: vi.fn() }))

vi.mock('@auxx/lib/usage', () => ({ readRecordsUsage, createUsageGuard: vi.fn() }))
vi.mock('@auxx/lib/email', () => ({ getUserOrganizationId: () => ORG_ID }))

// `trpc.ts` reaches redis/db at import time and hangs under vitest.
vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return { createTRPCRouter: t.router, protectedProcedure: t.procedure }
})

const { usageRouter } = await import('./usage')

function caller() {
  return usageRouter.createCaller({
    db: {},
    session: { organizationId: ORG_ID },
  } as never)
}

beforeEach(() => readRecordsUsage.mockReset())

describe('usage.getRecords', () => {
  it('returns the org records usage', async () => {
    const usage = { count: 850, soft: 800, hard: 1000, softReached: true, hardReached: false }
    readRecordsUsage.mockResolvedValue(ok(usage))

    expect(await caller().getRecords()).toEqual(usage)
    expect(readRecordsUsage).toHaveBeenCalledWith({}, ORG_ID)
  })

  it('rejects when the read fails', async () => {
    readRecordsUsage.mockResolvedValue(err(new Error('count failed')))

    await expect(caller().getRecords()).rejects.toThrow('count failed')
  })
})
