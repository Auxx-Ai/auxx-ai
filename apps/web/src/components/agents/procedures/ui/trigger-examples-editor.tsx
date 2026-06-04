// apps/web/src/components/agents/procedures/ui/trigger-examples-editor.tsx
'use client'

import type { TriggerExample } from '@auxx/lib/agents/procedures/client'
import { Input } from '@auxx/ui/components/input'
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'

interface TriggerExamplesEditorProps {
  value: TriggerExample[]
  onChange: (next: TriggerExample[]) => void
}

/**
 * Two tag lists — "Use when" / "Avoid when" — backing the Phase-0
 * `TriggerExample[]` shape. The `avoid` half is load-bearing for selection, so
 * both lists are equally prominent. Mirrors Lyra's "add at least 10" nudge.
 */
export function TriggerExamplesEditor({ value, onChange }: TriggerExamplesEditorProps) {
  const useList = useMemo(
    () => value.filter((e) => e.behavior === 'use').map((e) => e.text),
    [value]
  )
  const avoidList = useMemo(
    () => value.filter((e) => e.behavior === 'avoid').map((e) => e.text),
    [value]
  )

  const emit = (next: { use: string[]; avoid: string[] }) => {
    onChange([
      ...next.use.map((text) => ({ text, behavior: 'use' as const })),
      ...next.avoid.map((text) => ({ text, behavior: 'avoid' as const })),
    ])
  }

  return (
    <div className='space-y-3'>
      <TagList
        label='Use when'
        items={useList}
        onAdd={(text) => emit({ use: [...useList, text], avoid: avoidList })}
        onRemove={(i) => emit({ use: useList.filter((_, idx) => idx !== i), avoid: avoidList })}
      />
      <TagList
        label='Avoid when'
        items={avoidList}
        onAdd={(text) => emit({ use: useList, avoid: [...avoidList, text] })}
        onRemove={(i) => emit({ use: useList, avoid: avoidList.filter((_, idx) => idx !== i) })}
      />
      {value.length < 10 && (
        <p className='text-xs text-muted-foreground'>
          Add at least 10 examples to sharpen selection.
        </p>
      )}
    </div>
  )
}

function TagList({
  label,
  items,
  onAdd,
  onRemove,
}: {
  label: string
  items: string[]
  onAdd: (text: string) => void
  onRemove: (index: number) => void
}) {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const text = draft.trim()
    if (!text) return
    onAdd(text)
    setDraft('')
  }

  return (
    <div className='space-y-1.5'>
      <span className='text-xs font-medium text-muted-foreground'>{label}</span>
      <div className='flex flex-wrap gap-1.5'>
        {items.map((text, i) => (
          <span
            key={`${text}-${i}`}
            className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs'>
            {text}
            <button
              type='button'
              onClick={() => onRemove(i)}
              aria-label={`Remove ${text}`}
              className='text-muted-foreground hover:text-destructive'>
              <X className='size-3' />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
        placeholder={`Add a "${label.toLowerCase()}" example…`}
        className='h-7 text-xs'
      />
    </div>
  )
}
