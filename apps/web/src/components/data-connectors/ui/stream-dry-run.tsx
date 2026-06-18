// apps/web/src/components/data-connectors/ui/stream-dry-run.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { FlaskConical } from 'lucide-react'

interface StreamDryRunProps {
  sample: { records: unknown[]; count: number } | null
  onTestFetch: () => void | Promise<void>
  testing: boolean
}

/**
 * Test-fetch + dry-run preview (05 §4). The live test-fetch (`sampleFetch`) is
 * wired and shows the returned records. A full per-mapping dry-run preview
 * (reusing data-import value-review + plan-preview, with create/update/skip/
 * archive + identity-match + relationship counts) needs a backend "plan" procedure
 * that doesn't exist yet — only `sampleFetch` is available.
 *
 * TODO(dry-run backend): add a `dataConnector.dryRun` procedure that runs the
 * mapping layer over the sample (no writes) and returns per-mapping plan counts;
 * then render data-import/value-review + plan-preview here. See plans/data-connectors/claude/05-frontend.md §4.
 */
export function StreamDryRun({ sample, onTestFetch, testing }: StreamDryRunProps) {
  return (
    <div className='flex flex-col gap-3 px-1'>
      <Button
        variant='outline'
        size='sm'
        className='self-start'
        loading={testing}
        loadingText='Fetching...'
        onClick={() => void onTestFetch()}>
        <FlaskConical />
        Test-fetch
      </Button>

      {sample && (
        <div className='flex flex-col gap-1'>
          <span className='text-xs text-muted-foreground'>
            {sample.count} record{sample.count === 1 ? '' : 's'} returned. Preview:
          </span>
          <ScrollArea className='max-h-72 rounded-md border' scrollbarClassName='w-1.5'>
            <pre className='whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed'>
              {JSON.stringify(sample.records.slice(0, 3), null, 2)}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
