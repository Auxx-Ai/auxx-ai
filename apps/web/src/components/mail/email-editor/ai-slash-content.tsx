// apps/web/src/components/mail/email-editor/ai-slash-content.tsx
'use client'

import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandInputWithSubmit,
  CommandItem,
  CommandList,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import type { Editor } from '@tiptap/react'
import { ChevronRight } from 'lucide-react'
import { useCallback, useState } from 'react'
import { SparkleIcon } from '~/components/kopilot/ui/sparkle-icon'
import { AI_LANG_TYPE, AI_OPERATION, AI_TONE_TYPE, type AIOperation } from '~/types/ai-tools'
import { isBodyEmptyIgnoringChips } from '../composer-shared/content-empty'

export interface AiSlashContentProps {
  /** Live editor — detects whether the body has content (chip-aware). */
  editor?: Editor | null
  /** Strips the chip + runs the shared AI entrypoint. */
  onRunAI: (
    operation: AIOperation,
    options?: { tone?: string; language?: string; instruction?: string }
  ) => void
  /** Sync the chip scope label + restore editor focus on nav transitions. */
  onScopeChange: (scope: string | null) => void
  /** Close the chip entirely. */
  onClose: () => void
}

/** Compatible shape for the shared nav stack (mail uses a richer `type`). */
type AiNavItem = { id: string; label: string; type: string }

// Single-shot ops at the root. `needsContent` ops are disabled on an empty body.
const ROOT_PRESETS = [
  {
    id: 'compose',
    title: 'Compose',
    iconId: 'sparkles',
    op: AI_OPERATION.COMPOSE,
    needsContent: false,
  },
  {
    id: 'fix-grammar',
    title: 'Fix grammar',
    iconId: 'check-circle',
    op: AI_OPERATION.FIX_GRAMMAR,
    needsContent: true,
  },
  {
    id: 'expand',
    title: 'Expand',
    iconId: 'arrows-up-down',
    op: AI_OPERATION.EXPAND,
    needsContent: true,
  },
  {
    id: 'shorten',
    title: 'Shorten',
    iconId: 'chevrons-up-down',
    op: AI_OPERATION.SHORTEN,
    needsContent: true,
  },
] as const

// Drill rows — both transform the existing draft, so both need content.
const DRILL_PRESETS = [
  { id: 'tone', title: 'Tone', iconId: 'pen-tool', level: 'tone' as const },
  { id: 'translate', title: 'Translate', iconId: 'globe', level: 'translate' as const },
]

/**
 * Focus-owning "Ask AI" panel for the mail `/` menu. The instruction is typed
 * into a real {@link CommandInputWithSubmit} (placeholder + inline send button);
 * the preset ops sit below as static shortcuts (`shouldFilter={false}` at root).
 * Tone / Translate drill into a filterable sub-list.
 *
 * Lives inside the mail `CommandNavigation`, so it pushes/pops the shared stack
 * and renders the real {@link CommandBreadcrumb} ("Commands › Ask AI › Tone").
 * Every transition routes through `onScopeChange`, which re-runs the editor's
 * `setPickerScope` command and restores focus to the chip on the way out.
 */
export function AiSlashContent({ editor, onRunAI, onScopeChange, onClose }: AiSlashContentProps) {
  const { current, push, pop } = useCommandNavigation<AiNavItem>()
  const [instruction, setInstruction] = useState('')
  const [search, setSearch] = useState('')

  const level =
    current?.type === 'ai-tone' ? 'tone' : current?.type === 'ai-translate' ? 'translate' : 'root'

  // Chip-aware: the open `/` chip is ignored so an empty body reads as empty.
  const hasContent = !isBodyEmptyIgnoringChips(editor ?? null)

  const back = useCallback(() => {
    pop()
    // Tone/Translate → back to "Ask AI"; "Ask AI" → back to the slash root.
    onScopeChange(level === 'root' ? null : 'Ask AI')
    setSearch('')
  }, [pop, onScopeChange, level])

  const drill = useCallback(
    (target: 'tone' | 'translate') => {
      push({
        id: `ai-${target}`,
        label: target === 'tone' ? 'Tone' : 'Translate',
        type: `ai-${target}`,
      })
      onScopeChange(target === 'tone' ? 'Tone' : 'Translate')
    },
    [push, onScopeChange]
  )

  const run = useCallback(
    (
      operation: AIOperation,
      options?: { tone?: string; language?: string; instruction?: string }
    ) => {
      onRunAI(operation, options)
      onClose()
    },
    [onRunAI, onClose]
  )

  if (level === 'tone' || level === 'translate') {
    const isTone = level === 'tone'
    const options = isTone ? Object.values(AI_TONE_TYPE) : Object.values(AI_LANG_TYPE)
    return (
      <div className='w-72 overflow-hidden'>
        <Command
          className='w-full overflow-hidden'
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              back()
            } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !search) {
              e.preventDefault()
              back()
            }
          }}>
          <CommandBreadcrumb rootLabel='Commands' />
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={isTone ? 'Search tones…' : 'Search languages…'}
            autoFocus
          />
          <CommandList>
            <CommandEmpty>No options.</CommandEmpty>
            <CommandGroup heading={isTone ? 'Tone' : 'Translate'}>
              {options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() =>
                    run(
                      isTone ? AI_OPERATION.TONE : AI_OPERATION.TRANSLATE,
                      isTone ? { tone: opt } : { language: opt }
                    )
                  }>
                  {opt}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    )
  }

  return (
    <div className='w-72 overflow-hidden'>
      <Command
        className='w-full overflow-hidden'
        shouldFilter={false}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            back()
          } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !instruction) {
            e.preventDefault()
            back()
          }
        }}>
        <CommandBreadcrumb rootLabel='Commands' />
        <CommandInputWithSubmit
          autoFocus
          value={instruction}
          onValueChange={setInstruction}
          onSubmit={(value) => run(AI_OPERATION.CUSTOM, { instruction: value })}
          placeholder='Ask Kopilot to edit or write'
          leftIcon={<SparkleIcon className='shrink-0' />}
        />
        <CommandList>
          <CommandGroup heading='Ask AI'>
            {ROOT_PRESETS.map((preset) => {
              const disabled = preset.needsContent && !hasContent
              return (
                <CommandItem
                  key={preset.id}
                  value={preset.id}
                  disabled={disabled}
                  onSelect={() => !disabled && run(preset.op)}
                  className='aria-disabled:opacity-50'>
                  <EntityIcon iconId={preset.iconId} size='sm' className='text-muted-foreground' />
                  <span>{preset.title}</span>
                </CommandItem>
              )
            })}
            {DRILL_PRESETS.map((preset) => (
              <CommandItem
                key={preset.id}
                value={preset.id}
                disabled={!hasContent}
                data-drilldown={hasContent ? '' : undefined}
                onSelect={() => hasContent && drill(preset.level)}
                className='aria-disabled:opacity-50'>
                <EntityIcon iconId={preset.iconId} size='sm' className='text-muted-foreground' />
                <span className='flex-1'>{preset.title}</span>
                <ChevronRight className='size-4 opacity-50' />
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}
