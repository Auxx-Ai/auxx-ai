// apps/web/src/components/custom-fields/ui/ai-options-section.tsx

'use client'

import type { FieldType } from '@auxx/database/types'
import type { AiOptions, AiTriggerOn, RichReferencePrompt } from '@auxx/types/custom-field'
import { AnimatedCollapsibleContent } from '@auxx/ui/components/collapsible'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { Switch } from '@auxx/ui/components/switch'
import { Sparkles } from 'lucide-react'
import { AiPromptEditor } from './ai-prompt-editor'
import { AiPreviewPanel } from './ai-prompt-editor/ai-preview-panel'
import { emptyPromptDoc } from './ai-prompt-editor/use-ai-prompt'

export interface AiSectionState {
  enabled: boolean
  prompt: RichReferencePrompt
  triggerOn: AiTriggerOn
}

/**
 * Parse an `options.ai` block (if present) into the editor's shape. Missing
 * blocks default to a disabled, empty-prompt, manual-trigger state.
 */
export function parseAiOptions(options?: unknown): AiSectionState {
  const ai = (options as { ai?: AiOptions } | null | undefined)?.ai
  return {
    enabled: ai?.enabled ?? false,
    prompt: ai?.prompt ?? emptyPromptDoc(),
    triggerOn: ai?.triggerOn ?? 'manual',
  }
}

/**
 * Serialize the editor's section state into a persistable `AiOptions`
 * block. Returns `undefined` when AI is disabled so callers can drop the
 * whole `ai` key rather than store `{ enabled: false }`.
 */
export function formatAiOptions(state: AiSectionState): AiOptions | undefined {
  if (!state.enabled) return undefined
  return {
    enabled: true,
    prompt: state.prompt,
    triggerOn: state.triggerOn,
  }
}

interface AiOptionsSectionProps {
  state: AiSectionState
  onChange: (state: AiSectionState) => void
  entityDefinitionId: string
  currentFieldId?: string
  /**
   * Other AI-enabled sibling field ids — excluded from the prompt's field
   * picker to prevent AI→AI chains (decision T4.2).
   */
  aiSiblingFieldIds?: string[]
  availableFields: Array<{ key: string; label: string; type: string; id: string }>
  /** Selected field type — forwarded to the preview panel for json-schema generation. */
  fieldType: FieldType
  /** Native options for the selected type (e.g. SELECT option list). */
  fieldOptions?: unknown
  /** Field display name, threaded into the preview's system prompt. */
  fieldName?: string
}

/**
 * "AI generation" section rendered in the custom-field create/edit dialog
 * for AI-eligible types. Toggling on reveals the TipTap prompt editor and
 * the trigger-timing radio group.
 */
export function AiOptionsSection({
  state,
  onChange,
  entityDefinitionId,
  currentFieldId,
  aiSiblingFieldIds,
  availableFields,
  fieldType,
  fieldOptions,
  fieldName,
}: AiOptionsSectionProps) {
  const handleToggle = (next: boolean) => {
    // When flipping on for the first time, seed a blank prompt so
    // the editor renders with a valid TipTap document root.
    if (next && !state.prompt) {
      onChange({ ...state, enabled: true, prompt: emptyPromptDoc() })
      return
    }
    onChange({ ...state, enabled: next })
  }

  return (
    <div className='rounded-xl border px-3 py-2.5'>
      <div
        className='flex cursor-pointer items-center justify-between'
        onClick={() => handleToggle(!state.enabled)}>
        <div className='space-y-0.5'>
          <Label className='flex cursor-pointer items-center gap-1.5 text-sm font-medium'>
            <Sparkles className='size-3.5 text-muted-foreground' />
            AI generation
          </Label>
          <p className='text-xs text-muted-foreground'>
            Generate this field's value from a prompt that references other fields.
          </p>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Switch size='sm' checked={state.enabled} onCheckedChange={handleToggle} />
        </div>
      </div>

      <AnimatedCollapsibleContent open={state.enabled}>
        <div className='mt-3 space-y-3 border-t pt-3'>
          <AiPromptEditor
            prompt={state.prompt}
            onChange={(prompt) => onChange({ ...state, prompt })}
            entityDefinitionId={entityDefinitionId}
            currentFieldId={currentFieldId}
            excludeFieldIds={aiSiblingFieldIds}
            availableFields={availableFields}
          />

          <div className='space-y-2 hidden'>
            <Label className='text-xs text-muted-foreground'>Trigger</Label>
            <RadioGroup
              value={state.triggerOn}
              onValueChange={(v) => onChange({ ...state, triggerOn: v as AiTriggerOn })}
              className='gap-2'>
              <label className='flex items-center gap-2 text-sm'>
                <RadioGroupItem value='manual' />
                Manual (click to generate)
              </label>
              <label className='flex items-center gap-2 text-sm text-muted-foreground'>
                <RadioGroupItem value='create' disabled />
                On record create
                <span className='rounded bg-muted px-1.5 py-0.5 text-xs'>coming soon</span>
              </label>
            </RadioGroup>
          </div>

          <AiPreviewPanel
            type={fieldType}
            options={fieldOptions}
            prompt={state.prompt}
            name={fieldName}
            entityDefinitionId={entityDefinitionId}
          />
        </div>
      </AnimatedCollapsibleContent>
    </div>
  )
}
