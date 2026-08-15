// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/__tests__/search-knowledge-capabilities.test.ts
//
// Permissions v2 §3.3 (Phase C3): the searchable dataset set is filtered by
// instance access — KB-backed datasets by `canViewInstance('kb', kbId)`,
// standalone RAG datasets by `canViewInstance('dataset', id)`. Silent filter:
// an empty set is a normal empty result, never a 403. Absent capabilities ⇒
// unrestricted AND zero extra queries — for the headless construction sites
// that legitimately pass `undefined` (master-Kopilot job runs, pre-setup
// drafts). The tool spells this as `'unrestricted'` when calling the shared
// resolver, whose `capabilities` parameter is required. NOTE: the workflow AI
// node is NOT one of those callers any more — `ai-v2.ts` threads a real
// CapabilityView.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const searchSpy = vi.fn()
vi.mock('../../../../../../datasets/services/search.service', () => ({
  SearchService: { search: (...args: unknown[]) => searchSpy(...args) },
}))

import type { CapabilityView } from '../../../../../../permissions/capabilities/capability-view'
import { Level } from '../../../../../../permissions/capabilities/registry'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { createSearchKnowledgeTool } from '../search-knowledge'

const KB_DATASET = 'ds_kb'
const RAG_DATASET = 'ds_rag'
const KB_ID = 'kb_1'

/**
 * Fake drizzle handle, discriminated by the SELECTed column set rather than by
 * table identity — the `schema.*` objects are dual-loaded under Vitest, so
 * `table === schema.X` is not reliable here (same reason the two pre-existing
 * `search-knowledge.test.ts` cases fail at HEAD).
 *
 *  - `{ id, datasetId }` → the KB id ↔ datasetId map read by the access filter.
 *  - `{ id }`            → the Dataset list (one KB-backed, one standalone RAG).
 *
 * `queries` records every `.from()` so we can prove the no-capabilities path
 * issues no extra roundtrip.
 */
function makeFakeDb(queries: string[]) {
  return {
    select: (cols?: Record<string, unknown>) => ({
      from: () => {
        const isKbMap = Boolean(cols && 'id' in cols && 'datasetId' in cols)
        queries.push(isKbMap ? 'kb-map' : 'datasets')
        const rows = isKbMap
          ? [{ id: KB_ID, datasetId: KB_DATASET }]
          : [{ id: KB_DATASET }, { id: RAG_DATASET }]
        return { where: () => Promise.resolve(rows) }
      },
    }),
  }
}

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
    // The list-side twin of `canViewInstance`, all-permissive like the rest of
    // this stub. The narrowing cases below override `canViewInstance` alone
    // because that is the gate `resolveKnowledgeDatasetIds` asks — it filters a
    // known id set per id, never a list. A case that ever exercises a LIST path
    // must override both, or the two answers disagree.
    instanceListScope: () => ({ kind: 'exclude', excludeIds: [] }),
    canEditInstance: yes,
    canAdminInstance: yes,
    assertViewInstance: noop,
    assertEditInstance: noop,
    assertAdminInstance: noop,
    ...overrides,
  }
}

function runTool(db: unknown, capabilities?: CapabilityView) {
  const tool = createSearchKnowledgeTool(() => ({ db, capabilities }) as never)
  const ctx = { organizationId: 'org_1', userId: 'u_1' } as ToolContext
  return tool.execute({ query: 'how do I cancel', source: 'rag' }, ctx) as Promise<AgentToolResult>
}

/** The `datasetIds` actually handed to `SearchService.search`. */
function searchedDatasetIds(): string[] | undefined {
  const args = searchSpy.mock.calls[0]?.[0] as { datasetIds?: string[] } | undefined
  return args?.datasetIds
}

beforeEach(() => {
  searchSpy.mockReset()
  searchSpy.mockResolvedValue({ results: [], total: 0, metrics: {} })
})

describe('search_knowledge — instance-access scope', () => {
  it('without capabilities, searches every resolved dataset and adds no queries', async () => {
    const queries: string[] = []
    await runTool(makeFakeDb(queries), undefined)

    expect(searchSpy).toHaveBeenCalledTimes(1)
    expect(searchedDatasetIds()).toEqual([KB_DATASET, RAG_DATASET])
    // Exactly one query — the dataset resolution. No access-filter roundtrip.
    expect(queries).toEqual(['datasets'])
  })

  it('drops a KB-backed dataset whose KB is not viewable', async () => {
    const capabilities = makeCapabilities({
      canViewInstance: (key, instanceId) => !(key === 'kb' && instanceId === KB_ID),
    })
    await runTool(makeFakeDb([]), capabilities)

    expect(searchSpy).toHaveBeenCalledTimes(1)
    expect(searchedDatasetIds()).toEqual([RAG_DATASET])
  })

  it('drops a standalone RAG dataset that is not viewable', async () => {
    const capabilities = makeCapabilities({
      canViewInstance: (key, instanceId) => !(key === 'dataset' && instanceId === RAG_DATASET),
    })
    await runTool(makeFakeDb([]), capabilities)

    expect(searchSpy).toHaveBeenCalledTimes(1)
    expect(searchedDatasetIds()).toEqual([KB_DATASET])
  })

  it('returns the normal empty result (no throw) when everything is filtered out', async () => {
    const capabilities = makeCapabilities({ canViewInstance: () => false })
    const result = await runTool(makeFakeDb([]), capabilities)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      results: [],
      count: 0,
      message: 'No accessible datasets for this query',
    })
    expect(searchSpy).not.toHaveBeenCalled()
  })
})
