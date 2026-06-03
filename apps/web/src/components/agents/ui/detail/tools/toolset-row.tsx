// apps/web/src/components/agents/ui/detail/tools/toolset-row.tsx
'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { pluralize } from '@auxx/utils/strings'
import { Lock } from 'lucide-react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { Tooltip } from '~/components/global/tooltip'
import { RemoveButton } from './remove-button'

export interface ToolsetRowProps {
  label: string
  iconId: string
  /** `null` = inherit / neutral. */
  color: string | null
  /** Optional one-line tooltip; rendered by `<TreeRow>` as a help-icon. */
  description?: string
  toolCount: number
  source: 'manual' | 'mention' | 'auto_default'
  /** Read-only restriction count for this toolset; ≥1 shows a lock badge. */
  restrictionCount?: number
  depth?: number
  onRemove?: () => void
}

/**
 * One toolset rendered as a single-line TreeRow: icon + short label + tool
 * count + trash button. Only mention-locked rows render a disabled trash;
 * `manual` and `auto_default` are both freely removable. The toolset is the
 * atomic unit of control — there are no per-tool sub-rows.
 */
export function ToolsetRow({
  label,
  iconId,
  color,
  description,
  toolCount,
  source,
  restrictionCount = 0,
  depth = 0,
  onRemove,
}: ToolsetRowProps) {
  const removable = source !== 'mention'
  const tooltip = removable
    ? 'Remove toolset'
    : "This tool is referenced in your agent's prompt. To remove it, first edit your prompt."

  return (
    <TreeRow
      depth={depth}
      icon={<AppIcon iconId={iconId} color={color ?? undefined} size='sm' />}
      title={label}
      description={description || undefined}
      secondary={
        <span className='inline-flex items-center gap-2'>
          <span>{`${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`}</span>
          {restrictionCount > 0 ? (
            <Tooltip
              content={`${restrictionCount} ${pluralize(restrictionCount, 'restricted argument')}`}>
              <span className='inline-flex items-center gap-0.5 text-[11px] text-muted-foreground'>
                <Lock className='size-3' />
                {restrictionCount}
              </span>
            </Tooltip>
          ) : null}
        </span>
      }
      actions={
        onRemove && <RemoveButton enabled={removable} tooltip={tooltip} onClick={onRemove} />
      }
    />
  )
}
