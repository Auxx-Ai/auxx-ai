// apps/web/src/components/data-connectors/ui/stream-sample.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Sparkles } from 'lucide-react'
import CodeEditor, { CodeLanguage } from '~/components/workflow/ui/code-editor'

interface StreamSampleProps {
  sample: { response: unknown; recordCount: number } | null
  /** Offer "Use this shape as the schema". Omit for a read-only preview (catalog connectors). */
  onUseShape?: () => void
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
  if (!sample) return null

  return (
    <div className='flex flex-col gap-2 px-1'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-xs text-muted-foreground'>
          Returned {sample.recordCount} record{sample.recordCount === 1 ? '' : 's'}. Raw response:
        </span>
        {onUseShape && (
          <Button variant='ghost' size='xs' onClick={onUseShape}>
            <Sparkles />
            Use this shape as the schema
          </Button>
        )}
      </div>
      <CodeEditor
        value={JSON.stringify(previewResponse(sample.response), null, 2)}
        language={CodeLanguage.json}
        readOnly={true}
        minHeight={120}
        title='SAMPLE'
        gradientBorder={false}
      />
    </div>
  )
}

/** Trim a collection response to its first few records for the preview pane. */
function previewResponse(response: unknown): unknown {
  return Array.isArray(response) ? response.slice(0, 3) : response
}
