// apps/web/src/components/accounting/ui/provider-account-picker.test.tsx
//
// The create row pinned under the provider picker's list. `groupProviderAccountsByType`
// is covered by the pure tests in `gl-account-picker.test.ts`'s sibling style;
// this file is about the footer only.

import type { ProviderAccount } from '@auxx/lib/accounting/ledger/client'
import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ProviderAccountPicker } from './provider-account-picker'

// cmdk scrolls its active item into view on mount; jsdom has no such method.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

function renderPicker(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

const accounts: ProviderAccount[] = [
  {
    id: 'qbo_1',
    number: '1000',
    name: 'Checking',
    fullyQualifiedName: 'Checking',
    accountType: 'Bank',
    classification: 'asset',
    active: true,
  },
]

async function openPicker() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox'))
  return user
}

describe('ProviderAccountPicker - the create row', () => {
  it('leaves the row out without `onCreate`', async () => {
    renderPicker(
      <ProviderAccountPicker
        value={null}
        onChange={() => {}}
        accounts={accounts}
        target={{ accountType: 'asset', subtype: null }}
      />
    )
    await openPicker()

    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(screen.queryByText(/^Create in/)).not.toBeInTheDocument()
  })

  it('renders the labelled row and calls `onCreate` on select', async () => {
    const onCreate = vi.fn()
    renderPicker(
      <ProviderAccountPicker
        value={null}
        onChange={() => {}}
        accounts={accounts}
        target={{ accountType: 'asset', subtype: null }}
        onCreate={onCreate}
        createLabel='Create in QuickBooks Online'
      />
    )
    const user = await openPicker()

    await user.click(screen.getByText('Create in QuickBooks Online'))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('survives a search that matches nothing', async () => {
    renderPicker(
      <ProviderAccountPicker
        value={null}
        onChange={() => {}}
        accounts={accounts}
        target={{ accountType: 'asset', subtype: null }}
        onCreate={() => {}}
      />
    )
    const user = await openPicker()
    await user.type(screen.getByPlaceholderText('Search the accounting system…'), 'zzzz')

    expect(screen.queryByText('Checking')).not.toBeInTheDocument()
    expect(screen.getByText('Create in the accounting system')).toBeInTheDocument()
  })
})
