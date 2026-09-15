// apps/web/src/components/accounting/ui/source-provider-icon.tsx

'use client'

import { MANUAL_SOURCE_PROVIDER_KEY } from '@auxx/lib/postings/client'
import { cn } from '@auxx/ui/lib/utils'
import { Landmark, Store } from 'lucide-react'
import { sourceVisualRef } from '~/components/icons/source-brands'
import { VisualIcon } from '~/components/icons/ui/visual-icon'

interface SourceProviderIconProps {
  /** `FinancialSourceAccount.providerKey`, e.g. `shopify_payments`. */
  providerKey: string
  /** `sm` for a row or heading, `xs` inside a badge. */
  size?: 'xs' | 'sm'
  className?: string
}

/**
 * The provider's brand mark for a `FinancialSourceAccount`, or a lucide glyph.
 *
 * 🛑 The fallback is rendered HERE rather than handed to `VisualIcon`, for the
 * same reason `BankInstitutionIcon` does it: `VisualIcon`'s brand branch emits a
 * bare `<img src="/icons/brands/<slug>.svg">` and never falls back, so a missing
 * file is a silent empty frame. `sourceVisualRef` returns null unless the slug
 * is a proven `BrandSlug`, and null takes the lucide path below.
 *
 * The manual bucket (`auxx`) gets `Store` rather than `Landmark`: it is the
 * sentinel for money that no connector reported, so drawing it as an institution
 * would be a lie. Everything else that has no mark is a financial account and
 * gets `Landmark`, matching every banking screen.
 *
 * Sized to match a lucide `size-4` icon so it can sit in a `TreeRow` icon slot
 * or a badge without shifting the row.
 */
export function SourceProviderIcon({
  providerKey,
  size = 'sm',
  className,
}: SourceProviderIconProps) {
  const ref = sourceVisualRef(providerKey)

  if (!ref) {
    const Fallback = providerKey === MANUAL_SOURCE_PROVIDER_KEY ? Store : Landmark
    return (
      <Fallback
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
