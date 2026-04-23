// apps/web/src/components/fields/ai-overlay/ai-cell-overlay.tsx

'use client'

import type { FieldType } from '@auxx/database/types'
import type { RecordId } from '@auxx/lib/resources/client'
import type { FieldId } from '@auxx/types/field'
import type { ReactNode } from 'react'
import { useFieldAiState } from '~/components/resources/hooks/use-field-values'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { AiGeneratingIndicator } from './ai-generating-indicator'
import { SparkleBadge } from './sparkle-badge'

interface AiCellOverlayProps {
  /** Full RecordId (entityDefinitionId:entityInstanceId). */
  recordId: RecordId
  /** Bare field id passed to `saveFieldValue` and the AI state lookup. */
  fieldId: FieldId
  /** Field type — needed for the save hook's typed-input path. */
  fieldType: FieldType
  /** Native cell renderer. The overlay layers chrome on top of this. */
  children: ReactNode
}

/**
 * Overlay wrapper for AI-enabled field cells. Reads the per-cell AI marker
 * from the field-value store and layers:
 *   - a shimmer while stage-1 is in flight or stage-2 is running
 *   - a top-left sparkle badge that carries the value/stale/generating/error
 *     state. Click re-runs generation.
 *
 * The caller is responsible for deciding whether the field is AI-enabled —
 * this overlay renders chrome unconditionally.
 */
export function AiCellOverlay({ recordId, fieldId, fieldType, children }: AiCellOverlayProps) {
  const aiState = useFieldAiState(recordId, fieldId)
  const { saveFieldValue } = useSaveFieldValue()

  const status = aiState?.status
  const isGenerating = status === 'generating'

  const generate = () => {
    saveFieldValue(recordId, fieldId, null, fieldType, { ai: true })
  }

  return (
    <div className='relative group h-full w-full'>
      {!isGenerating && <div className='h-full w-full'>{children}</div>}

      {isGenerating && <AiGeneratingIndicator className='h-full pl-2 text-xs' />}

      <SparkleBadge
        metadata={aiState?.metadata}
        onClick={generate}
        isGenerating={isGenerating}
        errorMessage={
          status === 'error'
            ? (aiState?.metadata?.errorMessage ?? 'AI generation failed')
            : undefined
        }
      />
    </div>
  )
}
