// apps/web/src/components/agents/ui/detail/tools/toolset-row.tsx
'use client'

import { Switch } from '@auxx/ui/components/switch'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { AppIcon } from '~/components/workflow/ui/app-icon'

export interface ToolsetRowProps {
  slug: string
  label: string
  iconId: string
  /** `null` = inherit / neutral. */
  color: string | null
  /** Optional one-line tooltip; rendered by `<TreeRow>` as a help-icon. */
  description?: string
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
  description,
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

  const isMention = source === 'mention'
  const isAutoDefault = source === 'auto_default'

  return (
    <TreeRow
      depth={depth}
      icon={<AppIcon iconId={iconId} color={color ?? undefined} size='sm' />}
      title={label}
      description={description || undefined}
      actions={
        <div className='flex items-center gap-2'>
          <span className='text-xs text-muted-foreground'>
            {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
          </span>
          {isAutoDefault && (
            <span className='text-[10px] uppercase tracking-wide text-muted-foreground/70'>
              default
            </span>
          )}
          {isMention && (
            <Tooltip
              side='left'
              content='Referenced in instructions. Remove the @-mention to unlock.'>
              <span
                className='flex items-center text-muted-foreground hover:text-primary'
                aria-label='Locked by mention in instructions'>
                <Lock className='size-3.5' />
              </span>
            </Tooltip>
          )}
          {isMention ? (
            <Tooltip side='left' content='Locked — referenced in instructions.'>
              <span className='inline-flex opacity-60'>
                <Switch size='xs' checked={localEnabled} disabled />
              </span>
            </Tooltip>
          ) : (
            <Switch
              size='xs'
              checked={localEnabled}
              onCheckedChange={(checked) => {
                setLocalEnabled(checked)
                onToolsetToggle(slug, checked)
              }}
            />
          )}
        </div>
      }
    />
  )
}
