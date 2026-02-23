// packages/lib/src/test/example.test.ts
import { describe, expect, it } from 'vitest'
import { createMockDb, createMockRedis, wait } from './utils'

describe('Example Lib Test', () => {
  it('should create mock database', () => {
    const db = createMockDb()

    expect(db.user.findUnique).toBeDefined()
    expect(db.organization.create).toBeDefined()
    expect(typeof db.user.findUnique).toBe('function')
  })

  it('should create mock redis', () => {
    const redis = createMockRedis()

    expect(redis.get).toBeDefined()
    expect(redis.set).toBeDefined()
    expect(typeof redis.get).toBe('function')
  })

  it('should handle async operations', async () => {
    const startTime = Date.now()
    await wait(50)
    const endTime = Date.now()

    // Use a lenient lower bound to avoid timer-precision flakes
    expect(endTime - startTime).toBeGreaterThanOrEqual(30)
  })

  it('should perform basic utility tests', () => {
    expect(true).toBe(true)
    expect('test').toMatch(/test/)
    expect([1, 2, 3]).toHaveLength(3)
  })
})
