// packages/ui/src/components/collapsed-json.tsx
'use client'

import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

interface CollapsedJsonProps {
  /** Disclosure summary label shown next to the chevron. */
  title: ReactNode
  /** Value pretty-printed as JSON inside the disclosure body. */
  value: unknown
}

/**
 * Collapsed `<details>` JSON disclosure: a chevron that rotates open, a
 * summary label, and a scrollable `<pre>` of `JSON.stringify(value, null, 2)`.
 * Use it wherever a raw payload (provider evidence, source observation,
 * workflow trace output) needs to stay inspectable without occupying space
 * by default.
 */
export function CollapsedJson({ title, value }: CollapsedJsonProps) {
  return (
    <details className='group rounded-xl bg-background ring-1 ring-border'>
      <summary className='flex cursor-pointer items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground select-none'>
        <ChevronRight className='size-3 transition-transform group-open:rotate-90' />
        {title}
      </summary>
      <pre className='max-h-[200px] overflow-auto p-2 pt-0 font-mono text-xs'>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}
