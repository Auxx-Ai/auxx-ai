// packages/lib/src/mail-query/__tests__/visibility-scope.test.ts

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type { ConditionGroup } from '../../conditions/types'
import type { UserMailVisibility } from '../../permissions/visibility/context'
import { SYSTEM_VISIBILITY } from '../../permissions/visibility/context'
import { buildConditionGroupsQuery } from '../condition-query-builder'
import { sharedThreadIds } from '../visibility-scope'

function userVisibility(threadGrants: UserMailVisibility['threadGrants']): UserMailVisibility {
  return {
    userId: 'user-1',
    role: 'USER',
    isAdmin: false,
    isMailAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    threadGrants,
    contactGrants: {},
    entityGrants: {},
  }
}

describe('sharedThreadIds', () => {
  it('returns only direct thread grants at metadata or above', () => {
    const viewer = userVisibility({
      hidden: 'none',
      metadata: 'metadata',
      subject: 'subject',
      full: 'full',
    })

    expect(sharedThreadIds(viewer)).toEqual(['metadata', 'subject', 'full'])
  })

  it('returns no user-specific grants for system or automation viewers', () => {
    expect(sharedThreadIds(SYSTEM_VISIBILITY)).toEqual([])
    expect(sharedThreadIds({ kind: 'automation', personalInboxIds: {} })).toEqual([])
  })
})

describe('sharedWithMe condition', () => {
  const sharedWithMeGroup: ConditionGroup[] = [
    {
      id: 'shared-with-me',
      logicalOperator: 'AND',
      conditions: [
        {
          id: 'shared-with-me',
          fieldId: 'sharedWithMe',
          operator: 'is',
          value: true,
        },
      ],
    },
  ]

  it('fails closed when the viewer has no direct thread grants', () => {
    const condition = buildConditionGroupsQuery(
      sharedWithMeGroup,
      'organization-1',
      userVisibility({})
    )
    const query = new PgDialect().sqlToQuery(condition)

    expect(query.sql).toContain('false')
  })

  it('narrows admins to their explicitly granted thread ids', () => {
    const viewer = userVisibility({ 'thread-1': 'full' })
    viewer.isAdmin = true

    const condition = buildConditionGroupsQuery(sharedWithMeGroup, 'organization-1', viewer)
    const query = new PgDialect().sqlToQuery(condition)

    expect(query.params).toContain('thread-1')
  })

  it('excludes explicitly shared threads for a negative boolean condition', () => {
    const viewer = userVisibility({ 'thread-1': 'full' })
    viewer.isAdmin = true
    const negativeGroup = structuredClone(sharedWithMeGroup)
    negativeGroup[0]!.conditions[0]!.value = false

    const condition = buildConditionGroupsQuery(negativeGroup, 'organization-1', viewer)
    const query = new PgDialect().sqlToQuery(condition)

    expect(query.sql).toContain('not')
    expect(query.params).toContain('thread-1')
  })
})
