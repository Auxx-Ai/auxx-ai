// packages/lib/src/dashboards/draft-edit/__tests__/normalize.test.ts
//
// The four traps a model falls into writing a widget config by hand, and the
// fifth that fails silently:
//
// 1. a source named by slug/label/plural instead of the per-org cuid,
// 2. `thread` / `message` offered as if they were ordinary sources,
// 3. a field ref that is a bare name, or is scoped to the wrong def (which
//    refuses the WHOLE document via `layoutDocRefine`, not just its widget),
// 4. a select filter value written as the LABEL rather than the option key,
// 5. a filter condition the query builder cannot compile, which is DROPPED
//    silently at render time, so "filter applied" prints unfiltered data.
//
// These assert the normalization, not the implementation: what goes in is a
// name and what comes out is the canonical value the rest of the pipeline reads.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fieldsFor, RESOURCES, TICKET_FIELDS } from './support/org-fixtures'

// Partial mock: a wholesale replacement of the cache barrel dies at collection
// as the import graph grows (the aggregate suites document the same).
vi.mock('../../../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCachedResources: async () => RESOURCES,
    getCachedResourceFields: async (_org: string, id: string) => fieldsFor(id),
  }
})

import type { ConditionGroup } from '../../../conditions'
import { ForbiddenError } from '../../../errors'
import type { WidgetSource } from '../../client'
import { describeFieldRef, resolveFieldRef, resolveOptionValue } from '../normalize/field-refs'
import { normalizeFilters } from '../normalize/filters'
import { describeSource, resolveWidgetSource } from '../normalize/source-refs'

const ORG = 'org_1'
const TICKET: WidgetSource = { kind: 'entity', entityDefinitionId: 'ticket' }
const PROJECT: WidgetSource = { kind: 'entity', entityDefinitionId: 'cust_def_1' }
const ARTICLE: WidgetSource = { kind: 'system', tableId: 'article' as never }

let counter = 0
function group(
  conditions: Array<{ fieldId: string; operator: string; value?: unknown }>
): ConditionGroup {
  return {
    id: `grp_${counter++}`,
    logicalOperator: 'AND',
    conditions: conditions.map((c) => ({ id: `cnd_${counter++}`, ...c })) as never,
  }
}

beforeEach(() => {
  counter = 0
})

describe('resolveWidgetSource', () => {
  it.each([
    ['apiSlug', 'tickets'],
    ['entityType', 'ticket'],
    ['label', 'Ticket'],
    ['plural', 'Tickets'],
    ['raw id', 'ticket'],
    ['different casing', 'TICKETS'],
  ])('resolves a system-backed def by its %s', async (_label, input) => {
    const result = await resolveWidgetSource(ORG, input)
    expect(result._unsafeUnwrap()).toEqual({ kind: 'entity', entityDefinitionId: 'ticket' })
  })

  // The case the module exists for: nothing the user says looks like the id.
  it('resolves a per-org custom def by a name that looks nothing like its id', async () => {
    for (const input of ['Project', 'projects', 'Projects']) {
      const result = await resolveWidgetSource(ORG, input)
      expect(result._unsafeUnwrap()).toEqual({ kind: 'entity', entityDefinitionId: 'cust_def_1' })
    }
  })

  it('tags a curated aggregate table as a SYSTEM source, not an entity', async () => {
    expect((await resolveWidgetSource(ORG, 'Articles'))._unsafeUnwrap()).toEqual({
      kind: 'system',
      tableId: 'article',
    })
  })

  it.each([
    'thread',
    'threads',
    'Thread',
    'message',
  ])('refuses "%s" and says why, so the caller tells the user instead of retrying', async (input) => {
    const result = await resolveWidgetSource(ORG, input)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ForbiddenError)
    expect(error.message).toMatch(/mailbox/i)
    expect(error.message).toMatch(/mail search tools/i)
  })

  it('names the closest matches on a miss', async () => {
    const error = (await resolveWidgetSource(ORG, 'tickts'))._unsafeUnwrapErr()
    expect(error.message).toContain('Unknown dashboard source')
    expect(error.details.closestMatches).toContain('ticket')
  })

  it('is empty-safe', async () => {
    expect((await resolveWidgetSource(ORG, '   ')).isErr()).toBe(true)
  })
})

describe('describeSource', () => {
  it('renders a source back as a label, so no raw id leaves the module', () => {
    expect(describeSource(PROJECT, RESOURCES)).toBe('Project')
    expect(describeSource(ARTICLE, RESOURCES)).toBe('Article')
  })

  it('falls back to the id rather than inventing a name', () => {
    expect(describeSource(PROJECT)).toBe('cust_def_1')
  })
})

describe('resolveFieldRef', () => {
  it.each([
    ['label', 'Status'],
    ['key', 'status'],
    ['id', 'fld_status'],
    ['casing', 'STATUS'],
    ['an already-canonical ref', 'ticket:fld_status'],
  ])('resolves a field by its %s, scoped to the source', async (_label, input) => {
    const result = await resolveFieldRef(ORG, TICKET, input)
    expect(result._unsafeUnwrap()).toBe('ticket:fld_status')
  })

  // THE property: the def half of the ref is always the widget's own source, so
  // `layoutDocRefine`'s root-def check cannot fail on anything produced here.
  it('always scopes to the widget source, never to another def', async () => {
    const onTicket = await resolveFieldRef(ORG, TICKET, 'Status')
    const onProject = await resolveFieldRef(ORG, PROJECT, 'Name')
    expect(String(onTicket._unsafeUnwrap()).split(':')[0]).toBe('ticket')
    expect(String(onProject._unsafeUnwrap()).split(':')[0]).toBe('cust_def_1')
  })

  it('refuses a ref already scoped to a DIFFERENT def instead of passing it through', async () => {
    const error = (await resolveFieldRef(ORG, TICKET, 'contact:fld_email'))._unsafeUnwrapErr()
    expect(error.message).toMatch(/may only reference fields of its own source/i)
  })

  it('names the field, the source and the closest matches on a miss', async () => {
    const error = (await resolveFieldRef(ORG, TICKET, 'statuss', 'Ticket'))._unsafeUnwrapErr()
    expect(error.message).toContain('No field "statuss" on Ticket')
    expect(error.message).toContain('status')
    expect(error.details.closestMatches).toEqual(expect.arrayContaining(['status']))
  })

  it('resolves a one-hop path into a two-element FieldPath', async () => {
    const result = await resolveFieldRef(ORG, TICKET, 'company.name')
    expect(result._unsafeUnwrap()).toEqual(['ticket:fld_company', 'cust_def_1:fld_name'])
  })

  it('refuses a hop through a field that is not a relationship', async () => {
    const error = (await resolveFieldRef(ORG, TICKET, 'subject.name'))._unsafeUnwrapErr()
    expect(error.message).toMatch(/is not a relationship/i)
  })

  it('refuses paths deeper than one hop rather than guessing', async () => {
    const error = (await resolveFieldRef(ORG, TICKET, 'company.owner.name'))._unsafeUnwrapErr()
    expect(error.message).toMatch(/one hop at most/i)
  })

  it('refuses a relationship path on a system source, matching the engine', async () => {
    const error = (await resolveFieldRef(ORG, ARTICLE, 'a.b'))._unsafeUnwrapErr()
    expect(error.message).toMatch(/system sources/i)
  })

  it('refuses a non-column-backed field on a system source, matching the engine', async () => {
    const error = (await resolveFieldRef(ORG, ARTICLE, 'Word count'))._unsafeUnwrapErr()
    expect(error.message).toMatch(/not column-backed/i)
  })
})

describe('describeFieldRef', () => {
  it('renders a ref back as its label', () => {
    expect(describeFieldRef('ticket:fld_status' as never, TICKET_FIELDS)).toBe('Status')
  })
})

describe('resolveOptionValue', () => {
  const status = TICKET_FIELDS.find((f) => f.key === 'status') as (typeof TICKET_FIELDS)[number]
  const subject = TICKET_FIELDS.find((f) => f.key === 'subject') as (typeof TICKET_FIELDS)[number]

  it('maps a human LABEL to the stored KEY', () => {
    expect(resolveOptionValue(status, 'Active')._unsafeUnwrap()).toBe('ACTIVE')
  })

  it('leaves a key alone', () => {
    expect(resolveOptionValue(status, 'ACTIVE')._unsafeUnwrap()).toBe('ACTIVE')
  })

  it('maps every element of an `in` list', () => {
    expect(resolveOptionValue(status, ['Active', 'CLOSED'])._unsafeUnwrap()).toEqual([
      'ACTIVE',
      'CLOSED',
    ])
  })

  it('refuses a value that is neither, listing the options', () => {
    const error = resolveOptionValue(status, 'Open')._unsafeUnwrapErr()
    expect(error.message).toContain('ACTIVE (Active)')
  })

  it('passes a field with no options through untouched', () => {
    expect(resolveOptionValue(subject, 'anything')._unsafeUnwrap()).toBe('anything')
    expect(resolveOptionValue(status, undefined)._unsafeUnwrap()).toBeUndefined()
  })
})

describe('normalizeFilters', () => {
  it('resolves field names and select labels in one pass', async () => {
    const result = await normalizeFilters(
      ORG,
      TICKET,
      [group([{ fieldId: 'Status', operator: 'is', value: 'Active' }])],
      'Ticket'
    )
    const [only] = result._unsafeUnwrap()
    expect(only?.conditions[0]).toMatchObject({
      fieldId: 'ticket:fld_status',
      value: 'ACTIVE',
    })
  })

  it('reports EVERY unresolvable field at once rather than one per round trip', async () => {
    const result = await normalizeFilters(
      ORG,
      TICKET,
      [
        group([
          { fieldId: 'statuss', operator: 'is', value: 'ACTIVE' },
          { fieldId: 'nonesuch', operator: 'is', value: 'x' },
        ]),
      ],
      'Ticket'
    )
    const message = result._unsafeUnwrapErr().message
    expect(message).toContain('statuss')
    expect(message).toContain('nonesuch')
  })

  // THE silent trap. `starts with` has no case for an option-backed column, so
  // the builder drops it and the query runs with the bare org scope: every row.
  it('REJECTS a condition the builder would silently drop', async () => {
    const result = await normalizeFilters(
      ORG,
      TICKET,
      [group([{ fieldId: 'Status', operator: 'starts with', value: 'ACTIVE' }])],
      'Ticket'
    )
    const error = result._unsafeUnwrapErr()
    expect(error.message).toContain('Status')
    expect(error.message).toMatch(/starts with/i)
    expect(error.message).toMatch(/unfiltered data/i)
  })

  it('accepts an empty set: no filter is not the same as every filter dropped', async () => {
    expect((await normalizeFilters(ORG, TICKET, []))._unsafeUnwrap()).toEqual([])
  })
})
