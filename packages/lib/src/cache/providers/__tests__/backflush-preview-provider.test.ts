// packages/lib/src/cache/providers/__tests__/backflush-preview-provider.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  previewBackflush: vi.fn(),
  summarizeBackflushPlan: vi.fn(),
}))

vi.mock('../../../inventory/builds/backflush-preview', () => ({
  previewBackflush: h.previewBackflush,
  summarizeBackflushPlan: h.summarizeBackflushPlan,
}))

import type { Database } from '@auxx/database'
import { ORG_CACHE_KEY_CONFIG } from '../../org-cache-keys'
import { backflushPreviewProvider } from '../backflush-preview-provider'

const ORG = 'org_1'
const db = { tag: 'provider-db' } as unknown as Database

beforeEach(() => {
  h.previewBackflush.mockReset()
  h.summarizeBackflushPlan.mockReset()
})

describe('backflushPreviewProvider', () => {
  it('previews the default range and caches the summary', async () => {
    const plan = { buildCount: 25 }
    h.previewBackflush.mockResolvedValue(ok(plan))
    h.summarizeBackflushPlan.mockReturnValue({ buildCount: 25, parts: [] })
    expect(await backflushPreviewProvider.compute(ORG, db)).toEqual({ buildCount: 25, parts: [] })
    expect(h.previewBackflush).toHaveBeenCalledWith(db, ORG, {})
    expect(h.summarizeBackflushPlan).toHaveBeenCalledWith(plan)
  })

  it('throws on a failed preview so nothing is cached', async () => {
    h.previewBackflush.mockResolvedValue(err(new Error('boom')))
    await expect(backflushPreviewProvider.compute(ORG, db)).rejects.toThrow('boom')
  })

  it('is lazy with a short TTL', () => {
    expect(ORG_CACHE_KEY_CONFIG.backflushPreview.lazy).toBe(true)
    expect(ORG_CACHE_KEY_CONFIG.backflushPreview.ttlSeconds).toBeLessThanOrEqual(600)
  })
})
