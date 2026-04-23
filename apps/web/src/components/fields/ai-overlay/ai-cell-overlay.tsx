// apps/web/src/components/fields/ai-overlay/ai-cell-overlay.tsx

'use client'

import type { FieldType } from '@auxx/database/types'
import type { RecordId } from '@auxx/lib/resources/client'
import type { FieldId, ResourceFieldId } from '@auxx/types/field'
import { TextShimmer } from '@auxx/ui/components/text-shimmer'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { AnimatedDots } from '~/components/kopilot/ui/kopilot-status-bar'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import {
  buildFieldValueKey,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import { EmptyPlaceholder } from './empty-placeholder'
import { SparkleBadge } from './sparkle-badge'

interface AiCellOverlayProps {
  /** Full RecordId (entityDefinitionId:entityInstanceId). */
  recordId: RecordId
  /** Composite resource field id used to build the store key. */
  resourceFieldId: ResourceFieldId
  /** Bare field id passed to `saveFieldValue` (not the composite). */
  fieldId: FieldId
  /** Field type — needed for the save hook's typed-input path. */
  fieldType: FieldType
  /** The current value — used to decide if the cell is empty. */
  value: unknown
  /** Native cell renderer. The overlay layers chrome on top of this. */
  children: ReactNode
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'object' && 'value' in (value as object)) {
    const inner = (value as { value: unknown }).value
    if (inner == null) return true
    if (typeof inner === 'string') return inner.trim() === ''
    if (Array.isArray(inner)) return inner.length === 0
  }
  return false
}

/**
 * Overlay wrapper for AI-enabled field cells. Reads the per-cell AI marker
 * from the field-value store and layers:
 *   - a hover-visible sparkle in the empty state (triggers generation)
 *   - a shimmer while stage-1 is in flight or stage-2 is running
 *   - a top-left sparkle badge when a result has landed (click to regenerate)
 *   - an error badge when the worker reported a failure
 *
 * The caller is responsible for deciding whether the field is AI-enabled —
 * this overlay renders chrome unconditionally.
 */
export function AiCellOverlay({
  recordId,
  resourceFieldId,
  fieldId,
  fieldType,
  value,
  children,
}: AiCellOverlayProps) {
  const key = buildFieldValueKey(recordId, resourceFieldId)
  const aiState = useFieldValueStore((s) => s.aiStates[key])
  const { saveFieldValue } = useSaveFieldValue()

  const status = aiState?.status
  const empty = isEmpty(value)

  const generate = () => {
    saveFieldValue(recordId, fieldId, null, fieldType, { ai: true })
  }

  const showEmptyPlaceholder = empty && !status
  const isGenerating = status === 'generating'

  return (
    <div className='relative group h-full w-full'>
      {!isGenerating && <div className='h-full w-full'>{children}</div>}

      {isGenerating && (
        <div className='flex items-center h-full pl-2 pointer-events-none'>
          <TextShimmer as='span' className='text-xs'>
            Generating
          </TextShimmer>
          <AnimatedDots />
        </div>
      )}

      {showEmptyPlaceholder && <EmptyPlaceholder onClick={generate} />}

      {status === 'result' && <SparkleBadge metadata={aiState?.metadata} onClick={generate} />}

      {status === 'error' && (
        <TooltipProvider>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div className='absolute top-1 right-1 z-16 pointer-events-auto rounded-sm p-0.5 text-destructive'>
                <AlertTriangle className='w-3 h-3' />
              </div>
            </TooltipTrigger>
            <TooltipContent side='top' variant='destructive'>
              <span className='text-xs'>
                {aiState?.metadata?.errorMessage ?? 'AI generation failed'}
              </span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}
