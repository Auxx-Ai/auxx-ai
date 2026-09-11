// apps/web/src/components/accounting/ui/ledger/__tests__/post-result-callout.test.tsx
//
// The deep link out to the provider's own register, and the one question it has
// to get right: WHICH COMPANY.
//
// A QuickBooks entry id is a per-company sequence - entry `147` exists in every
// company and means something different in each - and no URL can pin the
// company (`&companyId=` is ignored, `/app/switchcompany` 404s, both verified).
// So a link followed from the wrong company reports a live entry as deleted,
// which is the single conclusion `providerEntryUrl`'s own docblock says the
// button exists to prevent. Task 24 §4.
//
// 🛑 The other half of this file's job is the NEGATIVE one: when the link is
// withheld, nothing takes its place. No company name, no explanation that the
// entry went elsewhere, no note that a row carries no tenant. An absent button
// is the complete answer, and the assertions below pin that the callout's own
// copy is the only text on screen.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PostResultCallout } from '../post-result-callout'

const REALM = '9341453857213446'
const OTHER_REALM = '4620108374925511'

function exported(overrides: Record<string, unknown> = {}) {
  return {
    status: 'posted' as const,
    docNumber: 'AUXX-RCP-20260818',
    providerId: 'quickbooks',
    providerEntryId: '147',
    providerTenantId: REALM,
    ...overrides,
  }
}

describe('PostResultCallout - the deep link', () => {
  it('links out when the entry went to the company this workspace is connected to', () => {
    render(
      <PostResultCallout
        result={exported()}
        providerLabel='QuickBooks Online'
        connectedTenantId={REALM}
      />
    )

    const link = screen.getByRole('link', { name: /Open in QuickBooks Online/ })
    // Unchanged: the txnId URL is still the only shape QuickBooks offers.
    expect(link).toHaveAttribute('href', 'https://app.qbo.intuit.com/app/journal?txnId=147')
  })

  it('renders NO link when the entry went to a different company', () => {
    render(
      <PostResultCallout
        result={exported()}
        providerLabel='QuickBooks Online'
        connectedTenantId={OTHER_REALM}
      />
    )

    expect(screen.queryByRole('link')).toBeNull()
    // 🛑 And nothing in its place. Naming the company, or explaining that this
    // workspace is connected elsewhere, were both considered and rejected as
    // narrating our internals at somebody who did not ask.
    expect(screen.queryByText(new RegExp(REALM))).toBeNull()
    expect(screen.queryByText(new RegExp(OTHER_REALM))).toBeNull()
    expect(screen.queryByText(/compan/i)).toBeNull()
    // The outcome copy itself is untouched - the entry is still posted.
    expect(screen.getByText('Posted')).toBeInTheDocument()
  })

  it('renders NO link when the row carries no tenant at all', () => {
    // Under §2.3 this should not occur on an `exported` row once the stamp
    // lands. It is drawn the same way regardless: a tenant we do not know is
    // not one we can claim matches, and nothing on screen mentions the gap.
    render(
      <PostResultCallout
        result={exported({ providerTenantId: undefined })}
        providerLabel='QuickBooks Online'
        connectedTenantId={REALM}
      />
    )

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/compan/i)).toBeNull()
  })

  it('renders NO link when nothing is connected', () => {
    render(
      <PostResultCallout
        result={exported()}
        providerLabel='QuickBooks Online'
        connectedTenantId={null}
      />
    )

    expect(screen.queryByRole('link')).toBeNull()
  })

  it('still refuses a provider whose URL shape we do not know', () => {
    // The original rule, unchanged by the tenant one: a guessed link that 404s
    // reads as "the entry is not there".
    render(
      <PostResultCallout
        result={exported({ providerId: 'xero' })}
        providerLabel='Xero'
        connectedTenantId={REALM}
      />
    )

    expect(screen.queryByRole('link')).toBeNull()
  })
})
