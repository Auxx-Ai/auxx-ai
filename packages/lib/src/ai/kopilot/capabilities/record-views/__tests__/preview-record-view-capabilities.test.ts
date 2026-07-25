// packages/lib/src/ai/kopilot/capabilities/record-views/__tests__/preview-record-view-capabilities.test.ts
//
// Permissions v2 §3 / plan 19b gap G6: `preview_table_view` ran
// `countRecordMatches` against the page's definition with no `canViewEntity`,
// making it a record-count oracle on a restricted def while its
// `create_table_view` / `update_table_view` siblings already asserted. This is
// the parity fix — same gate, same message as those siblings.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const countSpy = vi.fn()

vi.mock('../count-matches', () => ({
  countRecordMatches: (...args: unknown[]) => countSpy(...args),
}))

const RESOURCE = {
  id: 'def_invoice',
  entityDefinitionId: 'def_invoice',
  apiSlug: 'invoice',
  label: 'Invoice',
  plural: 'Invoices',
  fields: [],
}

vi.mock('../target', () => ({
  resolveRecordViewTarget: vi.fn(async () => ({
    resource: RESOURCE,
    entityDefinitionId: 'def_invoice',
    tableId: 'entity-def_invoice',
  })),
}))

import type { CapabilityView } from '../../../../../permissions/capabilities/capability-view'
import { Level } from '../../../../../permissions/capabilities/registry'
import type { ToolContext } from '../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../agent-framework/types'
import { createPreviewRecordViewTool } from '../tools/preview-record-view'

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

function runTool(capabilities?: CapabilityView) {
  const tool = createPreviewRecordViewTool(
    () => ({ db: {}, sessionContext: {}, capabilities }) as never
  )
  const ctx = { organizationId: 'org_1', userId: 'u_1' } as ToolContext
  return tool.execute({}, ctx) as Promise<AgentToolResult>
}

beforeEach(() => {
  countSpy.mockReset()
  countSpy.mockResolvedValue(42)
})

describe('preview_table_view — read enforcement', () => {
  it('previews and counts when the definition is viewable', async () => {
    const result = await runTool(makeCapabilities())

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ matched: 42 })
    expect(countSpy).toHaveBeenCalledTimes(1)
  })

  it('without capabilities, previews as before', async () => {
    const result = await runTool(undefined)

    expect(result.success).toBe(true)
    expect(countSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses an unviewable definition without running the count', async () => {
    const result = await runTool(makeCapabilities({ canViewEntity: () => false }))

    expect(result.success).toBe(false)
    expect(result.output).toBeNull()
    expect(result.error).toContain("don't have permission")
    expect(countSpy).not.toHaveBeenCalled()
  })

  it('the denial carries no record count and no view side-channel', async () => {
    const result = await runTool(makeCapabilities({ canViewEntity: () => false }))

    expect(JSON.stringify(result)).not.toContain('_kopilotRecordView')
    expect(JSON.stringify(result)).not.toContain('matched')
  })
})
