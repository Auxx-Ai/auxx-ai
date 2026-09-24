// packages/lib/src/files/__tests__/fetch-remote-image.test.ts

import { ok } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UsageLimitError } from '../../errors'

const safeFetch = vi.hoisted(() => vi.fn())
const assertStorageQuota = vi.hoisted(() => vi.fn())
const uploadContent = vi.hoisted(() => vi.fn())

vi.mock('../../net/safe-fetch', () => ({ safeFetch }))
vi.mock('../lifecycle/quota-cleanup', () => ({ assertStorageQuota }))
vi.mock('../storage/storage-manager', () => ({
  createStorageManager: () => ({ uploadContent }),
}))
vi.mock('../assets', () => ({
  createAssetWithVersion: vi.fn(async () => ok({ asset: { id: 'asset-1' } })),
}))

import {
  fetchAndStoreRemoteImage,
  isRetryableFetchError,
  normalizeImageUrl,
} from '../fetch-remote-image'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

const db = { transaction: (fn: (tx: unknown) => unknown) => fn({}) }

function run(extra: Record<string, unknown> = {}) {
  return fetchAndStoreRemoteImage({
    db: db as never,
    url: 'https://cdn.example.com/a.png',
    organizationId: 'org-1',
    userId: 'user-1',
    pathPrefix: 'p',
    purpose: 'product-image',
    name: 'image',
    ...extra,
  })
}

/** An endless body that counts how many chunks were pulled. */
function endlessBody(chunk = 1000) {
  const state = { pulls: 0 }
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls++
      controller.enqueue(new Uint8Array(chunk))
    },
  })
  return { stream, state }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('normalizeImageUrl', () => {
  it.each([
    [
      'https://www.dropbox.com/s/abc/photo.jpg?dl=0',
      'https://www.dropbox.com/s/abc/photo.jpg?raw=1',
    ],
    [
      'https://www.dropbox.com/scl/fi/x/photo.jpg?rlkey=k&dl=0',
      'https://www.dropbox.com/scl/fi/x/photo.jpg?rlkey=k&raw=1',
    ],
    [
      'https://drive.google.com/file/d/1AbC_d-E/view?usp=sharing',
      'https://drive.google.com/uc?export=download&id=1AbC_d-E',
    ],
    ['https://cdn.shopify.com/s/files/a.jpg?v=1', 'https://cdn.shopify.com/s/files/a.jpg?v=1'],
    [
      'https://dl.dropboxusercontent.com/s/abc/a.jpg',
      'https://dl.dropboxusercontent.com/s/abc/a.jpg',
    ],
    ['not a url', 'not a url'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeImageUrl(input)).toBe(expected)
  })
})

describe('fetchAndStoreRemoteImage', () => {
  it('stores a PNG and checks the quota for its size', async () => {
    safeFetch.mockResolvedValue(new Response(new Uint8Array(PNG)))
    uploadContent.mockResolvedValue({ id: 'loc-1' })

    const result = await run()

    expect(result).toEqual({
      assetId: 'asset-1',
      ref: 'asset:asset-1',
      mimeType: 'image/png',
      size: PNG.byteLength,
    })
    expect(assertStorageQuota).toHaveBeenCalledWith({ db, organizationId: 'org-1' }, PNG.byteLength)
  })

  it('fetches the normalized URL', async () => {
    safeFetch.mockResolvedValue(new Response(new Uint8Array(PNG)))
    uploadContent.mockResolvedValue({ id: 'loc-1' })
    await run({ url: 'https://drive.google.com/file/d/xyz/view' })
    expect(safeFetch.mock.calls[0]?.[0]).toBe('https://drive.google.com/uc?export=download&id=xyz')
  })

  it('skips the quota check when the caller already did it', async () => {
    safeFetch.mockResolvedValue(new Response(new Uint8Array(PNG)))
    uploadContent.mockResolvedValue({ id: 'loc-1' })
    await run({ skipQuotaCheck: true })
    expect(assertStorageQuota).not.toHaveBeenCalled()
  })

  it('does not store anything when over quota', async () => {
    safeFetch.mockResolvedValue(new Response(new Uint8Array(PNG)))
    assertStorageQuota.mockRejectedValueOnce(
      new UsageLimitError({ metric: 'storageGb', current: 1, limit: 1 })
    )
    const error = await run().catch((e) => e)
    expect(error).toBeInstanceOf(UsageLimitError)
    expect(isRetryableFetchError(error)).toBe(false)
    expect(uploadContent).not.toHaveBeenCalled()
  })

  it('refuses on a declared content-length over the cap without reading the body', async () => {
    const { stream, state } = endlessBody()
    safeFetch.mockResolvedValue(new Response(stream, { headers: { 'content-length': '999999' } }))
    const error = await run({ maxBytes: 2500 }).catch((e) => e)
    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toMatch(/too large/)
    expect(state.pulls).toBeLessThanOrEqual(1)
  })

  it('stops reading once the running total passes the cap', async () => {
    const { stream, state } = endlessBody()
    safeFetch.mockResolvedValue(new Response(stream))
    const error = await run({ maxBytes: 2500 }).catch((e) => e)
    expect(error).toBeInstanceOf(BadRequestError)
    expect(state.pulls).toBeLessThan(10)
    expect(uploadContent).not.toHaveBeenCalled()
  })

  it('refuses SVG unless the caller opts in', async () => {
    safeFetch.mockResolvedValue(new Response(new Uint8Array(SVG)))
    await expect(run()).rejects.toBeInstanceOf(BadRequestError)

    safeFetch.mockResolvedValue(new Response(new Uint8Array(SVG)))
    uploadContent.mockResolvedValue({ id: 'loc-1' })
    expect((await run({ allowSvg: true })).mimeType).toBe('image/svg+xml')
  })

  it('refuses a body that is not an image', async () => {
    safeFetch.mockResolvedValue(new Response('<html>login</html>'))
    await expect(run()).rejects.toBeInstanceOf(BadRequestError)
  })

  it('treats 4xx as permanent and 5xx / 429 / network errors as retryable', async () => {
    safeFetch.mockResolvedValue(new Response('', { status: 404 }))
    expect(isRetryableFetchError(await run().catch((e) => e))).toBe(false)

    safeFetch.mockResolvedValue(new Response('', { status: 503 }))
    expect(isRetryableFetchError(await run().catch((e) => e))).toBe(true)

    safeFetch.mockResolvedValue(new Response('', { status: 429 }))
    expect(isRetryableFetchError(await run().catch((e) => e))).toBe(true)

    safeFetch.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    expect(isRetryableFetchError(await run().catch((e) => e))).toBe(true)
  })
})
