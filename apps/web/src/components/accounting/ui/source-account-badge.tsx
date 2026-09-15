// apps/web/src/components/accounting/ui/source-account-badge.tsx

'use client'

import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { sourceAccountLabel, sourceAccountTooltip } from './source-account-label'
import { SourceProviderIcon } from './source-provider-icon'

interface SourceAccountBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  /** `FinancialSourceAccount.providerKey`, e.g. `shopify_payments`. */
  providerKey: string
  /** The provider's own id for the account: a shop domain, a `gid://`, an `acct_`. */
  externalAccountId: string
  /** `live` or `test`. Part of the identity, so it shows in the tooltip. */
  environment?: string | null
  className?: string
}

/**
 * A `FinancialSourceAccount` as an inline chip: the provider's brand mark and
 * the short name, with the full identity one hover away.
 *
 * Chrome comes from `recordBadgeVariants`, the same cva `RecordBadge` uses, so a
 * source account sits beside a bank account or a vendor badge without looking
 * like a different kind of thing. It is NOT a `RecordBadge` and cannot be:
 * `FinancialSourceAccount` is a plain Drizzle table rather than an
 * `EntityInstance`, so there is no `RecordId` to hand it. For the same reason
 * there is no `RecordHoverCard` — that fetches a record, and there is none.
 *
 * 🛑 The provider is carried by the ICON, not repeated in the text — the same
 * rule `BankAccountBadge` documents. In a dense row, `shopify_payments ·
 * gid://shopify/ShopifyPaymentsAccount/999000223183024` crowds out the amount
 * and the status the row exists to show.
 *
 * 🛑 It is wrapped in a `SimpleTooltip` where `BankAccountBadge` is not, because
 * the text this badge discards is an id somebody may have to paste into a
 * provider dashboard. Shortening it is only safe while the full string stays
 * reachable.
 *
 * Fetches nothing: every caller already holds these three strings, because the
 * evidence reads join the account and put them on the DTO.
 *
 * @example
 * <SourceAccountBadge
 *   providerKey={entry.providerKey}
 *   externalAccountId={entry.externalAccountId}
 *   environment={entry.environment}
 *   size='sm'
 * />
 */
export function SourceAccountBadge({
  providerKey,
  externalAccountId,
  environment,
  size,
  variant,
  className,
}: SourceAccountBadgeProps) {
  const subject = { providerKey, externalAccountId, environment }

  return (
    <SimpleTooltip content={sourceAccountTooltip(subject)}>
      <span className={cn(recordBadgeVariants({ variant, size }), className)}>
        <SourceProviderIcon providerKey={providerKey} size={size === 'sm' ? 'xs' : 'sm'} />
        <span className='truncate'>{sourceAccountLabel(subject)}</span>
      </span>
    </SimpleTooltip>
  )
}
