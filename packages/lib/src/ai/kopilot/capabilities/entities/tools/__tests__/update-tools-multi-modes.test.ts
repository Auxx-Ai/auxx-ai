// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/update-tools-multi-modes.test.ts
//
// B5/B6 (multi-email plan): the Kopilot update tools must never silently wipe a
// multi-value field's stored list when the model asked to append, and must never
// route an append at a single-value field (the append primitive throws there).
//
//   - `update_entity` accepts `modes: { <fieldId>: 'add' }` → `handler.update`
//     receives the per-field mode map, but ONLY for fields that are actually
//     multi-value on the cached resource; everything else stays default replace.
//   - `bulk_update_entity` accepts `mode: 'add'` per values entry → routed
//     through `FieldValueService.applyBulk` as `BulkValueItem.mode`, with the
//     same multi-only guard.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlerUpdate = vi.fn()
vi.mock('../../../../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    update = handlerUpdate
  },
}))

const applyBulkSpy = vi.fn()
vi.mock('../../../../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    async applyBulk(args: unknown) {
      return applyBulkSpy(args)
    }
  },
}))

const findCachedResource = vi.fn()
vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  findCachedResource: (...args: unknown[]) => findCachedResource(...args),
  getCachedResources: vi.fn(async () => []),
  getCachedMembers: vi.fn(async () => []),
  getCachedGroups: vi.fn(async () => []),
}))

import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { createBulkUpdateEntityTool } from '../bulk-update-entity'
import { createUpdateEntityTool } from '../update-entity'

const DEF = 'edf_contact00000000000000000'
const REC = `${DEF}:ins_a00000000000000000000`
const REC_B = `${DEF}:ins_b00000000000000000000`

/** Cached resource with one multi-value email field and one single-value URL field. */
const resource = {
  id: DEF,
  entityDefinitionId: DEF,
  label: 'Contact',
  fields: [
    {
      id: 'fld_email',
      key: 'primary_email',
      systemAttribute: 'primary_email',
      label: 'Email',
      fieldType: 'EMAIL',
      options: { multi: true },
      capabilities: {},
    },
    {
      id: 'fld_site',
      key: 'company_website',
      systemAttribute: 'company_website',
      label: 'Website',
      fieldType: 'URL',
      options: {},
      capabilities: {},
    },
  ],
}

const ctx = { organizationId: 'org_1', userId: 'u_1' } as ToolContext

beforeEach(() => {
  vi.clearAllMocks()
  findCachedResource.mockResolvedValue(resource)
  handlerUpdate.mockResolvedValue(undefined)
  applyBulkSpy.mockResolvedValue({ count: 0, added: 1 })
})

describe('update_entity — per-field write modes', () => {
  const tool = createUpdateEntityTool(() => ({ db: {}, capabilities: undefined }) as never)

  it("passes mode 'add' through for a multi-value field", async () => {
    const result = (await tool.execute(
      {
        recordId: REC,
        values: { primary_email: 'alias@x.com' },
        modes: { primary_email: 'add' },
      },
      ctx
    )) as AgentToolResult

    expect(result.success).toBe(true)
    expect(handlerUpdate).toHaveBeenCalledWith(
      REC,
      { primary_email: 'alias@x.com' },
      { primary_email: 'add' }
    )
  })

  it("ignores mode 'add' on a single-value field (default replace, no throw)", async () => {
    const result = (await tool.execute(
      {
        recordId: REC,
        values: { company_website: 'https://x.com' },
        modes: { company_website: 'add' },
      },
      ctx
    )) as AgentToolResult

    expect(result.success).toBe(true)
    expect(handlerUpdate).toHaveBeenCalledWith(REC, { company_website: 'https://x.com' }, undefined)
  })

  it('defaults to replace when no modes are given', async () => {
    const result = (await tool.execute(
      { recordId: REC, values: { primary_email: 'a@x.com' } },
      ctx
    )) as AgentToolResult

    expect(result.success).toBe(true)
    expect(handlerUpdate).toHaveBeenCalledWith(REC, { primary_email: 'a@x.com' }, undefined)
  })
})

describe('bulk_update_entity — per-entry write modes', () => {
  const tool = createBulkUpdateEntityTool(() => ({ db: {}, capabilities: undefined }) as never)

  it("routes mode 'add' on a multi-value field through applyBulk as an append", async () => {
    const result = (await tool.execute(
      {
        recordIds: [REC, REC_B],
        values: [{ fieldId: 'primary_email', value: 'alias@x.com', mode: 'add' }],
      },
      ctx
    )) as AgentToolResult

    expect(result.success).toBe(true)
    expect(applyBulkSpy).toHaveBeenCalledWith({
      recordIds: [REC, REC_B],
      values: [{ fieldId: 'primary_email', value: 'alias@x.com', mode: 'add' }],
    })
    // `count` only tallies replace writes — an all-append call still reports
    // every approved record as updated.
    expect(result.output).toMatchObject({ updated: 2 })
  })

  it("downgrades mode 'add' on a single-value field to a replace", async () => {
    applyBulkSpy.mockResolvedValue({ count: 2 })
    const result = (await tool.execute(
      {
        recordIds: [REC, REC_B],
        values: [{ fieldId: 'company_website', value: 'https://x.com', mode: 'add' }],
      },
      ctx
    )) as AgentToolResult

    expect(result.success).toBe(true)
    expect(applyBulkSpy).toHaveBeenCalledWith({
      recordIds: [REC, REC_B],
      values: [{ fieldId: 'company_website', value: 'https://x.com', mode: 'set' }],
    })
    expect(result.output).toMatchObject({ updated: 2 })
  })

  it('defaults every entry to replace when no mode is given', async () => {
    applyBulkSpy.mockResolvedValue({ count: 2 })
    const result = (await tool.execute(
      {
        recordIds: [REC, REC_B],
        values: [{ fieldId: 'primary_email', value: 'a@x.com' }],
      },
      ctx
    )) as AgentToolResult

    expect(result.success).toBe(true)
    expect(applyBulkSpy).toHaveBeenCalledWith({
      recordIds: [REC, REC_B],
      values: [{ fieldId: 'primary_email', value: 'a@x.com', mode: 'set' }],
    })
  })
})
