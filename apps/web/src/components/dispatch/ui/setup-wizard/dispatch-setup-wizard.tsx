// apps/web/src/components/dispatch/ui/setup-wizard/dispatch-setup-wizard.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { WizardAddressPage } from './wizard-address-page'
import { WizardDonePage } from './wizard-done-page'
import { WizardHoursPage } from './wizard-hours-page'
import { WizardPricingPage } from './wizard-pricing-page'
import type { WizardStepHandle } from './wizard-step-handle'
import { WizardWelcomePage } from './wizard-welcome-page'
import { WizardWorkersPage } from './wizard-workers-page'

const PAGES = ['welcome', 'workers', 'address', 'hours', 'pricing', 'done'] as const
type WizardPage = (typeof PAGES)[number]

const PAGE_TITLES: Record<WizardPage, string> = {
  welcome: 'Set up dispatch',
  workers: 'Workers',
  address: 'Business address',
  hours: 'Operating hours',
  pricing: 'Pricing',
  done: "You're set",
}

export interface DispatchSetupWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * `DispatchSetupWizard` (plans/dispatch/32-onboarding.md Part C) — a six-page `DialogNav` wizard
 * covering the three dispatch must-haves (workers, business address, operating hours) plus the
 * two pricing prerequisites (a catalog item, a default tax rate) before a "you're set" page
 * pointing at the checklist for the remaining record-creation steps.
 *
 * Pages write real data (worker upsert, `documents.business` setting, weekly-hours mutation),
 * never a wizard-local progress record. Workers saves on every pick; Address and Hours hold a
 * local draft and expose a {@link WizardStepHandle} the shell consults before leaving the page
 * in any direction — saving a dirty draft (Hours blocks instead when the draft is invalid), so
 * Back/Continue/"Set up later" never lose anything.
 *
 * "Set up later" (any page) and reaching the last page both call `setWizardCompleted` for the
 * `dispatch` checklist — one timestamp, so the wizard never auto-opens again either way.
 */
export function DispatchSetupWizard({ open, onOpenChange }: DispatchSetupWizardProps) {
  const [page, setPage] = useState<WizardPage>('welcome')
  const addressRef = useRef<WizardStepHandle | null>(null)
  const hoursRef = useRef<WizardStepHandle | null>(null)
  const pricingRef = useRef<WizardStepHandle | null>(null)

  // Reset to the first page each time the wizard is (re)opened.
  useEffect(() => {
    if (open) setPage('welcome')
  }, [open])

  const utils = api.useUtils()
  // Write the stamp into the cache up front, then invalidate. `finish()` is often the last thing
  // that happens before a navigation away from `/app/dispatch` (the done page's "Log a service
  // request" link), which unmounts the gate — an invalidation that lands after that only marks the
  // entry stale, so the stale `wizardCompletedAt: null` is what a remounted gate would read.
  const setWizardCompleted = api.gettingStarted.setWizardCompleted.useMutation({
    onMutate: () => {
      utils.gettingStarted.getStatus.setData({ checklist: 'dispatch' }, (prev) =>
        prev ? { ...prev, wizardCompletedAt: new Date().toISOString() } : prev
      )
    },
    // `onSettled`, not `onSuccess`: a failed write must not leave the optimistic stamp standing.
    onSettled: () => utils.gettingStarted.getStatus.invalidate(),
  })

  const index = PAGES.indexOf(page)

  /** Ask the current page (if it registered a handle) whether it's safe to navigate away. */
  const attemptLeave = () => {
    const handle =
      page === 'address'
        ? addressRef.current
        : page === 'hours'
          ? hoursRef.current
          : page === 'pricing'
            ? pricingRef.current
            : null
    return handle?.tryAdvance() ?? true
  }

  const goNext = () => {
    if (attemptLeave()) setPage(PAGES[Math.min(index + 1, PAGES.length - 1)] ?? 'done')
  }
  const goBack = () => {
    if (attemptLeave()) setPage(PAGES[Math.max(index - 1, 0)] ?? 'welcome')
  }
  const finish = () => {
    if (!attemptLeave()) return
    setWizardCompleted.mutate({ checklist: 'dispatch' })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish()}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Set up dispatch'
          description='A few things to configure before your board is ready.'
          onBack={page !== 'welcome' && page !== 'done' ? goBack : undefined}
          crumbs={[{ label: PAGE_TITLES[page] }]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='welcome' size='md'>
            <WizardWelcomePage />
          </DialogNavPage>
          <DialogNavPage value='workers' size='lg'>
            <WizardWorkersPage />
          </DialogNavPage>
          <DialogNavPage value='address' size='lg'>
            <WizardAddressPage ref={addressRef} />
          </DialogNavPage>
          <DialogNavPage value='hours' size='xl'>
            <WizardHoursPage ref={hoursRef} />
          </DialogNavPage>
          <DialogNavPage value='pricing' size='lg'>
            <WizardPricingPage ref={pricingRef} />
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
