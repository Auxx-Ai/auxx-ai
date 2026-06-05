// apps/web/src/components/agents/procedures/ui/trigger-examples-editor.tsx
'use client'

import type { TriggerExample } from '@auxx/lib/agents/procedures/client'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Field } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

interface TriggerExamplesEditorProps {
  value: TriggerExample[]
  onChange: (next: TriggerExample[]) => void
}

/**
 * Two `Field`-labelled groups — "Use when" / "Avoid when" — laid out in a
 * responsive 2-column grid (stacks below ~600px). Each example is a `TreeRow`
 * styled and behaving like the custom-fields `TemplateFieldRow`: inline-edit
 * the text, hover to reveal edit/delete. The `avoid` half is load-bearing for
 * selection, so both groups are equally prominent. Mirrors Lyra's "add at
 * least 10" nudge.
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
    <div className='space-y-3 pe-3'>
      <div className='grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3'>
        <TriggerGroup
          label='Use when'
          items={useList}
          onAdd={(text) => emit({ use: [...useList, text], avoid: avoidList })}
          onEdit={(i, text) =>
            emit({ use: useList.map((t, idx) => (idx === i ? text : t)), avoid: avoidList })
          }
          onRemove={(i) => emit({ use: useList.filter((_, idx) => idx !== i), avoid: avoidList })}
        />
        <TriggerGroup
          label='Avoid when'
          items={avoidList}
          onAdd={(text) => emit({ use: useList, avoid: [...avoidList, text] })}
          onEdit={(i, text) =>
            emit({ use: useList, avoid: avoidList.map((t, idx) => (idx === i ? text : t)) })
          }
          onRemove={(i) => emit({ use: useList, avoid: avoidList.filter((_, idx) => idx !== i) })}
        />
      </div>
      {value.length < 10 && (
        <p className='text-xs text-muted-foreground'>
          Add at least 10 examples to sharpen selection.
        </p>
      )}
    </div>
  )
}

function TriggerGroup({
  label,
  items,
  onAdd,
  onEdit,
  onRemove,
}: {
  label: string
  items: string[]
  onAdd: (text: string) => void
  onEdit: (index: number, text: string) => void
  onRemove: (index: number) => void
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  return (
    <Field
      title={label}
      actions={<span className='text-xs text-muted-foreground'>{items.length}</span>}>
      <div className='space-y-1'>
        {items.map((text, i) => (
          <ExampleRow
            key={`${text}-${i}`}
            text={text}
            isEditing={editingIndex === i}
            onStartEdit={() => setEditingIndex(i)}
            onCommit={(next) => {
              setEditingIndex(null)
              const trimmed = next.trim()
              if (trimmed && trimmed !== text) onEdit(i, trimmed)
            }}
            onCancel={() => setEditingIndex(null)}
            onRemove={() => onRemove(i)}
          />
        ))}
        <ExampleRow
          text=''
          isEditing={editingIndex === items.length}
          onStartEdit={() => setEditingIndex(items.length)}
          onCommit={(next) => {
            setEditingIndex(null)
            const trimmed = next.trim()
            if (trimmed) onAdd(trimmed)
          }}
          onCancel={() => setEditingIndex(null)}
          onRemove={() => {}}
        />
      </div>
    </Field>
  )
}

function ExampleRow({
  text,
  isEditing,
  onStartEdit,
  onCommit,
  onCancel,
  onRemove,
}: {
  text: string
  isEditing: boolean
  onStartEdit: () => void
  onCommit: (next: string) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const isPlaceholder = text.length === 0
  const inputRef = useRef<AutosizeInputRef>(null)
  const [editValue, setEditValue] = useState(text)

  useEffect(() => {
    if (isEditing) {
      setEditValue(text)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isEditing, text])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onCommit(editValue)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <TreeRow
      rowClassName={cn(
        'h-7 shadow-xs ring-1 ring-black/5',
        isPlaceholder && !isEditing
          ? 'bg-muted/40 hover:bg-muted/60'
          : 'bg-background hover:bg-primary-100'
      )}
      onTitleClick={isEditing ? undefined : onStartEdit}
      title={
        isEditing ? (
          <AutosizeInput
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => onCommit(editValue)}
            onKeyDown={handleKeyDown}
            placeholder={isPlaceholder ? 'Add example…' : undefined}
            inputClassName='text-sm text-foreground bg-transparent outline-none placeholder:text-muted-foreground'
            minWidth={40}
            maxWidth={240}
          />
        ) : isPlaceholder ? (
          <span className='flex items-center gap-1 text-sm text-muted-foreground'>
            <Plus className='size-3' />
            Add example
          </span>
        ) : (
          <span className='text-sm text-foreground'>{text}</span>
        )
      }
      actions={
        isPlaceholder && !isEditing ? undefined : (
          <div className='flex items-center gap-0.5'>
            {isEditing ? (
              <TreeRowButton aria-label='Cancel edit' className='opacity-100' onClick={onCancel}>
                <X />
              </TreeRowButton>
            ) : (
              <TreeRowButton aria-label='Edit example' onClick={onStartEdit}>
                <Pencil />
              </TreeRowButton>
            )}
            {!isPlaceholder && (
              <TreeRowButton
                variant='destructive'
                aria-label='Remove example'
                className={isEditing ? 'opacity-100' : undefined}
                onClick={onRemove}>
                <Trash2 />
              </TreeRowButton>
            )}
          </div>
        )
      }
    />
  )
}
