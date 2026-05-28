// packages/lib/src/geo/__tests__/geo-manager.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetGeoForTests, initGeo, lookupIp } from '../geo-manager'

describe('geo-manager', () => {
  const originalProvider = process.env.AUXX_GEO_PROVIDER
  const originalDbPath = process.env.MAXMIND_DB_PATH

  beforeEach(() => {
    __resetGeoForTests()
  })

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.AUXX_GEO_PROVIDER
    else process.env.AUXX_GEO_PROVIDER = originalProvider
    if (originalDbPath === undefined) delete process.env.MAXMIND_DB_PATH
    else process.env.MAXMIND_DB_PATH = originalDbPath
  })

  it('returns null before initGeo() has run', async () => {
    expect(await lookupIp('8.8.8.8')).toBeNull()
  })

  it('returns null for empty / nullish input', async () => {
    process.env.AUXX_GEO_PROVIDER = 'none'
    await initGeo()
    expect(await lookupIp(null)).toBeNull()
    expect(await lookupIp(undefined)).toBeNull()
    expect(await lookupIp('')).toBeNull()
  })

  it('short-circuits private IPs without calling the provider', async () => {
    process.env.AUXX_GEO_PROVIDER = 'none'
    await initGeo()
    expect(await lookupIp('127.0.0.1')).toBeNull()
    expect(await lookupIp('10.0.0.1')).toBeNull()
  })

  it('noop provider returns null for any public IP', async () => {
    process.env.AUXX_GEO_PROVIDER = 'none'
    await initGeo()
    expect(await lookupIp('8.8.8.8')).toBeNull()
  })

  it('falls back to noop on unknown provider name', async () => {
    process.env.AUXX_GEO_PROVIDER = 'bogus'
    await initGeo()
    expect(await lookupIp('8.8.8.8')).toBeNull()
  })

  it('falls back to noop when maxmind cannot find the mmdb', async () => {
    process.env.AUXX_GEO_PROVIDER = 'maxmind'
    process.env.MAXMIND_DB_PATH = '/nonexistent/path/GeoLite2-City.mmdb'
    await initGeo()
    // Should not throw and lookups should return null.
    expect(await lookupIp('8.8.8.8')).toBeNull()
  })
})
