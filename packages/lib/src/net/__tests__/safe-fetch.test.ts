// packages/lib/src/net/__tests__/safe-fetch.test.ts

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const dnsLookup = vi.hoisted(() => vi.fn())
vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>()
  dnsLookup.mockImplementation(actual.lookup)
  return { ...actual, default: { ...actual, lookup: dnsLookup }, lookup: dnsLookup }
})

const undiciFetch = vi.hoisted(() => vi.fn())
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>()
  undiciFetch.mockImplementation(actual.fetch)
  return { ...actual, fetch: undiciFetch }
})

import { BlockedAddressError, guardedLookup, safeDispatcher, safeFetch } from '../safe-fetch'

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port))
  })
}

let target: Server
let targetPort: number
let targetHits = 0
let redirector: Server
let redirectorPort: number
let hanging: Server
let hangingPort: number

beforeAll(async () => {
  target = createServer((_req, res) => {
    targetHits++
    res.end('internal')
  })
  targetPort = await listen(target, '127.0.0.1')

  redirector = createServer((req, res) => {
    if (req.url === '/ok') return res.end('ok')
    res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/` }).end()
  })
  redirectorPort = await listen(redirector, '::1')

  hanging = createServer(() => {})
  hangingPort = await listen(hanging, '127.0.0.1')
})

afterAll(async () => {
  for (const server of [target, redirector, hanging]) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  dnsLookup.mockClear()
  undiciFetch.mockClear()
  targetHits = 0
})

describe('safeFetch', () => {
  it('rejects non-http(s) URLs before any network call', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/Unsupported protocol/)
    await expect(safeFetch('not a url')).rejects.toThrow(/Invalid URL/)
    expect(undiciFetch).not.toHaveBeenCalled()
  })

  it('blocks an IP-literal host without a DNS lookup', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(safeFetch('http://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(
      BlockedAddressError
    )
    await expect(safeFetch(`http://[::ffff:127.0.0.1]:${targetPort}/`)).rejects.toBeInstanceOf(
      BlockedAddressError
    )
    await expect(safeFetch(`http://127.0.0.1:${targetPort}/`)).rejects.toBeInstanceOf(
      BlockedAddressError
    )
    expect(dnsLookup).not.toHaveBeenCalled()
    expect(targetHits).toBe(0)
  })

  it('blocks a name that resolves to a mix of public and private addresses', async () => {
    dnsLookup.mockImplementationOnce((_host, _opts, cb) =>
      cb(null, [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ])
    )
    await expect(safeFetch('http://mixed.example.test/')).rejects.toBeInstanceOf(
      BlockedAddressError
    )
    expect(dnsLookup).toHaveBeenCalledTimes(1)
  })

  it('blocks a redirect to a private address when dev loopback is off', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('OUTBOUND_ALLOWED_CIDRS', '::1/128')

    const ok = await safeFetch(`http://[::1]:${redirectorPort}/ok`)
    expect(await ok.text()).toBe('ok')

    await expect(safeFetch(`http://[::1]:${redirectorPort}/`)).rejects.toBeInstanceOf(
      BlockedAddressError
    )
    expect(targetHits).toBe(0)
  })

  it('follows the same redirect in dev, where loopback is allowed', async () => {
    const res = await safeFetch(`http://[::1]:${redirectorPort}/`)
    expect(await res.text()).toBe('internal')
    expect(targetHits).toBe(1)
  })

  it('aborts on timeout', async () => {
    await expect(
      safeFetch(`http://127.0.0.1:${hangingPort}/`, { timeoutMs: 50 })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('reuses the one dispatcher across calls', async () => {
    await (await safeFetch(`http://127.0.0.1:${targetPort}/`)).text()
    await (await safeFetch(`http://127.0.0.1:${targetPort}/`)).text()
    expect(undiciFetch).toHaveBeenCalledTimes(2)
    for (const [, init] of undiciFetch.mock.calls) {
      expect(init.dispatcher).toBe(safeDispatcher)
    }
  })
})

describe('guardedLookup', () => {
  const answers = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1::1', family: 6 },
  ]

  it('answers the single-address signature with the first vetted address', async () => {
    dnsLookup.mockImplementationOnce((_host, _opts, cb) => cb(null, answers))
    const result = await new Promise((resolve) =>
      guardedLookup('example.test', {}, (err, address, family) => resolve({ err, address, family }))
    )
    expect(result).toEqual({ err: null, address: '93.184.216.34', family: 4 })
  })

  it('answers the all:true signature with every address', async () => {
    dnsLookup.mockImplementationOnce((_host, _opts, cb) => cb(null, answers))
    const result = await new Promise((resolve) =>
      guardedLookup('example.test', { all: true }, (err, address) => resolve({ err, address }))
    )
    expect(result).toEqual({ err: null, address: answers })
  })

  it('rejects when any answer is private, in either signature', async () => {
    for (const options of [{}, { all: true }]) {
      dnsLookup.mockImplementationOnce((_host, _opts, cb) =>
        cb(null, [...answers, { address: 'fd00::1', family: 6 }])
      )
      const err = await new Promise((resolve) =>
        guardedLookup('example.test', options, (e) => resolve(e))
      )
      expect(err).toBeInstanceOf(BlockedAddressError)
    }
  })
})
