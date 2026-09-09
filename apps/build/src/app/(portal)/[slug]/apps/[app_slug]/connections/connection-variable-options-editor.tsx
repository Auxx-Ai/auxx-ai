// apps/build/src/app/(portal)/[slug]/apps/[app_slug]/connections/connection-variable-options-editor.tsx
'use client'

import type { ConnectionVariableOption } from '@auxx/database'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { PlusCircle, Trash2 } from 'lucide-react'

/**
 * Editor for a `SINGLE_SELECT` connection variable's choices: add, edit, remove.
 *
 * Fully controlled: `options` is rendered directly and every edit is pushed up through
 * `onChange`. Unlike the org-side custom-field editor, both `label` and `value` are
 * editable here: a connection option is authored against the provider's own vocabulary
 * (an API region, a plan name), so the submitted `value` is the developer's to choose.
 * An `id` on an existing option is preserved verbatim.
 */
export function ConnectionVariableOptionsEditor({
  options,
  onChange,
}: {
  options?: ConnectionVariableOption[]
  onChange: (options: ConnectionVariableOption[]) => void
}) {
  const items = Array.isArray(options) ? options : []

  const addOption = () => onChange([...items, { label: '', value: '' }])

  const updateOption = (index: number, patch: Partial<ConnectionVariableOption>) =>
    onChange(items.map((opt, i) => (i === index ? { ...opt, ...patch } : opt)))

  const removeOption = (index: number) => onChange(items.filter((_, i) => i !== index))

  return (
    <div className='rounded-lg border bg-background px-2 py-2 space-y-2'>
      <div className='flex items-center justify-between'>
        <span className='text-sm font-medium'>
          Options <span className='text-red-500'>*</span>
        </span>
        <Button type='button' variant='ghost' size='sm' onClick={addOption}>
          <PlusCircle />
          Add Option
        </Button>
      </div>

      {items.length === 0 ? (
        <p className='px-1 text-sm text-muted-foreground'>No options added yet.</p>
      ) : (
        <div className='space-y-2'>
          {items.map((option, index) => (
            // A connection option has no stable identity while it is being typed
            // (its `value` is editable), so the row index is the key.
            <div key={`option-${index}`} className='flex items-center gap-2'>
              <Input
                value={option.label}
                onChange={(e) => updateOption(index, { label: e.target.value })}
                placeholder='Label'
                aria-label={`Option ${index + 1} label`}
              />
              <Input
                value={option.value}
                onChange={(e) => updateOption(index, { value: e.target.value })}
                placeholder='value'
                className='font-mono'
                aria-label={`Option ${index + 1} value`}
              />
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                className='text-destructive hover:text-destructive'
                aria-label={`Remove option ${index + 1}`}
                onClick={() => removeOption(index)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}

      <p className='px-1 text-xs text-muted-foreground'>
        The label is shown in the dropdown; the value is what the connection stores.
      </p>
    </div>
  )
}
