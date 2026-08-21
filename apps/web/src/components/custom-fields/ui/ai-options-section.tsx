// apps/web/src/components/custom-fields/ui/ai-options-section.tsx

'use client'

import type { FieldType } from '@auxx/database/types'
import type {
  AiOptions,
  AiTriggerOn,
  RichReferencePrompt,
  SelectOption,
} from '@auxx/types/custom-field'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { ToggleCard } from '@auxx/ui/components/toggle-card'
import { Sparkles } from 'lucide-react'
import { AiPromptEditor } from './ai-prompt-editor'
import { AiPreviewPanel } from './ai-prompt-editor/ai-preview-panel'
import { emptyPromptDoc } from './ai-prompt-editor/use-ai-prompt'

export interface AiSectionState {
  enabled: boolean
  prompt: RichReferencePrompt
  triggerOn: AiTriggerOn
  /** TAGS only — may the model mint tag options that do not exist yet? */
  allowNewOptions: boolean
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
    allowNewOptions: ai?.allowNewOptions ?? false,
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
    // Omitted rather than stored as `false` — absent means "pick from my
    // taxonomy", which is the default for every non-TAGS type too.
    ...(state.allowNewOptions ? { allowNewOptions: true } : {}),
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
  /** Selected field type — forwarded to the preview panel for json-schema generation. */
  fieldType: FieldType
  /** Native options for the selected type (only SELECT/MULTI_SELECT/TAGS supply any). */
  fieldOptions?: { options: SelectOption[] }
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
    <ToggleCard
      title='AI generation'
      description="Generate this field's value from a prompt that references other fields."
      icon={<Sparkles className='size-3.5 text-muted-foreground' />}
      checked={state.enabled}
      onCheckedChange={handleToggle}
      collapsible
      contentClassName='space-y-3'>
      <AiPromptEditor
        prompt={state.prompt}
        onChange={(prompt) => onChange({ ...state, prompt })}
        entityDefinitionId={entityDefinitionId}
        currentFieldId={currentFieldId}
        excludeFieldIds={aiSiblingFieldIds}
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

      {fieldType === 'TAGS' && (
        <ToggleCard
          title='Let AI create new tags'
          description="Off, the model picks from this field's existing tags. On, it may add tags that don't exist yet."
          checked={state.allowNewOptions}
          onCheckedChange={(allowNewOptions) => onChange({ ...state, allowNewOptions })}
        />
      )}

      <AiPreviewPanel
        type={fieldType}
        options={
          // The preview builds its schema from these options, so an open TAGS
          // field has to carry `allowNewOptions` through or the dry run would
          // enumerate the existing tags the live generation is free to grow.
          fieldType === 'TAGS' && fieldOptions
            ? { ...fieldOptions, ai: formatAiOptions(state) }
            : fieldOptions
        }
        prompt={state.prompt}
        name={fieldName}
        entityDefinitionId={entityDefinitionId}
      />
    </ToggleCard>
  )
}
