// packages/lib/src/ai/mcp/__tests__/rate-limiter.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, number>()
const redis = {
  incr: vi.fn(async (key: string) => {
    const next = (store.get(key) ?? 0) + 1
    store.set(key, next)
    return next
  }),
  pexpire: vi.fn(async () => 1),
  pttl: vi.fn(async () => 60_000),
}

vi.mock('@auxx/redis', () => ({
  getRedisClient: async () => redis,
}))

import { checkAndCountMcpCall, MCP_ORG_CALL_LIMIT, MCP_TURN_CALL_LIMIT } from '../rate-limiter'

beforeEach(() => {
  store.clear()
  redis.incr.mockClear()
})

describe('checkAndCountMcpCall', () => {
  it('allows up to the per-turn limit, then blocks with reason "turn"', async () => {
    let last = await checkAndCountMcpCall({ organizationId: 'org-1', turnId: 'turn-1' })
    for (let i = 1; i < MCP_TURN_CALL_LIMIT; i++) {
      last = await checkAndCountMcpCall({ organizationId: 'org-1', turnId: 'turn-1' })
    }
    expect(last.allowed).toBe(true)

    const blocked = await checkAndCountMcpCall({ organizationId: 'org-1', turnId: 'turn-1' })
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toBe('turn')
  })

  it('blocks with reason "org" when the org bucket exceeds the cap', async () => {
    // Pre-fill the org bucket past the limit (no turnId → only org counter increments).
    let last = { allowed: true } as { allowed: boolean; reason?: string }
    for (let i = 0; i <= MCP_ORG_CALL_LIMIT; i++) {
      last = await checkAndCountMcpCall({ organizationId: 'org-2' })
    }
    expect(last.allowed).toBe(false)
    expect(last.reason).toBe('org')
  })
})
