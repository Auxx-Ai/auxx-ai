// apps/web/src/components/dispatch/ui/setup-wizard/wizard-done-page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { PartyPopper } from 'lucide-react'
import Link from 'next/link'

interface WizardDonePageProps {
  /** Stamps `setWizardCompleted` and closes the dialog. */
  onFinish: () => void
}

/**
 * Page 6 (last) of `DispatchSetupWizard` — a short "you're set" page pointing at the checklist's
 * remaining record-creation steps (service request → work order → visit), which stay visible in
 * the dispatch sidebar checklist after this wizard closes.
 */
export function WizardDonePage({ onFinish }: WizardDonePageProps) {
  return (
    <div className='flex flex-col items-center gap-3 px-4 py-6 text-center'>
      <PartyPopper className='size-8 text-muted-foreground' />
      <h2 className='font-medium text-foreground text-base'>You&apos;re set</h2>
      <p className='max-w-xs text-muted-foreground text-sm'>
        Next: log your first service request. The dispatch checklist keeps track of the remaining
        steps — turning it into a work order and scheduling a visit.
      </p>
      <div className='mt-2 flex items-center gap-2'>
        <Button variant='ghost' size='sm' onClick={onFinish}>
          Close
        </Button>
        <Button variant='outline' size='sm' asChild onClick={onFinish}>
          <Link href='/app/service-requests'>Log a service request</Link>
        </Button>
      </div>
    </div>
  )
}
