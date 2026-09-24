// apps/web/src/components/accounting/ui/setup-wizard/accounting-setup-wizard.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Check } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '../../hooks/use-accounting-provider-status'
import { ConnectAndGoAccountsPage, hasAccountQuestions } from './connect-and-go-accounts-page'
import { ConnectAndGoBooksPage } from './connect-and-go-books-page'
import { ConnectAndGoFinishPage } from './connect-and-go-finish-page'
import { ConnectAndGoImportedPage } from './connect-and-go-imported-page'
import { ConnectAndGoMappingPage } from './connect-and-go-mapping-page'
import { ConnectAndGoPostingPage } from './connect-and-go-posting-page'
import { useConnectAndGo } from './use-connect-and-go'
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
const CONNECT_AND_GO_PAGES = [
  'imported',
  'books',
  'accountQuestions',
  'mapping',
  'posting',
  'finish',
] as const
type ConnectAndGoPageKey = (typeof CONNECT_AND_GO_PAGES)[number]
// The chart before the rails that mint into it, and the opening grid over that chart.
const STANDALONE_PAGES = [
  ...INTRO_PAGES,
  'period',
  'accounts',
  'rails',
  'openingTrialBalance',
  'done',
] as const
type WizardPage =
  | (typeof INTRO_PAGES)[number]
  | 'connect'
  | ConnectAndGoPageKey
  | (typeof STANDALONE_PAGES)[number]

const PAGE_TITLES: Record<WizardPage, string> = {
  welcome: 'Welcome',
  choice: 'How to keep the books',
  connect: 'Accounting system',
  period: 'Accounting period',
  accounts: 'Account roles',
  rails: 'Payment rails',
  openingTrialBalance: 'Opening balances',
  done: 'Finalize',
  imported: 'Imported',
  books: 'Books',
  accountQuestions: 'Accounts',
  mapping: 'Mapping',
  posting: 'Posting',
  finish: 'Finish',
}

export interface AccountingSetupWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The accounting setup dialog: welcome, then how to keep the books. Import connects if needed and
 * walks the Connect-and-go pages over one `useConnectAndGo` draft; standalone walks the manual
 * pages through Finalize.
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

  const providerLabel = providerStatus.providerLabel ?? UNKNOWN_PROVIDER_LABEL
  const flow = useConnectAndGo(providerLabel)
  // Once finalized only the outcome is left to show; an empty accounts page is skipped.
  const importPages: readonly WizardPage[] = flow.report?.finalized
    ? ['imported', 'finish']
    : CONNECT_AND_GO_PAGES.filter(
        (key) => key !== 'accountQuestions' || hasAccountQuestions(flow.report)
      )

  const pages: readonly WizardPage[] =
    mode === 'standalone'
      ? STANDALONE_PAGES
      : mode === 'import'
        ? [
            ...INTRO_PAGES,
            ...(providerStatus.connected && page !== 'connect' ? [] : (['connect'] as const)),
            ...importPages,
          ]
        : INTRO_PAGES

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens.
  useEffect(() => {
    if (!open) return
    setPage('welcome')
    setPickedMode(null)
    flow.reset()
  }, [open])

  // Connecting from the connect page moves straight on to the import.
  useEffect(() => {
    if (page === 'connect' && providerStatus.connected) setPage('imported')
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

  const linear = page !== 'finish' && page !== 'done'
  const canContinue =
    page === 'choice'
      ? mode !== null
      : page === 'connect'
        ? providerStatus.connected
        : page === 'imported'
          ? !!flow.report && !flow.preparing
          : page === 'books'
            ? !flow.booksInvalid
            : true
  const canGoBack =
    page !== 'done' && index > 0 && !flow.finishing && !(page === 'finish' && flow.done)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish()}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Set up accounting'
          description='A few things to configure before your books can be closed from Auxx.'
          onBack={canGoBack ? goBack : undefined}
          crumbs={[{ label: PAGE_TITLES[page] }]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='welcome' size='lg'>
            <WizardWelcomePage />
          </DialogNavPage>
          <DialogNavPage value='choice' size='lg'>
            <WizardBooksChoicePage value={mode} onChange={setPickedMode} />
          </DialogNavPage>
          <DialogNavPage value='imported' size='xl'>
            <ConnectAndGoImportedPage flow={flow} providerLabel={providerLabel} />
          </DialogNavPage>
          <DialogNavPage value='books' size='xl'>
            <ConnectAndGoBooksPage flow={flow} providerLabel={providerLabel} />
          </DialogNavPage>
          <DialogNavPage value='accountQuestions' size='xl'>
            <ConnectAndGoAccountsPage flow={flow} providerLabel={providerLabel} />
          </DialogNavPage>
          <DialogNavPage value='mapping' size='xl'>
            <ConnectAndGoMappingPage />
          </DialogNavPage>
          <DialogNavPage value='posting' size='xl'>
            <ConnectAndGoPostingPage flow={flow} providerLabel={providerLabel} />
          </DialogNavPage>
          <DialogNavPage value='finish' size='xl'>
            <ConnectAndGoFinishPage flow={flow} providerLabel={providerLabel} />
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
            <Button variant='ghost' size='sm' onClick={finish} disabled={leaving || flow.finishing}>
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
            {page === 'finish' &&
              (flow.done ? (
                <Button variant='outline' size='sm' asChild onClick={finish}>
                  <Link href='/app/accounting'>Open the ledger</Link>
                </Button>
              ) : (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={flow.finish}
                  disabled={!!flow.booksInvalid || flow.preparing}
                  loading={flow.finishing}
                  loadingText='Finishing...'
                  data-dialog-submit>
                  <Check />
                  Finish setup
                </Button>
              ))}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
