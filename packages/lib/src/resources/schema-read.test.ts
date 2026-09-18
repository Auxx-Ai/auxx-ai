// packages/lib/src/resources/schema-read.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { CapabilityView } from '../permissions/capabilities/capability-view'
import type { Resource } from './registry'
import { getResourceFor, listResourcesFor, projectResource } from './schema-read'

const resources = vi.hoisted(() => ({ rows: [] as unknown[] }))

vi.mock('../cache/org-cache-helpers', () => ({
  getCachedResources: vi.fn(async () => resources.rows),
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) =>
      (resources.rows as Resource[]).find(
        (r) => r.id === key || r.entityType === key || r.apiSlug === key
      ) ?? null
  ),
}))

function capabilitiesSeeing(...defIds: string[]): CapabilityView {
  return { hasDefPresence: (id: string) => defIds.includes(id) } as unknown as CapabilityView
}

const contact = {
  id: 'contact',
  type: 'system',
  apiSlug: 'contacts',
  entityDefinitionId: 'def_contact',
  entityType: 'contact',
  label: 'Contact',
  plural: 'Contacts',
  icon: 'user',
  color: '#000',
  dbName: 'Contact',
  isVisible: true,
  display: {},
  fields: [
    {
      id: 'primary_email',
      key: 'primary_email',
      systemAttribute: 'primary_email',
      label: 'Email',
      type: 'string',
      fieldType: 'EMAIL',
      dbColumn: 'primaryEmail',
      dbType: 'text',
      sensitive: true,
      capabilities: { filterable: true, sortable: true, creatable: true, updatable: true },
    },
    {
      id: 'cf_stripe',
      key: 'customerId',
      label: 'Stripe customer ID',
      type: 'string',
      fieldType: 'TEXT',
      appSlug: 'stripe',
      appFieldKey: 'customerId',
      appInstallationId: 'inst_1',
      capabilities: { filterable: true, sortable: false, creatable: false, updatable: false },
    },
  ],
} as unknown as Resource

const deal = {
  id: 'def_deal',
  type: 'custom',
  apiSlug: 'deals',
  entityDefinitionId: 'def_deal',
  organizationId: 'org_1',
  dataConnectorId: 'dc_1',
  label: 'Deal',
  plural: 'Deals',
  icon: 'briefcase',
  color: '#111',
  isVisible: true,
  display: {},
  fields: [
    {
      id: 'cf_owner',
      key: 'owner',
      label: 'Owner',
      type: 'object',
      fieldType: 'RELATIONSHIP',
      relationship: {
        relationshipType: 'belongs_to',
        inverseResourceFieldId: 'def_contact:cf_deals',
        isInverse: false,
      },
      capabilities: { filterable: true, sortable: false, creatable: true, updatable: true },
    },
  ],
} as unknown as Resource

describe('projectResource', () => {
  it('keeps what an app can act on and drops storage internals', () => {
    const node = projectResource(contact)
    expect(node).toMatchObject({
      id: 'contact',
      entityDefinitionId: 'def_contact',
      apiSlug: 'contacts',
      entityType: 'contact',
      type: 'system',
      label: 'Contact',
    })
    expect(node).not.toHaveProperty('dbName')
    expect(node).not.toHaveProperty('display')
    expect(node).not.toHaveProperty('isVisible')

    const email = node.fields[0]!
    expect(email).toMatchObject({ key: 'primary_email', systemAttribute: 'primary_email' })
    expect(email).not.toHaveProperty('dbColumn')
    expect(email).not.toHaveProperty('sensitive')

    const stripe = node.fields[1]!
    expect(stripe).toMatchObject({ appSlug: 'stripe', appFieldKey: 'customerId' })
    expect(stripe).not.toHaveProperty('appInstallationId')
  })

  it('carries relationship type and inverse, and connector ownership on custom defs', () => {
    const node = projectResource(deal)
    expect(node.dataConnectorId).toBe('dc_1')
    expect(node.fields[0]!.relationship).toEqual({
      relationshipType: 'belongs_to',
      inverseResourceFieldId: 'def_contact:cf_deals',
    })
  })
})

describe('listResourcesFor / getResourceFor', () => {
  it('lists only defs the principal has presence on', async () => {
    resources.rows = [contact, deal]
    const nodes = await listResourcesFor('org_1', capabilitiesSeeing('def_contact'))
    expect(nodes.map((n) => n.id)).toEqual(['contact'])
  })

  it('resolves by id, entityType and apiSlug', async () => {
    resources.rows = [contact, deal]
    const caps = capabilitiesSeeing('def_contact', 'def_deal')
    expect((await getResourceFor('org_1', caps, 'contact'))?.id).toBe('contact')
    expect((await getResourceFor('org_1', caps, 'contacts'))?.id).toBe('contact')
    expect((await getResourceFor('org_1', caps, 'def_deal'))?.id).toBe('def_deal')
  })

  it('returns null for a hidden def exactly as for a missing one', async () => {
    resources.rows = [contact, deal]
    const caps = capabilitiesSeeing('def_contact')
    expect(await getResourceFor('org_1', caps, 'def_deal')).toBeNull()
    expect(await getResourceFor('org_1', caps, 'nope')).toBeNull()
  })
})
