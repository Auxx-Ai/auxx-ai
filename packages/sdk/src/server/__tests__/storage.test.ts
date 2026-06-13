// packages/sdk/src/server/__tests__/storage.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storage } from '../storage'

/**
 * The wrapper is a thin passthrough to `AUXX_SERVER_SDK.storage` — in an app
 * build `@auxx/sdk/server` is externalized to that global, so the wrapper code
 * never runs in the sandbox and the host owns the real implementation. These
 * tests assert the wrapper forwards positional calls verbatim and that the host
 * it forwards to exposes the public surface (positional args + `collection()`),
 * which is the contract production actually relies on.
 */
function installHost() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    (method: string, ret: unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return Promise.resolve(ret)
    }
  const collectionApi = {
    get: record('collection.get', { value: 7 }),
    set: record('collection.set', undefined),
    setIfAbsent: record('collection.setIfAbsent', true),
    remove: record('collection.remove', undefined),
    list: record('collection.list', { entries: [{ key: 'a', value: 1 }] }),
  }
  ;(global as { AUXX_SERVER_SDK?: unknown }).AUXX_SERVER_SDK = {
    storage: {
      get: record('get', { value: 42 }),
      set: record('set', undefined),
      setIfAbsent: record('setIfAbsent', true),
      remove: record('remove', undefined),
      collection: (name: string, defaults?: unknown) => {
        calls.push({ method: 'collection', args: [name, defaults] })
        return collectionApi
      },
    },
  }
  return calls
}

afterEach(() => {
  ;(global as { AUXX_SERVER_SDK?: unknown }).AUXX_SERVER_SDK = undefined
  vi.restoreAllMocks()
})

describe('storage wrapper (passthrough)', () => {
  let calls: ReturnType<typeof installHost>
  beforeEach(() => {
    calls = installHost()
  })

  it('forwards get positionally', async () => {
    await storage.get('k')
    expect(calls[0]).toEqual({ method: 'get', args: ['k', undefined] })
  })

  it('forwards set with value + opts positionally', async () => {
    await storage.set('k', { a: 1 }, { scope: 'connection', ttlSeconds: 60 })
    expect(calls[0]).toEqual({
      method: 'set',
      args: ['k', { a: 1 }, { scope: 'connection', ttlSeconds: 60 }],
    })
  })

  it('returns the host get wrapper verbatim (a stored null is { value: null })', async () => {
    ;(global as any).AUXX_SERVER_SDK.storage.get = async () => ({ value: null })
    await expect(storage.get('k')).resolves.toEqual({ value: null })
    ;(global as any).AUXX_SERVER_SDK.storage.get = async () => null
    await expect(storage.get('k')).resolves.toBeNull()
  })

  it('forwards collection() to the host and uses the host-bound collection api', async () => {
    const watches = storage.collection('watch', { scope: 'connection' })
    await watches.set('1Z', { status: 'in_transit' }, { ttlSeconds: 100 })
    await watches.get('1Z')
    await watches.remove('1Z')
    expect(calls).toEqual([
      { method: 'collection', args: ['watch', { scope: 'connection' }] },
      { method: 'collection.set', args: ['1Z', { status: 'in_transit' }, { ttlSeconds: 100 }] },
      { method: 'collection.get', args: ['1Z'] },
      { method: 'collection.remove', args: ['1Z'] },
    ])
  })

  it('list lives on the bound collection and forwards opts', async () => {
    const out = await storage.collection('watch', { scope: 'connection' }).list({ limit: 10 })
    expect(out).toEqual({ entries: [{ key: 'a', value: 1 }] })
    expect(calls.at(-1)).toEqual({ method: 'collection.list', args: [{ limit: 10 }] })
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
