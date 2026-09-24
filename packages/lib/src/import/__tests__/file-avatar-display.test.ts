// packages/lib/src/import/__tests__/file-avatar-display.test.ts

import { ok } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

// The importer's create path (`createValuesForEntity`, and the update reconcile) calls
// `maybeUpdateDisplayValue` per written field; this pins that the value shape the importer
// writes, `[{ ref, sourceUrl }]`, sets `avatarUrl` from the ref and never hotlinks the source.

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({ publish: async () => undefined }),
  rooms: { orgRecords: () => 'room' },
}))
vi.mock('../../files/thumbnails', () => ({
  ensureThumbnailPresets: vi.fn(async () => ok([{ status: 'queued' }])),
}))
vi.mock('../../files/storage/queue-port', () => ({ createProductionQueuePort: () => ({}) }))

const { maybeUpdateDisplayValue } = await import('../../field-values/field-value-helpers')

describe('avatar display for an imported image', () => {
  it('sets avatarUrl from the asset ref of a one-element { ref, sourceUrl } write', async () => {
    const sets: Array<Record<string, unknown>> = []
    const db = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          sets.push(values)
          return { where: async () => undefined }
        },
      }),
    }
    const field = {
      id: 'f-image',
      type: 'FILE',
      entityDefinition: { id: 'def-product', avatarFieldId: 'f-image' },
    }

    await maybeUpdateDisplayValue(
      { db, organizationId: 'org-1', userId: 'user-1' } as never,
      'def-product:inst-1' as never,
      field as never,
      [
        {
          type: 'json',
          value: { ref: 'asset:a1', sourceUrl: 'https://cdn.example.com/a.png' },
        },
      ] as never
    )

    expect(sets).toHaveLength(1)
    expect(sets[0]!.avatarUrl).toBe('/api/files/download/asset:a1')
  })
})
