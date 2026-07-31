// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/schema-references.test.ts
//
// `validateSchemaReferences` gates every `@[entity:…]` / `@[field:…]` chip an
// agent prompt or procedure body can carry.
//
// The regression this file exists for: the predicate used to test ONLY storage
// identity (`CustomField.id` CUID / `<defCUID>:<fieldCUID>`), while every
// producer of a field chip — `list_entity_fields`, the `set_agent_prompt`
// guidance, the client renderer — speaks the human-readable identity
// (`systemAttribute ?? key`). The two never met, so every system-attributed
// field (`contact_status`, `ticket_priority`, …) was permanently unresolvable
// and no agent in the database ever stored a single field chip.
//
// This loosens a validator, so the negative cases below matter as much as the
// positive ones.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceField } from '../../../../../../resources/registry/field-types'
import type { Resource } from '../../../../../../resources/registry/types'
import { validateSchemaReferences } from '../schema-references'

const findCachedResource = vi.fn()
const getCachedResources = vi.fn()

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  findCachedResource: (...args: unknown[]) => findCachedResource(...args),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
}))

const ORG = 'org_1'
const CONTACTS_DEF = 'mzxt3cxyzhm3cbtgcbpmeir1'

/** Chip node as the editor stores it. */
const chip = (id: string) => ({ type: 'reference', attrs: { id } })
const doc = (...ids: string[]) => ({ type: 'doc', content: ids.map(chip) })

/**
 * A seeded system field: identity is the CustomField CUID, `key` is the static
 * registry key, and `systemAttribute` is what `list_entity_fields` returns.
 * All three differ — which is the whole point.
 */
const statusField = {
  id: 'cf_cuid_status',
  key: 'status',
  systemAttribute: 'contact_status',
  resourceFieldId: `${CONTACTS_DEF}:cf_cuid_status`,
  label: 'Status',
} as unknown as ResourceField

/** A pure custom field: `key` IS the CUID, no systemAttribute. */
const customField = {
  id: 'cf_cuid_custom',
  key: 'cf_cuid_custom',
  resourceFieldId: `${CONTACTS_DEF}:cf_cuid_custom`,
  label: 'Loyalty Tier',
} as unknown as ResourceField

const contacts = {
  id: CONTACTS_DEF,
  apiSlug: 'contacts',
  entityType: 'contact',
  label: 'Contact',
  fields: [statusField, customField],
} as unknown as Resource

beforeEach(() => {
  vi.clearAllMocks()
  getCachedResources.mockResolvedValue([contacts])
  findCachedResource.mockImplementation(async (_org: string, key: string) =>
    key === CONTACTS_DEF || key === 'contacts' || key === 'contact' ? contacts : null
  )
})

describe('validateSchemaReferences — field chips', () => {
  it('accepts the systemAttribute form with an apiSlug entity key', async () => {
    // The exact chip the builder emitted and the server rejected three times.
    const r = await validateSchemaReferences(doc('field:contacts:contact_status'), ORG)
    expect(r.unresolvedReferences).toEqual([])
    expect(r.errorMessage).toBeUndefined()
  })

  it('accepts the systemAttribute form with a definition-id entity key', async () => {
    const r = await validateSchemaReferences(doc(`field:${CONTACTS_DEF}:contact_status`), ORG)
    expect(r.unresolvedReferences).toEqual([])
  })

  it('accepts the static registry key', async () => {
    const r = await validateSchemaReferences(doc('field:contacts:status'), ORG)
    expect(r.unresolvedReferences).toEqual([])
  })

  it('still accepts the storage identity (CustomField id)', async () => {
    const r = await validateSchemaReferences(doc('field:contacts:cf_cuid_status'), ORG)
    expect(r.unresolvedReferences).toEqual([])
  })

  it('still accepts a pure custom field, whose key is its CUID', async () => {
    // Regression guard: this is the ONE case that worked before the widening.
    const r = await validateSchemaReferences(doc('field:contacts:cf_cuid_custom'), ORG)
    expect(r.unresolvedReferences).toEqual([])
  })

  it('accepts the fully-qualified resourceFieldId form', async () => {
    const r = await validateSchemaReferences(doc(`field:${CONTACTS_DEF}:cf_cuid_status`), ORG)
    expect(r.unresolvedReferences).toEqual([])
  })

  it('validates only the root segment of a relationship traversal', async () => {
    const r = await validateSchemaReferences(
      doc('field:contacts:contact_status::orders:total'),
      ORG
    )
    expect(r.unresolvedReferences).toEqual([])
  })
})

describe('validateSchemaReferences — still rejects what it should', () => {
  it('rejects a field id that does not exist on a valid entity', async () => {
    const r = await validateSchemaReferences(doc('field:contacts:nope_not_a_field'), ORG)
    expect(r.unresolvedReferences).toEqual(['field:contacts:nope_not_a_field'])
    expect(r.errorMessage).toBeDefined()
  })

  it('does not let a field id leak across entities', async () => {
    // `contact_status` is real, but not on `orders`.
    findCachedResource.mockImplementation(async (_o: string, key: string) =>
      key === 'orders'
        ? ({
            id: 'orders_def',
            apiSlug: 'orders',
            label: 'Order',
            fields: [],
          } as unknown as Resource)
        : key === 'contacts'
          ? contacts
          : null
    )
    const r = await validateSchemaReferences(doc('field:orders:contact_status'), ORG)
    expect(r.unresolvedReferences).toEqual(['field:orders:contact_status'])
  })

  it('rejects an unresolvable entity key', async () => {
    const r = await validateSchemaReferences(doc('entity:not_a_real_slug'), ORG)
    expect(r.unresolvedReferences).toEqual(['entity:not_a_real_slug'])
  })

  it('rejects a malformed field chip with no field segment', async () => {
    const r = await validateSchemaReferences(doc('field:contacts'), ORG)
    expect(r.unresolvedReferences).toEqual(['field:contacts'])
  })
})

describe('validateSchemaReferences — rejection message is actionable', () => {
  it('tells a bad-field caller NOT to swap the entity key form', async () => {
    // The old message sent callers around the apiSlug <-> definition-id loop
    // forever. Both forms resolve; saying so is what terminates the retry.
    const r = await validateSchemaReferences(doc('field:contacts:nope_not_a_field'), ORG)
    expect(r.errorMessage).toContain('will NOT help')
    expect(r.errorMessage).toContain('list_entity_fields')
  })

  it('does not dump the whole apiSlug list when only a field id is wrong', async () => {
    const r = await validateSchemaReferences(doc('field:contacts:nope_not_a_field'), ORG)
    expect(r.errorMessage).not.toContain("don't resolve")
  })

  it('lists the valid entity keys when an entity chip is wrong', async () => {
    const r = await validateSchemaReferences(doc('entity:not_a_real_slug'), ORG)
    expect(r.errorMessage).toContain('contacts')
  })
})
