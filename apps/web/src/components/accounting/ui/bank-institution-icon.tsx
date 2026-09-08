// apps/web/src/components/accounting/ui/bank-institution-icon.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Landmark } from 'lucide-react'
import { institutionVisualRef } from '~/components/icons/institution-brands'
import { VisualIcon } from '~/components/icons/ui/visual-icon'

interface BankInstitutionIconProps {
  /** Free text as stored on the account (`bank_account_institution`). */
  institution: string | null
  /** The account's feed, when it has one. A manual account never gets a mark. */
  connectorId?: string | null
  /** `sm` for a row or a heading, `xs` inside a badge. */
  size?: 'xs' | 'sm'
  className?: string
}

/**
 * The institution's brand mark, or the generic bank icon.
 *
 * 🛑 The fallback is rendered HERE rather than handed to `VisualIcon`, because
 * `fallbackIconId` does not cover the case that matters: `VisualIcon`'s brand
 * branch emits a bare `<img src="/icons/brands/<slug>.svg">` and never falls
 * back, so a missing file is a silent empty frame. `institutionVisualRef`
 * returns null unless the slug is a proven `BrandSlug`, and null takes the
 * `Landmark` path below - the same icon every banking screen already uses for a
 * bank account.
 *
 * Sized to match a lucide `size-4` icon so it can sit in a `TreeRow` icon slot
 * or a `CommandGroup` heading without shifting the row.
 */
export function BankInstitutionIcon({
  institution,
  connectorId = null,
  size = 'sm',
  className,
}: BankInstitutionIconProps) {
  const ref = institutionVisualRef({ institution, connectorId })

  if (!ref) {
    return (
      <Landmark
        className={cn(size === 'xs' ? 'size-3' : 'size-4', 'text-muted-foreground', className)}
      />
    )
  }

  // ⚠️ `size` and `variant` do the sizing, never a className. `entityIconVariants`
  // pins the inner `img` with `!important` at the small sizes, so a `size-*`
  // passed from outside is not winnable (icons.tsx:162). `bare` drops the frame
  // chrome that would otherwise draw a box around a 14px mark.
  return <VisualIcon value={ref} size={size} variant='bare' className={className} />
}
