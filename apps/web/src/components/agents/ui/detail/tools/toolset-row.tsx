// apps/web/src/components/agents/ui/detail/tools/toolset-row.tsx
'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { AppIcon } from '~/components/apps/ui/app-icon'
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
      secondary={`${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`}
      actions={
        onRemove && <RemoveButton enabled={removable} tooltip={tooltip} onClick={onRemove} />
      }
    />
  )
}
