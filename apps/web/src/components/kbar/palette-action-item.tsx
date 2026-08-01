// apps/web/src/components/kbar/palette-action-item.tsx
'use client'

import { CommandItem } from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { useMemo } from 'react'
import type { PaletteAction } from './types'

/** The chord keys rendered as small kbd boxes (matches the old result-item look). */
function ShortcutHint({ keys }: { keys: string[] }) {
  return (
    <div className='ml-auto flex shrink-0 items-center gap-1'>
      {keys.map((key, i) => (
        <kbd
          key={i}
          className='flex items-center rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-muted-foreground dark:border-[#323842]/80'>
          {key.toLowerCase()}
        </kbd>
      ))}
    </div>
  )
}

/**
 * One command-palette row. `value` is the stable action id (kept unique so cmdk
 * selection is unambiguous); matching terms ride on `keywords` (label + subtitle
 * + the action's own keywords). Enter / click run `perform`; `onRun` fires first
 * (e.g. to record recents).
 */
export function PaletteActionItem({
  action,
  onRun,
}: {
  action: PaletteAction
  onRun?: (action: PaletteAction) => void
}) {
  const keywords = useMemo(() => {
    const parts = [action.label, action.subtitle, action.keywords].filter(Boolean) as string[]
    return parts.join(' ').split(/\s+/).filter(Boolean)
  }, [action.label, action.subtitle, action.keywords])

  const handleSelect = () => {
    if (action.disabled) return
    onRun?.(action)
    action.perform()
  }

  return (
    <CommandItem
      value={action.id}
      keywords={keywords}
      disabled={action.disabled}
      onSelect={handleSelect}>
      {action.icon && (
        <EntityIcon
          iconId={action.icon}
          color='gray'
          size='sm'
          inverse
          className='-ms-0.5 inset-shadow-xs inset-shadow-black/20'
        />
      )}
      <div className='flex min-w-0 flex-1 items-center gap-2'>
        <span className='shrink-0'>{action.label}</span>
        {action.subtitle && (
          <span className='min-w-0 truncate text-xs text-muted-foreground'>{action.subtitle}</span>
        )}
      </div>
      {action.shortcut?.length ? <ShortcutHint keys={action.shortcut} /> : null}
    </CommandItem>
  )
}
