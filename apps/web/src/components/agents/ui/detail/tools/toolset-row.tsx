// apps/web/src/components/agents/ui/detail/tools/toolset-row.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Switch } from '@auxx/ui/components/switch'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { useEffect, useState } from 'react'

export interface ToolsetRowProps {
  slug: string
  label: string
  iconId: string
  color: string
  toolCount: number
  enabled: boolean
  source: 'manual' | 'mention' | 'auto_default'
  depth?: number
  onToolsetToggle: (slug: string, enabled: boolean) => void
}

/**
 * One toolset rendered as a single-line TreeRow: icon + short label + tool
 * count + source badge + Switch. The toolset is the atomic unit of control —
 * there are no per-tool sub-rows. Mention-sourced rows show a badge and
 * disable the switch.
 */
export function ToolsetRow({
  slug,
  label,
  iconId,
  color,
  toolCount,
  enabled,
  source,
  depth = 0,
  onToolsetToggle,
}: ToolsetRowProps) {
  // Local state for instant switch feedback. Syncs back to server truth when
  // the parent prop changes (after optimistic update + cache reconciliation).
  const [localEnabled, setLocalEnabled] = useState(enabled)
  useEffect(() => {
    setLocalEnabled(enabled)
  }, [enabled])

  return (
    <TreeRow
      depth={depth}
      icon={<EntityIcon iconId={iconId} color={color} size='sm' />}
      title={label}
      actions={
        <>
          <span className='text-xs text-muted-foreground'>
            {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
          </span>
          {source === 'mention' && <Badge variant='secondary'>Pinned by mention</Badge>}
          {source === 'auto_default' && <Badge variant='outline'>Default</Badge>}
          <Switch
            size='sm'
            checked={localEnabled}
            disabled={source === 'mention'}
            onCheckedChange={(checked) => {
              setLocalEnabled(checked)
              onToolsetToggle(slug, checked)
            }}
          />
        </>
      }
    />
  )
}
