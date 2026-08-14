// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/mail-lens-write-block.test.ts
//
// Retrieval sequence step 0.1, WRITE half.
//
// 0.1 closed the generic *read* path onto `thread` / `message`; the write tools
// were left open, so `update_entity({recordId:"thread:..."})`,
// `bulk_update_entity` and `create_entity({entityDefinitionId:"threads"})` could
// still reach mail content through `UnifiedCrudHandler` / `FieldValueService` —
// whose `canViewEntity('thread')` / `canEditEntity('thread')` is the same
// unconditional pass-through (`NON_RECORD_DEF_SLUGS`) the read path had to route
// around.
//
// Two properties are asserted per tool:
//   1. every spelling refuses — the block is keyed on the RESOLVED def
//      (`parseRecordId` / `resolveEntity`), never on the string the model typed,
//      because the production read-path failure was the PLURAL slug;
//   2. the refusal lands before any handler, picker or write service is touched.
//
// The refusal points at `update_thread`, not at the mail SEARCH tools: a model
// that wanted to set a status is not helped by being told to go and search.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const RESOURCES = [
  {
    id: 'thread',
    entityDefinitionId: 'thread',
    entityType: 'thread',
    apiSlug: 'threads',
    label: 'Thread',
    plural: 'Threads',
    isVisible: false,
    fields: [],
  },
  {
    id: 'message',
    entityDefinitionId: 'message',
    entityType: 'message',
    apiSlug: 'messages',
    label: 'Message',
    plural: 'Messages',
    isVisible: false,
    fields: [],
  },
  {
    id: 'def_contact',
    entityDefinitionId: 'def_contact',
    entityType: 'contact',
    apiSlug: 'contacts',
    label: 'Contact',
    plural: 'Contacts',
    isVisible: true,
    fields: [{ id: 'contact_name', key: 'name', label: 'Name', fieldType: 'NAME' }],
  },
]

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) =>
      RESOURCES.find((r) => r.id === key || r.entityType === key || r.apiSlug === key) ?? null
  ),
  getCachedResources: vi.fn(async () => RESOURCES),
}))

const createSpy = vi.fn(async (_entityDefinitionId: string, _values: Record<string, unknown>) => ({
  recordId: 'def_contact:i_1',
}))
const updateSpy = vi.fn(async (_recordId: string, _values: Record<string, unknown>) => ({}))

vi.mock('../../../../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    async create(entityDefinitionId: string, values: Record<string, unknown>) {
      return createSpy(entityDefinitionId, values)
    }
    async update(recordId: string, values: Record<string, unknown>) {
      return updateSpy(recordId, values)
    }
  },
}))

/** `bulk_update_entity`'s per-row write gate — the first thing it would touch. */
const rowGateSpy = vi.fn(async (_args: unknown) => {})
vi.mock('../../../../../../resources/crud/record-row-access', () => ({
  assertRecordRowsEditableWithDb: (args: unknown) => rowGateSpy(args),
}))

const setBulkValuesSpy = vi.fn(async (_args: unknown) => ({ count: 1 }))
vi.mock('../../../../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    async applyBulk(args: unknown) {
      return setBulkValuesSpy(args)
    }
  },
}))

vi.mock('../field-label-helpers', () => ({
  validateFieldKeys: () => ({ unknownKeys: [], validIds: ['name'] }),
  formatUnknownFieldsError: () => 'unknown fields',
  isMultiValueField: () => false,
  resolveFieldLabels: (_r: unknown, ids: string[]) => ids,
}))

vi.mock('../resolve-actor-values', () => ({
  resolveActorValues: async (values: Record<string, unknown>) => ({ values, errors: [] }),
  resolveActorValuesFlat: async (pairs: unknown[]) => ({ pairs, errors: [] }),
  formatActorResolutionError: () => 'actor error',
}))

import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { createBulkUpdateEntityTool } from '../bulk-update-entity'
import { createCreateEntityTool } from '../create-entity'
import { createUpdateEntityTool } from '../update-entity'

const CTX = { organizationId: 'org_1', userId: 'u_1' } as ToolContext

/** `GetToolDeps` — capabilities absent, so nothing but the block can refuse. */
const deps = () => (() => ({ db: {}, capabilities: undefined })) as never

/**
 * Drive a tool the way the framework does — `validateInputs` first, then
 * `execute` on the normalized args. That order is load-bearing here: it is
 * `validateInputs` that folds `threads:<id>` onto the `thread` def id, and the
 * block is deliberately keyed on the folded id rather than on the raw string.
 */
async function drive(
  tool: ReturnType<typeof createUpdateEntityTool>,
  args: Record<string, unknown>
): Promise<AgentToolResult> {
  const validated = await tool.validateInputs?.(args, CTX)
  if (validated && !validated.ok) {
    return { success: false, output: null, error: validated.error }
  }
  const nextArgs = validated?.ok ? validated.args : args
  return tool.execute(nextArgs, CTX) as Promise<AgentToolResult>
}

/** The write refusal names the mail WRITE tool, not the mail search tools. */
function pointsAtUpdateThread(result: AgentToolResult) {
  expect(result.success).toBe(false)
  expect(result.error).toContain('update_thread')
}

function nothingWasWritten() {
  expect(createSpy).not.toHaveBeenCalled()
  expect(updateSpy).not.toHaveBeenCalled()
  expect(setBulkValuesSpy).not.toHaveBeenCalled()
  expect(rowGateSpy).not.toHaveBeenCalled()
}

beforeEach(() => {
  createSpy.mockClear()
  updateSpy.mockClear()
  setBulkValuesSpy.mockClear()
  rowGateSpy.mockClear()
})

describe('update_entity — mail-lens write block', () => {
  function run(recordId: string) {
    return drive(createUpdateEntityTool(deps()), { recordId, values: { name: 'Ada' } })
  }

  it.each([
    'thread:t_1',
    'threads:t_1',
    'message:m_1',
    'messages:m_1',
  ])('refuses "%s" without touching the handler', async (recordId) => {
    pointsAtUpdateThread(await run(recordId))
    nothingWasWritten()
  })

  it('refuses a cased spelling too — the input validator never resolves it', async () => {
    const result = await run('Threads:t_1')
    expect(result.success).toBe(false)
    nothingWasWritten()
  })

  it('still updates an ordinary record', async () => {
    const result = await run('def_contact:i_1')

    expect(result.success).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith('def_contact:i_1', { name: 'Ada' })
  })
})

describe('bulk_update_entity — mail-lens write block', () => {
  function run(recordIds: string[], approvedRecordIds?: string[]) {
    return drive(createBulkUpdateEntityTool(deps()), {
      recordIds,
      ...(approvedRecordIds ? { _approvedRecordIds: approvedRecordIds } : {}),
      values: [{ fieldId: 'ticket_status', value: 'COMPLETED' }],
    })
  }

  it.each([
    ['thread:t_1'],
    ['threads:t_1'],
    ['messages:m_1'],
  ])('refuses %s without touching the row gate or the write service', async (...recordIds) => {
    pointsAtUpdateThread(await run(recordIds))
    nothingWasWritten()
  })

  // Matches the malformed-recordId check directly above it, which rejects the
  // batch outright rather than dropping the offending entry, and the row gate
  // below it, which fails whole for the same reason.
  it('one blocked id fails the WHOLE batch rather than dropping that id', async () => {
    pointsAtUpdateThread(await run(['def_contact:i_1', 'thread:t_1']))
    nothingWasWritten()
  })

  it('a blocked id that was not approved still fails the call', async () => {
    // Judged on the REQUESTED ids, before the approval filter — an approval
    // subset must not be able to launder a batch that named a thread.
    pointsAtUpdateThread(await run(['def_contact:i_1', 'thread:t_1'], ['def_contact:i_1']))
    nothingWasWritten()
  })

  it('still bulk-updates an ordinary batch', async () => {
    const result = await run(['def_contact:i_1', 'def_contact:i_2'])

    expect(result.success).toBe(true)
    expect(setBulkValuesSpy).toHaveBeenCalledTimes(1)
  })
})

describe('create_entity — mail-lens write block', () => {
  function run(entityDefinitionId: string) {
    return drive(createCreateEntityTool(deps()), {
      entityDefinitionId,
      values: { name: 'Ada' },
    })
  }

  it.each([
    'thread',
    'threads',
    'Threads',
    'THREADS',
    'message',
    'messages',
  ])('refuses "%s" without touching the handler', async (slug) => {
    pointsAtUpdateThread(await run(slug))
    nothingWasWritten()
  })

  it('still creates an ordinary record', async () => {
    const result = await run('contacts')

    expect(result.success).toBe(true)
    expect(createSpy).toHaveBeenCalledWith('def_contact', { name: 'Ada' })
  })

  it('never suggests a blocked slug when the type is unknown', async () => {
    const result = await run('nope')

    expect(result.success).toBe(false)
    expect(result.error).toContain('contacts')
    expect(result.error).not.toContain('threads')
  })
})
