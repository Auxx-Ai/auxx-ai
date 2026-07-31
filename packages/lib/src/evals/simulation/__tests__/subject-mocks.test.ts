// packages/lib/src/evals/simulation/__tests__/subject-mocks.test.ts
//
// Derived subject mocks: make a simulation's identity lookups agree with the
// customer the simulation configures, instead of the tool's schema-doc
// `exampleOutput` (which always answers "Jane Cooper").
//
// The properties that matter are the ones about NOT overreaching: an
// author-written mock must still win, and a search for something unrelated must
// still fall through to the existing default.

import type { SimulationConfig, SimulationToolMock } from '@auxx/types/evals'
import { describe, expect, it } from 'vitest'
import { createMockResolver } from '../mock-tools'
import { buildSubjectMocks } from '../subject-mocks'

const config = (over: Partial<SimulationConfig> = {}): SimulationConfig =>
  ({
    openingMessage: 'hi',
    customerContext: '',
    channel: 'chat',
    maxCustomerTurns: 8,
    connectorMocks: [],
    unmatchedToolPolicy: 'fail_closed',
    startingFields: {},
    subject: { claimed: { name: 'Jordan Lee', email: 'jordan.lee@example.com' } },
    ...over,
  }) as unknown as SimulationConfig

describe('buildSubjectMocks', () => {
  it('returns nothing when there is no claimed identity', () => {
    expect(buildSubjectMocks(config({ subject: {} } as Partial<SimulationConfig>))).toEqual([])
  })

  it('returns nothing for a blank-but-present identity', () => {
    const c = config({
      subject: { claimed: { name: '  ', email: '' } },
    } as Partial<SimulationConfig>)
    expect(buildSubjectMocks(c)).toEqual([])
  })

  it('answers a search for the customer name with the customer', () => {
    const resolver = createMockResolver(buildSubjectMocks(config()))
    const hit = resolver.resolve('search_entities', { query: 'Jordan Lee' })
    expect(hit?.output).toMatchObject({
      count: 1,
      items: [{ displayName: 'Jordan Lee', secondaryInfo: 'jordan.lee@example.com' }],
    })
  })

  it('answers a search for the customer email with the customer', () => {
    const resolver = createMockResolver(buildSubjectMocks(config()))
    const hit = resolver.resolve('search_entities', { query: 'jordan.lee@example.com' })
    expect(hit?.output).toMatchObject({ count: 1 })
  })

  it('matches even when the call carries extra args', () => {
    // `subset` — an accompanying entityDefinitionId/limit must not defeat it.
    const resolver = createMockResolver(buildSubjectMocks(config()))
    const hit = resolver.resolve('search_entities', {
      query: 'Jordan Lee',
      entityDefinitionId: 'contacts',
      limit: 10,
    })
    expect(hit).not.toBeNull()
  })

  it('does NOT hijack a search for something unrelated', () => {
    // Must fall through to the existing exampleOutput behavior, not force-feed
    // the customer into every lookup.
    const resolver = createMockResolver(buildSubjectMocks(config()))
    expect(resolver.resolve('search_entities', { query: 'blender' })).toBeNull()
  })

  it('answers a contact query_records with the customer', () => {
    // Regression guard from a live verification run: query_records was left
    // uncovered, the agent called it FIRST, anchored on the example's contact,
    // and then wrote its note to the wrong record.
    const resolver = createMockResolver(buildSubjectMocks(config()))
    for (const entity of ['contacts', 'contact']) {
      const hit = resolver.resolve('query_records', { entity, filters: [{ field: 'x' }] })
      expect(hit?.output).toMatchObject({
        returned_count: 1,
        items: [{ displayName: 'Jordan Lee' }],
      })
    }
  })

  it('leaves a query_records for another entity type alone', () => {
    const resolver = createMockResolver(buildSubjectMocks(config()))
    expect(resolver.resolve('query_records', { entity: 'tickets' })).toBeNull()
  })

  it('hands query_records and search_entities the SAME recordId', () => {
    // Both entry points must anchor the run on one record, or a later
    // get_entity/create_note lands on a different one.
    const resolver = createMockResolver(buildSubjectMocks(config()))
    const viaQuery = resolver.resolve('query_records', { entity: 'contacts' })
    const viaSearch = resolver.resolve('search_entities', { query: 'Jordan Lee' })
    const idOf = (r: unknown) => (r as { items: Array<{ recordId: string }> }).items[0]!.recordId
    expect(idOf(viaQuery?.output)).toBe(idOf(viaSearch?.output))
  })

  it('reads back the same recordId it handed out', () => {
    const mocks = buildSubjectMocks(config())
    const resolver = createMockResolver(mocks)
    const found = resolver.resolve('search_entities', { query: 'Jordan Lee' })
    const recordId = (found?.output as { items: Array<{ recordId: string }> }).items[0]!.recordId
    const read = resolver.resolve('get_entity', { recordId })
    expect(read?.output).toMatchObject({ recordId, displayName: 'Jordan Lee' })
  })

  it('prefers a linked real record over the synthetic id', () => {
    const c = config({
      subject: {
        claimed: { name: 'Jordan Lee', email: 'jordan.lee@example.com' },
        recordIds: ['contacts:real_instance_1'],
      },
    } as Partial<SimulationConfig>)
    const resolver = createMockResolver(buildSubjectMocks(c))
    const hit = resolver.resolve('search_entities', { query: 'Jordan Lee' })
    expect((hit?.output as { items: Array<{ recordId: string }> }).items[0]!.recordId).toBe(
      'contacts:real_instance_1'
    )
  })

  it('works from an email alone', () => {
    const c = config({
      subject: { claimed: { email: 'solo@example.com' } },
    } as Partial<SimulationConfig>)
    const resolver = createMockResolver(buildSubjectMocks(c))
    const hit = resolver.resolve('search_entities', { query: 'solo@example.com' })
    expect(hit?.output).toMatchObject({ items: [{ displayName: 'solo@example.com' }] })
  })
})

describe('precedence against author-written mocks', () => {
  it('an explicit mock wins over the derived one', () => {
    // The executor composes [...connectorMocks, ...subjectMocks] and the
    // resolver takes the FIRST match in stored order. If that order is ever
    // flipped, an author who deliberately mocked "customer not found" would be
    // silently overridden — which is exactly the bug this ordering prevents.
    const authored: SimulationToolMock = {
      id: 'authored',
      toolName: 'search_entities',
      output: { items: [], count: 0 },
      usage: 'repeat',
    }
    const resolver = createMockResolver([authored, ...buildSubjectMocks(config())])
    const hit = resolver.resolve('search_entities', { query: 'Jordan Lee' })
    expect(hit?.mock.id).toBe('authored')
    expect(hit?.output).toMatchObject({ count: 0 })
  })
})
