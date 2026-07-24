// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/bulk-update-entity-capabilities.test.ts
//
// Permissions v2 §3.3 (Phase C1): `bulk_update_entity` bypasses
// `UnifiedCrudHandler` and writes straight through `FieldValueService`, so it
// carries its own copy of the handler's `assertEditDistinctDefs` — one
// `assertEditEntity` per DISTINCT def among the recordIds. Absent capabilities
// (the un-threaded workflow AI node) must behave byte-for-byte as before.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const setBulkValuesSpy = vi.fn()

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  // `null` ⇒ the tool skips field-key validation and actor resolution, which
  // keeps this test focused on the capability gate.
  findCachedResource: vi.fn(async () => null),
}))

vi.mock('../../../../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    async setBulkValues(args: unknown) {
      return setBulkValuesSpy(args)
    }
  },
}))

import { ForbiddenError } from '../../../../../../errors'
import type { CapabilityView } from '../../../../../../permissions/capabilities/capability-view'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { createBulkUpdateEntityTool } from '../bulk-update-entity'

/** All-permissive `CapabilityView`; override just the gate under test. */
function makeCapabilities(overrides: Partial<CapabilityView> = {}): CapabilityView {
  const yes = () => true
  const noop = () => {}
  return {
    can: yes,
    has: yes,
    assert: noop,
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

/** Records every def id the tool asserted on, in call order. */
function makeRecordingCapabilities(deniedDefIds: string[] = []) {
  const asserted: string[] = []
  const capabilities = makeCapabilities({
    canEditEntity: (defId: string) => !deniedDefIds.includes(defId),
    assertEditEntity: (defId: string) => {
      asserted.push(defId)
      if (deniedDefIds.includes(defId)) {
        throw new ForbiddenError("You don't have permission to edit records.")
      }
    },
  })
  return { capabilities, asserted }
}

function runTool(recordIds: string[], capabilities?: CapabilityView) {
  const tool = createBulkUpdateEntityTool(() => ({ db: {}, capabilities }) as never)
  const ctx = { organizationId: 'org_1', userId: 'u_1' } as ToolContext
  return tool.execute(
    { recordIds, values: [{ fieldId: 'ticket_status', value: 'COMPLETED' }] },
    ctx
  ) as Promise<AgentToolResult>
}

beforeEach(() => {
  setBulkValuesSpy.mockReset()
  setBulkValuesSpy.mockResolvedValue({ count: 2 })
})

describe('bulk_update_entity — write enforcement', () => {
  it('without capabilities, writes as before with no gating', async () => {
    const result = await runTool(['def_a:i_1', 'def_b:i_2'], undefined)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ total: 2, approved: 2, updated: 2 })
    expect(setBulkValuesSpy).toHaveBeenCalledTimes(1)
  })

  it('asserts once per DISTINCT def, not once per record', async () => {
    const { capabilities, asserted } = makeRecordingCapabilities()

    const result = await runTool(['def_a:i_1', 'def_a:i_2', 'def_b:i_3', 'def_a:i_4'], capabilities)

    expect(result.success).toBe(true)
    expect(asserted).toEqual(['def_a', 'def_b'])
    expect(setBulkValuesSpy).toHaveBeenCalledTimes(1)
  })

  it('throws ForbiddenError before any write when one def is not editable', async () => {
    const { capabilities } = makeRecordingCapabilities(['def_b'])

    await expect(runTool(['def_a:i_1', 'def_b:i_2'], capabilities)).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(setBulkValuesSpy).not.toHaveBeenCalled()
  })

  it('gates the APPROVED subset, not the originally requested ids', async () => {
    const { capabilities, asserted } = makeRecordingCapabilities(['def_b'])

    // `def_b` was requested but not approved, so it must not be asserted on.
    const tool = createBulkUpdateEntityTool(() => ({ db: {}, capabilities }) as never)
    const result = (await tool.execute(
      {
        recordIds: ['def_a:i_1', 'def_b:i_2'],
        _approvedRecordIds: ['def_a:i_1'],
        values: [{ fieldId: 'ticket_status', value: 'COMPLETED' }],
      },
      { organizationId: 'org_1', userId: 'u_1' } as ToolContext
    )) as AgentToolResult

    expect(result.success).toBe(true)
    expect(asserted).toEqual(['def_a'])
  })
})
