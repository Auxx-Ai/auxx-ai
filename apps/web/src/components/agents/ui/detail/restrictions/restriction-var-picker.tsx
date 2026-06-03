// apps/web/src/components/agents/ui/detail/restrictions/restriction-var-picker.tsx
'use client'

import type { RestrictionVar } from '@auxx/lib/agents/restrictions/client'
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
import { Tooltip } from '~/components/global/tooltip'
import { isVarFieldTypeCompatible } from '~/lib/agents/restrictions/arg-to-field-type'
import { api } from '~/trpc/react'

interface RestrictionVarPickerProps {
  /** Currently-bound var id (`ArgRestriction.var`), or undefined when unset. */
  value?: string
  onChange: (varId: string) => void
  /** The agent id — reserved; the query projection is org-wide. */
  agentId: string
  /**
   * The agent's invocation surface. On `internal` agents `visitor.*` vars
   * resolve null off-chat, so they're greyed with a tooltip.
   */
  agentKind: 'internal' | 'chat'
  /**
   * The arg's mapped platform FieldType — only type-compatible vars are
   * offered. Pass undefined to offer all.
   */
  argFieldType?: string
  disabled?: boolean
}

/**
 * Grouped Select over the phase-2 var registry (`api.agent.listRestrictionVars`),
 * grouped by `var.group` (Visitor / Thread / App). Binds a `source: 'var'`
 * restriction. `visitor.*` vars are greyed (with a tooltip) on internal agents
 * since they resolve null off-chat. See plans/chat/v6 phase-4.
 */
export function RestrictionVarPicker({
  value,
  onChange,
  agentId,
  agentKind,
  argFieldType,
  disabled,
}: RestrictionVarPickerProps) {
  const varsQuery = api.agent.listRestrictionVars.useQuery({ agentId })

  const grouped = useMemo(() => {
    const vars = (varsQuery.data?.vars ?? []).filter((v) =>
      argFieldType ? isVarFieldTypeCompatible(argFieldType, v.fieldType) : true
    )
    const groups = new Map<string, RestrictionVar[]>()
    for (const v of vars) {
      const arr = groups.get(v.group) ?? []
      arr.push(v)
      groups.set(v.group, arr)
    }
    return [...groups.entries()]
  }, [varsQuery.data, argFieldType])

  const isVisitorVarDisabledOnInternal = (v: RestrictionVar) =>
    agentKind === 'internal' && v.anchor === 'visitor'

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className='w-full'>
        <SelectValue placeholder='Select a dynamic value…' />
      </SelectTrigger>
      <SelectContent>
        {grouped.length === 0 ? (
          <div className='px-2 py-1.5 text-xs text-muted-foreground'>No matching values</div>
        ) : (
          grouped.map(([group, vars]) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {vars.map((v) => {
                const greyed = isVisitorVarDisabledOnInternal(v)
                const item = (
                  <SelectItem key={v.id} value={v.id} disabled={greyed}>
                    {v.label}
                  </SelectItem>
                )
                if (!greyed) return item
                return (
                  <Tooltip
                    key={v.id}
                    side='left'
                    content="Visitor values resolve only in a chat turn — they're null for an internal agent.">
                    <span className='inline-block w-full'>{item}</span>
                  </Tooltip>
                )
              })}
            </SelectGroup>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
