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

import { UnprocessableEntityError } from '../../../../../errors'
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
    // Record lane (plan v3/03 P5) — all-permissive: every def is present and
    // every row folds to `admin`.
    hasDefPresence: yes,
    hasRecordGrantsOn: yes,
    recordDefRung: () => 'admin',
    recordAccessAt: () => 'admin',
    canDeleteRecordAt: yes,
    canEditRecordAt: yes,
    viewAccessFor: () => undefined,
    canAdministerDef: yes,
    assertAdministerDef: noop,
    canViewInstance: yes,
    // The list-side twin of `canViewInstance` above: sees everything, denies nothing.
    instanceListScope: () => ({ kind: 'exclude', excludeIds: [] }),
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

// The count is best-effort here — a failed `COUNT(*)` has always degraded to
// "no match count" and still previewed. An ALL-DROPPED filter set is a
// different animal: it is not a missing number, it is the tool being told that
// the view it is about to push onto the user's table narrows nothing, and that
// the count it would print is the definition's full row count.
describe('preview_table_view — an all-dropped filter set is a refusal, not a missing count', () => {
  it('refuses rather than previewing a filter set that narrows nothing', async () => {
    countSpy.mockRejectedValue(new UnprocessableEntityError('None of the 2 filter condition(s)…'))

    const result = await runTool(makeCapabilities())

    expect(result.success).toBe(false)
    expect(result.error).toContain('filter condition')
    // No preview side-channel: applying it would leave the user looking at an
    // unfiltered table the assistant just called filtered.
    expect(JSON.stringify(result)).not.toContain('_kopilotRecordView')
  })

  it('still degrades to a countless preview for any OTHER count failure', async () => {
    countSpy.mockRejectedValue(new Error('statement timeout'))

    const result = await runTool(makeCapabilities())

    expect(result.success).toBe(true)
    expect(JSON.stringify(result)).toContain('_kopilotRecordView')
  })
})
