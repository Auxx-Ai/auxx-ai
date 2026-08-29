// apps/web/src/components/accounting/ui/setup-wizard/wizard-accounts-page.tsx
'use client'

import { ACCOUNT_ROLE_LABELS, type AccountRole } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import {
  FIXTURE_ROLE_ACCOUNTS,
  FIXTURE_ROLE_ASSIGNMENT_STATE,
  type FixtureRoleAssignmentState,
} from '~/components/accounting/fixtures'

const ROLES_HREF = '/app/accounting/settings/accounts?s=roles'

const STATE_BADGE: Record<
  FixtureRoleAssignmentState,
  { label: string; variant: 'green' | 'amber' | 'destructive' | 'gray' }
> = {
  confirmed: { label: 'Confirmed', variant: 'green' },
  suggested: { label: 'Suggested', variant: 'amber' },
  unmapped: { label: 'Not mapped', variant: 'destructive' },
  unused: { label: 'Not used', variant: 'gray' },
}

/** Display order: the ones needing attention first, then confirmed, then excused. */
const STATE_ORDER: Record<FixtureRoleAssignmentState, number> = {
  unmapped: 0,
  suggested: 1,
  confirmed: 2,
  unused: 3,
}

interface RoleRow {
  role: string
  label: string
  account: string | null
  state: FixtureRoleAssignmentState
}

/**
 * Page 5 of `AccountingSetupWizard` - a READ-ONLY summary of the account role map.
 *
 * 🛑 Deliberately not an editor. The full map, with the account picker and the reason each account
 * was suggested, lives on `settings/accounts` and this page links there rather than shipping a
 * second copy that could disagree with it. Dispatch's workers page does the same thing.
 *
 * ⚠️ Two roles ship excused rather than unmapped, and that is a decision. Nothing emits `ppv`
 * under L1 (purchase price variance is a report, not a posting) and `inventory_wip` is
 * structurally unreachable, so a map that demanded all thirteen would block every Preview on two
 * roles nothing can ever post to.
 *
 * 🛑 PLACEHOLDER DATA. There is no procedure that can read a `GlRoleAssignment` yet
 * (13-accounting-ui.md section 4), so the counts come from
 * `~/components/accounting/fixtures`. Swap the source, keep the rendering.
 */
export function WizardAccountsPage() {
  const rows: RoleRow[] = Object.entries(FIXTURE_ROLE_ASSIGNMENT_STATE)
    .map(([role, state]) => {
      const account = FIXTURE_ROLE_ACCOUNTS[role as AccountRole]
      return {
        role,
        label: ACCOUNT_ROLE_LABELS[role as AccountRole] ?? role,
        account: account ? `${account.code} · ${account.name}` : null,
        state,
      }
    })
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.label.localeCompare(b.label))

  const required = rows.filter((row) => row.state !== 'unused')
  const confirmed = required.filter((row) => row.state === 'confirmed').length
  const outstanding = required.filter((row) => row.state !== 'confirmed')

  return (
    <div className='flex flex-col gap-4 p-4'>
      <p className='text-muted-foreground text-sm'>
        Every line of a journal entry names an account by role, and each role has to point at a real
        account in your chart. Nothing can be previewed until they do.
      </p>

      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium text-foreground text-sm'>
          {confirmed} of {required.length} roles confirmed
        </span>
        {outstanding.length > 0 && (
          <span className='text-muted-foreground text-sm'>
            {outstanding.length} still need{outstanding.length === 1 ? 's' : ''} a look
          </span>
        )}
      </div>

      <div className='overflow-hidden rounded-xl border'>
        <ul className='flex flex-col'>
          {rows.map((row) => (
            <li
              key={row.role}
              className='flex items-center justify-between gap-2 border-b px-3 py-1.5 text-sm last:border-b-0'>
              <span className='min-w-0 flex-1 truncate'>{row.label}</span>
              <span className='hidden min-w-0 flex-1 truncate text-muted-foreground sm:block'>
                {row.account ?? '—'}
              </span>
              <Badge variant={STATE_BADGE[row.state].variant} size='sm' className='shrink-0'>
                {STATE_BADGE[row.state].label}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <p className='text-muted-foreground text-xs'>
        A suggested account is a guess from the account number and name. Confirm it so a later
        renumber cannot quietly move where a role posts.
      </p>

      <div>
        <Button variant='outline' size='sm' asChild>
          <Link href={ROLES_HREF}>
            Open the account map
            <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </div>
  )
}
