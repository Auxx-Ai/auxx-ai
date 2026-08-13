// packages/lib/src/workflow-engine/catalog/build-output-context.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { Resource } from '../../resources/client'

// Partial mock — the cache barrel is imported by half of lib; replacing it wholesale
// dies at collection (see `resource-trigger-base.test.ts`). Only the one read this
// module makes is stubbed.
const getCachedResources = vi.fn()
vi.mock('../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
}))

const { buildOutputContext, buildOutputContextFromResources } = await import(
  './build-output-context'
)

/** Minimal fixtures — only the keys `findResource`'s match reads. */
const CONTACT = {
  id: 'contact',
  entityType: 'contact',
  apiSlug: 'contacts',
  label: 'Contact',
  plural: 'Contacts',
  fields: [],
} as unknown as Resource

const CUSTOM_ENTITY = {
  id: 'clq1abc123',
  apiSlug: 'entity_vendors',
  label: 'Vendor',
  plural: 'Vendors',
  fields: [],
} as unknown as Resource

const ALL_RESOURCES = [CONTACT, CUSTOM_ENTITY]

describe('buildOutputContextFromResources', () => {
  it('leaves `resource` undefined when no resourceType is given — "nothing picked yet", not an error', () => {
    const ctx = buildOutputContextFromResources(ALL_RESOURCES, undefined)
    expect(ctx.resource).toBeUndefined()
    expect(ctx.allResources).toBe(ALL_RESOURCES)
  })

  it('matches by id', () => {
    expect(buildOutputContextFromResources(ALL_RESOURCES, 'contact').resource).toBe(CONTACT)
  })

  it('matches by entityType', () => {
    expect(buildOutputContextFromResources(ALL_RESOURCES, 'contact').resource).toBe(CONTACT)
  })

  it('matches by apiSlug — a custom entity has no entityType, only an apiSlug', () => {
    expect(buildOutputContextFromResources(ALL_RESOURCES, 'entity_vendors').resource).toBe(
      CUSTOM_ENTITY
    )
  })

  it('leaves `resource` undefined for an unresolved key rather than throwing', () => {
    expect(buildOutputContextFromResources(ALL_RESOURCES, 'nonexistent').resource).toBeUndefined()
  })

  it('defaults resolveVariable to "nothing resolved" — the graph-aware callers overwrite it', () => {
    const ctx = buildOutputContextFromResources(ALL_RESOURCES, 'contact')
    expect(ctx.resolveVariable('anything')).toBeUndefined()
  })
})

describe('buildOutputContext', () => {
  it('fetches allResources once from the org cache and delegates the resource match', async () => {
    getCachedResources.mockReset()
    getCachedResources.mockResolvedValue(ALL_RESOURCES)

    const ctx = await buildOutputContext('org-1', { resourceType: 'contacts' })

    expect(getCachedResources).toHaveBeenCalledTimes(1)
    expect(getCachedResources).toHaveBeenCalledWith('org-1')
    expect(ctx.resource).toBe(CONTACT)
    expect(ctx.allResources).toBe(ALL_RESOURCES)
  })

  it('resolves resource: undefined when resourceType is omitted, without matching anything by accident', async () => {
    getCachedResources.mockReset()
    getCachedResources.mockResolvedValue(ALL_RESOURCES)

    const ctx = await buildOutputContext('org-1', {})
    expect(ctx.resource).toBeUndefined()
  })
})
