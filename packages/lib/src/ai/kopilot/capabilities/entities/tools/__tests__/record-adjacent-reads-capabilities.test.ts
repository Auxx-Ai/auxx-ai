// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/record-adjacent-reads-capabilities.test.ts
//
// Permissions v2 §3 / plan 19b gap G3: `list_notes`, `list_field_changes`,
// `list_transcripts_for_entity` and `get_transcript` each took a bare
// `recordId` / `entityInstanceId` / `transcriptId` and ran raw org-scoped SQL,
// so a definition published `None` still yielded its notes, field-change
// history and meeting transcripts. Each now resolves the owning definition
// first and gates on `canViewEntity`, the shape `get_entity_history` proves.
//
// Denial convention, per tool shape: the two list tools return their empty
// success payload (matching `query_records`), the single-object getter returns
// its ordinary not-found error. Neither confirms the target exists.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCommentsSpy = vi.fn()

vi.mock('../../../../../../comments', () => ({
  CommentService: class {
    async getCommentsByRecordId(...args: unknown[]) {
      return getCommentsSpy(...args)
    }
  },
}))

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  getCachedMembersByUserIds: vi.fn(async () => []),
}))

import type { Rung } from '@auxx/database/enums'
import type { CapabilityView } from '../../../../../../permissions/capabilities/capability-view'
import { Level } from '../../../../../../permissions/capabilities/registry'
import { satisfiesRung } from '../../../../../../permissions/capabilities/rung'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { createGetTranscriptTool } from '../get-transcript'
import { createListFieldChangesTool } from '../list-field-changes'
import { createListNotesTool } from '../list-notes'
import { createListTranscriptsForEntityTool } from '../list-transcripts-for-entity'

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
    // The list-side twin of `canViewInstance` above: sees everything, denies nothing.
    instanceListScope: () => ({ kind: 'exclude', excludeIds: [] }),
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

/** Denies exactly one def, mirroring a published policy of `None` on it. */
function denying(defId: string): CapabilityView {
  return makeCapabilities({ canViewEntity: (id: string) => id !== defId })
}

/**
 * Thenable Drizzle-builder stub — every chained method returns itself and the
 * chain resolves to `rows` whenever it is awaited, at whatever depth.
 */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit']) {
    chain[method] = () => chain
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)
  return chain
}

/**
 * Fake db: `query.EntityInstance.findFirst` answers the def lookup, `select()`
 * shifts the next queued row set (defaulting to empty). Both are spies so a
 * test can assert the gate short-circuited before any SQL.
 */
function makeDb(options: {
  instance?: { entityDefinitionId: string } | null
  rowSets?: unknown[][]
}) {
  const queue = [...(options.rowSets ?? [])]
  const findFirst = vi.fn(async () => options.instance ?? null)
  const select = vi.fn(() => selectChain(queue.shift() ?? []))
  return { db: { query: { EntityInstance: { findFirst } }, select }, findFirst, select }
}

const CTX = { organizationId: 'org_1', userId: 'u_1' } as ToolContext

beforeEach(() => {
  getCommentsSpy.mockReset()
  getCommentsSpy.mockResolvedValue([
    { id: 'c_1', contentJson: {}, createdById: 'u_2', createdAt: new Date(), isPinned: false },
  ])
})

describe('list_notes — read enforcement', () => {
  function runTool(capabilities?: CapabilityView) {
    const tool = createListNotesTool(() => ({ db: {}, capabilities }) as never)
    return tool.execute({ recordId: 'def_invoice:i_1' }, CTX) as Promise<AgentToolResult>
  }

  it('lists notes when the definition is viewable', async () => {
    const result = await runTool(makeCapabilities())

    expect(result.success).toBe(true)
    expect((result.output as { notes: unknown[] }).notes).toHaveLength(1)
    expect(getCommentsSpy).toHaveBeenCalledTimes(1)
  })

  it('without capabilities, lists notes as before', async () => {
    const result = await runTool(undefined)

    expect(result.success).toBe(true)
    expect(getCommentsSpy).toHaveBeenCalledTimes(1)
  })

  it('returns an empty page for an unviewable definition, without reading comments', async () => {
    const result = await runTool(denying('def_invoice'))

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ notes: [], hasMore: false })
    expect(getCommentsSpy).not.toHaveBeenCalled()
  })

  it('the denial is indistinguishable from a record that simply has no notes', async () => {
    getCommentsSpy.mockResolvedValue([])
    const empty = await runTool(makeCapabilities())
    const denied = await runTool(denying('def_invoice'))

    expect(denied).toEqual(empty)
  })
})

describe('list_field_changes — read enforcement', () => {
  function runTool(capabilities: CapabilityView | undefined, dbSetup: ReturnType<typeof makeDb>) {
    const tool = createListFieldChangesTool(() => ({ db: dbSetup.db, capabilities }) as never)
    return tool.execute({ entityInstanceId: 'i_1' }, CTX) as Promise<AgentToolResult>
  }

  it('reads the timeline when the definition is viewable', async () => {
    const setup = makeDb({ instance: { entityDefinitionId: 'def_contact' } })

    const result = await runTool(makeCapabilities(), setup)

    expect(result.success).toBe(true)
    expect(setup.select).toHaveBeenCalledTimes(1)
  })

  it('without capabilities, skips the lookup and reads as before', async () => {
    const setup = makeDb({ instance: { entityDefinitionId: 'def_invoice' } })

    const result = await runTool(undefined, setup)

    expect(result.success).toBe(true)
    expect(setup.findFirst).not.toHaveBeenCalled()
    expect(setup.select).toHaveBeenCalledTimes(1)
  })

  it('returns no changes for an unviewable definition, without touching the timeline', async () => {
    const setup = makeDb({ instance: { entityDefinitionId: 'def_invoice' } })

    const result = await runTool(denying('def_invoice'), setup)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ changes: [] })
    expect(setup.select).not.toHaveBeenCalled()
  })

  it('an unviewable record and a non-existent one answer identically', async () => {
    const denied = await runTool(
      denying('def_invoice'),
      makeDb({ instance: { entityDefinitionId: 'def_invoice' } })
    )
    const missing = await runTool(makeCapabilities(), makeDb({ instance: null }))

    expect(denied).toEqual(missing)
  })
})

describe('list_transcripts_for_entity — read enforcement', () => {
  function runTool(capabilities: CapabilityView | undefined, dbSetup: ReturnType<typeof makeDb>) {
    const tool = createListTranscriptsForEntityTool(
      () => ({ db: dbSetup.db, capabilities }) as never
    )
    return tool.execute({ entityInstanceId: 'i_1' }, CTX) as Promise<AgentToolResult>
  }

  it('runs the transcript joins when the definition is viewable', async () => {
    const setup = makeDb({ instance: { entityDefinitionId: 'def_meeting' } })

    const result = await runTool(makeCapabilities(), setup)

    expect(result.success).toBe(true)
    expect(setup.select).toHaveBeenCalled()
  })

  it('without capabilities, skips the lookup and joins as before', async () => {
    const setup = makeDb({ instance: { entityDefinitionId: 'def_invoice' } })

    const result = await runTool(undefined, setup)

    expect(result.success).toBe(true)
    expect(setup.findFirst).not.toHaveBeenCalled()
    expect(setup.select).toHaveBeenCalled()
  })

  it('returns no transcripts for an unviewable definition, without joining', async () => {
    const setup = makeDb({ instance: { entityDefinitionId: 'def_invoice' } })

    const result = await runTool(denying('def_invoice'), setup)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ transcripts: [] })
    expect(setup.select).not.toHaveBeenCalled()
  })

  it('an unviewable record and a non-existent one answer identically', async () => {
    const denied = await runTool(
      denying('def_invoice'),
      makeDb({ instance: { entityDefinitionId: 'def_invoice' } })
    )
    const missing = await runTool(makeCapabilities(), makeDb({ instance: null }))

    expect(denied).toEqual(missing)
  })
})

describe('get_transcript — read enforcement', () => {
  const TRANSCRIPT_ROW = {
    fullText: 'Alex: welcome aboard.',
    wordCount: 4,
    entityDefinitionId: 'def_meeting',
  }

  function runTool(capabilities: CapabilityView | undefined, rowSets: unknown[][]) {
    const setup = makeDb({ rowSets })
    const tool = createGetTranscriptTool(() => ({ db: setup.db, capabilities }) as never)
    return {
      setup,
      result: tool.execute({ transcriptId: 't_1' }, CTX) as Promise<AgentToolResult>,
    }
  }

  it('returns the transcript text when the meeting definition is viewable', async () => {
    const { result } = runTool(makeCapabilities(), [[TRANSCRIPT_ROW]])

    expect(await result).toMatchObject({
      success: true,
      output: { transcriptId: 't_1', fullText: 'Alex: welcome aboard.' },
    })
  })

  it('without capabilities, returns the transcript as before', async () => {
    const { result } = runTool(undefined, [[TRANSCRIPT_ROW]])

    expect((await result).success).toBe(true)
  })

  it('refuses an unviewable meeting definition and leaks no transcript text', async () => {
    const { result } = runTool(denying('def_meeting'), [[TRANSCRIPT_ROW]])
    const resolved = await result

    expect(resolved.success).toBe(false)
    expect(resolved.output).toBeNull()
    expect(JSON.stringify(resolved)).not.toContain('welcome aboard')
  })

  it('the denial is byte-identical to a transcript that does not exist', async () => {
    const denied = await runTool(denying('def_meeting'), [[TRANSCRIPT_ROW]]).result
    const missing = await runTool(makeCapabilities(), [[]]).result

    expect(denied).toEqual(missing)
  })
})
