// apps/web/src/components/drawers/tabs/contact-conversations-tab.test.tsx
//
// C6 (multi-email plan, LOCKED): the contact drawer's Conversations tab
// filters threads by ALL of the contact's addresses (an alias's mail history
// must not vanish from the tab), while compose defaults to the primary
// (first) address.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrawerTabProps } from '../drawer-tab-registry'

const h = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  openCompose: vi.fn(),
  useThreadList: vi.fn(() => ({
    recordIds: [] as string[],
    isLoading: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  })),
}))

vi.mock('~/components/resources/hooks/use-system-values', () => ({
  useSystemValues: () => ({ values: h.values, isLoading: false }),
}))

vi.mock('~/components/threads/hooks/use-thread-list', () => ({
  useThreadList: (args: unknown) => h.useThreadList(args as never),
}))

vi.mock('~/hooks/use-compose', () => ({
  useCompose: () => ({ openCompose: h.openCompose }),
}))

// Rendered only when threads exist — stubs keep the module graph light.
vi.mock('~/components/mail/mail-filter-context', () => ({
  MailFilterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('~/components/mail/mail-thread-item', () => ({
  MailThreadItem: () => null,
}))
vi.mock('~/components/mail/thread-details-dialog', () => ({
  ThreadDetailsDialog: () => null,
}))
vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: vi.fn(), inView: false }),
}))

const { ContactConversationsTab } = await import('./contact-conversations-tab')

const PROPS = {
  entityInstanceId: 'c1',
  record: { primaryInfo: 'Ada Lovelace', secondaryInfo: 'a@x.com' },
} as unknown as DrawerTabProps

beforeEach(() => {
  h.values = {}
  h.openCompose.mockClear()
  h.useThreadList.mockClear()
})

describe('ContactConversationsTab — multi-value email', () => {
  it('filters threads by ALL of the contact addresses (OR of per-address conditions)', () => {
    h.values = { primary_email: ['a@x.com', 'b@x.com'] }
    render(<ContactConversationsTab {...PROPS} />)

    const { filter, enabled } = h.useThreadList.mock.calls[0]![0] as unknown as {
      filter: Array<{ logicalOperator: string; conditions: Array<Record<string, unknown>> }>
      enabled: boolean
    }
    expect(enabled).toBe(true)
    expect(filter).toHaveLength(1)
    expect(filter[0]!.logicalOperator).toBe('OR')
    expect(filter[0]!.conditions).toEqual([
      expect.objectContaining({ fieldId: 'from', operator: 'is', value: 'a@x.com' }),
      expect.objectContaining({ fieldId: 'from', operator: 'is', value: 'b@x.com' }),
    ])
  })

  it('composes to the PRIMARY (first) address', async () => {
    h.values = { primary_email: ['a@x.com', 'b@x.com'] }
    render(<ContactConversationsTab {...PROPS} />)

    await userEvent.click(screen.getByRole('button', { name: /create message/i }))

    expect(h.openCompose).toHaveBeenCalledTimes(1)
    const { presetValues } = h.openCompose.mock.calls[0]![0]
    expect(presetValues.to).toEqual([
      { id: 'c1', identifier: 'a@x.com', identifierType: 'EMAIL', name: 'Ada Lovelace' },
    ])
  })

  it('disables the thread query when the contact has no addresses', () => {
    h.values = { primary_email: [] }
    render(<ContactConversationsTab {...PROPS} />)

    const { filter, enabled } = h.useThreadList.mock.calls[0]![0] as unknown as {
      filter: unknown[]
      enabled: boolean
    }
    expect(enabled).toBe(false)
    expect(filter).toEqual([])
  })
})
