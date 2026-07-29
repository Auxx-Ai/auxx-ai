// apps/web/src/components/inbox/ui/inbox-channel-card.test.tsx

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listCard, push, useChannelById } = vi.hoisted(() => ({
  listCard: vi.fn(),
  push: vi.fn(),
  useChannelById: vi.fn(),
}))

vi.mock('@auxx/ui/components/list-card', () => ({
  ListCard: (props: Record<string, unknown>) => {
    listCard(props)
    return null
  },
  renderBadgeChips: vi.fn(() => null),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('~/components/channels/store/channel-store', () => ({ useChannelById }))
vi.mock('~/components/channels/ui/channel-card', () => ({
  channelStatus: vi.fn(() => ({ tone: 'good', label: 'Connected' })),
}))
vi.mock('~/components/channels/ui/channel-icon', () => ({
  getChannelProviderName: vi.fn(() => 'Gmail'),
  getIntegrationProviderIcon: vi.fn(() => null),
}))

const { InboxChannelCard } = await import('./inbox-channel-card')

const integration = {
  id: 'link_1',
  integrationId: 'channel_1',
  isDefault: true,
  settings: {},
  integration: {
    id: 'channel_1',
    name: 'Support',
    email: 'support@example.com',
    provider: 'google',
  },
} as never

beforeEach(() => {
  listCard.mockClear()
  push.mockClear()
  useChannelById.mockReturnValue(undefined)
})

describe('InboxChannelCard channel-management affordances', () => {
  it('is fully read-only when the viewer may neither open nor unroute', () => {
    render(
      <InboxChannelCard
        integration={integration}
        onRemove={vi.fn()}
        canOpen={false}
        canRemove={false}
      />
    )

    expect(listCard).toHaveBeenCalledWith(
      expect.objectContaining({
        href: undefined,
        menuItems: undefined,
      })
    )
  })

  it('keeps channel navigation and removal for a channel manager', () => {
    const onRemove = vi.fn()
    render(<InboxChannelCard integration={integration} onRemove={onRemove} canOpen canRemove />)

    const props = listCard.mock.calls[0]?.[0]
    expect(props.href).toBe('/app/settings/channels/channel_1')
    expect(props.menuItems).toHaveLength(2)

    props.menuItems[1].onClick()
    expect(onRemove).toHaveBeenCalledWith(integration)
  })

  // The personal-inbox owner case: `requireChannelManageAccess` lets them manage
  // their own channel, but `inbox.removeIntegration` still wants `channels.manage`.
  // Collapsing both into one flag left them with no link and no menu at all.
  it('keeps the channel reachable when the viewer may open but not unroute', () => {
    render(
      <InboxChannelCard integration={integration} onRemove={vi.fn()} canOpen canRemove={false} />
    )

    const props = listCard.mock.calls[0]?.[0]
    expect(props.href).toBe('/app/settings/channels/channel_1')
    expect(props.menuItems).toHaveLength(1)
    expect(props.menuItems[0].label).toBe('Open')
  })

  it('offers only removal when the viewer may unroute but not open', () => {
    render(
      <InboxChannelCard integration={integration} onRemove={vi.fn()} canOpen={false} canRemove />
    )

    const props = listCard.mock.calls[0]?.[0]
    expect(props.href).toBeUndefined()
    expect(props.menuItems).toHaveLength(1)
    expect(props.menuItems[0].label).toBe('Remove from inbox')
  })
})
