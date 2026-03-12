// packages/lib/src/providers/google/messages/__tests__/gmail-attachment-fetcher.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageAttachmentMeta } from '../../../../email/email-storage'

const mocks = vi.hoisted(() => {
  return {
    executeWithThrottle: vi.fn(),
  }
})

vi.mock('../../shared/utils', () => ({
  executeWithThrottle: mocks.executeWithThrottle,
}))

vi.mock('../../../../utils/rate-limiter', () => ({
  getGmailQuotaCost: () => 5,
}))

import {
  fetchAllGmailAttachmentBytes,
  fetchGmailAttachmentBytes,
} from '../gmail-attachment-fetcher'

const baseContext = {
  accessToken: 'ya29.test-token',
  integrationId: 'int_123',
  throttler: {} as any,
}

function makeAttMeta(overrides: Partial<MessageAttachmentMeta> = {}): MessageAttachmentMeta {
  return {
    filename: 'file.bin',
    mimeType: 'application/octet-stream',
    size: 100,
    inline: false,
    contentId: null,
    providerAttachmentId: null,
    embeddedData: null,
    ...overrides,
  }
}

describe('fetchGmailAttachmentBytes', () => {
  beforeEach(() => {
    mocks.executeWithThrottle.mockReset()
  })

  it('fetches and decodes base64url data from Gmail API', async () => {
    // "hello world" in base64url
    const base64urlData = 'aGVsbG8gd29ybGQ'

    mocks.executeWithThrottle.mockImplementation(async (_op: string, fn: () => Promise<any>) => {
      // Simulate the fetch function
      return {
        ok: true,
        json: async () => ({ data: base64urlData, size: 11 }),
      }
    })

    const result = await fetchGmailAttachmentBytes('msg_abc', 'att_xyz', baseContext)

    expect(result).toBeInstanceOf(Buffer)
    expect(result.toString('utf-8')).toBe('hello world')
    expect(mocks.executeWithThrottle).toHaveBeenCalledOnce()
  })

  it('throws on non-ok response', async () => {
    mocks.executeWithThrottle.mockImplementation(async (_op: string, fn: () => Promise<any>) => {
      return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      }
    })

    await expect(fetchGmailAttachmentBytes('msg_abc', 'att_xyz', baseContext)).rejects.toThrow(
      'Gmail attachment fetch failed: 429 Too Many Requests'
    )
  })
})

describe('fetchAllGmailAttachmentBytes', () => {
  beforeEach(() => {
    mocks.executeWithThrottle.mockReset()
  })

  it('decodes embedded data without API call', async () => {
    // "embedded" in base64url
    const base64urlData = 'ZW1iZWRkZWQ'

    const attachments = [makeAttMeta({ embeddedData: base64urlData })]

    const { resolved, failedCount } = await fetchAllGmailAttachmentBytes(
      'msg_001',
      attachments,
      baseContext
    )

    expect(failedCount).toBe(0)
    expect(resolved.size).toBe(1)
    expect(resolved.get(0)!.toString('utf-8')).toBe('embedded')
    // No API call for embedded data
    expect(mocks.executeWithThrottle).not.toHaveBeenCalled()
  })

  it('fetches large attachment via API', async () => {
    const apiData = 'YXBpLWZldGNoZWQ' // "api-fetched"

    mocks.executeWithThrottle.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: apiData, size: 11 }),
    }))

    const attachments = [makeAttMeta({ providerAttachmentId: 'att_large_1' })]

    const { resolved, failedCount } = await fetchAllGmailAttachmentBytes(
      'msg_002',
      attachments,
      baseContext
    )

    expect(failedCount).toBe(0)
    expect(resolved.size).toBe(1)
    expect(resolved.get(0)!.toString('utf-8')).toBe('api-fetched')
    expect(mocks.executeWithThrottle).toHaveBeenCalledOnce()
  })

  it('increments failedCount on fetch failure without throwing', async () => {
    mocks.executeWithThrottle.mockImplementation(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }))

    const attachments = [makeAttMeta({ providerAttachmentId: 'att_fail_1' })]

    const { resolved, failedCount } = await fetchAllGmailAttachmentBytes(
      'msg_003',
      attachments,
      baseContext
    )

    expect(failedCount).toBe(1)
    expect(resolved.size).toBe(0)
  })

  it('increments failedCount when neither embeddedData nor providerAttachmentId', async () => {
    const attachments = [makeAttMeta({ embeddedData: null, providerAttachmentId: null })]

    const { resolved, failedCount } = await fetchAllGmailAttachmentBytes(
      'msg_004',
      attachments,
      baseContext
    )

    expect(failedCount).toBe(1)
    expect(resolved.size).toBe(0)
  })

  it('handles mixed embedded + API-fetched attachments', async () => {
    const embeddedB64 = 'ZW1i' // "emb"
    const apiB64 = 'YXBp' // "api"

    mocks.executeWithThrottle.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: apiB64, size: 3 }),
    }))

    const attachments = [
      makeAttMeta({ embeddedData: embeddedB64 }),
      makeAttMeta({ providerAttachmentId: 'att_api_1' }),
    ]

    const { resolved, failedCount } = await fetchAllGmailAttachmentBytes(
      'msg_005',
      attachments,
      baseContext
    )

    expect(failedCount).toBe(0)
    expect(resolved.size).toBe(2)
    expect(resolved.get(0)!.toString('utf-8')).toBe('emb')
    expect(resolved.get(1)!.toString('utf-8')).toBe('api')
    // Only one API call (for the non-embedded attachment)
    expect(mocks.executeWithThrottle).toHaveBeenCalledOnce()
  })

  it('continues processing after a single fetch failure', async () => {
    const embeddedB64 = 'b2s' // "ok"

    mocks.executeWithThrottle.mockImplementation(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }))

    const attachments = [
      makeAttMeta({ providerAttachmentId: 'att_will_fail' }),
      makeAttMeta({ embeddedData: embeddedB64 }),
    ]

    const { resolved, failedCount } = await fetchAllGmailAttachmentBytes(
      'msg_006',
      attachments,
      baseContext
    )

    expect(failedCount).toBe(1)
    expect(resolved.size).toBe(1)
    expect(resolved.get(1)!.toString('utf-8')).toBe('ok')
  })
})
