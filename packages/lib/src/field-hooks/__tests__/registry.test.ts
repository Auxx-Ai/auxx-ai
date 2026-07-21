// packages/lib/src/field-hooks/__tests__/registry.test.ts

import type { FieldType } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'
import { describe, expect, it, vi } from 'vitest'
import type { CachedField } from '../../field-values/types'
import {
  getEntityFieldChangeHooks,
  getEntityPreDeleteHooks,
  getFieldPreHooks,
  getFieldTypeChangeHooks,
  hasFieldPreHooks,
  hasFieldTypeChangeHooks,
  registerEntityFieldChangeHooks,
  registerEntityPreDeleteHooks,
  registerFieldPreHooks,
  registerFieldTypeChangeHooks,
} from '../registry'
import type { EntityFieldChangeEvent, FieldPreHookEvent } from '../types'

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

function buildFieldChangeEvent(
  overrides: Partial<EntityFieldChangeEvent> = {}
): EntityFieldChangeEvent {
  return {
    recordId: TEST_RECORD,
    entityDefinitionId: 'fhk-test-def',
    entityType: null,
    entitySlug: 'fhk-tests',
    field: { id: 'fld_1', type: 'ADDRESS_STRUCT' } as unknown as CachedField,
    oldValue: null,
    newValue: null,
    oldDisplay: null,
    newDisplay: null,
    organizationId: 'org_1',
    userId: 'user_1',
    ...overrides,
  }
}

describe('field-hooks registry — field-type-keyed post-write hooks (decision #13)', () => {
  it('returns empty list / false when nothing registered for a fieldType', () => {
    expect(getFieldTypeChangeHooks('fhk-empty-type' as FieldType)).toHaveLength(0)
    expect(hasFieldTypeChangeHooks('fhk-empty-type' as FieldType)).toBe(false)
  })

  it('registers handlers keyed by fieldType, independent of entitySlug', async () => {
    const fieldType = 'fhk-address-type' as FieldType
    const otherType = 'fhk-other-type' as FieldType
    const handler = vi.fn(async () => undefined)
    registerFieldTypeChangeHooks(fieldType, [handler])

    expect(getFieldTypeChangeHooks(fieldType)).toEqual([handler])
    expect(hasFieldTypeChangeHooks(fieldType)).toBe(true)
    // A different field type never registered here stays cheap/false — the
    // whole point of type-keying instead of a '*' sentinel (decision #13).
    expect(hasFieldTypeChangeHooks(otherType)).toBe(false)
    expect(getFieldTypeChangeHooks(otherType)).toHaveLength(0)

    await getFieldTypeChangeHooks(fieldType)[0]!(buildFieldChangeEvent())
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('appends multiple handlers under the same fieldType and preserves order', () => {
    const fieldType = 'fhk-multi-type' as FieldType
    const a = vi.fn(async () => undefined)
    const b = vi.fn(async () => undefined)
    registerFieldTypeChangeHooks(fieldType, [a])
    registerFieldTypeChangeHooks(fieldType, [b])

    expect(getFieldTypeChangeHooks(fieldType)).toEqual([a, b])
  })

  it('composes entity-scoped hooks before field-type-keyed hooks (the fire-point pattern)', () => {
    const slug = 'fhk-compose-slug'
    const fieldType = 'fhk-compose-type' as FieldType
    const entityHandler = vi.fn(async () => undefined)
    const typeHandler = vi.fn(async () => undefined)
    registerEntityFieldChangeHooks(slug, [entityHandler])
    registerFieldTypeChangeHooks(fieldType, [typeHandler])

    // Mirrors the fire-point composition in field-value-mutations.ts: entity chain first,
    // then the field's type-keyed chain (decision #13's ordering requirement) — NOT a '*'
    // sentinel, so unrelated slugs/types are unaffected. Asserted structurally (position),
    // not by invoking the chain: `getEntityFieldChangeHooks` also carries this process's
    // real `'*'`-registered global hooks (`registerAllHooks` runs lazily on first access and
    // stays registered for the rest of the suite) — calling those with a synthetic event
    // would reach real infra (queues/redis), which this unit test has no business touching.
    const handlers = [...getEntityFieldChangeHooks(slug), ...getFieldTypeChangeHooks(fieldType)]

    expect(handlers[0]).toBe(entityHandler)
    expect(handlers[handlers.length - 1]).toBe(typeHandler)
    expect(handlers.indexOf(entityHandler)).toBeLessThan(handlers.indexOf(typeHandler))
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
