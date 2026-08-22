// packages/lib/src/files/storage/__tests__/providers.test.ts

/**
 * The provider registry, which was a `private static` on `StorageManager`.
 *
 * `vi.mock` is called zero times here: the registry is pure data and its
 * loaders are `import()` expressions, so asking "is `DROPBOX` supported?"
 * touches nothing. That is the property the Phase-2 write pilot wanted when it
 * duplicated the set as a local `SUPPORTED_PROVIDERS` rather than construct a
 * `StorageManager` to answer it — `storage/locations.ts` now reads this.
 */

import { describe, expect, it } from 'vitest'
import type { ProviderId } from '../../adapters/base-adapter'
import { AVAILABLE_PROVIDERS, isProviderAvailable } from '../providers'

describe('isProviderAvailable', () => {
  it('accepts S3, the only provider with an adapter today', () => {
    expect(isProviderAvailable('S3')).toBe(true)
  })

  it.each<ProviderId>([
    'GOOGLE_DRIVE',
    'DROPBOX',
    'ONEDRIVE',
    'BOX',
    'GENERIC_URL',
  ])('rejects %s, whose adapter is still a commented-out stub', (provider) => {
    expect(isProviderAvailable(provider)).toBe(false)
  })

  it('agrees with the exported set', () => {
    expect([...AVAILABLE_PROVIDERS]).toEqual(['S3'])
    for (const provider of AVAILABLE_PROVIDERS) {
      expect(isProviderAvailable(provider)).toBe(true)
    }
  })
})
