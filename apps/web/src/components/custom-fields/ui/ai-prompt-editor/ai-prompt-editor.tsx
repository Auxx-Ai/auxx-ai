// apps/web/src/components/custom-fields/ui/ai-prompt-editor/ai-prompt-editor.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { RichReferencePrompt } from '@auxx/types/custom-field'
import type { FieldReference } from '@auxx/types/field'
import { CommandNavigation } from '@auxx/ui/components/command'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { EditorContent } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FieldPickerInnerContent,
  type FieldPickerNavigationItem,
} from '~/components/pickers/field-picker'
import { useAiPrompt } from './use-ai-prompt'

interface AiPromptEditorProps {
  /** Current prompt document (TipTap JSON). */
  prompt: RichReferencePrompt | null
  /** Fires on every content change with the canonical TipTap doc. */
  onChange: (prompt: RichReferencePrompt) => void
  /** Entity definition for the field picker. */
  entityDefinitionId: string
  /** Current field id (excluded from the picker to prevent self-reference). */
  currentFieldId?: string
  /**
   * Additional field ids to exclude from the picker. Typically populated
   * with other AI-enabled siblings to prevent AI→AI chains (decision T4.2).
   */
  excludeFieldIds?: string[]
  /** Fields available in this entity; drives badge labels. */
  availableFields: Array<{ key: string; label: string; type: string; id: string }>
}

/**
 * TipTap prompt editor for AI-enabled fields. Mirrors the CALC formula
 * editor's picker UX but without functions or expression validation — an
 * AI prompt is free text with inline `{fieldId}` references.
 */
export function AiPromptEditor({
  prompt,
  onChange,
  entityDefinitionId,
  currentFieldId,
  excludeFieldIds,
  availableFields,
}: AiPromptEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null)

  const { editor, suggestionState, insertField, closeSuggestion } = useAiPrompt({
    initialPrompt: prompt,
    onChange,
    // Badge lookup and stored id are both `field.id` (the CustomField UUID).
    // That's what `FieldValue.fieldId` references and what `getField`'s
    // cache is keyed by, so the server can resolve the ref without a
    // key→id translation step.
    availableFields: availableFields.map((f) => ({ key: f.id, label: f.label, type: f.type })),
  })

  const handleSelectField = useCallback(
    (_fieldReference: FieldReference, field: ResourceField) => {
      insertField(field.id)
    },
    [insertField]
  )

  const excludeFilters = [
    FieldType.RELATIONSHIP,
    FieldType.CALC,
    ...(currentFieldId ? [`${entityDefinitionId}:${currentFieldId}`] : []),
    ...(excludeFieldIds ?? []).map((id) => `${entityDefinitionId}:${id}`),
  ]

  useEffect(() => {
    if (suggestionState.isOpen && suggestionState.clientRect && editorContainerRef.current) {
      const containerRect = editorContainerRef.current.getBoundingClientRect()
      const cursorRect = suggestionState.clientRect
      setPopoverPosition({
        top: cursorRect.bottom - containerRect.top,
        left: cursorRect.left - containerRect.left,
      })
    }
  }, [suggestionState.isOpen, suggestionState.clientRect])

  useEffect(() => {
    if (!suggestionState.isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        closeSuggestion()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [suggestionState.isOpen, closeSuggestion])

  return (
    <Field>
      <FieldLabel>Prompt</FieldLabel>
      <div ref={editorContainerRef} className='relative rounded-md border bg-background'>
        <EditorContent editor={editor} className='min-h-[80px]' />

        {suggestionState.isOpen && popoverPosition && (
          <div
            ref={pickerRef}
            className='absolute z-50'
            style={{ top: popoverPosition.top, left: popoverPosition.left }}>
            <div
              className='w-[320px] rounded-lg border bg-popover shadow-lg'
              onMouseDown={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  closeSuggestion()
                }
              }}>
              <CommandNavigation<FieldPickerNavigationItem>>
                <FieldPickerInnerContent
                  entityDefinitionId={entityDefinitionId}
                  excludeFields={excludeFilters}
                  onSelect={handleSelectField}
                  onClose={closeSuggestion}
                  closeOnSelect
                  showBreadcrumb={false}
                  searchPlaceholder='Search fields...'
                />
              </CommandNavigation>
            </div>
          </div>
        )}
      </div>
      <FieldDescription>
        Type <kbd className='rounded bg-muted px-1 text-xs'>{'{'}</kbd> to insert a field reference.
      </FieldDescription>
    </Field>
  )
}
