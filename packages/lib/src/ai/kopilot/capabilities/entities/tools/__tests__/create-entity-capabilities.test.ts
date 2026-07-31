// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/create-entity-capabilities.test.ts
//
// Permissions v2 §3.3 (Phase C1): `create_entity` must hand its resolved
// `CapabilityView` to `UnifiedCrudHandler`, whose `create` asserts
// `canEditEntity`. Absent capabilities (the un-threaded workflow AI node) must
// behave byte-for-byte as before.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSpy = vi.fn()
const constructedOptions: Array<{ capabilities?: CapabilityView } | undefined> = []

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  findCachedResource: vi.fn(async () => ({
    id: 'contact',
    entityDefinitionId: 'def_contact',
    label: 'Contact',
    fields: [],
  })),
  getCachedResources: vi.fn(async () => []),
}))

vi.mock('../field-label-helpers', () => ({
  validateFieldKeys: () => ({ unknownKeys: [], validIds: ['name'] }),
  formatUnknownFieldsError: () => 'unknown fields',
  resolveFieldLabels: (_r: unknown, ids: string[]) => ids,
}))

vi.mock('../resolve-actor-values', () => ({
  resolveActorValues: async (values: Record<string, unknown>) => ({ values, errors: [] }),
  formatActorResolutionError: () => 'actor error',
}))

// Stand-in for the real handler that reproduces the one line under test:
// `create` asserts `assertEditEntity` when capabilities were threaded in.
vi.mock('../../../../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    private readonly capabilities?: CapabilityView
    constructor(
      _org: string,
      _user: string,
      _db: unknown,
      _def: unknown,
      options?: { capabilities?: CapabilityView }
    ) {
      constructedOptions.push(options)
      this.capabilities = options?.capabilities
    }
    async create(entityDefinitionId: string, values: Record<string, unknown>) {
      this.capabilities?.assertEditEntity(entityDefinitionId)
      return createSpy(entityDefinitionId, values)
    }
  },
}))

import type { Rung } from '@auxx/database/enums'
import { ForbiddenError } from '../../../../../../errors'
import type { CapabilityView } from '../../../../../../permissions/capabilities/capability-view'
import { Level } from '../../../../../../permissions/capabilities/registry'
import { satisfiesRung } from '../../../../../../permissions/capabilities/rung'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { createCreateEntityTool } from '../create-entity'

/** All-permissive `CapabilityView`; override just the gate under test. */
function makeCapabilities(overrides: Partial<CapabilityView> = {}): CapabilityView {
  const yes = () => true
  const noop = () => {}
  const view: CapabilityView = {
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
    hasDefPresence: (id: string) => view.canViewEntity(id),
    hasRecordGrantsOn: () => false,
    recordDefRung: (id: string) => (view.canViewEntity(id) ? 'admin' : undefined),
    recordAccessAt: (id: string) => (view.canViewEntity(id) ? 'admin' : 'none'),
    canDeleteRecordAt: (access: Rung) => satisfiesRung(access, 'admin'),
    canEditRecordAt: (access: Rung) => satisfiesRung(access, 'edit'),
    ...overrides,
  }
  return view
}

function runTool(capabilities?: CapabilityView) {
  const tool = createCreateEntityTool(() => ({ db: {}, capabilities }) as never)
  const ctx = { organizationId: 'org_1', userId: 'u_1' } as ToolContext
  return tool.execute(
    { entityDefinitionId: 'contact', values: { name: 'Ada' } },
    ctx
  ) as Promise<AgentToolResult>
}

beforeEach(() => {
  createSpy.mockReset()
  createSpy.mockResolvedValue({ recordId: 'def_contact:i_1' })
  constructedOptions.length = 0
})

describe('create_entity — write enforcement', () => {
  it('without capabilities, creates as before and passes none to the handler', async () => {
    const result = await runTool(undefined)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ recordId: 'def_contact:i_1' })
    expect(createSpy).toHaveBeenCalledWith('def_contact', { name: 'Ada' })
    expect(constructedOptions).toHaveLength(1)
    expect(constructedOptions[0]?.capabilities).toBeUndefined()
  })

  it('threads the capability view into the handler options', async () => {
    const capabilities = makeCapabilities()
    await runTool(capabilities)

    expect(constructedOptions[0]?.capabilities).toBe(capabilities)
  })

  it('surfaces the ForbiddenError as a tool error when the def is not editable', async () => {
    const capabilities = makeCapabilities({
      canEditEntity: () => false,
      assertEditEntity: () => {
        throw new ForbiddenError("You don't have permission to edit records.")
      },
    })

    const result = await runTool(capabilities)

    expect(result.success).toBe(false)
    expect(result.error).toContain("don't have permission")
    expect(createSpy).not.toHaveBeenCalled()
  })
})
