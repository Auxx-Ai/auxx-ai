// apps/web/src/components/resources/utils/normalize-record-id.test.ts
// Hardening-plan Part 8: prefix index + resolver — seed resolution, static
// tier, hydration replace + hook recompute, reference stability, reset.

import type { CustomResource, Resource } from '@auxx/lib/resources/client'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getResourceStoreState, useResourceStore } from '../store/resource-store'
import {
  canNormalizeRecordId,
  getNormalizedDefinitionId,
  getNormalizedRecordId,
  tryNormalizeRecordId,
  useNormalizedRecordId,
} from './normalize-record-id'

const WORK_ORDER_DEF = 'cmworkorderdef12345678'
const CUSTOM_DEF = 'cmcustomdef12345678901'

function makeResource(overrides: Partial<CustomResource>): Resource {
  return {
    id: CUSTOM_DEF,
    type: 'custom',
    apiSlug: 'gadgets',
    entityDefinitionId: CUSTOM_DEF,
    organizationId: 'org_1',
    label: 'Gadget',
    plural: 'Gadgets',
    icon: 'box',
    color: 'blue',
    isVisible: true,
    fields: [],
    display: {
      primaryDisplayField: null,
      secondaryDisplayField: null,
      avatarField: null,
      defaultSortField: 'updatedAt',
      defaultSortDirection: 'desc',
      orgScopingStrategy: 'direct',
    },
    ...overrides,
  } as Resource
}

const workOrderResource = makeResource({
  id: WORK_ORDER_DEF,
  entityDefinitionId: WORK_ORDER_DEF,
  entityType: 'work_order',
  apiSlug: 'work_orders',
  label: 'Work Order',
  plural: 'Work Orders',
})

const customResource = makeResource({})

beforeEach(() => {
  getResourceStoreState().reset()
})

describe('static tier resolution (no seed, no hydration)', () => {
  it('legacy system names resolve to themselves', () => {
    expect(getNormalizedRecordId('thread:abc')).toBe('thread:abc')
    expect(canNormalizeRecordId('thread:abc')).toBe(true)
    expect(tryNormalizeRecordId('thread:abc')).toBe('thread:abc')
  })

  it('legacy apiSlugs resolve to the system name', () => {
    expect(getNormalizedRecordId('threads:abc')).toBe('thread:abc')
    expect(tryNormalizeRecordId('threads:abc')).toBe('thread:abc')
  })

  it('long-form definition ids are processable before hydration', () => {
    const id = `${WORK_ORDER_DEF}:inst1` as const
    expect(getNormalizedRecordId(id)).toBe(id)
    expect(canNormalizeRecordId(id)).toBe(true)
    expect(tryNormalizeRecordId(id)).toBe(id)
  })

  it('def-backed entityTypes are unresolved until a mapping exists', () => {
    expect(canNormalizeRecordId('work_order:abc')).toBe(false)
    expect(tryNormalizeRecordId('work_order:abc')).toBeNull()
    // getNormalizedRecordId is a no-op (never throws / never guesses)
    expect(getNormalizedRecordId('work_order:abc')).toBe('work_order:abc')
  })
})

describe('dynamic tier (hydrated prefix map)', () => {
  beforeEach(() => {
    getResourceStoreState().setResources([workOrderResource, customResource])
  })

  it('resolves entityType, apiSlug, and identity forms to the canonical id', () => {
    expect(getNormalizedRecordId('work_order:x')).toBe(`${WORK_ORDER_DEF}:x`)
    expect(getNormalizedRecordId('work_orders:x')).toBe(`${WORK_ORDER_DEF}:x`)
    expect(getNormalizedRecordId(`${WORK_ORDER_DEF}:x`)).toBe(`${WORK_ORDER_DEF}:x`)
    expect(getNormalizedDefinitionId('gadgets')).toBe(CUSTOM_DEF)
  })

  it('partial mapping does not claim an unrelated alias is resolvable', () => {
    expect(canNormalizeRecordId('contact:abc')).toBe(false)
  })

  it('reset clears the mapping (org switch) — aliases become unresolved again', () => {
    getResourceStoreState().reset()
    expect(canNormalizeRecordId('work_order:x')).toBe(false)
    // static tier is unaffected by reset
    expect(canNormalizeRecordId('thread:x')).toBe(true)
  })
})

describe('setResources prefix-map reference stability', () => {
  it('reuses the map reference when mappings are unchanged', () => {
    getResourceStoreState().setResources([workOrderResource])
    const first = useResourceStore.getState().definitionIdByPrefix
    // Same resources again (e.g. field-only refetch)
    getResourceStoreState().setResources([workOrderResource])
    expect(useResourceStore.getState().definitionIdByPrefix).toBe(first)
  })

  it('replaces the reference when a mapping is added', () => {
    getResourceStoreState().setResources([workOrderResource])
    const first = useResourceStore.getState().definitionIdByPrefix
    getResourceStoreState().setResources([workOrderResource, customResource])
    const second = useResourceStore.getState().definitionIdByPrefix
    expect(second).not.toBe(first)
    expect(second.get('gadgets')).toBe(CUSTOM_DEF)
  })
})

describe('useNormalizedRecordId', () => {
  it('recomputes when hydration adds the mapping (no sticky memo)', () => {
    const { result } = renderHook(() => useNormalizedRecordId('work_order:x'))
    expect(result.current).toBe('work_order:x')

    act(() => {
      getResourceStoreState().setResources([workOrderResource])
    })
    expect(result.current).toBe(`${WORK_ORDER_DEF}:x`)
  })

  it('field-only updates (unchanged mappings) keep the same result identity', () => {
    act(() => {
      getResourceStoreState().setResources([workOrderResource])
    })
    const { result, rerender } = renderHook(() => useNormalizedRecordId('work_order:x'))
    const first = result.current
    act(() => {
      getResourceStoreState().setResources([workOrderResource])
    })
    rerender()
    expect(result.current).toBe(first)
  })
})
