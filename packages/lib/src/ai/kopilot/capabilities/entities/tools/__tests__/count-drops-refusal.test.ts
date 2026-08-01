// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/count-drops-refusal.test.ts
//
// The AI boundary for a WIDENED COUNT.
//
// `countEntityInstances` / `countSystemResource` fail open: a filter condition
// the builder cannot compile is dropped and the `COUNT(*)` runs anyway. For a
// list that is the right call and the reporting channel is enough — the extra
// rows are on screen. For a count it is not: the answer is a single number that
// reads exactly as authoritative when it is the unfiltered total, and an agent
// will state it as fact ("you have 6,470 open tickets").
//
// So the rule, and it is asymmetric on purpose:
//
//   • EVERY condition dropped ⇒ refuse. Not a wider answer to the question
//     asked — the answer to a different question. Same line
//     `inspectFilterConditions` draws, same `allConditionsDropped` discriminant,
//     which is `false` for the genuine no-filter case so an unfiltered
//     `countOnly` still answers.
//   • SOME conditions dropped ⇒ answer, with a warning naming each ignored one.
//     The survivors did narrow the count, and the model can see what to fix.

import { describe, expect, it, vi } from 'vitest'

const CONTACT = {
  id: 'def_contact',
  entityDefinitionId: 'def_contact',
  entityType: 'contact',
  apiSlug: 'contacts',
  label: 'Contact',
  plural: 'Contacts',
  isVisible: true,
  fields: [{ id: 'contact_status', key: 'status', label: 'Status', fieldType: 'TEXT' }],
}

/** A system-table-backed resource, to prove the other count lane refuses too. */
const ARTICLE = {
  id: 'article',
  entityDefinitionId: 'article',
  entityType: 'article',
  apiSlug: 'articles',
  label: 'Article',
  plural: 'Articles',
  isVisible: true,
  fields: [{ id: 'article_status', key: 'status', label: 'Status', fieldType: 'TEXT' }],
}

const RESOURCES = [CONTACT, ARTICLE]

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) =>
      RESOURCES.find((r) => r.id === key || r.entityType === key || r.apiSlug === key) ?? null
  ),
  getCachedResources: vi.fn(async () => RESOURCES),
}))

/**
 * Full factory, not `importOriginal` + spread: this is a LOCAL barrel whose
 * transitive graph re-enters the modules under test, and a partial mock there
 * binds the real helper and silently no-ops (see the sibling crud tests).
 */
const countEntity = vi.fn()
const countSystem = vi.fn()

vi.mock('../../../../../../resources/crud', () => ({
  countEntityInstances: (...args: unknown[]) => countEntity(...args),
  countSystemResource: (...args: unknown[]) => countSystem(...args),
  isSystemResource: (id: string) => id === 'article',
  UnifiedCrudHandler: class {
    listFiltered() {
      return { ids: [], hasMore: false, total: 0 }
    }
    getByIds() {
      return {}
    }
  },
}))

import { UnprocessableEntityError } from '../../../../../../errors'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { countRecordMatches } from '../../../record-views/count-matches'
import { createQueryRecordsTool } from '../query-records'

const CTX = { organizationId: 'org_1', userId: 'u_1' } as ToolContext

/** One condition that passes the front door, so only the BUILDER can drop it. */
const STATUS_FILTER = [{ field: 'status', operator: 'is', value: 'OPEN' }]

/** The count-lane result shape, with the drop report the builder produced. */
function countResult(over: { count: number; allConditionsDropped: boolean; dropped?: number }) {
  const dropped = over.dropped ?? 0
  return {
    count: over.count,
    allConditionsDropped: over.allConditionsDropped,
    ...(dropped > 0
      ? {
          droppedConditionCount: dropped,
          droppedConditions: Array.from({ length: dropped }, (_, i) => ({
            conditionId: `filter-${i}`,
            fieldRef: 'contacts:status',
            operator: 'is',
            reason: 'unresolved-field-or-operator' as const,
          })),
        }
      : {}),
  }
}

function runCount(args: Record<string, unknown>) {
  const tool = createQueryRecordsTool(() => ({ db: {}, capabilities: undefined }) as never)
  return tool.execute({ countOnly: true, ...args }, CTX) as Promise<AgentToolResult>
}

describe('query_records countOnly — every condition dropped', () => {
  it('refuses instead of reporting the unfiltered total', async () => {
    countEntity.mockResolvedValue(
      countResult({ count: 6470, allConditionsDropped: true, dropped: 1 })
    )

    const result = await runCount({ entity: 'contact', filters: STATUS_FILTER })

    expect(result.success).toBe(false)
    expect(result.error).toContain('UNFILTERED')
    expect(result.error).toContain('Contact')
  })

  it('leaks the widened number nowhere in the refusal', async () => {
    countEntity.mockResolvedValue(
      countResult({ count: 6470, allConditionsDropped: true, dropped: 1 })
    )

    const result = await runCount({ entity: 'contact', filters: STATUS_FILTER })

    // A refusal that still prints the number is not a refusal — the model would
    // read it out of the error string.
    expect(JSON.stringify(result)).not.toContain('6470')
    expect(JSON.stringify(result)).not.toContain('total_matching')
  })

  it('refuses on the system-table lane identically', async () => {
    countSystem.mockResolvedValue(
      countResult({ count: 900, allConditionsDropped: true, dropped: 1 })
    )

    const result = await runCount({ entity: 'article', filters: STATUS_FILTER })

    expect(countSystem).toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error).toContain('UNFILTERED')
  })

  it('names the ignored condition so the model can fix it in one turn', async () => {
    countEntity.mockResolvedValue(
      countResult({ count: 6470, allConditionsDropped: true, dropped: 1 })
    )

    const result = await runCount({ entity: 'contact', filters: STATUS_FILTER })

    expect(result.error).toContain('status')
    expect(result.error).toContain('list_entity_fields')
  })

  it('returns a failed result rather than throwing out of execute', async () => {
    countEntity.mockResolvedValue(
      countResult({ count: 6470, allConditionsDropped: true, dropped: 1 })
    )

    // The tool's own idiom for a caller-caused refusal is `success: false` — the
    // same shape as its ambiguous / not-found / blocked branches. A thrown tool
    // is logged as an internal fault, which this is not.
    await expect(runCount({ entity: 'contact', filters: STATUS_FILTER })).resolves.toMatchObject({
      success: false,
    })
  })
})

describe('query_records countOnly — a partial drop still answers', () => {
  it('returns the count and warns about the condition that was ignored', async () => {
    countEntity.mockResolvedValue(
      countResult({ count: 88, allConditionsDropped: false, dropped: 1 })
    )

    const result = await runCount({ entity: 'contact', filters: STATUS_FILTER })

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ total_matching: 88 })
    const warnings = (result.output as { warnings?: Array<{ kind: string; hint: string }> })
      .warnings
    expect(warnings?.some((w) => w.kind === 'filter_not_applied')).toBe(true)
    expect(warnings?.find((w) => w.kind === 'filter_not_applied')?.hint).toContain('HIGHER')
  })

  it('answers a clean count with no warnings at all', async () => {
    countEntity.mockResolvedValue(countResult({ count: 12, allConditionsDropped: false }))

    const result = await runCount({ entity: 'contact', filters: STATUS_FILTER })

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ total_matching: 12, warnings: undefined })
  })

  it('answers a genuinely UNFILTERED count — the no-filter case is not a drop', async () => {
    // `allConditionsDropped` is false when nothing was asked for, which is the
    // only reason "count every contact" is still a legal question here.
    countEntity.mockResolvedValue(countResult({ count: 6470, allConditionsDropped: false }))

    const result = await runCount({ entity: 'contact' })

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ total_matching: 6470 })
  })
})

describe('countRecordMatches — the record-view preview lane', () => {
  const args = {
    db: {} as never,
    organizationId: 'org_1',
    resource: CONTACT as never,
    entityDefinitionId: 'def_contact',
    filters: [{ field: 'status', operator: 'is', value: 'OPEN' }],
    logicalOperator: 'AND' as const,
  }

  it('throws an AuxxError when every condition dropped', async () => {
    countEntity.mockResolvedValue(
      countResult({ count: 6470, allConditionsDropped: true, dropped: 1 })
    )

    // `UnprocessableEntityError`, not a `TRPCError`: this is lib code, reached
    // from a worker-hosted agent as often as from a request.
    await expect(countRecordMatches(args)).rejects.toBeInstanceOf(UnprocessableEntityError)
  })

  it('still answers on a partial drop', async () => {
    countEntity.mockResolvedValue(
      countResult({ count: 88, allConditionsDropped: false, dropped: 1 })
    )

    await expect(countRecordMatches(args)).resolves.toBe(88)
  })

  it('answers a clean count', async () => {
    countEntity.mockResolvedValue(countResult({ count: 5, allConditionsDropped: false }))

    await expect(countRecordMatches(args)).resolves.toBe(5)
  })
})
