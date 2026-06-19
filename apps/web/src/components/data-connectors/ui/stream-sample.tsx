// apps/web/src/components/data-connectors/ui/stream-sample.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Sparkles } from 'lucide-react'

interface StreamSampleProps {
  sample: { response: unknown; recordCount: number } | null
  onUseShape: () => void
}

/**
 * Sample section body (05 §4) — renders the result of the live test-fetch (the
 * `Test fetch` trigger lives in the section header). Shows the raw response and
 * offers to derive the source schema from that shape. Replaces the old split
 * between "Generate from result" (top) and "Test & preview" (bottom), which
 * both ran the same fetch.
 *
 * TODO(dry-run backend): a real per-mapping Preview (create/update/skip/archive
 * + identity-match counts) needs a `dataConnector.dryRun` procedure that runs
 * the mapping layer over the sample with no writes. When it lands, add a Preview
 * section below Mappings. See plans/data-connectors/claude/05-frontend.md §4.
 */
export function StreamSample({ sample, onUseShape }: StreamSampleProps) {
  if (!sample) {
    return (
      <p className='px-1 text-xs text-muted-foreground'>
        Run a test fetch to pull a few real records from the source.
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-2 px-1'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-xs text-muted-foreground'>
          Returned {sample.recordCount} record{sample.recordCount === 1 ? '' : 's'}. Raw response:
        </span>
        <Button variant='ghost' size='xs' onClick={onUseShape}>
          <Sparkles />
          Use this shape as the schema
        </Button>
      </div>
      <ScrollArea className='max-h-72 rounded-md border' scrollbarClassName='w-1.5'>
        <pre className='whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed'>
          {JSON.stringify(previewResponse(sample.response), null, 2)}
        </pre>
      </ScrollArea>
    </div>
  )
}

/** Trim a collection response to its first few records for the preview pane. */
function previewResponse(response: unknown): unknown {
  return Array.isArray(response) ? response.slice(0, 3) : response
}
