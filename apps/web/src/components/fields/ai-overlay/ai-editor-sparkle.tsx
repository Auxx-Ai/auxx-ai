// apps/web/src/components/fields/ai-overlay/ai-editor-sparkle.tsx

'use client'

import { isAiEligible } from '@auxx/lib/custom-fields/client'
import type { RecordId } from '@auxx/lib/resources/client'
import type { AiOptions } from '@auxx/types/custom-field'
import type { FieldId } from '@auxx/types/field'
import { toResourceFieldId } from '@auxx/types/field'
import { parseRecordId } from '@auxx/types/resource'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { Sparkles } from 'lucide-react'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import {
  buildFieldValueKey,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'

interface AiEditorSparkleProps {
  field: {
    id: string
    fieldType?: string | null
    options?: { ai?: AiOptions } | null
  }
  recordId: RecordId
  value: unknown
  onTrigger?: () => void
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
 * Sparkle button anchored to the bottom-right of an active inline editor on
 * AI-enabled empty cells. Clicking fires stage-1 generation without closing
 * the editor — caller can optionally pass `onTrigger` to close it.
 */
export function AiEditorSparkle({ field, recordId, value, onTrigger }: AiEditorSparkleProps) {
  const { saveFieldValue } = useSaveFieldValue()

  const entityDefinitionId = field.id ? parseRecordId(recordId).entityDefinitionId : ''
  const resourceFieldId = toResourceFieldId(entityDefinitionId, field.id)
  const key = buildFieldValueKey(recordId, resourceFieldId)
  const status = useFieldValueStore((s) => s.aiStates[key]?.status)

  const aiEnabled =
    field.fieldType != null && isAiEligible(field.fieldType) && field.options?.ai?.enabled === true

  if (!aiEnabled) return null
  if (!isEmpty(value) || status) return null

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            type='button'
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              saveFieldValue(recordId, field.id as FieldId, null, field.fieldType!, { ai: true })
              onTrigger?.()
            }}
            className='absolute top-1 right-1 z-10 size-6 flex items-center justify-center rounded-sm text-muted-foreground hover:text-purple-500 hover:bg-purple-50/30 dark:hover:bg-purple-500/10 pointer-events-auto'>
            <Sparkles className='w-3.5 h-3.5' />
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>
          <span className='text-xs'>Autofill with AI</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
