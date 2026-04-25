// packages/lib/src/field-hooks/__tests__/registry.test.ts

import type { RecordId } from '@auxx/types/resource'
import { describe, expect, it, vi } from 'vitest'
import type { CachedField } from '../../field-values/types'
import {
  getEntityPreDeleteHooks,
  getFieldPreHooks,
  hasFieldPreHooks,
  registerEntityPreDeleteHooks,
  registerFieldPreHooks,
} from '../registry'
import type { FieldPreHookEvent } from '../types'

const TEST_RECORD: RecordId = 'fhk-test-record:abc' as RecordId

function buildEvent(overrides: Partial<FieldPreHookEvent> = {}): FieldPreHookEvent {
  return {
    recordId: TEST_RECORD,
    entityDefinitionId: 'fhk-test-def',
    entityType: null,
    entitySlug: 'fhk-tests',
    fieldId: 'fld_1',
    systemAttribute: 'title',
    field: { id: 'fld_1', systemAttribute: 'title' } as unknown as CachedField,
    newValue: 'before',
    existingValue: undefined,
    allValues: new Map<string, unknown>([['fld_1', 'before']]),
    organizationId: 'org_1',
    userId: 'user_1',
    bypass: new Set(),
    ...overrides,
  }
}

describe('field-hooks registry — pre-hooks', () => {
  it('returns empty list when no pre-hooks registered for slug + attribute', () => {
    expect(getFieldPreHooks('fhk-empty-slug', 'title')).toHaveLength(0)
    expect(hasFieldPreHooks('fhk-empty-slug', 'title')).toBe(false)
  })

  it('keys hooks by (entitySlug, systemAttribute) — different slugs do not collide', () => {
    const slugA = 'fhk-slug-a'
    const slugB = 'fhk-slug-b'
    const handlerA = vi.fn(async () => 'A')
    const handlerB = vi.fn(async () => 'B')
    registerFieldPreHooks(slugA, 'tag_parent', [handlerA])
    registerFieldPreHooks(slugB, 'tag_parent', [handlerB])

    expect(getFieldPreHooks(slugA, 'tag_parent')).toEqual([handlerA])
    expect(getFieldPreHooks(slugB, 'tag_parent')).toEqual([handlerB])
  })

  it('runs entity-scoped hooks before global ("*"-scoped) hooks', async () => {
    const slug = 'fhk-order-slug'
    const calls: string[] = []
    const scoped = async () => {
      calls.push('scoped')
      return 'mid'
    }
    const global = async () => {
      calls.push('global')
      return 'last'
    }
    registerFieldPreHooks(slug, 'tag_parent', [scoped])
    registerFieldPreHooks('*', 'tag_parent', [global])

    const chain = getFieldPreHooks(slug, 'tag_parent')
    expect(chain).toEqual([scoped, global])

    let value: unknown = 'first'
    for (const fn of chain) {
      value = await fn(buildEvent({ newValue: value }))
    }
    expect(calls).toEqual(['scoped', 'global'])
    expect(value).toBe('last')
  })

  it('registers multiple hooks under one (slug, attribute) and preserves order', () => {
    const slug = 'fhk-multi-slug'
    const a = vi.fn(async () => 'A')
    const b = vi.fn(async () => 'B')
    registerFieldPreHooks(slug, 'title', [a])
    registerFieldPreHooks(slug, 'title', [b])

    expect(getFieldPreHooks(slug, 'title')).toEqual([a, b])
  })

  it('hasFieldPreHooks reports true when entity-scoped or global hooks exist', () => {
    const slug = 'fhk-has-slug'
    expect(hasFieldPreHooks(slug, 'title')).toBe(false)

    registerFieldPreHooks(slug, 'title', [async () => 'x'])
    expect(hasFieldPreHooks(slug, 'title')).toBe(true)

    registerFieldPreHooks('*', 'tag_parent', [async () => 'y'])
    expect(hasFieldPreHooks('any-other-slug', 'tag_parent')).toBe(true)
  })
})

describe('field-hooks registry — pre-delete hooks', () => {
  it('returns empty list when nothing registered', () => {
    expect(getEntityPreDeleteHooks('fhk-pd-empty')).toHaveLength(0)
  })

  it('appends handlers across registrations on the same slug', () => {
    const slug = 'fhk-pd-multi'
    const a = vi.fn(async () => undefined)
    const b = vi.fn(async () => undefined)
    registerEntityPreDeleteHooks(slug, [a])
    registerEntityPreDeleteHooks(slug, [b])
    expect(getEntityPreDeleteHooks(slug)).toEqual([a, b])
  })
})
