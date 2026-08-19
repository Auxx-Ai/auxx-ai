// apps/web/src/components/dispatch/ui/setup-wizard/wizard-welcome-page.tsx
'use client'

import { GuideColumn, GuideConcept, GuideConcepts } from '@auxx/ui/components/guide'
import { CalendarClock, MapPin, Tag, Users } from 'lucide-react'

/**
 * Page 1 of `DispatchSetupWizard` — a plain-language explainer of what dispatch is and the four
 * things the wizard sets up, built from the container-agnostic `@auxx/ui/components/guide`
 * content primitives (docs/ui-design-guide.md §16), not a `GuideDialog` shell (the wizard already
 * supplies its own `DialogNav`).
 */
export function WizardWelcomePage() {
  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Dispatch schedules your team&apos;s on-site work: service requests turn into work orders,
        work orders get visits, and visits land on a board organized by worker. A few things make it
        useful right away.
      </p>
      <GuideColumn title="What we'll set up">
        <GuideConcepts>
          <GuideConcept glyph={<Users className='size-3.5 text-muted-foreground' />} term='Workers'>
            The people who show up as columns on the board.
          </GuideConcept>
          <GuideConcept
            glyph={<MapPin className='size-3.5 text-muted-foreground' />}
            term='Business address'>
            Used as the depot for route planning and printed on quotes and invoices.
          </GuideConcept>
          <GuideConcept
            glyph={<CalendarClock className='size-3.5 text-muted-foreground' />}
            term='Operating hours'>
            When your organization is open, shown as shading on the board.
          </GuideConcept>
          <GuideConcept glyph={<Tag className='size-3.5 text-muted-foreground' />} term='Pricing'>
            What you sell and the tax you charge, ready for quotes and invoices.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>
    </div>
  )
}
