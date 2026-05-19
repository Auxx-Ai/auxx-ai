// apps/web/src/components/agents/ui/detail/tools/tool-select-row.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { pluralize } from '@auxx/utils/strings'
import { Check, Trash2 } from 'lucide-react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { Tooltip } from '~/components/global/tooltip'

export interface ToolSelectRowProps {
  /** Either a toolset slug or an app id — opaque to the row. */
  id: string
  iconId: string
  color: string | null
  label: string
  description?: string
  /** Right-side badge label, e.g. `'3 tools'`. */
  badge?: string
  /** Tool display names shown in the badge tooltip. */
  toolNames?: string[]
  /** Subtitle line shown below the label — used by the Apps tab to show installed counts. */
  subtitle?: string
  installed: boolean
  /**
   * Source of the installed state, when known. `'manual'` = removable;
   * `'mention'` / `'auto_default'` = locked (trash disabled with tooltip).
   */
  source?: 'manual' | 'mention' | 'auto_default'
  /**
   * Click handler for the row body. Toggles add/remove for toolsets; opens
   * the app-detail view for apps.
   */
  onSelect: () => void
  /**
   * Optional inline remove handler. When supplied + `installed === true` +
   * the row is removable, renders a hover trash button that fires this
   * instead of `onSelect`.
   */
  onRemove?: () => void
}

/**
 * Row used inside the Tool-Select dialog (All tab + App-detail tab). Avatar
 * spans two lines, title + description on the right, optional badge on the
 * far right. When `installed`, a green check overlays the avatar and a
 * hover-only trash button appears (or a disabled trash with tooltip when
 * `source` indicates the row is locked).
 */
export function ToolSelectRow({
  iconId,
  color,
  label,
  description,
  badge,
  toolNames,
  subtitle,
  installed,
  source,
  onSelect,
  onRemove,
}: ToolSelectRowProps) {
  const removable = source === undefined || source === 'manual'
  const lockedTooltip =
    source === 'mention'
      ? "This tool is referenced in your agent's prompt. To remove it, first edit your prompt."
      : 'Required'

  return (
    <button
      type='button'
      onClick={onSelect}
      className='group flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-primary-100/80'>
      <div className='relative shrink-0'>
        <AppIcon
          iconId={iconId}
          color={color ?? undefined}
          size='lg'
          className='border border-foreground/5'
        />
        {installed && (
          <span className='absolute -top-0.5 -right-0.5 inline-flex size-2.5 items-center justify-center rounded-full bg-green-500 ring-1 ring-background'>
            <Check className='size-2 text-white' />
          </span>
        )}
      </div>

      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex items-center gap-2'>
          <span className='truncate text-sm font-medium'>{label}</span>
          {badge &&
            (toolNames && toolNames.length > 0 ? (
              <Tooltip
                side='top'
                contentComponent={
                  <div className='flex max-w-xs flex-col gap-0.5 py-0 text-xs'>
                    {toolNames.map((name) => (
                      <span key={name}>{name}</span>
                    ))}
                  </div>
                }>
                <Badge variant='purple' size='xs' className='text-[10px]'>
                  {badge}
                </Badge>
              </Tooltip>
            ) : (
              <Badge variant='purple' size='xs' className='text-[10px]'>
                {badge}
              </Badge>
            ))}
        </div>
        {description && (
          <span className='truncate text-xs text-muted-foreground'>{description}</span>
        )}
        {!description && subtitle && (
          <span className='text-xs text-muted-foreground'>{subtitle}</span>
        )}
      </div>

      {installed &&
        onRemove &&
        (removable ? (
          <span
            role='button'
            tabIndex={-1}
            aria-label='Remove toolset'
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className='ml-2 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100'>
            <Trash2 className='size-3.5' />
          </span>
        ) : (
          <Tooltip side='left' content={lockedTooltip}>
            <span
              aria-label='Toolset locked'
              className='ml-2 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 group-hover:opacity-100'>
              <Trash2 className='size-3.5' />
            </span>
          </Tooltip>
        ))}
    </button>
  )
}

/** Build the `{n} tools` badge string. Returns `null` for rows with one or zero tools. */
export function toolCountBadge(toolCount: number): string | null {
  if (toolCount < 2) return null
  return `${toolCount} ${pluralize(toolCount, 'tool')}`
}
