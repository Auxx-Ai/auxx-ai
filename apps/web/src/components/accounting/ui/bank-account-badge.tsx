// apps/web/src/components/accounting/ui/bank-account-badge.tsx

'use client'

import type { BankAccountRow } from '@auxx/lib/banking/client'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { useBankAccounts } from './bank-account-picker'
import { BankInstitutionIcon } from './bank-institution-icon'

/** The shape a badge can render from, whether resolved or passed in. */
type BadgeAccount = Pick<BankAccountRow, 'name' | 'last4' | 'institution' | 'connectorId'>

interface BankAccountBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  /** Resolved against `banking.bankAccount.list` - the cached, deduped read. */
  bankAccountId?: string | null
  /**
   * The account itself, when the caller already holds it. Skips the lookup, and
   * is the only way to render an account that is not in the org's list.
   */
  account?: BadgeAccount | null
  /**
   * Rendered when the id resolves to nothing - an account that was removed, or
   * a line that was never assigned one. Omit to render nothing at all.
   */
  fallbackLabel?: string
  className?: string
}

/**
 * A bank account as an inline chip: the institution's brand mark, the account
 * name, and the last four.
 *
 * Chrome comes from `recordBadgeVariants`, the same cva `RecordBadge` uses, so
 * a bank account sits beside a contact or a vendor badge without looking like a
 * different kind of thing. It is NOT a `RecordBadge`, though a `bank_account`
 * is an `EntityInstance`: that component resolves its icon from the entity
 * DEFINITION, which would render one generic glyph for every bank, and it
 * fetches per badge where this reads a list the screen already has.
 *
 * 🛑 The institution is carried by the ICON, not repeated in the text. The name
 * is what distinguishes two accounts at one bank ("Business Adv Relationship"
 * vs "Payroll"), and in a dense row - the review queue's `secondary` slot -
 * "Bank of America · Business Adv Relationship · ···5381" crowds out the amount
 * and the status that the row exists to show.
 *
 * @example
 * <BankAccountBadge bankAccountId={row.bankAccountId} size='sm' />
 * <BankAccountBadge account={account} fallbackLabel='Unassigned account' />
 */
export function BankAccountBadge({
  bankAccountId,
  account,
  fallbackLabel,
  size,
  variant,
  className,
}: BankAccountBadgeProps) {
  // Cheap: React Query dedupes this against every other reader on the screen,
  // and the badge never issues a request of its own for a single account.
  //
  // ⚠️ Archived included. This badge NAMES a stored id rather than offering a
  // choice, and an archived account that a record still points at has to keep
  // rendering as itself instead of falling back to "Unassigned account".
  const { accounts } = useBankAccounts({ includeArchived: true })
  const resolved = account ?? accounts.find((row) => row.id === bankAccountId) ?? null

  if (!resolved) {
    if (!fallbackLabel) return null
    return (
      <span className={cn(recordBadgeVariants({ variant, size }), className)}>
        <BankInstitutionIcon institution={null} size={size === 'sm' ? 'xs' : 'sm'} />
        <span className='truncate'>{fallbackLabel}</span>
      </span>
    )
  }

  // No `···` prefix and no nested Badge: the chip is `h-4` at `sm`, so a Badge
  // inside it would not fit. A middot separates the digits from the name.
  const label = [resolved.name, resolved.last4].filter(Boolean).join(' · ')

  return (
    <span className={cn(recordBadgeVariants({ variant, size }), className)}>
      <BankInstitutionIcon
        institution={resolved.institution}
        connectorId={resolved.connectorId}
        size={size === 'sm' ? 'xs' : 'sm'}
      />
      <span className='truncate'>{label || 'Bank account'}</span>
    </span>
  )
}
