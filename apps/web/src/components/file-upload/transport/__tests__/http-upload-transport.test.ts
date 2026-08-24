// apps/web/src/components/file-upload/transport/__tests__/http-upload-transport.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpUploadTransport } from '../http-upload-transport'
import { isUploadTransportError } from '../upload-error'

/**
 * The one place a `fetch` stub is still the right tool: this IS the fetch layer.
 * Everything above it now takes a transport, so no other suite needs one.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(response))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const CREATE_INPUT = {
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  expectedSize: 1024,
  provider: 'S3' as const,
  entityType: 'FILE' as const,
  entityId: 'fld_1',
}

describe('httpUploadTransport.createSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the session request and returns the presigned config', async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        sessionId: 'ses_1',
        storageKey: 'org1/FILE/photo.jpg',
        uploadMethod: 'single',
        uploadType: 'PUT',
        presignedUrl: 'https://storage.test/put',
      })
    )

    const config = await httpUploadTransport.createSession(CREATE_INPUT)

    expect(config.sessionId).toBe('ses_1')
    expect(config.uploadMethod).toBe('single')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/files/upload/sessions')
    expect(JSON.parse(String(init.body))).toMatchObject({ fileName: 'photo.jpg', provider: 'S3' })
  })

  it('throws the storage-limit message instead of "Session create failed (403)"', async () => {
    stubFetch(
      jsonResponse(403, {
        error: 'USAGE_LIMIT',
        message:
          'You have reached your storage limit. Usage: 4.8GB/5GB. Upgrade your plan for more storage.',
        details: { metric: 'storageGb', upgradeRequired: 'true' },
      })
    )

    const error = await httpUploadTransport.createSession(CREATE_INPUT).catch((e) => e)

    expect(isUploadTransportError(error)).toBe(true)
    expect(error.message).toContain('Upgrade your plan for more storage')
    expect(error.status).toBe(403)
    expect(error.code).toBe('USAGE_LIMIT')
  })
})

describe('httpUploadTransport.completeSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const body = { size: 1024, mimeType: 'image/jpeg', etag: 'etag-1' }

  it('posts to the session-scoped complete route and returns the produced ids', async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        success: true,
        sessionId: 'ses_1',
        storageLocationId: 'sl_1',
        assetId: 'ast_1',
        url: 'https://cdn.test/1',
      })
    )

    const result = await httpUploadTransport.completeSession('ses_1', body)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/files/upload/ses_1/complete')
    expect(result.assetId).toBe('ast_1')
  })

  it('surfaces the real reason for a 422 policy violation (PR 4e)', async () => {
    stubFetch(
      jsonResponse(422, {
        error: 'Uploaded object is not an image',
        errorType: 'validation',
        retryable: false,
        code: 'VALIDATION_ERROR',
      })
    )

    const error = await httpUploadTransport.completeSession('ses_1', body).catch((e) => e)

    expect(error.message).toBe('Uploaded object is not an image')
    expect(error.status).toBe(422)
    expect(error.retryable).toBe(false)
  })

  it('treats an unreadable 200 body as an empty result, not a failure', async () => {
    stubFetch(new Response('not json', { status: 200 }))

    await expect(httpUploadTransport.completeSession('ses_1', body)).resolves.toEqual({})
  })
})
