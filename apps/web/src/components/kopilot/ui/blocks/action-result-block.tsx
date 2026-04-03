// apps/web/src/components/kopilot/ui/blocks/action-result-block.tsx

import { Check, X } from 'lucide-react'
import type { BlockRendererProps } from './block-registry'
import type { ActionResultData } from './block-schemas'

export function ActionResultBlock({ data }: BlockRendererProps<ActionResultData>) {
  return (
    <div className='not-prose my-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm'>
      {data.success ? (
        <Check className='size-4 shrink-0 text-green-500' />
      ) : (
        <X className='size-4 shrink-0 text-destructive' />
      )}
      <span>{data.summary}</span>
    </div>
  )
}
