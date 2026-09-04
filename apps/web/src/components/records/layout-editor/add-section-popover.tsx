// apps/web/src/components/records/layout-editor/add-section-popover.tsx
'use client'

import type { LayoutBlock } from '@auxx/lib/resources/client'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { ListTree, Rows3 } from 'lucide-react'
import { resolveLayoutIcon } from '~/components/records/layout/layout-icon'

export interface AddSectionMenuProps {
  tabLabel: string
  /** Predefined blocks for this definition that are not currently rendering. */
  blocks: LayoutBlock[]
  onSelectBlock: (block: LayoutBlock) => void
  onCreateRecordsBlock: () => void
  onCreateFieldsBlock: () => void
}

/**
 * The body of the "Add section" command popover, scoped to one tab (§9.4).
 *
 * A searchable list of every predefined block for this definition that is not
 * currently rendering anywhere, plus the two creators at the bottom. The popover
 * shell lives in `LayoutTabRow`, so the menu is anchored to the row's own button
 * without this component needing to know anything about the tree.
 */
export function AddSectionMenu({
  tabLabel,
  blocks,
  onSelectBlock,
  onCreateRecordsBlock,
  onCreateFieldsBlock,
}: AddSectionMenuProps) {
  return (
    <Command>
      <CommandInput placeholder={`Add a section to ${tabLabel}...`} />
      <CommandList>
        <CommandEmpty>No section matches.</CommandEmpty>
        {blocks.length > 0 && (
          <CommandGroup heading='Available sections'>
            {blocks.map((block) => {
              const Icon = resolveLayoutIcon(block.icon) ?? Rows3
              return (
                <CommandItem
                  key={block.id}
                  value={`${block.label} ${block.id}`}
                  onSelect={() => onSelectBlock(block)}>
                  <Icon className='size-4' />
                  {block.label}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading='Create'>
          <CommandItem value='new related list' onSelect={onCreateRecordsBlock}>
            <ListTree className='size-4' />
            New related list...
          </CommandItem>
          <CommandItem value='new field group' onSelect={onCreateFieldsBlock}>
            <Rows3 className='size-4' />
            New field group...
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
