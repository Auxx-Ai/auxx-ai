// apps/web/src/components/accounting/ui/setup-wizard/wizard-welcome-page.tsx
'use client'

import { GuideColumn, GuideConcept, GuideConcepts } from '@auxx/ui/components/guide'
import { CalendarClock, CreditCard, Equal, ListChecks, ListTree, Plug } from 'lucide-react'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'

/**
 * A plain-language explainer of what the accounting module does and the seven things this wizard
 * sets up, built from the container-agnostic `@auxx/ui/components/guide` content primitives
 * (docs/ui-design-guide.md section 16), not a `GuideDialog` shell: the wizard already supplies its
 * own `DialogNav`.
 *
 * 🛑 The list must name every page that asks for something. It listed four of seven for three
 * briefs - connecting a provider, provisioning the chart and routing the rails were all
 * unannounced - and it collapsed the inventory snapshot and the trial balance into one
 * "Opening balances" concept that the rest of the wizard then split across two pages
 * (plans/accounting/WIZARD-REVIEW.md F3, F4).
 */
export function WizardWelcomePage() {
  const providerStatus = useAccountingProviderStatus()

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Accounting turns what your warehouse did into what your books say. Once a month it values
        every movement, build and count against your standard costs and posts a single journal
        entry. A few things have to be true before that entry can be trusted.
      </p>

      {/*
        The import note, and it is the single most useful thing a connected org can be told here:
        the chart, the account map and the whole opening trial balance are each one button once
        QuickBooks is connected. Every page discovered that independently and this page never said
        it, so the wizard read as a data-entry chore that is mostly optional.
      */}
      {providerStatus.connected && (
        <p className='rounded-lg border bg-muted/40 p-3 text-muted-foreground text-sm'>
          Your accounting system is connected, so most of this is an import rather than typing. Your
          chart of accounts, the account map and your opening trial balance can each be filled from
          it in one click — you review the result rather than entering it.
        </p>
      )}

      <GuideColumn title="What we'll set up">
        <GuideConcepts>
          <GuideConcept
            glyph={<CalendarClock className='size-3.5 text-muted-foreground' />}
            term='Accounting period'>
            The last month your old system closed, and the timezone your books are kept in.
          </GuideConcept>
          <GuideConcept
            glyph={<Plug className='size-3.5 text-muted-foreground' />}
            term='Accounting system'>
            Connect QuickBooks, or don&apos;t — the ledger is ours either way, and nothing here
            requires it.
          </GuideConcept>
          <GuideConcept
            glyph={<ListTree className='size-3.5 text-muted-foreground' />}
            term='Chart of accounts'>
            Start from our default chart, or import yours from your accounting system.
          </GuideConcept>
          <GuideConcept
            glyph={<CreditCard className='size-3.5 text-muted-foreground' />}
            term='Payment rails'>
            A clearing account per card rail, so a payout can drain it and the balance means
            something.
          </GuideConcept>
          <GuideConcept
            glyph={<ListChecks className='size-3.5 text-muted-foreground' />}
            term='Account map'>
            Which account in your chart each accounting role posts to.
          </GuideConcept>
          <GuideConcept
            glyph={<Equal className='size-3.5 text-muted-foreground' />}
            term='Opening balances'>
            What every account, inventory included, was worth at the cutoff, as one balanced entry —
            filled from your accounting system, or a tick to say your books start from nothing.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>

      <p className='text-muted-foreground text-xs'>
        You can leave at any point and pick it back up from Accounting settings. Nothing here posts
        anything.
      </p>
    </div>
  )
}
