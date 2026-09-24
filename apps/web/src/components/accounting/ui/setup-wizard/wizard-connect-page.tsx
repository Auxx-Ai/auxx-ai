// apps/web/src/components/accounting/ui/setup-wizard/wizard-connect-page.tsx
'use client'

// The import path's connect page, shown only while nothing is connected.

import { usePathname } from 'next/navigation'
import { AccountingProviderOptions } from '../provider-connect/accounting-provider-options'

/** Install, then connect; once connected the wizard moves on to the import by itself. */
export function WizardConnectPage() {
  const pathname = usePathname()

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Connect your accounting system to import from it. To set up without one, go back and choose
        Use Auxx on its own.
      </p>

      {/* `/app/accounting` reopens the wizard gate rather than stranding somebody on `/app`. */}
      <AccountingProviderOptions returnTo={pathname || '/app/accounting'} />

      <p className='text-muted-foreground text-xs'>
        Nothing is sent to your accounting system until you finish setup.
      </p>
    </div>
  )
}
