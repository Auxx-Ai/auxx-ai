// apps/web/src/components/accounting/ui/setup-wizard/accounting-setup-wizard.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'
import { ConnectAndGoPage } from './connect-and-go-page'
import { WizardAccountsPage } from './wizard-accounts-page'
import { type BooksMode, WizardBooksChoicePage } from './wizard-books-choice-page'
import { WizardConnectPage } from './wizard-connect-page'
import { WizardDonePage } from './wizard-done-page'
import { WizardOpeningTbPage } from './wizard-opening-tb-page'
import { WizardPeriodPage } from './wizard-period-page'
import { WizardRailsPage } from './wizard-rails-page'
import {
  leaveCurrentPage,
  type WizardLeaveDirection,
  type WizardStepHandle,
} from './wizard-step-handle'
import { WizardWelcomePage } from './wizard-welcome-page'

const INTRO_PAGES = ['welcome', 'choice'] as const
// Connect shows only until a provider is connected; everything after is derived from it (105 §4).
const IMPORT_PAGES = [...INTRO_PAGES, 'connect', 'connectAndGo'] as const
const IMPORT_CONNECTED_PAGES = [...INTRO_PAGES, 'connectAndGo'] as const
// The chart before the rails that mint into it, and the opening grid over that chart.
const STANDALONE_PAGES = [
  ...INTRO_PAGES,
  'period',
  'accounts',
  'rails',
  'openingTrialBalance',
  'done',
] as const
type WizardPage = (typeof IMPORT_PAGES)[number] | (typeof STANDALONE_PAGES)[number]

const PAGE_TITLES: Record<WizardPage, string> = {
  welcome: 'Welcome',
  choice: 'How to keep the books',
  connect: 'Accounting system',
  period: 'Accounting period',
  accounts: 'Account roles',
  rails: 'Payment rails',
  openingTrialBalance: 'Opening balances',
  done: 'Finalize',
  connectAndGo: 'Set up from your accounting system',
}

export interface AccountingSetupWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The accounting setup dialog: welcome, then how to keep the books. Import connects if needed and
 * runs `ConnectAndGoPage`; standalone walks the manual pages through Finalize.
 *
 * Pages holding a dirty draft expose a {@link WizardStepHandle} the shell consults before leaving
 * the page, so Back, Continue and "Set up later" never lose work. "Set up later" and finishing
 * both stamp `setWizardCompleted`, so the wizard never auto-opens again either way.
 */
export function AccountingSetupWizard({ open, onOpenChange }: AccountingSetupWizardProps) {
  const providerStatus = useAccountingProviderStatus()
  const [page, setPage] = useState<WizardPage>('welcome')
  // Null until picked; import is the default while a provider is connected.
  const [pickedMode, setPickedMode] = useState<BooksMode | null>(null)
  const mode = pickedMode ?? (providerStatus.connected ? 'import' : null)
  const periodRef = useRef<WizardStepHandle | null>(null)
  const openingTbRef = useRef<WizardStepHandle | null>(null)

  const pages: readonly WizardPage[] =
    mode === 'standalone'
      ? STANDALONE_PAGES
      : mode === 'import'
        ? providerStatus.connected && page !== 'connect'
          ? IMPORT_CONNECTED_PAGES
          : IMPORT_PAGES
        : INTRO_PAGES

  useEffect(() => {
    if (!open) return
    setPage('welcome')
    setPickedMode(null)
  }, [open])

  // Connecting from the connect page moves straight on to the import.
  useEffect(() => {
    if (page === 'connect' && providerStatus.connected) setPage('connectAndGo')
  }, [page, providerStatus.connected])

  const utils = api.useUtils()
  // Write the stamp into the cache up front, then invalidate: `finish()` often precedes a
  // navigation that unmounts the gate, and a late invalidation would leave the stale null behind.
  const setWizardCompleted = api.gettingStarted.setWizardCompleted.useMutation({
    onMutate: () => {
      utils.gettingStarted.getStatus.setData({ checklist: 'accounting' }, (prev) =>
        prev ? { ...prev, wizardCompletedAt: new Date().toISOString() } : prev
      )
    },
    onSettled: () => utils.gettingStarted.getStatus.invalidate(),
  })

  const index = Math.max(pages.indexOf(page), 0)

  /** Awaited: a page's save resolves only once the write has landed and its query refetched. */
  const attemptLeave = (direction: WizardLeaveDirection, onAllowed: () => void) => {
    const handle =
      page === 'period'
        ? periodRef.current
        : page === 'openingTrialBalance'
          ? openingTbRef.current
          : null
    return leaveCurrentPage(handle, direction, onAllowed)
  }

  // One lock for all three exits, so a second Continue cannot run against a page already leaving.
  const [leaving, setLeaving] = useState(false)

  const leaveVia = async (direction: WizardLeaveDirection, onAllowed: () => void) => {
    if (leaving) return
    setLeaving(true)
    try {
      await attemptLeave(direction, onAllowed)
    } finally {
      setLeaving(false)
    }
  }

  const goNext = () =>
    leaveVia('next', () => setPage(pages[Math.min(index + 1, pages.length - 1)] ?? page))
  const goBack = () => leaveVia('back', () => setPage(pages[Math.max(index - 1, 0)] ?? 'welcome'))
  const finish = () =>
    leaveVia('exit', () => {
      setWizardCompleted.mutate({ checklist: 'accounting' })
      onOpenChange(false)
    })

  const linear = page !== 'connectAndGo' && page !== 'done'
  const canContinue =
    page === 'choice' ? mode !== null : page === 'connect' ? providerStatus.connected : true

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish()}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Set up accounting'
          description='A few things to configure before your books can be closed from Auxx.'
          onBack={page !== 'done' && index > 0 ? goBack : undefined}
          crumbs={[{ label: PAGE_TITLES[page] }]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='welcome' size='lg'>
            <WizardWelcomePage />
          </DialogNavPage>
          <DialogNavPage value='choice' size='lg'>
            <WizardBooksChoicePage value={mode} onChange={setPickedMode} />
          </DialogNavPage>
          <DialogNavPage value='connectAndGo' size='xl'>
            <ConnectAndGoPage onFinish={finish} />
          </DialogNavPage>
          <DialogNavPage value='connect' size='lg'>
            <WizardConnectPage />
          </DialogNavPage>
          <DialogNavPage value='period' size='lg'>
            <WizardPeriodPage ref={periodRef} />
          </DialogNavPage>
          <DialogNavPage value='accounts' size='lg'>
            <WizardAccountsPage />
          </DialogNavPage>
          <DialogNavPage value='rails' size='xl'>
            <WizardRailsPage />
          </DialogNavPage>
          <DialogNavPage value='openingTrialBalance' size='xl'>
            <WizardOpeningTbPage ref={openingTbRef} />
          </DialogNavPage>
          <DialogNavPage value='done' size='md'>
            <WizardDonePage onFinish={finish} />
          </DialogNavPage>
        </DialogNavPages>

        {page !== 'done' && (
          <DialogFooter className='border-t px-4 py-3 sm:justify-between'>
            <Button variant='ghost' size='sm' onClick={finish} disabled={leaving}>
              Set up later
            </Button>
            {linear && (
              <Button
                variant='outline'
                size='sm'
                onClick={goNext}
                loading={leaving}
                disabled={!canContinue}>
                Continue
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
