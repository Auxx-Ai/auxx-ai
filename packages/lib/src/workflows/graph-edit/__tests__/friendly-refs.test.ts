// packages/lib/src/workflows/graph-edit/__tests__/friendly-refs.test.ts

import { describe, expect, it } from 'vitest'
import {
  normalizeFriendlyRefs,
  type ResourceAliasIndex,
  renderPersistedRefs,
} from '../normalize/friendly-refs'
import type { NodeMeta } from '../types'

const TICKET_ID = 'i5aezsg4bc6n8gof2uan3wcf'

const node = (id: string, title: string, data: Record<string, unknown> = {}): NodeMeta => ({
  id,
  type: 'standard',
  data: { id, type: 'find', title, ...data },
})

const NODES: NodeMeta[] = [
  node('n1aaaaaaaaaaaaaaaaaaaa', 'Find Contact'),
  node('n2aaaaaaaaaaaaaaaaaaaa', 'Find Tickets', { resourceType: TICKET_ID }),
  node('n3aaaaaaaaaaaaaaaaaaaa', 'Find Mr. Smith'),
  node('d1aaaaaaaaaaaaaaaaaaaa', 'Send Reply'),
  node('d2aaaaaaaaaaaaaaaaaaaa', 'Send Reply'),
]

/** Tier-B ticket aliases, as `buildResourceAliasIndex` would produce them. */
const ALIASES: ResourceAliasIndex = {
  aliasToId: new Map(
    [TICKET_ID, 'ticket', 'tickets'].map((alias) => [alias.toLowerCase(), TICKET_ID])
  ),
  idToSlug: new Map([[TICKET_ID, 'ticket']]),
}

describe('normalizeFriendlyRefs', () => {
  it('rewrites {{Title.path}} spans to {{nodeId.path}}', () => {
    const { data, issues } = normalizeFriendlyRefs(
      { text: 'Email: {{Find Contact.email}}' },
      { nodes: NODES }
    )
    expect(data.text).toBe('Email: {{n1aaaaaaaaaaaaaaaaaaaa.email}}')
    expect(issues).toEqual([])
  })

  it('resolves a title containing a dot via longest-prefix', () => {
    const { data, issues } = normalizeFriendlyRefs(
      { text: '{{Find Mr. Smith.email}}' },
      { nodes: NODES }
    )
    expect(data.text).toBe('{{n3aaaaaaaaaaaaaaaaaaaa.email}}')
    expect(issues).toEqual([])
  })

  it('rewrites gated bare refs (if-else variableId shape)', () => {
    const { data, issues } = normalizeFriendlyRefs(
      { cases: [{ conditions: [{ variableId: 'Find Contact.email', value: 1 }] }] },
      { nodes: NODES }
    )
    expect((data.cases[0]!.conditions[0] as { variableId: string }).variableId).toBe(
      'n1aaaaaaaaaaaaaaaaaaaa.email'
    )
    expect(issues).toEqual([])
  })

  it('leaves prose alone, even when it starts with a node title and a dot', () => {
    const { data, issues } = normalizeFriendlyRefs(
      { note: 'Find Contact. Thanks.' },
      { nodes: NODES }
    )
    expect(data.note).toBe('Find Contact. Thanks.')
    expect(issues).toEqual([])
  })

  it('errors on an ambiguous title, listing candidates with ids, and leaves the value verbatim', () => {
    const { data, issues } = normalizeFriendlyRefs(
      { text: '{{Send Reply.status}}' },
      { nodes: NODES }
    )
    expect(data.text).toBe('{{Send Reply.status}}')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'error', ref: 'Send Reply.status' })
    expect(issues[0]!.message).toContain('d1aaaaaaaaaaaaaaaaaaaa')
    expect(issues[0]!.message).toContain('d2aaaaaaaaaaaaaaaaaaaa')
  })

  it('errors on an unknown span ref — never a silent drop', () => {
    const { data, issues } = normalizeFriendlyRefs({ text: '{{Ghost Node.x}}' }, { nodes: NODES })
    expect(data.text).toBe('{{Ghost Node.x}}')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toContain('Ghost Node.x')
  })

  it('leaves env./sys. refs untouched', () => {
    const { data, issues } = normalizeFriendlyRefs(
      { text: '{{env.THRESHOLD}} {{sys.userId}}' },
      { nodes: NODES }
    )
    expect(data.text).toBe('{{env.THRESHOLD}} {{sys.userId}}')
    expect(issues).toEqual([])
  })

  it('aliases the resource segment to the canonical id ({{Find Tickets.ticket.subject}})', () => {
    const { data, issues } = normalizeFriendlyRefs(
      { text: '{{Find Tickets.ticket.subject}}' },
      { nodes: NODES, resourceAliases: ALIASES }
    )
    expect(data.text).toBe(`{{n2aaaaaaaaaaaaaaaaaaaa.${TICKET_ID}.subject}}`)
    expect(issues).toEqual([])
  })

  it('aliases the plural form with a bracket accessor', () => {
    const { data } = normalizeFriendlyRefs(
      { text: '{{Find Tickets.tickets[*].subject}}' },
      { nodes: NODES, resourceAliases: ALIASES }
    )
    expect(data.text).toBe(`{{n2aaaaaaaaaaaaaaaaaaaa.${TICKET_ID}[*].subject}}`)
  })

  it('aliases even when the node still holds the slug in resourceType (pre-canonicalization)', () => {
    const nodes = [node('n9aaaaaaaaaaaaaaaaaaaa', 'Find Slug', { resourceType: 'ticket' })]
    const { data } = normalizeFriendlyRefs(
      { text: '{{Find Slug.ticket.subject}}' },
      { nodes, resourceAliases: ALIASES }
    )
    expect(data.text).toBe(`{{n9aaaaaaaaaaaaaaaaaaaa.${TICKET_ID}.subject}}`)
  })

  it('does not touch non-resource segments after the node ref', () => {
    const { data } = normalizeFriendlyRefs(
      { text: '{{Find Tickets.count}}' },
      { nodes: NODES, resourceAliases: ALIASES }
    )
    expect(data.text).toBe('{{n2aaaaaaaaaaaaaaaaaaaa.count}}')
  })

  it('never mutates the input', () => {
    const input = { text: '{{Find Contact.email}}' }
    normalizeFriendlyRefs(input, { nodes: NODES })
    expect(input.text).toBe('{{Find Contact.email}}')
  })
})

describe('renderPersistedRefs', () => {
  it('renders {{nodeId.path}} back as {{Title.path}}', () => {
    const data = renderPersistedRefs(
      { text: 'Email: {{n1aaaaaaaaaaaaaaaaaaaa.email}}' },
      { nodes: NODES }
    )
    expect(data.text).toBe('Email: {{Find Contact.email}}')
  })

  it('renders the resource segment back as its slug', () => {
    const data = renderPersistedRefs(
      { text: `{{n2aaaaaaaaaaaaaaaaaaaa.${TICKET_ID}.subject}}` },
      { nodes: NODES, resourceAliases: ALIASES }
    )
    expect(data.text).toBe('{{Find Tickets.ticket.subject}}')
  })

  it('keeps the id for duplicated titles — the only rendering that round-trips', () => {
    const data = renderPersistedRefs(
      { text: '{{d1aaaaaaaaaaaaaaaaaaaa.status}}' },
      { nodes: NODES }
    )
    expect(data.text).toBe('{{d1aaaaaaaaaaaaaaaaaaaa.status}}')
  })

  it('renders bare id refs (variableId shape)', () => {
    const data = renderPersistedRefs(
      { variableId: 'n1aaaaaaaaaaaaaaaaaaaa.email' },
      { nodes: NODES }
    )
    expect(data.variableId).toBe('Find Contact.email')
  })
})

describe('round trip', () => {
  it.each([
    ['{{Find Contact.email}}', {}],
    ['{{Find Mr. Smith.email}}', {}],
    ['{{Find Tickets.ticket.subject}}', { resourceAliases: ALIASES }],
    ['{{Find Tickets.ticket.attachments.values[*].name}}', { resourceAliases: ALIASES }],
    ['{{d1aaaaaaaaaaaaaaaaaaaa.status}}', {}],
  ])('%s survives friendly → persisted → friendly', (text, extra) => {
    const params = { nodes: NODES, ...extra }
    const { data: persisted, issues } = normalizeFriendlyRefs({ text }, params)
    expect(issues).toEqual([])
    const { data: rePersisted, issues: reIssues } = normalizeFriendlyRefs(
      renderPersistedRefs(persisted, params),
      params
    )
    expect(reIssues).toEqual([])
    // Friendly rendering is stable and re-normalizes to the identical persisted form.
    expect(renderPersistedRefs(persisted, params)).toEqual({ text })
    expect(rePersisted).toEqual(persisted)
  })
})
