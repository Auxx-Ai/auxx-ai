// apps/web/src/components/accounting/ui/setup-wizard/wizard-welcome-page.tsx
'use client'

import { GuideColumn, GuideConcept, GuideConcepts } from '@auxx/ui/components/guide'
import { CalendarClock, CreditCard, Equal, ListTree, Plug } from 'lucide-react'

/** The wizard's first page: what accounting does and what setup asks for, on either path. */
export function WizardWelcomePage() {
  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Accounting turns what your business does into what your books say. Auxx posts a journal
        entry for each event — a shipment, a payment, a receipt, a payout — and, with an accounting
        system connected, exports each one to it.
      </p>

      <GuideColumn title="What we'll set up">
        <GuideConcepts>
          <GuideConcept
            glyph={<CalendarClock className='size-3.5 text-muted-foreground' />}
            term='Accounting period'>
            The cutover — the last month your old books are closed through — and the timezone your
            books are kept in.
          </GuideConcept>
          <GuideConcept
            glyph={<Plug className='size-3.5 text-muted-foreground' />}
            term='Accounting system'>
            Import from your accounting system, or use Auxx on its own.
          </GuideConcept>
          <GuideConcept
            glyph={<ListTree className='size-3.5 text-muted-foreground' />}
            term='Chart of accounts'>
            Imported from your accounting system, or built from our account templates.
          </GuideConcept>
          <GuideConcept
            glyph={<CreditCard className='size-3.5 text-muted-foreground' />}
            term='Payment rails'>
            A clearing account per card rail, so a payout can drain it and the balance means
            something.
          </GuideConcept>
          <GuideConcept
            glyph={<Equal className='size-3.5 text-muted-foreground' />}
            term='Opening balances'>
            What every account, inventory included, was worth at the cutover — read from your
            accounting system, entered by you, or a tick to say your books start from nothing.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>

      <p className='text-muted-foreground text-xs'>
        You can leave at any point and pick it back up from Accounting settings. Nothing posts, and
        nothing is sent to your accounting system, until you finish.
      </p>
    </div>
  )
}
