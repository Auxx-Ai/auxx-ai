// apps/web/src/components/accounting/ui/setup-wizard/accounting-setup-wizard.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { WizardAccountMapPage } from './wizard-account-map-page'
import { WizardAccountsPage } from './wizard-accounts-page'
import { WizardConnectPage } from './wizard-connect-page'
import { WizardCostingPage } from './wizard-costing-page'
import { WizardDonePage } from './wizard-done-page'
import { WizardOpeningPage } from './wizard-opening-page'
import { WizardOpeningTbPage } from './wizard-opening-tb-page'
import { WizardPeriodPage } from './wizard-period-page'
import type { WizardLeaveDirection, WizardStepHandle } from './wizard-step-handle'
import { WizardWelcomePage } from './wizard-welcome-page'

// 🛑 `connect` sits immediately before `accountMap`, and the order is the whole
// point of the pair: the mapping page cannot render a single row until a
// provider chart exists to map against. `accounts` (the role map) stays BEFORE
// both, because a role has to point at one of our accounts before that account
// has anything to be paired with.
const PAGES = [
  'welcome',
  'period',
  'opening',
  // 🛑 The trial balance sits AFTER the inventory snapshot and the order is
  // load-bearing: its three inventory rows are prefilled from the
  // `accounting.opening*` keys the previous page writes, and locked. Put it
  // first and those rows would be blank with no way to fill them.
  'openingTrialBalance',
  'costing',
  'accounts',
  'connect',
  'accountMap',
  'done',
] as const
type WizardPage = (typeof PAGES)[number]

const PAGE_TITLES: Record<WizardPage, string> = {
  welcome: 'Set up accounting',
  period: 'Accounting period',
  opening: 'Opening inventory',
  openingTrialBalance: 'Opening trial balance',
  costing: 'Costing',
  accounts: 'Account roles',
  connect: 'Accounting system',
  accountMap: 'QuickBooks accounts',
  done: 'Finalize',
}

export interface AccountingSetupWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * `AccountingSetupWizard` (plans/money/tasks/13-accounting-ui.md section 3.3) - a nine-page
 * `DialogNav` wizard covering the things that have to be true before a month-end entry can
 * legally be posted (accounting period, the opening inventory snapshot, the opening trial balance, costing, the
 * role map) plus the
 * `G19` provider pair - connect an accounting system, then say which of ITS accounts each of
 * ours corresponds to - and a "finalize" page that freezes the opening baseline.
 *
 * 🛑 The two `G19` pages are SKIPPABLE, like every other page here. `P1` makes
 * "nothing connected" a supported configuration rather than an unfinished setup: the ledger is
 * ours, entries are still built, balanced and persisted, and only the export does not happen.
 * Neither page may ever block Continue.
 *
 * 🛑 Pages write REAL data through the settings catalog keys, never a wizard-local progress
 * record. That is task 12's scalar-keys decision and it is what lets the settings pages, the
 * checklist and the Post gate all read one source and agree.
 *
 * Pages holding a dirty draft expose a {@link WizardStepHandle} the shell consults before leaving
 * the page in any direction - saving a dirty draft, or blocking Continue when the draft is
 * invalid - so Back, Continue and "Set up later" never lose work. Only Continue is ever refused;
 * see `wizard-step-handle.ts` for why the exits stay open.
 *
 * "Set up later" (any page) and reaching the last page both call `setWizardCompleted` for the
 * `accounting` checklist - one timestamp, so the wizard never auto-opens again either way.
 */
export function AccountingSetupWizard({ open, onOpenChange }: AccountingSetupWizardProps) {
  const [page, setPage] = useState<WizardPage>('welcome')
  const periodRef = useRef<WizardStepHandle | null>(null)
  const openingRef = useRef<WizardStepHandle | null>(null)
  const openingTbRef = useRef<WizardStepHandle | null>(null)
  const costingRef = useRef<WizardStepHandle | null>(null)

  // Reset to the first page each time the wizard is (re)opened.
  useEffect(() => {
    if (open) setPage('welcome')
  }, [open])

  const utils = api.useUtils()
  // Write the stamp into the cache up front, then invalidate. `finish()` is often the last thing
  // that happens before a navigation away from `/app/accounting` (the done page's "Open the
  // ledger" link), which unmounts the gate - an invalidation that lands after that only marks the
  // entry stale, so the stale `wizardCompletedAt: null` is what a remounted gate would read.
  const setWizardCompleted = api.gettingStarted.setWizardCompleted.useMutation({
    onMutate: () => {
      utils.gettingStarted.getStatus.setData({ checklist: 'accounting' }, (prev) =>
        prev ? { ...prev, wizardCompletedAt: new Date().toISOString() } : prev
      )
    },
    // `onSettled`, not `onSuccess`: a failed write must not leave the optimistic stamp standing.
    onSettled: () => utils.gettingStarted.getStatus.invalidate(),
  })

  const index = PAGES.indexOf(page)

  /** Ask the current page (if it registered a handle) whether it is safe to navigate away. */
  const attemptLeave = (direction: WizardLeaveDirection) => {
    const handle =
      page === 'period'
        ? periodRef.current
        : page === 'opening'
          ? openingRef.current
          : page === 'openingTrialBalance'
            ? openingTbRef.current
            : page === 'costing'
              ? costingRef.current
              : null
    return handle?.tryAdvance(direction) ?? true
  }

  const goNext = () => {
    if (attemptLeave('next')) setPage(PAGES[Math.min(index + 1, PAGES.length - 1)] ?? 'done')
  }
  const goBack = () => {
    if (attemptLeave('back')) setPage(PAGES[Math.max(index - 1, 0)] ?? 'welcome')
  }
  const finish = () => {
    if (!attemptLeave('exit')) return
    setWizardCompleted.mutate({ checklist: 'accounting' })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish()}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Set up accounting'
          description='A few things to configure before your books can be closed from Auxx.'
          onBack={page !== 'welcome' && page !== 'done' ? goBack : undefined}
          crumbs={[{ label: PAGE_TITLES[page] }]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='welcome' size='md'>
            <WizardWelcomePage />
          </DialogNavPage>
          <DialogNavPage value='period' size='lg'>
            <WizardPeriodPage ref={periodRef} />
          </DialogNavPage>
          <DialogNavPage value='opening' size='xl'>
            <WizardOpeningPage ref={openingRef} />
          </DialogNavPage>
          <DialogNavPage value='openingTrialBalance' size='xl'>
            <WizardOpeningTbPage ref={openingTbRef} />
          </DialogNavPage>
          <DialogNavPage value='costing' size='lg'>
            <WizardCostingPage ref={costingRef} />
          </DialogNavPage>
          <DialogNavPage value='accounts' size='lg'>
            <WizardAccountsPage />
          </DialogNavPage>
          <DialogNavPage value='connect' size='lg'>
            <WizardConnectPage />
          </DialogNavPage>
          <DialogNavPage value='accountMap' size='xl'>
            <WizardAccountMapPage />
          </DialogNavPage>
          <DialogNavPage value='done' size='md'>
            <WizardDonePage onFinish={finish} />
          </DialogNavPage>
        </DialogNavPages>

        {page !== 'done' && (
          <DialogFooter className='border-t px-4 py-3 sm:justify-between'>
            <Button variant='ghost' size='sm' onClick={finish}>
              Set up later
            </Button>
            <Button variant='outline' size='sm' onClick={goNext}>
              {page === 'welcome' ? 'Get started' : 'Continue'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
