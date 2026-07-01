// packages/lib/src/data-connectors/resolve-sole-app-connection.test.ts
// Auto-link rule for a fresh app connector: bind ONLY when the org has exactly one
// org-scoped connection for the app installation (unambiguous). Zero or two-plus → null.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSoleAppConnection } from './mutations'

const listCredentials = vi.hoisted(() => vi.fn())
vi.mock('@auxx/credentials/store', () => ({ listCredentials }))

const ORG = 'org_1'
const INSTALL = 'inst_1'
const cred = (id: string) => ({ id })

describe('resolveSoleAppConnection', () => {
  beforeEach(() => listCredentials.mockReset())

  it('binds the sole org-scoped connection', async () => {
    listCredentials.mockResolvedValue(ok([cred('cred_a')]))
    await expect(resolveSoleAppConnection(ORG, INSTALL)).resolves.toBe('cred_a')
    // Org-scoped only (userId: null) + scoped to this app installation.
    expect(listCredentials).toHaveBeenCalledWith({
      organizationId: ORG,
      kind: 'app',
      appInstallationId: INSTALL,
      userId: null,
    })
  })

  it('leaves unbound when there is nothing to link', async () => {
    listCredentials.mockResolvedValue(ok([]))
    await expect(resolveSoleAppConnection(ORG, INSTALL)).resolves.toBeNull()
  })

  it('leaves unbound when the choice is ambiguous (two-plus)', async () => {
    listCredentials.mockResolvedValue(ok([cred('cred_a'), cred('cred_b')]))
    await expect(resolveSoleAppConnection(ORG, INSTALL)).resolves.toBeNull()
  })

  it('leaves unbound on a store error (never guesses)', async () => {
    listCredentials.mockResolvedValue(err(new Error('boom')))
    await expect(resolveSoleAppConnection(ORG, INSTALL)).resolves.toBeNull()
  })
})
