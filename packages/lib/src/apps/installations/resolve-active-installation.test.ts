// packages/lib/src/apps/installations/resolve-active-installation.test.ts
//
// This resolver is the authoritative one — `app-workflow-block-processor`
// overwrites a node's stored `installationId` with whatever it returns — and it
// shipped as an unordered `findFirst` with no type filter. An org holding both a
// development and a production installation got whichever row the database
// handed back, so a block could execute as development while the settings page
// wrote to production, and app settings are keyed by `appInstallationId`.
//
// What is pinned: it reads EVERY live installation and prefers production, in
// either arrival order. Mutation-checked — reverting to `findFirst` semantics
// (take row zero) fails the second case.

import { describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  database: { query: { AppInstallation: { findMany: (...a: unknown[]) => findMany(...a) } } },
}))

const { resolveActiveInstallationId } = await import('./resolve-active-installation')

const DEV = { id: 'dev_1', installationType: 'development' }
const PROD = { id: 'prod_1', installationType: 'production' }

describe('resolveActiveInstallationId', () => {
  it('returns the production installation when both are live', async () => {
    findMany.mockResolvedValueOnce([DEV, PROD])
    const result = await resolveActiveInstallationId('app_1', 'org_1')
    expect(result.isOk() && result.value).toBe('prod_1')
  })

  it('still returns production when the database hands back production first', async () => {
    // The unordered `findFirst` this replaced would have been right here by
    // luck and wrong above — which is exactly why it was unstable.
    findMany.mockResolvedValueOnce([PROD, DEV])
    const result = await resolveActiveInstallationId('app_1', 'org_1')
    expect(result.isOk() && result.value).toBe('prod_1')
  })

  it('falls back to a lone development installation', async () => {
    findMany.mockResolvedValueOnce([DEV])
    const result = await resolveActiveInstallationId('app_1', 'org_1')
    expect(result.isOk() && result.value).toBe('dev_1')
  })

  it('errors when the app has no live installation', async () => {
    findMany.mockResolvedValueOnce([])
    const result = await resolveActiveInstallationId('app_1', 'org_1')
    expect(result.isErr()).toBe(true)
    expect(result.isErr() && result.error.message).toContain('No active installation found')
  })

  it('selects installationType, or the preference has nothing to read', async () => {
    findMany.mockResolvedValueOnce([PROD])
    await resolveActiveInstallationId('app_1', 'org_1')
    expect(findMany.mock.calls[0]?.[0]?.columns).toEqual({ id: true, installationType: true })
  })

  it('returns an err rather than throwing when the query fails', async () => {
    findMany.mockRejectedValueOnce(new Error('connection reset'))
    const result = await resolveActiveInstallationId('app_1', 'org_1')
    expect(result.isErr()).toBe(true)
  })
})
