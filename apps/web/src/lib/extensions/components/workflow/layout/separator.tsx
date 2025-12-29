// apps/web/src/lib/extensions/components/workflow/layout/separator.tsx

'use client'

import React from 'react'

/**
 * Separator component.
 * Visual divider for separating sections.
 */
export const Separator = ({ className = '' }: any) => {
  return <div className={`h-px w-full bg-border ${className}`} />
}
