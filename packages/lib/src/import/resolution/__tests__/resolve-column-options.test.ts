// packages/lib/src/import/resolution/__tests__/resolve-column-options.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', () => ({
  findCachedResource: vi.fn(),
}))

const { findCachedResource } = await import('../../../cache')
const { resolveColumnOptions } = await import('../resolve-column-options')

const findCachedResourceMock = vi.mocked(findCachedResource)

/**
 * A resource shaped the way the org cache really returns one. `category` is the
 * system TAGS field this was written for — label-keyed, growing per org — and
 * `status` carries explicit option ids, which is the case that separates
 * `optionKey`'s write rule from a naive `value` read.
 */
// biome-ignore lint/suspicious/noExplicitAny: the cache's Resource shape is wider than this test needs
const resource: any = {
  type: 'custom',
  id: 'part',
  entityDefinitionId: 'def-part',
  organizationId: 'org-1',
  fields: [
    { id: 'cf-title', key: 'title', type: 'STRING' },
    {
      id: 'cf-category',
      key: 'category',
      systemAttribute: 'category',
      type: 'TAGS',
      options: {
        options: [
          { label: 'Motor', value: 'Motor' },
          { label: 'Steel', value: 'Steel', color: 'blue' },
        ],
      },
    },
    {
      // `key` and `systemAttribute` deliberately disagree: a column stores the
      // OUTPUT key (`systemAttribute ?? key`), so keying this map by `key`
      // would miss every system field.
      id: 'cf-status',
      key: 'status',
      systemAttribute: 'part_status',
      type: 'SINGLE_SELECT',
      options: {
        options: [{ id: 'opt-live', label: 'Live', value: 'live_raw' }],
      },
    },
    { id: 'cf-empty', key: 'empty_select', type: 'SINGLE_SELECT', options: { options: [] } },
  ],
}

const input = { organizationId: 'org-1', entityDefinitionId: 'def-part' }

beforeEach(() => {
  vi.clearAllMocks()
  findCachedResourceMock.mockResolvedValue(resource)
})

describe('resolveColumnOptions', () => {
  it('returns the live option list keyed by target field key', async () => {
    const live = await resolveColumnOptions({ ...input, targetFieldKeys: ['category'] })

    expect(live.get('category')).toEqual([
      { label: 'Motor', value: 'Motor' },
      { label: 'Steel', value: 'Steel', color: 'blue' },
    ])
  })

  it('reads the whole mapping from ONE cache lookup', async () => {
    await resolveColumnOptions({ ...input, targetFieldKeys: ['category', 'part_status'] })

    expect(findCachedResourceMock).toHaveBeenCalledTimes(1)
  })

  it('does not touch the cache when no column is select-ish', async () => {
    const live = await resolveColumnOptions({ ...input, targetFieldKeys: [] })

    expect(live.size).toBe(0)
    expect(findCachedResourceMock).not.toHaveBeenCalled()
  })

  it('projects an id-carrying option onto its id, not its raw value', async () => {
    // `optionKey`'s write rule is `id ?? value`, so this is the key a FieldValue
    // stores. Returning `live_raw` would resolve the column to a label-shaped
    // orphan that matches no option on read.
    const live = await resolveColumnOptions({ ...input, targetFieldKeys: ['part_status'] })

    expect(live.get('part_status')).toEqual([{ label: 'Live', value: 'opt-live' }])
  })

  it('omits a field that carries no options, so the caller keeps its stored list', async () => {
    const live = await resolveColumnOptions({
      ...input,
      targetFieldKeys: ['empty_select', 'title'],
    })

    expect(live.has('empty_select')).toBe(false)
    expect(live.has('title')).toBe(false)
  })

  it('omits a key whose field has vanished from the resource', async () => {
    const live = await resolveColumnOptions({ ...input, targetFieldKeys: ['deleted_field'] })

    expect(live.size).toBe(0)
  })

  it('returns empty when the resource itself is gone', async () => {
    findCachedResourceMock.mockResolvedValue(null)

    const live = await resolveColumnOptions({ ...input, targetFieldKeys: ['category'] })

    expect(live.size).toBe(0)
  })
})
