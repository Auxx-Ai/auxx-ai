// packages/lib/src/workflows/graph-edit/__tests__/refs.test.ts

import { describe, expect, it } from 'vitest'
import { formatNodeRef, isIdShaped, matchNodeRefPrefix, resolveNodeRef } from '../refs'
import type { NodeMeta } from '../types'

const node = (id: string, title: string, data: Record<string, unknown> = {}): NodeMeta => ({
  id,
  type: 'standard',
  data: { id, type: 'find', title, ...data },
})

const NODES: NodeMeta[] = [
  node('n1aaaaaaaaaaaaaaaaaaaa', 'Find Contact'),
  node('n2aaaaaaaaaaaaaaaaaaaa', 'Find Tickets'),
  node('n3aaaaaaaaaaaaaaaaaaaa', 'Find Mr. Smith'),
  node('d1aaaaaaaaaaaaaaaaaaaa', 'Send Reply'),
  node('d2aaaaaaaaaaaaaaaaaaaa', 'Send Reply'),
]

describe('resolveNodeRef', () => {
  it('resolves an exact title match case-insensitively', () => {
    const result = resolveNodeRef(NODES, 'find contact')
    expect(result._unsafeUnwrap()).toMatchObject({
      node: { id: 'n1aaaaaaaaaaaaaaaaaaaa' },
      matchedBy: 'title',
    })
  })

  it('errors on an ambiguous title, listing every candidate with its id', () => {
    const result = resolveNodeRef(NODES, 'Send Reply')
    expect(result.isErr()).toBe(true)
    const message = result._unsafeUnwrapErr().message
    expect(message).toContain('ambiguous')
    expect(message).toContain('d1aaaaaaaaaaaaaaaaaaaa')
    expect(message).toContain('d2aaaaaaaaaaaaaaaaaaaa')
  })

  it('falls back to an exact id match when no title matches', () => {
    const result = resolveNodeRef(NODES, 'n2aaaaaaaaaaaaaaaaaaaa')
    expect(result._unsafeUnwrap()).toMatchObject({
      node: { id: 'n2aaaaaaaaaaaaaaaaaaaa' },
      matchedBy: 'id',
    })
  })

  it('returns an actionable not-found error naming close candidates', () => {
    const result = resolveNodeRef(NODES, 'Find Contct')
    expect(result.isErr()).toBe(true)
    const message = result._unsafeUnwrapErr().message
    expect(message).toContain('No node matches "Find Contct"')
    expect(message).toContain('Find Contact')
  })

  it('notes when an id-shaped ref matches no node', () => {
    const result = resolveNodeRef(NODES, 'zzzzzzzzzzzzzzzzzzzzzzzz')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('No node has this id either')
  })

  it('rejects an empty ref', () => {
    expect(resolveNodeRef(NODES, '  ').isErr()).toBe(true)
  })
})

describe('matchNodeRefPrefix', () => {
  it('matches a title head and returns the path remainder', () => {
    const match = matchNodeRefPrefix(NODES, 'Find Contact.email')._unsafeUnwrap()
    expect(match).toMatchObject({ node: { id: 'n1aaaaaaaaaaaaaaaaaaaa' }, rest: 'email' })
  })

  it('matches a title containing a dot via longest-prefix', () => {
    const match = matchNodeRefPrefix(NODES, 'Find Mr. Smith.email')._unsafeUnwrap()
    expect(match).toMatchObject({ node: { id: 'n3aaaaaaaaaaaaaaaaaaaa' }, rest: 'email' })
  })

  it('matches an id head', () => {
    const match = matchNodeRefPrefix(NODES, 'n2aaaaaaaaaaaaaaaaaaaa.tickets[*]')._unsafeUnwrap()
    expect(match).toMatchObject({ node: { id: 'n2aaaaaaaaaaaaaaaaaaaa' }, rest: 'tickets[*]' })
  })

  it('keeps a bracket remainder attached to the ref head', () => {
    const withBracket = [...NODES, node('n4aaaaaaaaaaaaaaaaaaaa', 'Orders')]
    const match = matchNodeRefPrefix(withBracket, 'Orders[0].total')._unsafeUnwrap()
    expect(match).toMatchObject({ node: { id: 'n4aaaaaaaaaaaaaaaaaaaa' }, rest: '[0].total' })
  })

  it('errors on an ambiguous title head instead of guessing', () => {
    const result = matchNodeRefPrefix(NODES, 'Send Reply.status')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('ambiguous')
  })

  it('returns null for prose that merely starts with a title', () => {
    expect(matchNodeRefPrefix(NODES, 'Find Contact. Thanks.')._unsafeUnwrap()).toBeNull()
  })

  it('returns null for non-refs (env/prose)', () => {
    expect(matchNodeRefPrefix(NODES, 'no such thing.here')._unsafeUnwrap()).toBeNull()
  })
})

describe('formatNodeRef', () => {
  it('renders a unique title', () => {
    expect(formatNodeRef(NODES, 'n1aaaaaaaaaaaaaaaaaaaa')).toBe('Find Contact')
  })

  it('keeps the id when the title is duplicated — the only rendering that round-trips', () => {
    expect(formatNodeRef(NODES, 'd1aaaaaaaaaaaaaaaaaaaa')).toBe('d1aaaaaaaaaaaaaaaaaaaa')
  })

  it('passes unknown ids through', () => {
    expect(formatNodeRef(NODES, 'ghost')).toBe('ghost')
  })
})

describe('isIdShaped', () => {
  it.each(['V1StGXR8_Z5jdHi6B-myT', 'i5aezsg4bc6n8gof2uan3wcf'])('accepts %s', (id) => {
    expect(isIdShaped(id)).toBe(true)
  })

  it.each(['Find Contact', 'short', 'has.dot.aaaaaaaaaaaaaa'])('rejects %s', (ref) => {
    expect(isIdShaped(ref)).toBe(false)
  })
})
