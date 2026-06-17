// apps/web/src/components/workflow/apps/primitives/layout/separator.tsx

'use client'

/**
 * Separator component.
 * Visual divider for separating sections.
 */
export const Separator = ({ className = '' }: any) => {
  return <div className={`h-px w-full bg-border ${className}`} />
}
