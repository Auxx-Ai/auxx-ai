// packages/sdk/src/server/__tests__/storage.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storage } from '../storage'

/** Capture every host call so we can assert what the sugar forwarded. */
function installHost() {
  const calls: Array<{ method: string; args: unknown }> = []
  const record = (method: string, ret: unknown) => async (args: unknown) => {
    calls.push({ method, args })
    return ret
  }
  ;(global as { AUXX_SERVER_SDK?: unknown }).AUXX_SERVER_SDK = {
    storage: {
      get: record('get', { value: 42 }),
      set: record('set', undefined),
      setIfAbsent: record('setIfAbsent', true),
      remove: record('remove', undefined),
      list: record('list', { entries: [{ key: 'a', value: 1 }] }),
    },
  }
  return calls
}

afterEach(() => {
  ;(global as { AUXX_SERVER_SDK?: unknown }).AUXX_SERVER_SDK = undefined
  vi.restoreAllMocks()
})

describe('storage sugar', () => {
  let calls: ReturnType<typeof installHost>
  beforeEach(() => {
    calls = installHost()
  })

  it('plain key defaults to installation scope and collection ""', async () => {
    await storage.get('k')
    expect(calls[0]).toEqual({
      method: 'get',
      args: { collection: '', key: 'k', scope: 'installation' },
    })
  })

  it('forwards explicit scope + ttl on set', async () => {
    await storage.set('k', { a: 1 }, { scope: 'connection', ttlSeconds: 60 })
    expect(calls[0].args).toEqual({
      collection: '',
      key: 'k',
      value: { a: 1 },
      scope: 'connection',
      ttlSeconds: 60,
    })
  })

  it('get returns the host wrapper verbatim (a stored null is { value: null })', async () => {
    ;(global as any).AUXX_SERVER_SDK.storage.get = async () => ({ value: null })
    await expect(storage.get('k')).resolves.toEqual({ value: null })
    ;(global as any).AUXX_SERVER_SDK.storage.get = async () => null
    await expect(storage.get('k')).resolves.toBeNull()
  })

  it('collection() binds the name and applies defaults to every call', async () => {
    const watches = storage.collection('watch', { scope: 'connection' })
    await watches.set('1Z', { status: 'in_transit' }, { ttlSeconds: 100 })
    await watches.get('1Z')
    await watches.remove('1Z')
    expect(calls.map((c) => c.args)).toEqual([
      {
        collection: 'watch',
        key: '1Z',
        value: { status: 'in_transit' },
        scope: 'connection',
        ttlSeconds: 100,
      },
      { collection: 'watch', key: '1Z', scope: 'connection' },
      { collection: 'watch', key: '1Z', scope: 'connection' },
    ])
  })

  it('per-call scope overrides the collection default', async () => {
    const c = storage.collection('watch', { scope: 'connection' })
    await c.get('k', { scope: 'installation' })
    expect(calls[0].args).toMatchObject({ scope: 'installation' })
  })

  it('list exists only on a collection and forwards the bound scope + limit', async () => {
    const c = storage.collection('watch', { scope: 'connection' })
    const out = await c.list({ limit: 10 })
    expect(out).toEqual({ entries: [{ key: 'a', value: 1 }] })
    expect(calls[0]).toEqual({
      method: 'list',
      args: { collection: 'watch', scope: 'connection', limit: 10 },
    })
    // No `list` on the top-level handle.
    expect((storage as unknown as { list?: unknown }).list).toBeUndefined()
  })

  it('setIfAbsent returns the host boolean', async () => {
    await expect(storage.collection('webhook-events').setIfAbsent('evt', {})).resolves.toBe(true)
  })

  it('throws a clear error when the host SDK is absent', () => {
    ;(global as { AUXX_SERVER_SDK?: unknown }).AUXX_SERVER_SDK = undefined
    expect(() => storage.get('k')).toThrow(/Server SDK not available/)
  })
})
