// packages/lib/src/connections/__tests__/ensure-platform-providers.test.ts
//
// `ensurePlatformProviders` is now reachable from a superadmin button, which makes it
// an operational tool rather than a seed step — and an operational tool that cannot be
// audited is worse than no tool. Two properties matter, and both are about what the run
// LEAVES BEHIND rather than what it writes:
//
//   1. `updatedAt` moves. The column has no `$onUpdate`, so unless the upsert stamps it
//      the row carries no evidence a reseed ever happened, and "did my new client secret
//      land?" has no answer in the database.
//   2. A provider that declares a system client but resolved no config is REPORTED. The
//      cred columns are deliberately left untouched rather than nulled, so a missing or
//      misspelled config key looks exactly like a successful no-op.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logInfo: vi.fn(),
  selected: [] as Array<{ id: string }>,
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    info: mocks.logInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Encryption is not what this suite is about, and a real `encryptValue` needs a key.
vi.mock('@auxx/credentials/crypto', () => ({
  encryptValue: (value: string) => `enc(${value})`,
}))

function fakeDb() {
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => mocks.selected }) }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updates.push(values)
        return { where: async () => undefined }
      },
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        mocks.inserts.push(values)
      },
    }),
  } as never
}

/** The summary the run logged, i.e. what an operator actually sees. */
function summary(): { credentialed: string[]; skippedMissingConfig: string[] } {
  const call = mocks.logInfo.mock.calls.find(
    ([message]) => message === 'Ensured platform connection providers'
  )
  return call?.[1] as { credentialed: string[]; skippedMissingConfig: string[] }
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  mocks.logInfo.mockClear()
  mocks.selected = [{ id: 'def_existing' }]
  mocks.updates = []
  mocks.inserts = []
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
})

describe('ensurePlatformProviders', () => {
  it('stamps updatedAt on every row, so a reseed is visible in the database', async () => {
    const { ensurePlatformProviders } = await import('../providers/ensure-platform-providers')
    const before = Date.now()

    await ensurePlatformProviders(fakeDb())

    expect(mocks.updates.length).toBeGreaterThan(0)
    for (const values of mocks.updates) {
      expect(values.updatedAt).toBeInstanceOf(Date)
      expect((values.updatedAt as Date).getTime()).toBeGreaterThanOrEqual(before)
    }
  })

  it('reports a provider whose system client config is missing instead of failing quietly', async () => {
    process.env.FACEBOOK_APP_ID = ''
    process.env.FACEBOOK_APP_SECRET = ''
    const { ensurePlatformProviders } = await import('../providers/ensure-platform-providers')

    await ensurePlatformProviders(fakeDb())

    // Reported, not written: the columns are left alone so a partial env cannot null a
    // live credential — which is exactly why the operator has to be told.
    expect(summary().skippedMissingConfig).toContain('facebook')
    expect(summary().credentialed).not.toContain('facebook')
    const facebookWrite = mocks.updates.find((v) => v.providerKey === 'facebook')
    expect(facebookWrite).toBeDefined()
    expect(facebookWrite?.oauth2ClientId).toBeUndefined()
    expect(facebookWrite?.oauth2ClientSecret).toBeUndefined()
  })

  it('reports — and encrypts — a provider whose client config resolved', async () => {
    process.env.FACEBOOK_APP_ID = 'app-id'
    process.env.FACEBOOK_APP_SECRET = 'app-secret'
    const { ensurePlatformProviders } = await import('../providers/ensure-platform-providers')

    await ensurePlatformProviders(fakeDb())

    expect(summary().credentialed).toEqual(expect.arrayContaining(['facebook', 'instagram']))
    const facebookWrite = mocks.updates.find((v) => v.providerKey === 'facebook')
    expect(facebookWrite?.oauth2ClientId).toBe('enc(app-id)')
    expect(facebookWrite?.oauth2ClientSecret).toBe('enc(app-secret)')
  })

  it('never lists a provider that has no system client at all', async () => {
    const { ensurePlatformProviders } = await import('../providers/ensure-platform-providers')

    await ensurePlatformProviders(fakeDb())

    // `openaiApi` and friends take the user's own key at connect time; they have no
    // platform client to bake, so neither bucket should mention them.
    const { credentialed, skippedMissingConfig } = summary()
    expect([...credentialed, ...skippedMissingConfig]).not.toContain('openaiApi')
    expect([...credentialed, ...skippedMissingConfig]).not.toContain('smtp')
  })
})
