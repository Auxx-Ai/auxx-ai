// apps/web/src/components/accounting/ui/settings/__tests__/mapping-list.test.tsx
//
// The Mapping tab's link state (89 D9). A role can be mapped to one of OUR
// accounts and still fail every export, because the account it names has no
// provider identity - which lives on the Chart tab. The row has to say so, and
// offer the door.

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

// The picker reads the whole chart through tRPC; this file is about the row.
vi.mock('../mapping-account-select', () => ({
  MappingAccountSelect: () => <div data-testid='account-select' />,
}))

import { chartAccountHref, MappingScopeRow } from '../mapping-scope-row'

function renderRow(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('chartAccountHref', () => {
  // 🛑 Both params. `?account=` alone is kept per tab, so without `s=chart` the
  // link lands back on Mapping and does nothing (89 D9).
  it('names the chart tab and the account', () => {
    expect(chartAccountHref('acct_5010')).toBe(
      '/app/accounting/settings/accounts?s=chart&account=acct_5010'
    )
  })
})

describe('MappingScopeRow - the link state', () => {
  it('shows "Not linked" and a door to the chart tab for an unlinked account', () => {
    renderRow(
      <MappingScopeRow
        title='Direct labor'
        value='acct_5010'
        onChange={() => {}}
        linked={false}
        linkAccountId='acct_5010'
        linkTooltip='Link its QuickBooks Online account'
      />
    )

    expect(screen.getByText('Not linked')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/app/accounting/settings/accounts?s=chart&account=acct_5010'
    )
  })

  // A store override names its own account, so it fails an export exactly as a
  // role row does - same badge, same door.
  it('shows "Not linked" and the door on a store override row', () => {
    renderRow(
      <MappingScopeRow
        depth={2}
        nested
        title='Main storefront'
        value='acct_4000'
        onChange={() => {}}
        inheritedAccountName='4000 Product Revenue'
        linked={false}
        linkAccountId='acct_4000'
        linkTooltip='Link its QuickBooks Online account'
      />
    )

    expect(screen.getByText('Not linked')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/app/accounting/settings/accounts?s=chart&account=acct_4000'
    )
  })

  it('shows nothing for a linked account', () => {
    renderRow(
      <MappingScopeRow
        title='Direct labor'
        value='acct_5010'
        onChange={() => {}}
        linked={true}
        linkAccountId='acct_5010'
      />
    )

    expect(screen.queryByText('Not linked')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  // Nothing connected. "Not linked" would be advice nobody can act on.
  it('shows nothing when the link state is unknown', () => {
    renderRow(
      <MappingScopeRow
        title='Direct labor'
        value='acct_5010'
        onChange={() => {}}
        linked={null}
        linkAccountId='acct_5010'
      />
    )

    expect(screen.queryByText('Not linked')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows nothing for a row that names no account', () => {
    renderRow(
      <MappingScopeRow title='Direct labor' value={null} onChange={() => {}} linked={false} />
    )

    expect(screen.queryByText('Not linked')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
