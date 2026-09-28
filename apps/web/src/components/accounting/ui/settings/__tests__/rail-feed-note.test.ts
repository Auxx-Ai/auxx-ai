// apps/web/src/components/accounting/ui/settings/__tests__/rail-feed-note.test.ts

import type { RailFeedStatus } from '@auxx/lib/accounting/rails/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/trpc/react', () => ({ api: {} }))
vi.mock('~/components/data-connectors/hooks/use-can-manage-connectors', () => ({
  useCanManageConnectors: () => true,
}))
vi.mock('~/components/apps/providers/apps-context', () => ({
  useOptionalAppsContext: () => null,
}))

import { railFeedCopy } from '../rail-feed-note'

function feed(overrides: Partial<RailFeedStatus>): RailFeedStatus {
  return {
    state: 'not_installed',
    feedApp: 'affirm',
    feedAppTitle: 'Affirm',
    processorLabel: 'Affirm',
    connectorId: null,
    candidateSourceAccountId: null,
    optional: false,
    ...overrides,
  }
}

describe('railFeedCopy', () => {
  it('says nothing for linked, none or a missing state', () => {
    expect(railFeedCopy(feed({ state: 'linked' }), true)).toBeNull()
    expect(railFeedCopy(feed({ state: 'none' }), true)).toBeNull()
    expect(railFeedCopy(null, true)).toBeNull()
  })

  it('offers Link only with exactly one candidate', () => {
    expect(
      railFeedCopy(feed({ state: 'available', candidateSourceAccountId: 'fsa_1' }), true)
    ).toEqual({
      sentence: 'An Affirm feed is ready.',
      action: { kind: 'link', sourceAccountId: 'fsa_1' },
    })
    expect(railFeedCopy(feed({ state: 'available' }), true)?.action).toBeNull()
  })

  it('points connector states at the picker or the connector', () => {
    expect(railFeedCopy(feed({ state: 'not_installed' }), true)).toEqual({
      sentence: 'Affirm can read and post these payouts.',
      action: { kind: 'href', href: '/app/connectors?connect=app:affirm', label: 'Install Affirm' },
    })
    expect(railFeedCopy(feed({ state: 'not_connected' }), true)?.action).toEqual({
      kind: 'href',
      href: '/app/connectors?connect=app:affirm',
      label: 'Connect Affirm',
    })
    expect(railFeedCopy(feed({ state: 'syncing', connectorId: 'dc_1' }), true)?.action).toEqual({
      kind: 'href',
      href: '/app/connectors/dc_1?tab=streams',
      label: 'Open connector',
    })
  })

  it('asks instead of linking without connector access', () => {
    expect(railFeedCopy(feed({ state: 'not_installed' }), false)?.action).toEqual({
      kind: 'ask',
      text: 'Ask whoever manages connectors to connect Affirm.',
    })
    expect(railFeedCopy(feed({ state: 'syncing', connectorId: 'dc_1' }), false)?.action).toBeNull()
  })

  it('prefixes a billed rail with Optional', () => {
    const copy = railFeedCopy(
      feed({
        state: 'not_connected',
        feedApp: 'authorize-net',
        feedAppTitle: 'Authorize.Net',
        processorLabel: 'Authorize.Net',
        optional: true,
      }),
      true
    )
    expect(copy?.sentence).toBe(
      'Optional: Authorize.Net is installed. Connect it so auxx reads and posts Authorize.Net payouts.'
    )
  })
})
