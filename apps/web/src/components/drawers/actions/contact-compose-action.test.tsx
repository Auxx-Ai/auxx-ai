// apps/web/src/components/drawers/actions/contact-compose-action.test.tsx
//
// C6 (multi-email plan): the contact drawer's compose action under the
// multi-value email flip. The load-bearing behaviors: >1 address offers a
// dropdown (the user picks WHICH address the mail goes to — a bare click must
// not silently target an arbitrary one); exactly one address composes
// directly; zero addresses disables the button.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrawerActionProps } from '../drawer-action-registry'

const h = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  openCompose: vi.fn(),
}))

vi.mock('~/components/resources/hooks/use-system-values', () => ({
  useSystemValues: () => ({ values: h.values, isLoading: false }),
}))

vi.mock('~/components/channels/hooks/use-default-channel', () => ({
  useDefaultChannelId: () => 'int_default',
}))

vi.mock('~/hooks/use-compose', () => ({
  useCompose: () => ({ openCompose: h.openCompose }),
}))

vi.mock('~/components/global/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const { ContactComposeAction } = await import('./contact-compose-action')

const PROPS = {
  recordId: 'contact:c1',
  record: { id: 'c1', displayName: 'Ada Lovelace' },
} as unknown as DrawerActionProps

beforeEach(() => {
  h.values = {}
  h.openCompose.mockClear()
})

describe('ContactComposeAction — multi-value email', () => {
  it('offers a dropdown with one row per address when the contact has >1 email', async () => {
    h.values = { primary_email: ['a@x.com', 'b@x.com'], first_name: 'Ada', last_name: 'Lovelace' }
    render(<ContactComposeAction {...PROPS} />)

    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByText('a@x.com')).toBeVisible()
    expect(screen.getByText('b@x.com')).toBeVisible()

    await userEvent.click(screen.getByText('b@x.com'))

    expect(h.openCompose).toHaveBeenCalledTimes(1)
    const { presetValues } = h.openCompose.mock.calls[0]![0]
    expect(presetValues.to).toEqual([
      { id: 'c1', identifier: 'b@x.com', identifierType: 'EMAIL', name: 'Ada Lovelace' },
    ])
  })

  it('composes directly to the single address without a dropdown', async () => {
    h.values = { primary_email: ['a@x.com'], first_name: 'Ada' }
    render(<ContactComposeAction {...PROPS} />)

    await userEvent.click(screen.getByRole('button'))

    expect(h.openCompose).toHaveBeenCalledTimes(1)
    const { presetValues } = h.openCompose.mock.calls[0]![0]
    expect(presetValues.to[0].identifier).toBe('a@x.com')
  })

  it('still handles a legacy scalar read (single-value shape)', async () => {
    h.values = { primary_email: 'a@x.com' }
    render(<ContactComposeAction {...PROPS} />)

    await userEvent.click(screen.getByRole('button'))
    expect(h.openCompose.mock.calls[0]![0].presetValues.to[0].identifier).toBe('a@x.com')
  })

  it('disables the button when the contact has no email', () => {
    h.values = { primary_email: [] }
    render(<ContactComposeAction {...PROPS} />)

    expect(screen.getByRole('button')).toBeDisabled()
    expect(h.openCompose).not.toHaveBeenCalled()
  })
})
