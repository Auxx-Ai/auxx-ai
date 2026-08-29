// apps/web/src/components/accounting/ui/setup-wizard/wizard-welcome-page.tsx
'use client'

import { GuideColumn, GuideConcept, GuideConcepts } from '@auxx/ui/components/guide'
import { Banknote, Calculator, CalendarClock, ListChecks } from 'lucide-react'

/**
 * Page 1 of `AccountingSetupWizard` - a plain-language explainer of what the accounting module
 * does and the four things this wizard sets up, built from the container-agnostic
 * `@auxx/ui/components/guide` content primitives (docs/ui-design-guide.md section 16), not a
 * `GuideDialog` shell: the wizard already supplies its own `DialogNav`.
 */
export function WizardWelcomePage() {
  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Accounting turns what your warehouse did into what your books say. Once a month it values
        every movement, build and count against your standard costs and posts a single journal
        entry. Four things have to be true before that entry can be trusted.
      </p>
      <GuideColumn title="What we'll set up">
        <GuideConcepts>
          <GuideConcept
            glyph={<CalendarClock className='size-3.5 text-muted-foreground' />}
            term='Accounting period'>
            The last month your old system closed, and the timezone your books are kept in.
          </GuideConcept>
          <GuideConcept
            glyph={<Banknote className='size-3.5 text-muted-foreground' />}
            term='Opening balances'>
            What you were carrying at the cutoff, agreed with your accounting provider.
          </GuideConcept>
          <GuideConcept
            glyph={<Calculator className='size-3.5 text-muted-foreground' />}
            term='Costing'>
            The labor and overhead absorbed onto every unit you assemble.
          </GuideConcept>
          <GuideConcept
            glyph={<ListChecks className='size-3.5 text-muted-foreground' />}
            term='Account map'>
            Which account in your chart each accounting role posts to.
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
