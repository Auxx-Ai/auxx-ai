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
  it('is read-only for an inbox Manager without channels.manage', () => {
    render(<InboxChannelCard integration={integration} onRemove={vi.fn()} canManage={false} />)

    expect(listCard).toHaveBeenCalledWith(
      expect.objectContaining({
        href: undefined,
        menuItems: undefined,
      })
    )
  })

  it('keeps channel navigation and removal for a channel manager', () => {
    const onRemove = vi.fn()
    render(<InboxChannelCard integration={integration} onRemove={onRemove} canManage />)

    const props = listCard.mock.calls[0]?.[0]
    expect(props.href).toBe('/app/settings/channels/channel_1')
    expect(props.menuItems).toHaveLength(2)

    props.menuItems[1].onClick()
    expect(onRemove).toHaveBeenCalledWith(integration)
  })
})
