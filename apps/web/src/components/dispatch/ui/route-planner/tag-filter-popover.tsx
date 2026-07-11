// apps/web/src/components/dispatch/ui/route-planner/tag-filter-popover.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Command, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Tag } from 'lucide-react'

interface TagFilterPopoverProps {
  /** Distinct `work_order.tags` values across the planner's visible day. */
  tags: string[]
  /** `null` = every tag is visible (the default, no filter applied). */
  selectedTags: Set<string> | null
  onChange: (tags: Set<string> | null) => void
}

/**
 * Route planner tag/region filter (09-route-planner.md §A) — a `Command` multi-select over the
 * visible day's distinct work-order tags, narrowing both the map pins and the backlog list.
 * Shape copied verbatim from `board/worker-filter-popover.tsx`.
 */
export function TagFilterPopover({ tags, selectedTags, onChange }: TagFilterPopoverProps) {
  const isSelected = (tag: string) => selectedTags === null || selectedTags.has(tag)

  const toggle = (tag: string) => {
    const current = selectedTags ?? new Set(tags)
    const next = new Set(current)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    onChange(next.size === tags.length ? null : next)
  }

  if (tags.length === 0) return null

  const label =
    selectedTags === null
      ? 'All tags'
      : `${selectedTags.size} tag${selectedTags.size === 1 ? '' : 's'}`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant='outline' size='sm'>
          <Tag /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-56 p-0'>
        <Command>
          <CommandList>
            <CommandGroup>
              {tags.map((tag) => (
                <CommandItem key={tag} onSelect={() => toggle(tag)}>
                  <Checkbox checked={isSelected(tag)} className='pointer-events-none mr-1' />
                  <span className='truncate'>{tag}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
