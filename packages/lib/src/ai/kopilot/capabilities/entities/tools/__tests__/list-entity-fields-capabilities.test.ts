// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/list-entity-fields-capabilities.test.ts
//
// Permissions v2 §3 / plan 19b gap G4: `list_entity_fields` returned the full
// field schema (ids, types, options, relationships, flags) for ANY definition
// with no capability check, reopening through a tool call exactly the
// disclosure doc 14 §3.4 removed from the prompt catalog. It now requires
// definition-level Read, and an unviewable def must be indistinguishable from
// one that does not exist — including in the "valid apiSlugs" hint.

import { describe, expect, it, vi } from 'vitest'

const RESOURCES = [
  {
    id: 'def_contact',
    entityDefinitionId: 'def_contact',
    apiSlug: 'contact',
    entityType: 'contact',
    label: 'Contact',
    fields: [
      {
        id: 'contact_name',
        key: 'name',
        label: 'Name',
        fieldType: 'NAME',
        systemAttribute: 'name',
        isRequired: true,
      },
    ],
  },
  {
    id: 'def_invoice',
    entityDefinitionId: 'def_invoice',
    apiSlug: 'invoice',
    entityType: 'invoice',
    label: 'Invoice',
    fields: [
      {
        id: 'invoice_total',
        key: 'total',
        label: 'Total',
        fieldType: 'CURRENCY',
        systemAttribute: 'total',
      },
    ],
  },
]

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) =>
      RESOURCES.find((r) => r.id === key || r.entityType === key || r.apiSlug === key) ?? null
  ),
  getCachedResources: vi.fn(async () => RESOURCES),
}))

import type { CapabilityView } from '../../../../../../permissions/capabilities/capability-view'
import { Level } from '../../../../../../permissions/capabilities/registry'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { createListEntityFieldsTool } from '../list-entity-fields'

/** All-permissive `CapabilityView`; override just the gate under test. */
function makeCapabilities(overrides: Partial<CapabilityView> = {}): CapabilityView {
  const yes = () => true
  const noop = () => {}
  return {
    can: yes,
    has: yes,
    assert: noop,
    areaLevel: () => Level.Full,
    canWriteEntity: yes,
    assertWriteEntity: noop,
    canEditEntity: yes,
    assertEditEntity: noop,
    filterEditableDefIds: (ids: string[]) => ids,
    canViewEntity: yes,
    assertViewEntity: noop,
    filterViewableDefIds: (ids: string[]) => ids,
    viewAccessFor: () => undefined,
    canAdministerDef: yes,
    assertAdministerDef: noop,
    canViewInstance: yes,
    canEditInstance: yes,
    canAdminInstance: yes,
    assertViewInstance: noop,
    assertEditInstance: noop,
    assertAdminInstance: noop,
    ...overrides,
  }
}

/** Denies exactly one def, mirroring a published policy of `None` on it. */
function denying(defId: string): CapabilityView {
  return makeCapabilities({ canViewEntity: (id: string) => id !== defId })
}

function runTool(entityDefinitionId: string, capabilities?: CapabilityView) {
  const tool = createListEntityFieldsTool(() => ({ db: {}, capabilities }) as never)
  const ctx = { organizationId: 'org_1', userId: 'u_1' } as ToolContext
  return tool.execute({ entityDefinitionId }, ctx) as Promise<AgentToolResult>
}

describe('list_entity_fields — read enforcement', () => {
  it('returns the schema for a viewable definition', async () => {
    const result = await runTool('invoice', makeCapabilities())

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ entityDefinitionId: 'def_invoice' })
    expect((result.output as { fields: unknown[] }).fields).toHaveLength(1)
  })

  it('without capabilities, discloses the schema as before', async () => {
    const result = await runTool('invoice', undefined)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ entityDefinitionId: 'def_invoice' })
  })

  it('refuses an unviewable definition and leaks no field data', async () => {
    const result = await runTool('invoice', denying('def_invoice'))

    expect(result.success).toBe(false)
    expect(result.output).toBeNull()
    expect(result.error).toContain('not found')
    expect(JSON.stringify(result)).not.toContain('invoice_total')
  })

  it('denial is byte-identical to an unknown slug, so existence stays hidden', async () => {
    const capabilities = denying('def_invoice')

    const denied = await runTool('invoice', capabilities)
    const unknown = await runTool('no_such_thing', capabilities)

    const suffixOf = (error: string | undefined) => error?.slice(error.indexOf('not found'))
    expect(suffixOf(denied.error)).toBe(suffixOf(unknown.error))
  })

  it('filters the suggested apiSlug list to viewable definitions', async () => {
    const result = await runTool('no_such_thing', denying('def_invoice'))

    expect(result.error).toContain('contact')
    expect(result.error).not.toContain('invoice')
  })

  it('without capabilities, the suggested apiSlug list is unfiltered', async () => {
    const result = await runTool('no_such_thing', undefined)

    expect(result.error).toContain('contact')
    expect(result.error).toContain('invoice')
  })
})
