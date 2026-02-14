// packages/database/lambda/__tests__/deploy.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Vitest mock for filesystem stat checks. */
const mockStat = vi.fn()
/** Vitest mock for drizzle client factory. */
const mockDrizzle = vi.fn()
/** Vitest mock for the Drizzle migrator. */
const mockMigrate = vi.fn()
/** Vitest mock capturing pg.Pool constructor calls. */
const mockPoolConstructor = vi.fn()
/** Vitest mock for pg.Pool shutdown. */
const mockPoolEnd = vi.fn()

/** In-memory representation of the SST Resource linkage. */
const mockResource = {
  AuxxAiRds: {
    host: 'example-host',
    port: 5432,
    username: 'postgres',
    password: 'password',
    database: 'example-db',
  },
}

vi.mock('node:fs/promises', () => ({
  stat: mockStat,
}))

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: mockDrizzle,
}))

vi.mock('drizzle-orm/node-postgres/migrator', () => ({
  migrate: mockMigrate,
}))

vi.mock('pg', () => {
  /** Minimal pg.Pool stand-in used by the tests. */
  class MockPool {
    constructor(config: unknown) {
      mockPoolConstructor(config)
    }

    /**
     * Mocked pool shutdown.
     */
    async end() {
      await mockPoolEnd()
    }
  }

  return {
    Pool: MockPool,
  }
})

vi.mock('sst', () => ({
  Resource: mockResource,
}))

const { handler } = await import('../deploy')

describe('database deploy lambda', () => {
  /** Reset shared mocks before each test run. */
  beforeEach(() => {
    mockStat.mockReset()
    mockDrizzle.mockReset()
    mockMigrate.mockReset()
    mockPoolConstructor.mockReset()
    mockPoolEnd.mockReset()

    delete process.env.DATABASE_URL

    mockResource.AuxxAiRds = {
      host: 'example-host',
      port: 5432,
      username: 'postgres',
      password: 'password',
      database: 'example-db',
    }
  })

  it('returns success when migrations execute', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true })
    mockDrizzle.mockReturnValue({})
    mockMigrate.mockResolvedValue(undefined)
    mockPoolEnd.mockResolvedValue(undefined)

    const response = await handler()

    expect(response.statusCode).toBe(200)
    expect(mockPoolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgresql://postgres:password@example-host:5432/example-db',
      })
    )
    expect(mockMigrate).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        migrationsFolder: expect.stringMatching(/drizzle$/),
      })
    )
    expect(mockPoolEnd).toHaveBeenCalled()
  })

  it('prefers DATABASE_URL from environment', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true })
    mockDrizzle.mockReturnValue({})
    mockMigrate.mockResolvedValue(undefined)
    mockPoolEnd.mockResolvedValue(undefined)

    process.env.DATABASE_URL = 'postgresql://env-user:env-pass@env-host:5555/env-db'

    await handler()

    expect(mockPoolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgresql://env-user:env-pass@env-host:5555/env-db',
      })
    )
  })

  it('fails when migrations folder is missing', async () => {
    mockStat.mockRejectedValue(new Error('missing'))

    const response = await handler()

    expect(response.statusCode).toBe(500)
    expect(response.body).toContain('Missing Drizzle migrations')
  })

  it('fails when RDS resource is incomplete', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true })
    mockResource.AuxxAiRds = {} as typeof mockResource.AuxxAiRds

    const response = await handler()

    expect(response.statusCode).toBe(500)
    expect(response.body).toContain('RDS connection details are missing')
  })
})
