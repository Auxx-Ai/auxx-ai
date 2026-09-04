// packages/lib/src/data-migrations/migrations/131-reseed-platform-providers-bank-feed.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_DATA_MIGRATIONS } from '../registry'

const ensurePlatformProviders = vi.fn(async (_db: unknown) => {})

vi.mock('../../connections/providers', () => ({
  ensurePlatformProviders: (db: unknown) => ensurePlatformProviders(db),
}))

const { migration131ReseedPlatformProvidersBankFeed } = await import(
  './131-reseed-platform-providers-bank-feed'
)

/** The migration never touches the db itself, so this only has to be passed on. */
const db = {} as Database

describe('migration 131, the bank feed connection definition', () => {
  beforeEach(() => {
    ensurePlatformProviders.mockClear()
  })

  it('is registered in the shared id sequence', () => {
    expect(ALL_DATA_MIGRATIONS.map((migration) => migration.id)).toContain(
      '131-reseed-platform-providers-bank-feed'
    )
  })

  it('reseeds the platform providers on the db it is handed', async () => {
    await migration131ReseedPlatformProvidersBankFeed.run(db)
    expect(ensurePlatformProviders).toHaveBeenCalledWith(db)
  })

  it('is safe to re-run against an environment that already has the definition', async () => {
    await migration131ReseedPlatformProvidersBankFeed.run(db)
    await expect(migration131ReseedPlatformProvidersBankFeed.run(db)).resolves.toBeUndefined()
    expect(ensurePlatformProviders).toHaveBeenCalledTimes(2)
  })
})
