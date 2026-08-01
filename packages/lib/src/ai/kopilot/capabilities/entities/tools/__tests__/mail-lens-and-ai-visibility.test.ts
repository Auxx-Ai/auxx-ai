// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/mail-lens-and-ai-visibility.test.ts
//
// Retrieval sequence 0.1 + 4.1 at the tool boundary.
//
// 0.1 — every generic-record door refuses `thread` / `message` and names the mail
// tool instead: `query_records` (the one caught in production, with the PLURAL
// slug), `search_entities` scoped, `get_entity` by RecordId prefix, and
// `list_entity_fields` (handing back the thread schema is what teaches the model
// to try the record path next).
//
// 4.1 — the AI-visible set is a curated allowlist rather than the Records-nav
// flag, and `search_entities`' global scope no longer discards a nav-hidden def
// the principal holds per-record grants on — the case the per-row partitioning
// immediately below it was written for.

import { describe, expect, it, vi } from 'vitest'

const RESOURCES = [
  {
    id: 'thread',
    entityDefinitionId: 'thread',
    entityType: 'thread',
    apiSlug: 'threads',
    label: 'Thread',
    plural: 'Threads',
    isVisible: false,
    fields: [{ id: 'thread_subject', key: 'subject', label: 'Subject', fieldType: 'TEXT' }],
  },
  {
    id: 'message',
    entityDefinitionId: 'message',
    entityType: 'message',
    apiSlug: 'messages',
    label: 'Message',
    plural: 'Messages',
    isVisible: false,
    fields: [{ id: 'message_body', key: 'textPlain', label: 'Body', fieldType: 'TEXT' }],
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
  {
    id: 'def_inbox',
    entityDefinitionId: 'def_inbox',
    entityType: 'inbox',
    apiSlug: 'inboxes',
    label: 'Inbox',
    plural: 'Inboxes',
    isVisible: false,
    fields: [{ id: 'inbox_name', key: 'name', label: 'Name', fieldType: 'TEXT' }],
  },
  {
    id: 'def_signature',
    entityDefinitionId: 'def_signature',
    entityType: 'signature',
    apiSlug: 'signatures',
    label: 'Signature',
    plural: 'Signatures',
    isVisible: false,
    fields: [],
  },
  // Nav-hidden, user-authored: invisible to the catalog, but findable by anyone
  // holding a per-record grant on it.
  {
    id: 'def_project',
    entityDefinitionId: 'def_project',
    apiSlug: 'projects',
    label: 'Project',
    plural: 'Projects',
    isVisible: false,
    fields: [],
  },
]

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) =>
      RESOURCES.find((r) => r.id === key || r.entityType === key || r.apiSlug === key) ?? null
  ),
  getCachedResources: vi.fn(async () => RESOURCES),
}))

const searchSpy = vi.fn(async (_params: unknown) => ({ items: [] as unknown[] }))
const getResourcesByIdsSpy = vi.fn(async (_ids: unknown) => ({}) as Record<string, unknown>)

vi.mock('../../../../../../resources/picker', () => ({
  RecordPickerService: class {
    search(params: unknown) {
      return searchSpy(params)
    }
    getResourcesByIds(ids: unknown) {
      return getResourcesByIdsSpy(ids)
    }
  },
}))

/** The `entityDefinitionIds` the tool handed the picker on its last global search. */
function lastGlobalScope(): string[] {
  const params = searchSpy.mock.calls[0]?.[0] as { entityDefinitionIds?: string[] } | undefined
  return params?.entityDefinitionIds ?? []
}

vi.mock('../../enrich-entity-fields', () => ({
  enrichEntitiesWithFieldValues: vi.fn(async () => new Map()),
}))

import type { Rung } from '@auxx/database/enums'
import type { CapabilityView } from '../../../../../../permissions/capabilities/capability-view'
import { Level } from '../../../../../../permissions/capabilities/registry'
import { satisfiesRung } from '../../../../../../permissions/capabilities/rung'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { createGetEntityTool } from '../get-entity'
import { createListEntitiesTool } from '../list-entities'
import { createListEntityFieldsTool } from '../list-entity-fields'
import { createQueryRecordsTool } from '../query-records'
import { createSearchEntitiesTool } from '../search-entities'

const CTX = { organizationId: 'org_1', userId: 'u_1' } as ToolContext

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

function pointsAtTheMailTools(result: AgentToolResult) {
  expect(result.success).toBe(false)
  expect(result.error).toContain('find_threads')
  expect(result.error).toContain('get_thread_detail')
}

describe('query_records — mail-lens block', () => {
  function run(entity: string) {
    const tool = createQueryRecordsTool(() => ({ db: {}, capabilities: undefined }) as never)
    return tool.execute({ entity }, CTX) as Promise<AgentToolResult>
  }

  // The production turn was `{"limit":5,"entity":"threads"}` — plural.
  it.each([
    'thread',
    'threads',
    'Threads',
    'THREADS',
    'message',
    'messages',
  ])('refuses "%s" and points at the mail tools', async (entity) => {
    pointsAtTheMailTools(await run(entity))
  })

  it('leaks no row data in the refusal', async () => {
    const result = await run('threads')
    expect(result.output).toBeNull()
  })
})

describe('search_entities — mail-lens block and scope', () => {
  function tool(capabilities?: CapabilityView) {
    return createSearchEntitiesTool(() => ({ db: {}, capabilities }) as never)
  }

  function run(args: Record<string, unknown>, capabilities?: CapabilityView) {
    return tool(capabilities).execute(args, CTX) as Promise<AgentToolResult>
  }

  it.each(['thread', 'threads', 'messages'])('refuses a scoped search on "%s"', async (key) => {
    searchSpy.mockClear()
    pointsAtTheMailTools(await run({ entityDefinitionId: key, query: 'refund' }))
    expect(searchSpy).not.toHaveBeenCalled()
  })

  it('never puts thread or message in the global scope', async () => {
    searchSpy.mockClear()
    await run({ query: 'refund' }, makeCapabilities())

    const scope = lastGlobalScope()
    expect(scope).not.toContain('thread')
    expect(scope).not.toContain('message')
  })

  it('includes the curated infra defs the Records nav hides', async () => {
    searchSpy.mockClear()
    await run({ query: 'support' }, makeCapabilities())

    const scope = lastGlobalScope()
    expect(scope).toContain('def_inbox')
    expect(scope).toContain('def_contact')
    expect(scope).not.toContain('def_signature')
  })

  // §7.3: the isVisible filter used to discard the def before the per-row
  // partitioning below it ever ran, so a record shared with the principal was
  // globally unfindable.
  it('keeps a nav-hidden def in scope when the principal holds per-record grants on it', async () => {
    searchSpy.mockClear()
    await run(
      { query: 'apollo' },
      makeCapabilities({ hasRecordGrantsOn: (id: string) => id === 'def_project' })
    )

    const scope = lastGlobalScope()
    expect(scope).toContain('def_project')
  })

  it('a grant on a blocked def still does not widen the scope to it', async () => {
    searchSpy.mockClear()
    await run({ query: 'apollo' }, makeCapabilities({ hasRecordGrantsOn: () => true }))

    const scope = lastGlobalScope()
    expect(scope).not.toContain('thread')
    expect(scope).not.toContain('message')
  })

  it('drops a def the principal has no presence on', async () => {
    searchSpy.mockClear()
    await run(
      { query: 'refund' },
      makeCapabilities({ canViewEntity: (id: string) => id !== 'def_contact' })
    )

    const scope = lastGlobalScope()
    expect(scope).not.toContain('def_contact')
  })
})

describe('get_entity — mail-lens block', () => {
  function run(recordId: string) {
    const tool = createGetEntityTool(() => ({ db: {}, capabilities: undefined }) as never)
    return tool.execute({ recordId }, CTX) as Promise<AgentToolResult>
  }

  it.each(['thread:t_1', 'message:m_1'])('refuses "%s" without reading the row', async (id) => {
    getResourcesByIdsSpy.mockClear()
    pointsAtTheMailTools(await run(id))
    expect(getResourcesByIdsSpy).not.toHaveBeenCalled()
  })
})

describe('list_entity_fields — mail-lens block', () => {
  function run(entityDefinitionId: string) {
    const tool = createListEntityFieldsTool(() => ({ db: {}, capabilities: undefined }) as never)
    return tool.execute({ entityDefinitionId }, CTX) as Promise<AgentToolResult>
  }

  it('refuses the thread schema rather than teaching the model the slug', async () => {
    const result = await run('threads')
    pointsAtTheMailTools(result)
    expect(JSON.stringify(result)).not.toContain('thread_subject')
  })

  it('never suggests a blocked or hidden slug in its valid-slug hint', async () => {
    const result = await run('nope')
    expect(result.error).toContain('contacts')
    expect(result.error).toContain('inboxes')
    expect(result.error).not.toContain('threads')
    expect(result.error).not.toContain('signatures')
  })
})

describe('list_entities — the curated allowlist', () => {
  function run(capabilities?: CapabilityView) {
    const tool = createListEntitiesTool(() => ({ db: {}, capabilities }) as never)
    return tool.execute({}, CTX) as Promise<AgentToolResult>
  }

  async function slugs(capabilities?: CapabilityView) {
    const result = await run(capabilities)
    return (result.output as { entities: Array<{ apiSlug: string }> }).entities.map(
      (e) => e.apiSlug
    )
  }

  it('advertises the curated infra defs the Records nav hides', async () => {
    expect(await slugs(makeCapabilities())).toContain('inboxes')
  })

  it('never advertises threads, messages or signatures', async () => {
    const listed = await slugs(makeCapabilities())
    expect(listed).not.toContain('threads')
    expect(listed).not.toContain('messages')
    expect(listed).not.toContain('signatures')
  })

  it('still applies def-level read enforcement on top of the allowlist', async () => {
    const listed = await slugs(makeCapabilities({ canViewEntity: (id) => id !== 'def_inbox' }))
    expect(listed).not.toContain('inboxes')
    expect(listed).toContain('contacts')
  })
})
