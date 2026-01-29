// packages/lib/src/mail-query/__tests__/client.test.ts

import { describe, it, expect } from 'vitest'
import { mapStatusSlugToClientFilter, threadMatchesFilter, filterThreads } from '../client'

describe('mapStatusSlugToClientFilter', () => {
  it('maps open to OPEN status', () => {
    expect(mapStatusSlugToClientFilter('open')).toEqual({ status: 'OPEN' })
  })

  it('maps done/resolved to ARCHIVED status', () => {
    expect(mapStatusSlugToClientFilter('done')).toEqual({ status: 'ARCHIVED' })
    expect(mapStatusSlugToClientFilter('resolved')).toEqual({ status: 'ARCHIVED' })
  })

  it('maps trash/trashed to TRASH status', () => {
    expect(mapStatusSlugToClientFilter('trash')).toEqual({ status: 'TRASH' })
    expect(mapStatusSlugToClientFilter('trashed')).toEqual({ status: 'TRASH' })
  })

  it('maps spam to SPAM status', () => {
    expect(mapStatusSlugToClientFilter('spam')).toEqual({ status: 'SPAM' })
  })

  it('maps assigned to hasAssignee + OPEN (mirrors server)', () => {
    expect(mapStatusSlugToClientFilter('assigned')).toEqual({
      hasAssignee: true,
      status: 'OPEN',
    })
  })

  it('maps unassigned to no assignee + OPEN (mirrors server)', () => {
    expect(mapStatusSlugToClientFilter('unassigned')).toEqual({
      hasAssignee: false,
      status: 'OPEN',
    })
  })

  it('returns empty for context-based filters', () => {
    expect(mapStatusSlugToClientFilter('drafts')).toEqual({})
    expect(mapStatusSlugToClientFilter('sent')).toEqual({})
    expect(mapStatusSlugToClientFilter('all')).toEqual({})
    expect(mapStatusSlugToClientFilter('snoozed')).toEqual({})
  })

  it('handles case insensitivity', () => {
    expect(mapStatusSlugToClientFilter('OPEN')).toEqual({ status: 'OPEN' })
    expect(mapStatusSlugToClientFilter('Done')).toEqual({ status: 'ARCHIVED' })
    expect(mapStatusSlugToClientFilter('ASSIGNED')).toEqual({ hasAssignee: true, status: 'OPEN' })
  })

  it('handles undefined and unknown slugs', () => {
    expect(mapStatusSlugToClientFilter(undefined)).toEqual({})
    expect(mapStatusSlugToClientFilter('unknown')).toEqual({})
  })
})

describe('threadMatchesFilter', () => {
  const baseThread = {
    id: 'thread-1',
    status: 'OPEN',
    assigneeId: null,
    isUnread: true,
    tags: [{ id: 'tag-1' }],
    inboxId: 'inbox-1',
  }

  describe('status filter', () => {
    it('matches by single status', () => {
      expect(threadMatchesFilter(baseThread, { status: 'OPEN' })).toBe(true)
      expect(threadMatchesFilter(baseThread, { status: 'ARCHIVED' })).toBe(false)
    })

    it('matches by status array', () => {
      expect(threadMatchesFilter(baseThread, { status: ['OPEN', 'ARCHIVED'] })).toBe(true)
      expect(threadMatchesFilter(baseThread, { status: ['ARCHIVED', 'TRASH'] })).toBe(false)
    })
  })

  describe('inbox filter', () => {
    it('matches by inboxId', () => {
      expect(threadMatchesFilter(baseThread, { inboxId: 'inbox-1' })).toBe(true)
      expect(threadMatchesFilter(baseThread, { inboxId: 'inbox-2' })).toBe(false)
    })
  })

  describe('hasAssignee filter', () => {
    it('matches unassigned threads', () => {
      expect(threadMatchesFilter(baseThread, { hasAssignee: false })).toBe(true)
      expect(threadMatchesFilter(baseThread, { hasAssignee: true })).toBe(false)
    })

    it('matches assigned threads with ActorIdObject', () => {
      const assigned = { ...baseThread, assigneeId: { type: 'user' as const, id: 'user-1' } }
      expect(threadMatchesFilter(assigned, { hasAssignee: true })).toBe(true)
      expect(threadMatchesFilter(assigned, { hasAssignee: false })).toBe(false)
    })
  })

  describe('assigneeId filter', () => {
    it('matches specific assignee with ActorIdObject (type and id match)', () => {
      const assigned = { ...baseThread, assigneeId: { type: 'user' as const, id: 'user-1' } }
      expect(threadMatchesFilter(assigned, { assigneeId: { type: 'user', id: 'user-1' } })).toBe(true)
      expect(threadMatchesFilter(assigned, { assigneeId: { type: 'user', id: 'user-2' } })).toBe(false)
    })

    it('does not match when type differs', () => {
      const assigned = { ...baseThread, assigneeId: { type: 'user' as const, id: 'user-1' } }
      expect(threadMatchesFilter(assigned, { assigneeId: { type: 'contact', id: 'user-1' } })).toBe(false)
    })

    it('matches null assigneeId filter for unassigned', () => {
      expect(threadMatchesFilter(baseThread, { assigneeId: null })).toBe(true)
      const assigned = { ...baseThread, assigneeId: { type: 'user' as const, id: 'user-1' } }
      expect(threadMatchesFilter(assigned, { assigneeId: null })).toBe(false)
    })
  })

  describe('isUnread filter', () => {
    it('matches by unread status', () => {
      expect(threadMatchesFilter(baseThread, { isUnread: true })).toBe(true)
      expect(threadMatchesFilter(baseThread, { isUnread: false })).toBe(false)

      const readThread = { ...baseThread, isUnread: false }
      expect(threadMatchesFilter(readThread, { isUnread: false })).toBe(true)
      expect(threadMatchesFilter(readThread, { isUnread: true })).toBe(false)
    })
  })

  describe('tagIds filter', () => {
    it('matches if thread has at least one matching tag', () => {
      expect(threadMatchesFilter(baseThread, { tagIds: ['tag-1', 'tag-2'] })).toBe(true)
      expect(threadMatchesFilter(baseThread, { tagIds: ['tag-2', 'tag-3'] })).toBe(false)
    })

    it('handles threads with no tags', () => {
      const noTags = { ...baseThread, tags: [] }
      expect(threadMatchesFilter(noTags, { tagIds: ['tag-1'] })).toBe(false)

      const undefinedTags = { ...baseThread, tags: undefined }
      expect(threadMatchesFilter(undefinedTags, { tagIds: ['tag-1'] })).toBe(false)
    })
  })

  describe('excludeIds filter', () => {
    it('excludes threads in the exclude set', () => {
      expect(threadMatchesFilter(baseThread, { excludeIds: new Set(['thread-1']) })).toBe(false)
      expect(threadMatchesFilter(baseThread, { excludeIds: new Set(['thread-2']) })).toBe(true)
    })
  })

  describe('combined filters', () => {
    it('ANDs all criteria together', () => {
      expect(
        threadMatchesFilter(baseThread, {
          status: 'OPEN',
          hasAssignee: false,
          inboxId: 'inbox-1',
        })
      ).toBe(true)

      expect(
        threadMatchesFilter(baseThread, {
          status: 'OPEN',
          hasAssignee: true, // Fails - thread has no assignee
          inboxId: 'inbox-1',
        })
      ).toBe(false)
    })

    it('handles complex filter combinations', () => {
      const assigned = {
        ...baseThread,
        assigneeId: { type: 'user' as const, id: 'user-1' },
        isUnread: false,
        tags: [{ id: 'priority' }, { id: 'bug' }],
      }

      expect(
        threadMatchesFilter(assigned, {
          status: 'OPEN',
          hasAssignee: true,
          assigneeId: { type: 'user', id: 'user-1' },
          isUnread: false,
          tagIds: ['priority'],
          inboxId: 'inbox-1',
        })
      ).toBe(true)
    })
  })

  it('returns true for empty filter', () => {
    expect(threadMatchesFilter(baseThread, {})).toBe(true)
  })
})

describe('filterThreads', () => {
  const threads = [
    { id: '1', status: 'OPEN', assigneeId: null },
    { id: '2', status: 'OPEN', assigneeId: { type: 'user' as const, id: 'user-1' } },
    { id: '3', status: 'ARCHIVED', assigneeId: null },
    { id: '4', status: 'ARCHIVED', assigneeId: { type: 'user' as const, id: 'user-2' } },
    { id: '5', status: 'TRASH', assigneeId: null },
  ]

  it('filters array by status', () => {
    const open = filterThreads(threads, { status: 'OPEN' })
    expect(open.map((t) => t.id)).toEqual(['1', '2'])
  })

  it('filters array by hasAssignee', () => {
    const assigned = filterThreads(threads, { hasAssignee: true })
    expect(assigned.map((t) => t.id)).toEqual(['2', '4'])

    const unassigned = filterThreads(threads, { hasAssignee: false })
    expect(unassigned.map((t) => t.id)).toEqual(['1', '3', '5'])
  })

  it('filters by combined criteria', () => {
    const openUnassigned = filterThreads(threads, { status: 'OPEN', hasAssignee: false })
    expect(openUnassigned.map((t) => t.id)).toEqual(['1'])

    const openAssigned = filterThreads(threads, { status: 'OPEN', hasAssignee: true })
    expect(openAssigned.map((t) => t.id)).toEqual(['2'])
  })

  it('returns empty array when no matches', () => {
    const spam = filterThreads(threads, { status: 'SPAM' })
    expect(spam).toEqual([])
  })

  it('returns all threads for empty filter', () => {
    const all = filterThreads(threads, {})
    expect(all).toHaveLength(5)
  })

  it('preserves original thread types', () => {
    interface ExtendedThread {
      id: string
      status: string
      assigneeId: null
      customField: string
    }
    const extended: ExtendedThread[] = [{ id: '1', status: 'OPEN', assigneeId: null, customField: 'test' }]

    const result = filterThreads(extended, { status: 'OPEN' })
    expect(result[0].customField).toBe('test')
  })
})
