// apps/web/src/components/accounting/ui/setup-wizard/wizard-account-map-page.tsx
'use client'

// Page 7 of `AccountingSetupWizard` - say which account in QuickBooks each of
// the org's own accounts corresponds to (decision `G19`, the provider half).
//
// 🛑 Unlike `wizard-accounts-page.tsx`, this one EDITS rather than summarising,
// and the difference is deliberate. The role map is a review - the seed already
// pointed each role somewhere and the page's job is to let somebody check it.
// This map starts entirely empty on every new connection, nothing downstream can
// resolve an account until it is filled in, and sending a person out to a
// settings page to do the one task that unblocks posting is losing them at the
// exact moment they were going to finish.
//
// 🛑 It still must not BLOCK. `P1` keeps "nothing connected" first class and
// this page inherits that: with no provider connected it says so and Continue
// works, because an org that never connects QuickBooks still has a complete
// internal ledger. What it does not do is pretend the map is done.
//
// The editor itself is `AccountMapList`, shared with the Accounts settings tab,
// so the two cannot drift into disagreeing about what a mapping is.

import { Button } from '@auxx/ui/components/button'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { AccountMapList } from '~/components/accounting/ui/settings/account-map-list'

const MAP_HREF = '/app/accounting/settings/accounts?s=quickbooks'

/**
 * The account map, in `compact` mode: only the rows that still need a decision,
 * plus any confirmed mapping that has since broken.
 *
 * Compact because a wizard page answers "what is left to do" - a full 29-row
 * table with twenty already-settled rows buries the four that are not. The
 * settings tab renders the whole map for the times somebody wants to audit it.
 */
export function WizardAccountMapPage() {
  return (
    <div className='flex flex-col gap-2 p-4'>
      <p className='text-muted-foreground text-sm'>
        A journal entry names your accounts; QuickBooks needs its own. Pair them once here and every
        month-end entry lands in the right place. Nothing is matched automatically - a wrong account
        still balances, so it would never be caught later.
      </p>

      {/* Owns its own padding (it is `chart-list.tsx`'s shape), so it is pulled
          back out of this page's `p-4` rather than sitting inside a second inset. */}
      <div className='-mx-4'>
        <AccountMapList compact />
      </div>

      <div>
        <Button variant='outline' size='sm' asChild>
          <Link href={MAP_HREF}>
            Open the full account map
            <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </div>
  )
}
