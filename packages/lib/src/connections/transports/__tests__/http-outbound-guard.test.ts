// packages/lib/src/connections/transports/__tests__/http-outbound-guard.test.ts

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BlockedAddressError } from '../../../net/safe-fetch'
import { httpTransport } from '../http'

let server: Server
let base: string
let hits: Array<{ contentType?: string; body: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      hits.push({ contentType: req.headers['content-type'], body })
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

afterEach(() => {
  vi.unstubAllEnvs()
  hits = []
})

describe('httpTransport outbound address guard', () => {
  it('refuses a loopback base URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(
      httpTransport.request(null, { method: 'GET', url: `${base}/items` })
    ).rejects.toBeInstanceOf(BlockedAddressError)
    expect(hits).toHaveLength(0)
  })

  it('sends a FormData body as multipart when the address is allowed', async () => {
    const form = new FormData()
    form.append('name', 'widget')
    const res = await httpTransport.request(null, {
      method: 'POST',
      url: `${base}/upload`,
      body: form,
    })

    expect(res.ok).toBe(true)
    expect(hits[0]?.contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(hits[0]?.body).toContain('name="name"\r\n\r\nwidget')
  })
})
