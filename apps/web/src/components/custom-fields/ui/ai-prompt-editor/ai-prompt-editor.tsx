// apps/web/src/components/custom-fields/ui/ai-prompt-editor/ai-prompt-editor.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import type { RichReferencePrompt } from '@auxx/types/custom-field'
import { type FieldReference, fieldRefToKey } from '@auxx/types/field'
import { CommandNavigation } from '@auxx/ui/components/command'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { EditorContent } from '@tiptap/react'
import { useCallback, useMemo } from 'react'
import { InlinePickerPopover, useActivePicker } from '~/components/editor/inline-picker'
import {
  type ExcludeFilter,
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
}: AiPromptEditorProps) {
  const { editor, insertField, closePicker } = useAiPrompt({
    initialPrompt: prompt,
    onChange,
    entityDefinitionId,
  })

  // Drive the picker popover off the open `{` chip.
  const activePicker = useActivePicker(editor)
  const pickerOpen = !!activePicker && activePicker.trigger === '{'

  // Encode the picker's FieldReference (ResourceFieldId or FieldPath) as a
  // single string key via `fieldRefToKey`. The server's reference-resolver
  // decodes via `keyToFieldRef`, so direct fields and multi-hop paths
  // round-trip through the same canonical format — no string surgery.
  const handleSelectField = useCallback(
    (fieldReference: FieldReference, _field: ResourceField) => {
      insertField(fieldRefToKey(fieldReference))
    },
    [insertField]
  )

  // Self + AI-sibling excludes only. RELATIONSHIP and CALC are now
  // referenceable; the picker can drill into relationships and the
  // resolver handles the resulting FieldPath.
  const excludeFilters = useMemo<ExcludeFilter[]>(
    () => [
      ...(currentFieldId ? [`${entityDefinitionId}:${currentFieldId}`] : []),
      ...(excludeFieldIds ?? []).map((id) => `${entityDefinitionId}:${id}`),
    ],
    [entityDefinitionId, currentFieldId, excludeFieldIds]
  )

  return (
    <Field>
      <FieldLabel>Prompt</FieldLabel>
      <div className='relative rounded-md border bg-background'>
        <EditorContent editor={editor} className='min-h-[80px]' />
      </div>

      {editor && (
        <InlinePickerPopover
          state={{
            isOpen: pickerOpen,
            query: activePicker?.query ?? '',
            range: null,
            clientRect: activePicker?.clientRect ?? null,
          }}
          width={320}
          onClose={closePicker}>
          <CommandNavigation<FieldPickerNavigationItem>>
            <FieldPickerInnerContent
              entityDefinitionId={entityDefinitionId}
              excludeFields={excludeFilters}
              onSelect={handleSelectField}
              onClose={closePicker}
              closeOnSelect
              showBreadcrumb={false}
              searchPlaceholder='Search fields...'
            />
          </CommandNavigation>
        </InlinePickerPopover>
      )}
      <FieldDescription>
        Type <kbd className='rounded bg-muted px-1 text-xs'>{'{'}</kbd> to insert a field reference.
      </FieldDescription>
    </Field>
  )
}
