// apps/web/src/components/tags/ui/tag-picker/create-tag-row.tsx
'use client'

import { getOptionColor, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { EmojiPicker } from '@auxx/ui/components/emoji-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowRight, FolderTree } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import type { Tag } from './types'

interface CreateTagRowProps {
  search: string
  flatTags: Tag[]
  emoji: string
  setEmoji: (s: string) => void
  color: SelectOptionColor
  setColor: (s: SelectOptionColor) => void
  parentId: string | null
  setParentId: (id: string | null) => void
  isCreating: boolean
  handleCreate: () => void
}

/**
 * Inline-create row content. Rendered as a plain div (not CommandItem) so
 * background clicks don't fire any "select" action. The submit button or the
 * parent's Enter-key handler are the only paths to creation.
 */
export function CreateTagRow({
  search,
  flatTags,
  emoji,
  setEmoji,
  color,
  setColor,
  parentId,
  setParentId,
  isCreating,
  handleCreate,
}: CreateTagRowProps) {
  const [parentOpen, setParentOpen] = useState(false)

  const tagMap = useMemo(() => new Map(flatTags.map((t) => [t.id, t])), [flatTags])
  const parentTag = parentId ? tagMap.get(parentId) : null

  return (
    <div className='flex min-h-7 w-full items-center gap-2 px-2 text-sm'>
      <EmojiPicker
        value={emoji}
        onChange={setEmoji}
        color={color}
        onColorChange={(c) => setColor(c as SelectOptionColor)}
        hideColors={false}
        modal={false}>
        <AppIcon
          iconId={emoji || 'tag'}
          color={emoji ? undefined : color}
          inverse={!emoji}
          variant='default'
          size='default'
          className='cursor-pointer'
        />
      </EmojiPicker>
      <span className='truncate'>
        Create "<span className='font-medium'>{search.trim()}</span>"
      </span>
      <Popover open={parentOpen} onOpenChange={setParentOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className='ml-auto flex h-6 items-center gap-1 rounded border px-1.5 text-xs text-muted-foreground hover:bg-muted'>
            <FolderTree className='size-3' />
            {parentTag ? parentTag.title : 'No parent'}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className='w-56 p-0'
          align='end'
          onCloseAutoFocus={(e) => e.preventDefault()}>
          <Command>
            <CommandInput placeholder='Search parents…' />
            <CommandList>
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setParentId(null)
                    setParentOpen(false)
                  }}
                  className='cursor-pointer'>
                  No parent
                </CommandItem>
                {flatTags.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={t.title}
                    onSelect={() => {
                      setParentId(t.id)
                      setParentOpen(false)
                    }}
                    className='cursor-pointer'>
                    {t.tag_emoji ? (
                      <span className='mr-2'>{t.tag_emoji}</span>
                    ) : (
                      <div
                        className={cn(
                          'mr-2 size-3 rounded-full',
                          getOptionColor((t.tag_color || 'gray') as SelectOptionColor).swatch
                        )}
                      />
                    )}
                    <span>{t.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button
        type='button'
        size='icon-xs'
        variant='ghost'
        onClick={handleCreate}
        loading={isCreating}>
        <ArrowRight />
      </Button>
    </div>
  )
}
