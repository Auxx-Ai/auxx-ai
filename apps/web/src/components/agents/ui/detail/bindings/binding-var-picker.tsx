// apps/web/src/components/agents/ui/detail/bindings/binding-var-picker.tsx
'use client'

import type { AvailableField } from '@auxx/lib/agents/bindings/client'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useMemo } from 'react'
import { isVarFieldTypeCompatible } from '~/lib/agents/bindings/arg-to-field-type'
import { api } from '~/trpc/react'

interface BindingVarPickerProps {
  /** Currently-bound field ref (`{ kind:'var' }.ref` as a string), or undefined. */
  value?: string
  onChange: (ref: string) => void
  /**
   * The input's mapped platform FieldType — only type-compatible fields are
   * offered. Pass undefined to offer all.
   */
  argFieldType?: string
  disabled?: boolean
}

/** Anchors a chat subject provides — the override picker offers fields from each. */
const ANCHORS = ['contact', 'participant', 'thread'] as const

/**
 * Grouped Select over the bindable subject fields (`api.agent.listBindingFields`
 * per anchor), grouped by field `group` (Contact / Participant / Thread / App).
 * Binds a `{ kind:'var', ref }` override. App-owned fields appear as their
 * `@app:<slug>:<key>` ref (resolved at turn time). See plans/chat/v8 phase-5.
 */
export function BindingVarPicker({
  value,
  onChange,
  argFieldType,
  disabled,
}: BindingVarPickerProps) {
  const contact = api.agent.listBindingFields.useQuery({ anchor: 'contact' })
  const participant = api.agent.listBindingFields.useQuery({ anchor: 'participant' })
  const thread = api.agent.listBindingFields.useQuery({ anchor: 'thread' })
  const byAnchor = { contact, participant, thread }

  const grouped = useMemo(() => {
    const fields: AvailableField[] = []
    for (const anchor of ANCHORS) {
      for (const f of byAnchor[anchor].data?.fields ?? []) {
        if (!argFieldType || isVarFieldTypeCompatible(argFieldType, f.fieldType)) fields.push(f)
      }
    }
    const groups = new Map<string, AvailableField[]>()
    for (const f of fields) {
      const arr = groups.get(f.group) ?? []
      arr.push(f)
      groups.set(f.group, arr)
    }
    return [...groups.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.data, participant.data, thread.data, argFieldType])

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className='w-full'>
        <SelectValue placeholder='Select a dynamic value…' />
      </SelectTrigger>
      <SelectContent>
        {grouped.length === 0 ? (
          <div className='px-2 py-1.5 text-xs text-muted-foreground'>No matching values</div>
        ) : (
          grouped.map(([group, fields]) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {fields.map((f) => (
                <SelectItem key={f.ref} value={f.ref}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
