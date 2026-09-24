// apps/web/src/components/accounting/ui/setup-wizard/__tests__/accounting-setup-wizard.test.tsx

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  status: { connected: false, providerLabel: null as string | null, loading: false },
  prepare: vi.fn((): Promise<unknown> => new Promise(() => {})),
}))

/** A prepare report with nothing left to ask about accounts. */
const REPORT = {
  finalized: false,
  company: null,
  fiscalYearStartMonth: 4,
  bookTimeZone: 'America/Chicago',
  exportMode: 'transaction',
  proposedCutover: { cutoffPeriod: '2025-12', source: 'last_full_month' },
  providerAccountsToCreate: [],
  questions: { roles: [], rails: [], bankAccounts: [] },
  failures: [],
}

vi.mock('../../../hooks/use-accounting-provider-status', () => ({
  UNKNOWN_PROVIDER_LABEL: 'the accounting system',
  useAccountingProviderStatus: () => h.status,
}))

vi.mock('~/trpc/react', () => {
  const invalidate = vi.fn()
  return {
    api: {
      useUtils: () => ({
        gettingStarted: { getStatus: { setData: vi.fn(), invalidate } },
        ledgerOpening: { invalidate, get: { invalidate } },
        ledger: { invalidate, roleMap: { invalidate }, chartAccounts: { invalidate } },
      }),
      gettingStarted: { setWizardCompleted: { useMutation: () => ({ mutate: vi.fn() }) } },
      ledger: {
        connectAndGo: {
          prepare: {
            useMutation: () => ({
              mutateAsync: h.prepare,
              isPending: true,
              isError: false,
              error: null,
            }),
          },
          complete: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
        },
      },
    },
  }
})

vi.mock('~/providers/dehydrated-state-provider', () => ({
  useDehydratedOrganizationId: () => 'org_1',
  useDehydratedSettings: () => ({}),
  useDehydratedStateContext: () => ({ patchSettings: vi.fn() }),
}))

// The pages behind the choice have their own concerns; here only which one shows matters.
vi.mock('../wizard-connect-page', () => ({ WizardConnectPage: () => <div>connect page</div> }))
vi.mock('../wizard-period-page', () => ({ WizardPeriodPage: () => <div>period page</div> }))
vi.mock('../wizard-accounts-page', () => ({ WizardAccountsPage: () => <div>accounts page</div> }))
vi.mock('../wizard-rails-page', () => ({ WizardRailsPage: () => <div>rails page</div> }))
vi.mock('../wizard-opening-tb-page', () => ({
  WizardOpeningTbPage: () => <div>opening page</div>,
}))
vi.mock('../wizard-done-page', () => ({ WizardDonePage: () => <div>done page</div> }))
vi.mock('../connect-and-go-questions', () => ({ ConnectAndGoQuestions: () => null }))
vi.mock('../connect-and-go-backlog', () => ({ ConnectAndGoBacklog: () => null }))
vi.mock('../connect-and-go-books-page', () => ({
  ConnectAndGoBooksPage: () => <div>books page</div>,
}))
vi.mock('../connect-and-go-mapping-page', () => ({
  ConnectAndGoMappingPage: () => <div>mapping page</div>,
}))
vi.mock('../connect-and-go-posting-page', () => ({
  ConnectAndGoPostingPage: () => <div>posting page</div>,
}))
vi.mock('../connect-and-go-summary', () => ({
  ConnectAndGoDoneList: () => null,
  ConnectAndGoProviderAccounts: () => null,
  ConnectAndGoStepList: () => null,
}))

import { AccountingSetupWizard } from '../accounting-setup-wizard'

const continueButton = () => screen.getByRole('button', { name: 'Continue' })

async function next(expected: string | RegExp) {
  fireEvent.click(continueButton())
  return screen.findByText(expected)
}

function renderWizard() {
  return render(<AccountingSetupWizard open onOpenChange={vi.fn()} />)
}

beforeEach(() => {
  h.status = { connected: false, providerLabel: null, loading: false }
  h.prepare.mockClear()
})

describe('AccountingSetupWizard', () => {
  it('opens on the welcome page and does not run prepare', () => {
    h.status = { connected: true, providerLabel: 'Acme Books', loading: false }
    renderWizard()
    expect(screen.getByText("What we'll set up")).toBeTruthy()
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('offers the two ways as stacked cards, with nothing picked while nothing is connected', async () => {
    renderWizard()
    await next('How do you want to keep your books?')

    const group = screen.getByRole('radiogroup')
    expect(group.className).not.toMatch(/grid-cols/)
    expect(screen.getByRole('radio', { name: /Import from your accounting system/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Use Auxx on its own/ })).toBeTruthy()
    expect(screen.queryByRole('radio', { checked: true })).toBeNull()
    expect((continueButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('defaults to import with the provider named, and runs prepare only once that page is reached', async () => {
    h.status = { connected: true, providerLabel: 'Acme Books', loading: false }
    renderWizard()
    await next('How do you want to keep your books?')

    const importCard = screen.getByRole('radio', { name: /Import from Acme Books/ })
    expect(importCard.getAttribute('aria-checked')).toBe('true')
    expect(h.prepare).not.toHaveBeenCalled()

    await next(/reads your whole chart from Acme Books/)
    expect(h.prepare).toHaveBeenCalledOnce()
  })

  it('walks the import pages, skipping accounts when there is nothing to answer', async () => {
    h.status = { connected: true, providerLabel: 'Acme Books', loading: false }
    h.prepare.mockImplementationOnce(() => Promise.resolve(REPORT))
    renderWizard()
    await next('How do you want to keep your books?')
    fireEvent.click(continueButton())
    await screen.findByText(/Refresh from Acme Books/)

    await next('books page')
    await next('mapping page')
    await next('posting page')
    fireEvent.click(continueButton())
    await screen.findByRole('button', { name: /Finish setup/ })
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(h.prepare).toHaveBeenCalledOnce()
  })

  it('asks to connect first when importing with nothing connected', async () => {
    renderWizard()
    await next('How do you want to keep your books?')
    fireEvent.click(screen.getByRole('radio', { name: /Import from your accounting system/ }))
    await next('connect page')
    expect((continueButton() as HTMLButtonElement).disabled).toBe(true)
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('walks the standalone pages in order, and back across the choice', async () => {
    h.status = { connected: true, providerLabel: 'Acme Books', loading: false }
    renderWizard()
    await next('How do you want to keep your books?')
    fireEvent.click(screen.getByRole('radio', { name: /Use Auxx on its own/ }))

    await next('period page')
    await next('accounts page')
    await next('rails page')
    await next('opening page')
    for (const page of ['rails page', 'accounts page', 'period page']) {
      fireEvent.click(screen.getByRole('button', { name: /Back/ }))
      await screen.findByText(page)
    }
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    await screen.findByText('How do you want to keep your books?')
    expect(
      screen.getByRole('radio', { name: /Use Auxx on its own/ }).getAttribute('aria-checked')
    ).toBe('true')

    for (const page of ['period page', 'accounts page', 'rails page', 'opening page', 'done page'])
      await next(page)
    expect(screen.queryByText('connect page')).toBeNull()
    expect(h.prepare).not.toHaveBeenCalled()
  })
})
