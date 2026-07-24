// apps/web/src/app/(protected)/app/mail/_utils/shared-with-me.test.ts

import { InternalFilterContextType } from '@auxx/lib/types'
import { describe, expect, it } from 'vitest'
import { buildFilterChips } from '~/components/mail/searchbar/store/search-store'
import { parseMailboxContext } from './mail-utils'
import {
  getBreadcrumbTitleForContext,
  getDisplayTabsForContext,
  isPersonalContext,
} from './mailbox-utils'

describe('shared-with-me mailbox UI', () => {
  it('parses the shared route without falling back to the personal inbox', () => {
    expect(parseMailboxContext('/app/mail/shared/open')).toEqual({
      contextType: 'shared_with_me',
      contextId: '',
      statusSlug: 'open',
    })
  })

  it('uses personal-style tabs and breadcrumb treatment', () => {
    expect(getDisplayTabsForContext(InternalFilterContextType.SHARED_WITH_ME)).toEqual([
      'open',
      'done',
      'trash',
      'spam',
    ])
    expect(getBreadcrumbTitleForContext(InternalFilterContextType.SHARED_WITH_ME)).toBe(
      'Shared with me'
    )
    expect(isPersonalContext(InternalFilterContextType.SHARED_WITH_ME)).toBe(true)
  })

  it('renders readable positive and negative boolean chips', () => {
    const positive = buildFilterChips([
      {
        id: 'shared-true',
        fieldId: 'sharedWithMe',
        operator: 'is',
        value: true,
      },
    ])
    const negative = buildFilterChips([
      {
        id: 'shared-false',
        fieldId: 'sharedWithMe',
        operator: 'is',
        value: false,
      },
    ])

    expect(positive[0]?.label).toBe('Shared with me')
    expect(negative[0]?.label).toBe('Not shared with me')
  })
})
